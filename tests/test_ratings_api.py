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
        api.app.dependency_overrides[api.require_onec_token] = lambda: None
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

    def test_onec_rating_defaults_to_operator_target(self):
        with (
            patch.object(api.database, "save_csat_rating", return_value=True) as save_operator,
            patch.object(api.database, "save_ai_csat_rating", return_value=True) as save_ai,
        ):
            response = self.client.post(
                "/integrations/1c/rating",
                json={
                    "external_chat_id": "onec-chat-1",
                    "dialog_id": 42,
                    "appeal_id": 99,
                    "rating": 5,
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["target"], "operator")
        save_operator.assert_called_once_with(
            42,
            5,
            appeal_id=99,
            rater_external_chat_id="onec-chat-1",
            channel=api.database.RATING_CHANNEL_ONEC_API,
        )
        save_ai.assert_not_called()

    def test_onec_rating_without_dialog_uses_latest_closed_dialog_for_chat(self):
        with (
            patch.object(api, "_resolve_onec_chat_id", return_value=20) as resolve_chat,
            patch.object(api.database, "get_latest_closed_chat_dialog_id", return_value=42, create=True) as latest_dialog,
            patch.object(api.database, "get_latest_closed_appeal_id", return_value=99) as latest_appeal,
            patch.object(api.database, "save_csat_rating", return_value=True) as save_operator,
            patch.object(api.database, "save_ai_csat_rating", return_value=True) as save_ai,
            patch.object(api.survey_service, "maybe_start_survey_after_employee_csat", return_value={"started": False}),
        ):
            response = self.client.post(
                "/integrations/1c/rating",
                json={
                    "external_chat_id": "onec-chat-1",
                    "rating": 5,
                },
            )

        self.assertEqual(response.status_code, 200)
        resolve_chat.assert_called_once_with("onec-chat-1", None)
        latest_dialog.assert_called_once_with(20)
        latest_appeal.assert_called_once_with(42)
        save_operator.assert_called_once_with(
            42,
            5,
            appeal_id=99,
            rater_external_chat_id="onec-chat-1",
            channel=api.database.RATING_CHANNEL_ONEC_API,
        )
        save_ai.assert_not_called()

    def test_onec_rating_uses_explicit_chat_id_for_latest_closed_dialog(self):
        with (
            patch.object(api, "_resolve_onec_chat_id", return_value=20) as resolve_chat,
            patch.object(api.database, "get_latest_closed_chat_dialog_id", return_value=42, create=True) as latest_dialog,
            patch.object(api.database, "get_latest_closed_appeal_id", return_value=99) as latest_appeal,
            patch.object(api.database, "save_csat_rating", return_value=True) as save_operator,
            patch.object(api.database, "save_ai_csat_rating", return_value=True) as save_ai,
            patch.object(api.survey_service, "maybe_start_survey_after_employee_csat", return_value={"started": False}),
        ):
            response = self.client.post(
                "/integrations/1c/rating",
                json={
                    "external_chat_id": "onec-chat-1",
                    "chat_id": 20,
                    "rating": 5,
                },
            )

        self.assertEqual(response.status_code, 200)
        resolve_chat.assert_called_once_with("onec-chat-1", 20)
        latest_dialog.assert_called_once_with(20)
        latest_appeal.assert_called_once_with(42)
        save_operator.assert_called_once_with(
            42,
            5,
            appeal_id=99,
            rater_external_chat_id="onec-chat-1",
            channel=api.database.RATING_CHANNEL_ONEC_API,
        )
        save_ai.assert_not_called()

    def test_onec_rating_falls_back_to_stored_external_chat_mapping(self):
        def fake_latest_dialog(chat_id):
            return 42 if chat_id == 20 else None

        with (
            patch.object(api, "_resolve_onec_chat_id", return_value=999) as resolve_chat,
            patch.object(api.database, "get_chat_by_external_chat_id", return_value={"chat_id": 20}, create=True) as get_external_chat,
            patch.object(api.database, "get_latest_closed_chat_dialog_id", side_effect=fake_latest_dialog, create=True) as latest_dialog,
            patch.object(api.database, "get_latest_closed_appeal_id", return_value=99) as latest_appeal,
            patch.object(api.database, "save_csat_rating", return_value=True) as save_operator,
            patch.object(api.database, "save_ai_csat_rating", return_value=True) as save_ai,
            patch.object(api.survey_service, "maybe_start_survey_after_employee_csat", return_value={"started": False}),
        ):
            response = self.client.post(
                "/integrations/1c/rating",
                json={
                    "external_chat_id": "onec-chat-1",
                    "rating": 5,
                },
            )

        self.assertEqual(response.status_code, 200)
        resolve_chat.assert_called_once_with("onec-chat-1", None)
        get_external_chat.assert_called_once_with("onec-chat-1")
        self.assertEqual([call.args[0] for call in latest_dialog.call_args_list], [999, 20])
        latest_appeal.assert_called_once_with(42)
        save_operator.assert_called_once_with(
            42,
            5,
            appeal_id=99,
            rater_external_chat_id="onec-chat-1",
            channel=api.database.RATING_CHANNEL_ONEC_API,
        )
        save_ai.assert_not_called()


if __name__ == "__main__":
    unittest.main()
