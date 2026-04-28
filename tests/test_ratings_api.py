import unittest
from datetime import date
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend import api


def _admin_user():
    return {"id": 1, "role": "admin"}


class RatingsApiTests(unittest.TestCase):
    def setUp(self):
        api.app.dependency_overrides[api.require_admin_or_moderator] = _admin_user
        self.client = TestClient(api.app)

    def tearDown(self):
        api.app.dependency_overrides.clear()

    def test_ratings_summary_endpoint_is_registered(self):
        with patch.object(
            api.database,
            "get_ratings_summary",
            return_value={
                "employees": {"rating_count": 2},
                "clients": {"rating_count": 3},
                "ai": {"rating_count": 4},
                "missing_flows": [],
                "updated_at": "2026-04-28T00:00:00+00:00",
            },
        ):
            response = self.client.get("/api/analytics/ratings/summary")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["employees"]["rating_count"], 2)

    def test_rating_ledger_endpoint_passes_filters(self):
        captured = {}

        def fake_get_rating_ledger(**filters):
            captured.update(filters)
            return {
                "items": [],
                "total": 0,
                "limit": filters["limit"],
                "offset": filters["offset"],
                "updated_at": "2026-04-28T00:00:00+00:00",
            }

        with patch.object(api.database, "get_rating_ledger", side_effect=fake_get_rating_ledger):
            response = self.client.get(
                "/api/analytics/ratings/ledger",
                params={
                    "start_date": "2026-04-01",
                    "end_date": "2026-04-28",
                    "rater_type": "client",
                    "rated_object_type": "employee",
                    "employee_id": 7,
                    "employee_name": "Operator One",
                    "client_bin": "131313131313",
                    "client_id": 11,
                    "section": "support",
                    "region": "Almaty",
                    "organization": "ACME",
                    "ai_involved": "true",
                    "channel": "webapp",
                    "limit": 25,
                    "offset": 50,
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            captured,
            {
                "start_date": date(2026, 4, 1),
                "end_date": date(2026, 4, 28),
                "rater_type": "client",
                "rated_object_type": "employee",
                "employee_id": 7,
                "employee_name": "Operator One",
                "client_bin": "131313131313",
                "client_id": 11,
                "section": "support",
                "region": "Almaty",
                "organization": "ACME",
                "ai_involved": True,
                "channel": "webapp",
                "limit": 25,
                "offset": 50,
            },
        )


if __name__ == "__main__":
    unittest.main()
