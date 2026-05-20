import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend import api


def _hr_user():
    return {
        "id": 10,
        "email": "hr@example.kz",
        "login": "hr",
        "name": "HR User",
        "role": "hr",
        "created_at": "2026-05-19T00:00:00+00:00",
        "job_title": "HR",
        "phone": "",
        "bio": "",
        "is_approved": True,
        "sections": [],
        "bins": [],
        "favorite_dialog_ids": [],
    }


def _employee_user():
    return {
        "id": 20,
        "email": "employee@example.kz",
        "login": "employee",
        "name": "Employee User",
        "role": "operator",
        "created_at": "2026-05-19T00:00:00+00:00",
        "job_title": "Operator",
        "phone": "",
        "bio": "",
        "is_approved": True,
        "sections": [],
        "bins": [],
        "favorite_dialog_ids": [],
    }


class HrRequestsApiTests(unittest.TestCase):
    def setUp(self):
        api.app.dependency_overrides[api.get_current_user] = _hr_user
        self.client = TestClient(api.app)

    def tearDown(self):
        api.app.dependency_overrides.clear()

    def test_hr_can_create_template(self):
        template = {
            "id": 7,
            "title": "Vacation request",
            "type": "vacation",
            "description": "",
            "body": "Please approve {employee_name} from {start_date}.",
            "variables": ["employee_name", "start_date"],
            "status": "active",
            "created_by": 10,
            "created_at": "2026-05-19T10:00:00+00:00",
            "updated_at": "2026-05-19T10:00:00+00:00",
        }
        captured = {}

        def fake_create(**kwargs):
            captured.update(kwargs)
            return template

        with patch.object(api.database, "create_hr_template", side_effect=fake_create):
            response = self.client.post(
                "/api/hr/templates",
                json={
                    "title": "Vacation request",
                    "type": "vacation",
                    "body": "Please approve {employee_name} from {start_date}.",
                    "variables": ["employee_name", "start_date"],
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], 7)
        self.assertEqual(captured["created_by"], 10)
        self.assertEqual(captured["variables"], ["employee_name", "start_date"])

    def test_employee_can_submit_request_from_template(self):
        api.app.dependency_overrides[api.get_current_user] = _employee_user
        request_row = {
            "id": 31,
            "template_id": 7,
            "template_title": "Vacation request",
            "type": "vacation",
            "employee_id": 20,
            "employee_name": "Employee User",
            "department": "Operator",
            "status": "new",
            "values": {"start_date": "2026-06-01", "end_date": "2026-06-10"},
            "rendered_text": "Please approve Employee User from 2026-06-01.",
            "summary": "Annual leave",
            "period": "2026-06-01 - 2026-06-10",
            "submitted_at": "2026-05-19T10:10:00+00:00",
            "updated_at": "2026-05-19T10:10:00+00:00",
            "decided_at": None,
            "decided_by": None,
            "decided_by_name": None,
            "decision_comment": "",
        }
        captured = {}

        def fake_create(**kwargs):
            captured.update(kwargs)
            return request_row

        with patch.object(api.database, "create_hr_request", side_effect=fake_create):
            response = self.client.post(
                "/api/hr/requests",
                json={
                    "template_id": 7,
                    "values": {"start_date": "2026-06-01", "end_date": "2026-06-10"},
                    "summary": "Annual leave",
                    "period": "2026-06-01 - 2026-06-10",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "new")
        self.assertEqual(captured["employee_id"], 20)
        self.assertEqual(captured["employee_name"], "Employee User")

    def test_hr_can_approve_request(self):
        decided = {
            "id": 31,
            "template_id": 7,
            "template_title": "Vacation request",
            "type": "vacation",
            "employee_id": 20,
            "employee_name": "Employee User",
            "department": "Operator",
            "status": "approved",
            "values": {},
            "rendered_text": "Signed text",
            "summary": "Annual leave",
            "period": "2026-06-01 - 2026-06-10",
            "submitted_at": "2026-05-19T10:10:00+00:00",
            "updated_at": "2026-05-19T10:20:00+00:00",
            "decided_at": "2026-05-19T10:20:00+00:00",
            "decided_by": 10,
            "decided_by_name": "HR User",
            "decision_comment": "Approved",
        }

        with patch.object(api.database, "decide_hr_request", return_value=decided) as decide:
            response = self.client.post(
                "/api/hr/requests/31/decision",
                json={"status": "approved", "comment": "Approved"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "approved")
        decide.assert_called_once_with(
            31,
            status="approved",
            decided_by=10,
            decided_by_name="HR User",
            comment="Approved",
        )


if __name__ == "__main__":
    unittest.main()
