import unittest
from unittest.mock import patch

from backend import customer_surveys, database


class DatabaseConstraintTests(unittest.TestCase):
    def test_ensure_check_constraint_recreates_existing_named_constraint(self):
        executed_queries: list[str] = []

        with (
            patch.object(database, "_constraint_exists", return_value=True),
            patch.object(database, "execute", side_effect=lambda query, params=None: executed_queries.append(query)),
        ):
            database._ensure_check_constraint(
                "survey_sessions",
                constraint_name="chk_survey_sessions_status_known",
                expression='"status" IS NULL OR "status" IN (\'current\')',
                not_valid=False,
            )

        self.assertTrue(
            any("DROP CONSTRAINT IF EXISTS" in query for query in executed_queries),
            executed_queries,
        )
        self.assertTrue(
            any("ADD CONSTRAINT" in query and "CHECK" in query for query in executed_queries),
            executed_queries,
        )

    def test_ensure_active_chat_dialog_preserves_operator_mode_for_existing_dialog(self):
        class _Cursor:
            def __init__(self, row=None):
                self._row = row

            def fetchone(self):
                return self._row

        executed_queries: list[str] = []

        def fake_execute(query, params=None):
            executed_queries.append(query)
            normalized_query = " ".join(query.split())
            if "SELECT 1 FROM all_bins" in normalized_query:
                return _Cursor({"exists": 1})
            if "FROM chat_dialogs" in normalized_query and "ended_at IS NULL" in normalized_query:
                return _Cursor({"id": 30, "bin": "181818181818"})
            if "SELECT 1 FROM appeals" in normalized_query:
                return _Cursor({"exists": 1})
            return _Cursor()

        with (
            patch.object(database, "execute", side_effect=fake_execute),
            patch.object(database, "create_appeal"),
        ):
            result = database.ensure_active_chat_dialog(
                20,
                "181818181818",
                return_state=True,
            )

        self.assertEqual(result, (30, False))
        self.assertFalse(
            any(
                "UPDATE chat_dialogs" in query
                and "operator_mode = 0" in " ".join(query.split())
                for query in executed_queries
            ),
            executed_queries,
        )

    def test_delete_survey_template_archives_active_template_instead_of_rejecting(self):
        class _Cursor:
            def __init__(self, row=None, rowcount=1):
                self._row = row
                self.rowcount = rowcount

            def fetchone(self):
                return self._row

        executed_queries: list[str] = []

        def fake_execute(query, params=None):
            executed_queries.append(query)
            normalized_query = " ".join(query.split())
            if "SELECT status FROM survey_templates" in normalized_query:
                return _Cursor({"status": "active"})
            if "SELECT 1 FROM survey_sessions" in normalized_query:
                return _Cursor({"exists": 1})
            if "UPDATE survey_templates" in normalized_query and "status = %s" in normalized_query:
                return _Cursor(rowcount=1)
            return _Cursor()

        with patch.object(database, "execute", side_effect=fake_execute):
            deleted = database.delete_survey_template(42)

        self.assertTrue(deleted)
        self.assertTrue(
            any(
                "UPDATE survey_templates" in query
                and "status = %s" in " ".join(query.split())
                for query in executed_queries
            ),
            executed_queries,
        )

    def test_operator_rating_targets_fall_back_to_dialog_stats_when_appeal_has_no_rows(self):
        class _Cursor:
            def __init__(self, rows=None):
                self._rows = rows or []

            def fetchall(self):
                return self._rows

        def fake_execute(query, params=None):
            normalized_query = " ".join(query.split())
            if "WHERE appeal_id = %s" in normalized_query:
                return _Cursor([])
            if "WHERE dialog_id = %s AND appeal_id IS NULL" in normalized_query:
                return _Cursor(
                    [
                        {
                            "id": 77,
                            "operator_name": "Arai",
                            "messages_sent": 2,
                            "response_count": 1,
                        }
                    ]
                )
            return _Cursor([])

        with patch.object(database, "execute", side_effect=fake_execute):
            targets = database.list_operator_rating_targets(30, appeal_id=40)

        self.assertEqual(len(targets), 1)
        self.assertEqual(targets[0]["operator_name"], "Arai")

    def test_default_after_csat_seed_ignores_generic_monthly_survey(self):
        class _Cursor:
            def __init__(self, row=None):
                self._row = row
                self.rowcount = 1

            def fetchone(self):
                return self._row

        survey_template_select_params: list[tuple] = []
        inserted_template_params: list[tuple] = []
        inserted_questions: list[tuple] = []

        def fake_execute(query, params=None):
            normalized_query = " ".join(query.split())
            if "FROM survey_templates st" in normalized_query:
                survey_template_select_params.append(tuple(params or ()))
                return _Cursor(None)
            if "INSERT INTO survey_templates" in normalized_query:
                inserted_template_params.append(tuple(params or ()))
                return _Cursor({"id": 120})
            if "INSERT INTO survey_questions" in normalized_query:
                inserted_questions.append(tuple(params or ()))
                return _Cursor()
            return _Cursor()

        with patch.object(database, "execute", side_effect=fake_execute):
            database._ensure_default_after_csat_survey_template()

        self.assertTrue(survey_template_select_params)
        self.assertNotIn(customer_surveys.SURVEY_TRIGGER_PERIODIC, survey_template_select_params[0])
        self.assertIn(customer_surveys.SURVEY_TRIGGER_AFTER_EMPLOYEE_CSAT, survey_template_select_params[0])
        self.assertTrue(inserted_template_params)
        self.assertIn(customer_surveys.SURVEY_TRIGGER_AFTER_EMPLOYEE_CSAT, inserted_template_params[0])
        self.assertEqual(len(inserted_questions), len(customer_surveys.default_after_csat_questions()))


if __name__ == "__main__":
    unittest.main()
