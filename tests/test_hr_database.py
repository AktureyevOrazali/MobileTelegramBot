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

    def test_create_hr_request_appends_created_event(self):
        class _Cursor:
            def __init__(self, row=None, rows=None):
                self._row = row
                self._rows = rows or []

            def fetchone(self):
                return self._row

            def fetchall(self):
                return self._rows

        inserted_events: list[tuple] = []

        def fake_execute(query, params=None):
            normalized_query = " ".join(query.split())
            if "FROM hr_request_templates" in normalized_query:
                return _Cursor(
                    {
                        "id": 7,
                        "title": "Vacation request",
                        "request_type": "vacation",
                        "body": "Please approve {employee_name}.",
                    }
                )
            if "INSERT INTO hr_requests" in normalized_query:
                return _Cursor({"id": 31})
            if "INSERT INTO hr_request_events" in normalized_query:
                inserted_events.append(tuple(params or ()))
                return _Cursor({"id": 101})
            if "FROM hr_requests r" in normalized_query:
                return _Cursor(
                    {
                        "id": 31,
                        "template_id": 7,
                        "template_title": "Vacation request",
                        "request_type": "vacation",
                        "employee_id": 20,
                        "employee_name": "Employee User",
                        "department": "Operator",
                        "status": "new",
                        "values_json": "{}",
                        "rendered_text": "Please approve Employee User.",
                        "summary": "Annual leave",
                        "period": "2026-06-01 - 2026-06-10",
                        "submitted_at": "2026-05-19T10:10:00+00:00",
                        "updated_at": "2026-05-19T10:10:00+00:00",
                        "decided_at": None,
                        "decided_by": None,
                        "decided_by_name": None,
                        "decision_comment": "",
                    }
                )
            if "FROM hr_request_events" in normalized_query:
                return _Cursor(
                    rows=[
                        {
                            "id": 101,
                            "request_id": 31,
                            "action": "created",
                            "actor_id": 20,
                            "actor_name": "Employee User",
                            "comment": "Annual leave",
                            "created_at": "2026-05-19T10:10:00+00:00",
                        }
                    ]
                )
            return _Cursor()

        original_lock = database._lock
        try:
            database._lock = MagicMock()
            database._lock.__enter__.return_value = None
            database._lock.__exit__.return_value = None
            with patch.object(database, "execute", side_effect=fake_execute):
                hr_request = database.create_hr_request(
                    template_id=7,
                    employee_id=20,
                    employee_name="Employee User",
                    department="Operator",
                    values={},
                    summary="Annual leave",
                    period="2026-06-01 - 2026-06-10",
                )
        finally:
            database._lock = original_lock

        self.assertEqual(inserted_events[0][1], "created")
        self.assertEqual(inserted_events[0][3], "Employee User")
        self.assertEqual(hr_request["events"][0]["action"], "created")
        self.assertEqual(hr_request["events"][0]["comment"], "Annual leave")

    def test_decide_hr_request_appends_decision_event(self):
        class _Cursor:
            def __init__(self, row=None, rows=None):
                self._row = row
                self._rows = rows or []

            def fetchone(self):
                return self._row

            def fetchall(self):
                return self._rows

        inserted_events: list[tuple] = []

        def fake_execute(query, params=None):
            normalized_query = " ".join(query.split())
            if normalized_query.startswith("UPDATE hr_requests"):
                return _Cursor({"id": 31})
            if "INSERT INTO hr_request_events" in normalized_query:
                inserted_events.append(tuple(params or ()))
                return _Cursor({"id": 102})
            if "FROM hr_requests r" in normalized_query:
                return _Cursor(
                    {
                        "id": 31,
                        "template_id": 7,
                        "template_title": "Vacation request",
                        "request_type": "vacation",
                        "employee_id": 20,
                        "employee_name": "Employee User",
                        "department": "Operator",
                        "status": "needsInfo",
                        "values_json": "{}",
                        "rendered_text": "Signed text",
                        "summary": "Annual leave",
                        "period": "2026-06-01 - 2026-06-10",
                        "submitted_at": "2026-05-19T10:10:00+00:00",
                        "updated_at": "2026-05-19T10:20:00+00:00",
                        "decided_at": None,
                        "decided_by": 10,
                        "decided_by_name": "HR User",
                        "decision_comment": "Attach certificate",
                    }
                )
            if "FROM hr_request_events" in normalized_query:
                return _Cursor(
                    rows=[
                        {
                            "id": 102,
                            "request_id": 31,
                            "action": "needsInfo",
                            "actor_id": 10,
                            "actor_name": "HR User",
                            "comment": "Attach certificate",
                            "created_at": "2026-05-19T10:20:00+00:00",
                        }
                    ]
                )
            return _Cursor()

        original_lock = database._lock
        try:
            database._lock = MagicMock()
            database._lock.__enter__.return_value = None
            database._lock.__exit__.return_value = None
            with patch.object(database, "execute", side_effect=fake_execute):
                hr_request = database.decide_hr_request(
                    31,
                    status="needsInfo",
                    decided_by=10,
                    decided_by_name="HR User",
                    comment="Attach certificate",
                )
        finally:
            database._lock = original_lock

        self.assertEqual(inserted_events[0][1], "needsInfo")
        self.assertEqual(inserted_events[0][2], 10)
        self.assertEqual(inserted_events[0][4], "Attach certificate")
        self.assertEqual(hr_request["events"][0]["action"], "needsInfo")
        self.assertEqual(hr_request["events"][0]["comment"], "Attach certificate")

    def test_update_user_profile_persists_organization(self):
        captured_params: list[tuple] = []

        def fake_execute(query, params=None):
            normalized_query = " ".join(query.split())
            if normalized_query.startswith("UPDATE users SET"):
                captured_params.append(tuple(params or ()))
            return MagicMock(fetchone=lambda: None)

        updated_user = {
            "id": 20,
            "email": "employee@example.kz",
            "name": "Employee User",
            "created_at": "2026-05-19T00:00:00+00:00",
            "job_title": "Operator",
            "organization": "ТОО Азия-Сервис",
            "phone": "",
            "bio": "",
            "login": "employee",
            "role": "operator",
            "is_approved": True,
        }

        original_lock = database._lock
        try:
            database._lock = MagicMock()
            database._lock.__enter__.return_value = None
            database._lock.__exit__.return_value = None
            with patch.object(database, "execute", side_effect=fake_execute), patch.object(
                database,
                "get_user_by_id",
                return_value=updated_user,
            ), patch.object(database, "get_user_sections", return_value=[]), patch.object(
                database,
                "get_user_bin_assignments",
                return_value=[],
            ):
                profile = database.update_user_profile(
                    20,
                    name="Employee User",
                    job_title="Operator",
                    organization="ТОО Азия-Сервис",
                    phone="",
                    bio="",
                    email="employee@example.kz",
                )
        finally:
            database._lock = original_lock

        self.assertEqual(profile["organization"], "ТОО Азия-Сервис")
        self.assertIn("ТОО Азия-Сервис", captured_params[0])

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
