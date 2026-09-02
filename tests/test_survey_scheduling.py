import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from backend import customer_surveys, database, survey_service


class SurveyQuestionValidationTests(unittest.TestCase):
    def test_rejects_blank_questions(self):
        with self.assertRaisesRegex(ValueError, "текст вопроса 1"):
            customer_surveys.validate_survey_questions([
                {"question_type": "scale", "text": "  ", "config": {"min": 1, "max": 5}},
            ])

    def test_rejects_invalid_scale_and_choice_options(self):
        with self.assertRaisesRegex(ValueError, "диапазоне от 1 до 10"):
            customer_surveys.validate_survey_questions([
                {"question_type": "scale", "text": "Оцените", "config": {"min": 5, "max": 5}},
            ])
        with self.assertRaisesRegex(ValueError, "минимум два варианта"):
            customer_surveys.validate_survey_questions([
                {"question_type": "single_choice", "text": "Выберите", "config": {"options": ["Да"]}},
            ])


class SurveyScheduleTests(unittest.TestCase):
    @patch("backend.database.get_survey_template")
    @patch("backend.database.get_chat")
    def test_survey_session_is_rejected_for_telegram_chat(self, get_chat, get_template):
        get_template.return_value = {
            "id": 7,
            "status": customer_surveys.SURVEY_STATUS_ACTIVE,
            "questions": [{"id": 1}],
        }
        get_chat.return_value = {"chat_id": 101, "type": "private"}

        session = database.start_survey_session(
            template_id=7,
            chat_id=101,
            dialog_id=202,
            trigger_source=customer_surveys.SURVEY_TRIGGER_MANUAL,
        )

        self.assertIsNone(session)

    def test_calendar_dispatch_keys_match_month_quarter_and_custom_dates(self):
        self.assertEqual(
            survey_service._calendar_dispatch_keys(
                {"schedule": customer_surveys.SURVEY_PERIOD_MONTHLY},
                datetime(2026, 8, 1, tzinfo=timezone.utc),
            ),
            ["2026-08"],
        )
        self.assertEqual(
            survey_service._calendar_dispatch_keys(
                {"schedule": customer_surveys.SURVEY_PERIOD_QUARTERLY},
                datetime(2026, 9, 30, tzinfo=timezone.utc),
            ),
            ["2026-Q3"],
        )
        self.assertEqual(
            survey_service._calendar_dispatch_keys(
                {"schedule": customer_surveys.SURVEY_PERIOD_CUSTOM, "dates": ["2026-08-28"]},
                datetime(2026, 8, 28, tzinfo=timezone.utc),
            ),
            ["2026-08-28"],
        )
        self.assertEqual(
            survey_service._calendar_dispatch_keys(
                {"schedule": customer_surveys.SURVEY_PERIOD_MONTHLY},
                datetime(2026, 8, 2, tzinfo=timezone.utc),
            ),
            [],
        )

    @patch("backend.survey_service.start_survey_for_context")
    @patch("backend.survey_service.database.resolve_survey_manual_targets")
    @patch("backend.survey_service.database.list_survey_templates")
    def test_periodic_launch_starts_and_reports_each_target(self, list_templates, resolve_targets, start_context):
        list_templates.return_value = [{
            "id": 7,
            "launch_rules": [{"type": "calendar", "schedule": "month_start", "dates": []}],
        }]
        resolve_targets.return_value = [{"chat_id": 101, "dialog_id": 202, "bin": "123"}]
        start_context.return_value = {"id": 303}

        result = survey_service.start_periodic_surveys(datetime(2026, 8, 1, tzinfo=timezone.utc))

        self.assertEqual(result["started_count"], 1)
        self.assertEqual(result["skipped_count"], 0)
        start_context.assert_called_once_with(
            template_id=7,
            chat_id=101,
            dialog_id=202,
            appeal_id=None,
            trigger_source="periodic:2026-08",
        )

    @patch("backend.survey_service.start_survey_for_context")
    @patch("backend.survey_service.database.resolve_survey_manual_targets")
    @patch("backend.survey_service.database.list_survey_templates")
    def test_periodic_launch_deduplicates_multiple_dialogs_in_same_chat(
        self,
        list_templates,
        resolve_targets,
        start_context,
    ):
        list_templates.return_value = [{
            "id": 7,
            "launch_rules": [{"type": "calendar", "schedule": "month_start", "dates": []}],
        }]
        resolve_targets.return_value = [
            {"chat_id": 101, "dialog_id": 201, "bin": "111"},
            {"chat_id": 101, "dialog_id": 202, "bin": "222"},
        ]
        start_context.return_value = {"id": 303}

        result = survey_service.start_periodic_surveys(datetime(2026, 8, 1, tzinfo=timezone.utc))

        self.assertEqual(result["started_count"], 1)
        start_context.assert_called_once_with(
            template_id=7,
            chat_id=101,
            dialog_id=202,
            appeal_id=None,
            trigger_source="periodic:2026-08",
        )


if __name__ == "__main__":
    unittest.main()
