import json
import unittest
from unittest.mock import MagicMock, patch

from backend import database


class HrDatabaseTests(unittest.TestCase):
    def test_hr_role_is_supported_by_backend(self):
        self.assertIn(database.ROLE_HR, database.ALL_ROLES)
        self.assertTrue(database.is_hr_staff(database.ROLE_HR))
        self.assertTrue(database.can_manage_hr(database.ROLE_ADMIN))
        self.assertTrue(database.can_manage_hr(database.ROLE_HR))
        self.assertFalse(database.can_manage_hr(database.ROLE_OPERATOR))

    def test_render_hr_template_replaces_known_values_and_keeps_missing_markers(self):
        rendered = database.render_hr_template(
            "Please approve {employee_name} from {start_date} to {end_date}.",
            {"employee_name": "Employee User", "start_date": "2026-06-01"},
        )

        self.assertEqual(
            rendered,
            "Please approve Employee User from 2026-06-01 to {end_date}.",
        )

    def test_create_hr_template_normalizes_variables_from_input_and_body(self):
        class _Cursor:
            def __init__(self, row=None):
                self._row = row

            def fetchone(self):
                return self._row

        captured_params: list[tuple] = []

        def fake_execute(query, params=None):
            normalized_query = " ".join(query.split())
            if "INSERT INTO hr_request_templates" in normalized_query:
                captured_params.append(tuple(params or ()))
                return _Cursor(
                    {
                        "id": 9,
                        "title": params[0],
                        "request_type": params[1],
                        "description": params[2],
                        "body": params[3],
                        "variables": params[4],
                        "status": params[5],
                        "created_by": params[6],
                        "created_at": params[7],
                        "updated_at": params[8],
                    }
                )
            return _Cursor()

        original_lock = database._lock
        try:
            database._lock = MagicMock()
            database._lock.__enter__.return_value = None
            database._lock.__exit__.return_value = None
            with patch.object(database, "execute", side_effect=fake_execute):
                template = database.create_hr_template(
                    title="Vacation",
                    type="vacation",
                    body="Please approve {employee_name} from {start_date} to {end_date}.",
                    variables=["start_date", "not valid", "start_date"],
                    created_by=10,
                )
        finally:
            database._lock = original_lock

        self.assertEqual(template["variables"], ["start_date", "end_date"])
        self.assertEqual(json.loads(captured_params[0][4]), ["start_date", "end_date"])

    def test_default_hr_templates_are_seeded_when_table_is_empty(self):
        class _Cursor:
            def __init__(self, row=None):
                self._row = row

            def fetchone(self):
                return self._row

        inserted_templates: list[tuple] = []

        def fake_execute(query, params=None):
            normalized_query = " ".join(query.split())
            if "SELECT COUNT(*) AS cnt FROM hr_request_templates" in normalized_query:
                return _Cursor({"cnt": 0})
            if "INSERT INTO hr_request_templates" in normalized_query:
                inserted_templates.append(tuple(params or ()))
            return _Cursor()

        original_lock = database._lock
        try:
            database._lock = MagicMock()
            database._lock.__enter__.return_value = None
            database._lock.__exit__.return_value = None
            with patch.object(database, "execute", side_effect=fake_execute):
                database._ensure_default_hr_request_templates()
        finally:
            database._lock = original_lock

        self.assertGreaterEqual(len(inserted_templates), 4)
        titles = {params[0] for params in inserted_templates}
        self.assertIn("Заявление на отпуск", titles)
        self.assertIn("Справка с места работы", titles)


if __name__ == "__main__":
    unittest.main()
