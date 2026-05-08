import unittest
from datetime import date
from unittest.mock import patch

from backend import database


class _DefaultRow(dict):
    def __getitem__(self, key):
        return self.get(key, 0)


class _Cursor:
    def __init__(self, row=None, rows=None):
        self._row = _DefaultRow(row or {})
        self._rows = rows if rows is not None else []

    def fetchone(self):
        return self._row

    def fetchall(self):
        return self._rows


def _count_row(prefix, count):
    row = {f"{prefix}_median": 5, f"{prefix}_count": count}
    for rating in range(1, 6):
        row[f"{prefix}_{rating}"] = count if rating == 5 else 0
    return row


class DashboardCsatPeriodTests(unittest.TestCase):
    def test_dashboard_csat_filters_primary_ratings_by_rating_created_at(self):
        calls = []

        def fake_execute(query, params=None):
            calls.append((query, tuple(params or ())))
            return _Cursor()

        with patch.object(database, "execute", side_effect=fake_execute):
            database.get_dashboard_summary(
                start_date=date(2026, 2, 1),
                end_date=date(2026, 5, 1),
            )

        operator_queries = [
            query for query, _params in calls
            if "FROM operator_csat_ratings ocr" in query
        ]
        client_queries = [
            query for query, params in calls
            if "FROM dialog_feedback_ratings dfr" in query
            and database.DIALOG_FEEDBACK_KIND_CLIENT in params
        ]
        ai_queries = [
            query for query, params in calls
            if "FROM dialog_feedback_ratings dfr" in query
            and database.DIALOG_FEEDBACK_KIND_AI in params
        ]

        self.assertTrue(client_queries, "client CSAT query was not executed")
        self.assertIn("dfr.created_at >= %s", client_queries[0])
        self.assertNotIn("WHERE ds.started_at >= %s", client_queries[0])

        self.assertTrue(operator_queries, "operator CSAT query was not executed")
        self.assertIn("ocr.created_at >= %s", operator_queries[0])
        self.assertNotIn("WHERE ds.started_at >= %s", operator_queries[0])

        self.assertTrue(ai_queries, "AI CSAT query was not executed")
        self.assertIn("dfr.created_at >= %s", ai_queries[0])
        self.assertNotIn("WHERE ds.started_at >= %s", ai_queries[0])

    def test_dashboard_csat_does_not_replace_primary_ratings_with_operator_subset(self):
        def fake_execute(query, params=None):
            if "FROM dialog_feedback_ratings dfr" in query and database.DIALOG_FEEDBACK_KIND_CLIENT in tuple(params or ()):
                return _Cursor(_count_row("csat", 17))
            if "FROM operator_csat_ratings ocr" in query:
                return _Cursor(_count_row("csat", 3))
            if "FROM dialog_feedback_ratings dfr" in query and database.DIALOG_FEEDBACK_KIND_AI in tuple(params or ()):
                return _Cursor(_count_row("ai_csat", 4))
            return _Cursor()

        with patch.object(database, "execute", side_effect=fake_execute):
            summary = database.get_dashboard_summary(
                start_date=date(2026, 2, 8),
                end_date=date(2026, 5, 8),
            )

        self.assertEqual(summary["csat_count"], 17)


if __name__ == "__main__":
    unittest.main()
