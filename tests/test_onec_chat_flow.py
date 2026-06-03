import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient

from backend import api, customer_surveys, database, survey_service


ROOT_DIR = Path(__file__).resolve().parents[1]


class OneCChatFlowTests(unittest.TestCase):
    def setUp(self):
        api.app.dependency_overrides[api.require_onec_token] = lambda: None
        self.client = TestClient(api.app)

    def tearDown(self):
        api.app.dependency_overrides.clear()

    def test_no_contract_status_message_is_russian(self):
        stored_messages: list[dict] = []

        with (
            patch.object(api, "_resolve_onec_chat_id", return_value=1001),
            patch.object(api.database, "upsert_chat"),
            patch.object(api.database, "ensure_active_chat_dialog", return_value=77),
            patch.object(api.database, "save_message", return_value=501),
            patch.object(api.database, "get_message_attachments_map", return_value={}),
            patch.object(api.database, "set_chat_section"),
            patch.object(api.database, "get_messages", return_value=[{"id": 501}]),
            patch.object(api.contract_checker, "ACTIVE_CONTRACT_YEAR", 2026),
            patch.object(
                api.contract_checker,
                "check_customer_contracts",
                return_value={"has_contract": False},
            ) as check_contracts,
            patch.object(api.database, "add_organization_without_contract") as add_without_contract,
            patch.object(api.database, "upsert_bin_contract_snapshot") as upsert_snapshot,
            patch.object(api, "_store_onec_outgoing_text_message", side_effect=lambda **kwargs: stored_messages.append(kwargs) or 900),
            patch.object(api, "_process_onec_incoming_message"),
        ):
            response = self.client.post(
                "/integrations/1c/messages",
                json={
                    "external_chat_id": "onec-chat",
                    "bin": "181818181818",
                    "text": "Фыв",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertIn("действующий договор", response.json()["response_message"].lower())
        self.assertNotIn("No active", response.json()["response_message"])
        self.assertEqual(stored_messages[0]["text"], response.json()["response_message"])
        check_contracts.assert_called_once_with("181818181818")
        upsert_snapshot.assert_called_once_with(
            "181818181818",
            has_contract=False,
            customer_legal_address=None,
            customer_bank_name_ru=None,
            customer_name_ru=None,
        )
        add_without_contract.assert_called_once_with(
            customer_bin="181818181818",
            customer_legal_address=None,
            customer_bank_name_ru=None,
            customer_name_ru=None,
        )

    def test_onec_first_message_checks_only_current_bin_and_saves_snapshot(self):
        stored_messages: list[dict] = []

        with (
            patch.object(api, "_resolve_onec_chat_id", return_value=1001),
            patch.object(api.database, "upsert_chat"),
            patch.object(api.database, "ensure_active_chat_dialog", return_value=77),
            patch.object(api.database, "save_message", return_value=501),
            patch.object(api.database, "get_message_attachments_map", return_value={}),
            patch.object(api.database, "set_chat_section"),
            patch.object(api.database, "get_messages", return_value=[{"id": 501}]),
            patch.object(api.contract_checker, "ACTIVE_CONTRACT_YEAR", 2026),
            patch.object(
                api.contract_checker,
                "check_customer_contracts",
                return_value={
                    "has_contract": True,
                    "customer_legal_address": "Atyrau",
                    "customer_bank_name_ru": "Bank",
                    "customer_name_ru": "Customer",
                },
            ) as check_contracts,
            patch.object(api.contract_checker, "get_all_customer_bins_with_contracts") as get_all_contract_bins,
            patch.object(api.database, "add_organization_without_contract") as add_without_contract,
            patch.object(api.database, "remove_organization_without_contract") as remove_without_contract,
            patch.object(api.database, "upsert_bin_contract_snapshot") as upsert_snapshot,
            patch.object(api, "_store_onec_outgoing_text_message", side_effect=lambda **kwargs: stored_messages.append(kwargs) or 900),
            patch.object(api, "_process_onec_incoming_message"),
        ):
            response = self.client.post(
                "/integrations/1c/messages",
                json={
                    "external_chat_id": "onec-chat",
                    "bin": "181818181818",
                    "text": "РџРµСЂРІРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["has_contract"])
        self.assertIsNotNone(response.json()["response_message"])
        check_contracts.assert_called_once_with("181818181818")
        get_all_contract_bins.assert_not_called()
        upsert_snapshot.assert_called_once_with(
            "181818181818",
            has_contract=True,
            customer_legal_address="Atyrau",
            customer_bank_name_ru="Bank",
            customer_name_ru="Customer",
        )
        add_without_contract.assert_not_called()
        remove_without_contract.assert_called_once_with("181818181818")
        self.assertEqual(stored_messages[0]["text"], response.json()["response_message"])

    def test_onec_outbox_payload_can_include_quick_replies(self):
        captured: dict = {}

        with patch.object(api.database, "outbox_enqueue_onec", side_effect=lambda **kwargs: captured.update(kwargs) or 1):
            api._enqueue_onec_outgoing_message(
                message_id=10,
                chat_id=20,
                dialog_id=30,
                external_chat_id="onec-chat",
                bin_value="181818181818",
                text="Выберите действие",
                author="System",
                section=None,
                quick_replies=[
                    {
                        "id": "operator",
                        "label": "Позвать оператора",
                        "value": "/operator",
                    }
                ],
            )

        self.assertEqual(
            captured["payload"]["quick_replies"],
            [{"id": "operator", "label": "Позвать оператора", "value": "/operator"}],
        )

    def test_onec_store_message_persists_quick_replies_for_history(self):
        quick_replies = [
            {"id": "survey_yes", "label": "Да", "value": "yes", "type": "survey_answer"},
            {"id": "survey_no", "label": "Нет", "value": "no", "type": "survey_answer"},
        ]

        with (
            patch.object(api.database, "save_message", return_value=501) as save_message,
            patch.object(api, "_enqueue_onec_outgoing_message"),
            patch.object(api, "_publish_new_message_event"),
        ):
            api._store_onec_outgoing_text_message(
                chat_id=20,
                dialog_id=30,
                external_chat_id="onec-chat",
                bin_value="181818181818",
                text="Выберите вариант",
                author="System",
                chat_title="1C client",
                section=None,
                quick_replies=quick_replies,
            )

        self.assertEqual(save_message.call_args.kwargs["quick_replies"], quick_replies)

    def test_onec_history_response_includes_quick_replies(self):
        quick_replies = [{"id": "survey_yes", "label": "Да", "value": "yes", "type": "survey_answer"}]

        with (
            patch.object(api, "_resolve_onec_chat_id", return_value=20),
            patch.object(api.database, "get_chat", return_value={"type": "onec"}),
            patch.object(api.database, "get_messages", return_value=[
                {
                    "id": 501,
                    "message_id": None,
                    "chat_id": 20,
                    "dialog_id": 30,
                    "direction": "outgoing",
                    "text": "Выберите вариант",
                    "author": "System",
                    "created_at": "2026-05-04T00:00:00+00:00",
                    "section": None,
                    "attachments": [],
                    "quick_replies": quick_replies,
                }
            ]),
            patch.object(api.database, "get_active_chat_dialog_id", return_value=30),
        ):
            response = self.client.get(
                "/integrations/1c/messages",
                params={"external_chat_id": "onec-chat", "chat_id": "20"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["messages"][0]["quick_replies"], quick_replies)

    def test_onec_history_with_bin_does_not_reactivate_closed_dialog(self):
        def get_messages(chat_id, *, limit, dialog_id):
            self.assertEqual(dialog_id, 30)
            return []

        with (
            patch.object(api, "_resolve_onec_chat_id", return_value=20),
            patch.object(api.database, "get_active_chat_dialog", return_value=None),
            patch.object(api.database, "get_latest_closed_chat_dialog_id", return_value=30),
            patch.object(api.database, "get_chat_dialog", return_value={"id": 30, "chat_id": 20, "bin": "181818181818"}),
            patch.object(api.database, "ensure_active_chat_dialog") as ensure_dialog,
            patch.object(api.database, "get_chat", return_value={"type": "onec"}),
            patch.object(api.database, "get_messages", side_effect=get_messages),
        ):
            response = self.client.get(
                "/integrations/1c/messages",
                params={"external_chat_id": "onec-chat", "chat_id": "20", "bin": "181818181818"},
            )

        self.assertEqual(response.status_code, 200)
        ensure_dialog.assert_not_called()

    def test_survey_session_current_question_index_is_zero_based(self):
        row = {
            "id": 44,
            "template_id": 12,
            "chat_id": 20,
            "dialog_id": 30,
            "appeal_id": 40,
            "bin": "181818181818",
            "status": customer_surveys.SESSION_STATUS_CURRENT,
            "trigger_source": customer_surveys.SURVEY_TRIGGER_AFTER_EMPLOYEE_CSAT,
            "current_question_id": 101,
            "is_anonymous": False,
            "started_at": "2026-05-04T00:00:00+00:00",
            "completed_at": None,
            "updated_at": "2026-05-04T00:00:00+00:00",
        }
        questions = [
            {"id": 101, "text": "Первый вопрос", "question_type": customer_surveys.QUESTION_TYPE_SCALE, "config": {}},
            {"id": 102, "text": "Второй вопрос", "question_type": customer_surveys.QUESTION_TYPE_SCALE, "config": {}},
        ]

        with (
            patch.object(database, "get_survey_questions", return_value=questions),
            patch.object(database, "get_survey_session_operators", return_value=[]),
        ):
            session = database._survey_session_from_row(row)

        self.assertIsNotNone(session)
        self.assertEqual(session["current_question_index"], 0)
        self.assertEqual(survey_service._question_text(session), "Опрос, вопрос 1 из 2.\nПервый вопрос")

    def test_onec_integration_shows_bubble_buttons_for_survey_questions(self):
        integration_code = (ROOT_DIR / "1C_Integration.md").read_text(encoding="utf-8")

        self.assertIn('ПолучитьПолеJSON(Стр, "quick_replies"', integration_code)
        self.assertIn("СформироватьHTMLКнопокОпроса(QuickReplies", integration_code)
        self.assertIn("qa-btn qa-survey-choice", integration_code)
        self.assertIn('Если Найти(ЛокТекст, "опрос, вопрос") > 0', integration_code)
        self.assertIn("qa-rate qa-survey-rate", integration_code)

    def test_onec_integration_overrides_stale_scale_buttons_for_employee_and_comment_questions(self):
        integration_code = (ROOT_DIR / "1C_Integration.md").read_text(encoding="utf-8")

        self.assertIn("ЭтоВопросВыбораСотрудникаОпроса", integration_code)
        self.assertIn("СформироватьHTMLКнопокСотрудниковОпроса", integration_code)
        employee_buttons_fn = integration_code[
            integration_code.index("Функция СформироватьHTMLКнопокСотрудниковОпроса"):
            integration_code.index("Функция СформироватьHTMLКнопокОпроса")
        ]
        self.assertIn("Нет таких сотрудников", employee_buttons_fn)
        self.assertIn("data-answer-label='Нет таких сотрудников'", employee_buttons_fn)
        self.assertIn("ЭтоВопросКомментарияОпроса", integration_code)
        self.assertIn("СформироватьHTMLКнопкиПропуститьОпрос", integration_code)
        self.assertIn("СформироватьHTMLКнопокОпроса(QuickReplies, ТекстИсходный, Сообщения)", integration_code)

    def test_onec_numeric_label_check_uses_chislo_as_expression(self):
        integration_code = (ROOT_DIR / "1C_Integration.md").read_text(encoding="utf-8")

        self.assertNotIn("        Число(СокрЛП(Строка(Метка)));", integration_code)
        self.assertIn("ЛокЧисло = Число(СокрЛП(Строка(Метка)));", integration_code)

    def test_onec_survey_button_sends_visible_label_not_internal_value(self):
        integration_code = (ROOT_DIR / "1C_Integration.md").read_text(encoding="utf-8")

        self.assertIn("data-answer-label", integration_code)

    def test_onec_rating_refreshes_history_to_show_started_survey(self):
        integration_code = (ROOT_DIR / "1C_Integration.md").read_text(encoding="utf-8")
        rating_proc = integration_code[integration_code.index("Процедура НажатаОценка"):integration_code.index("Функция ОтправитьОценкуНаСервере")]

        self.assertIn('Строка(ПолучитьПолеJSON(Ответ, "status", "")) = "ok"', rating_proc)
        self.assertIn("ОбновитьИсторию(Неопределено, Ложь)", rating_proc)

    def test_onec_rating_is_not_requested_again_after_successful_submit(self):
        integration_code = (ROOT_DIR / "1C_Integration.md").read_text(encoding="utf-8")

        self.assertIn('РеквизитФормы("ОценкаОтправлена"', integration_code)
        self.assertIn('Не ЭтаФорма["ОценкаОтправлена"]', integration_code)
        self.assertIn('ЭтаФорма["ОценкаОтправлена"] = Истина', integration_code)
        self.assertIn('ЭтаФорма["ОценкаОтправлена"] = Ложь', integration_code)

    def test_onec_rating_flag_resets_after_survey_completion_notice(self):
        integration_code = (ROOT_DIR / "1C_Integration.md").read_text(encoding="utf-8")

        self.assertIn('"спасибо, ваш ответ сохран"', integration_code)
        self.assertIn('"thank you, your answer has been saved"', integration_code)

    def test_operator_bubble_turns_on_operator_mode_without_ai_reply(self):
        outbox_messages: list[dict] = []
        ai_manager = Mock()

        with (
            patch.object(api.database, "get_chat", return_value={"section": "accounting", "bin": "181818181818"}),
            patch.object(api.database, "set_dialog_operator_mode") as set_operator_mode,
            patch.object(api.database, "create_operator_request_notifications") as create_notifications,
            patch.object(api.database, "is_dialog_in_operator_mode", return_value=False),
            patch.object(api, "_store_onec_outgoing_text_message", side_effect=lambda **kwargs: outbox_messages.append(kwargs) or 1),
            patch.object(api, "ai_manager", ai_manager),
        ):
            api._process_onec_incoming_message(
                chat_id=20,
                dialog_id=30,
                external_chat_id="onec-chat",
                bin_value="181818181818",
                message_text="Позвать оператора",
                normalized_text="позвать оператора",
                author="1С Бухгалтер",
                chat_title="1C client",
                section_id="accounting",
            )

        set_operator_mode.assert_called_with(30, True)
        create_notifications.assert_called_once()
        ai_manager.generate_response.assert_not_called()
        self.assertIn("оператор", outbox_messages[0]["text"].lower())

    def test_survey_after_employee_csat_starts_matching_template_and_sends_question(self):
        sent_messages: list[dict] = []
        survey_service.configure_survey_runtime(
            send_channel_message=lambda chat_id, text, **kwargs: sent_messages.append(
                {"chat_id": chat_id, "text": text, **kwargs}
            )
        )
        template = {
            "id": 12,
            "status": customer_surveys.SURVEY_STATUS_ACTIVE,
            "audience": customer_surveys.SURVEY_AUDIENCE_CLIENT,
            "launch_rules": [{"type": customer_surveys.SURVEY_TRIGGER_AFTER_EMPLOYEE_CSAT}],
        }
        session = {
            "id": 44,
            "chat_id": 20,
            "dialog_id": 30,
            "appeal_id": 40,
            "current_question": {
                "text": "Оцените консультацию от 1 до 5",
                "question_type": customer_surveys.QUESTION_TYPE_SCALE,
                "config": {"min": 1, "max": 5},
            },
            "current_question_index": 0,
            "questions_total": 1,
        }

        with (
            patch.object(database, "list_survey_templates", return_value=[template]),
            patch.object(database, "get_chat_dialog", return_value={"chat_id": 20}),
            patch.object(database, "start_survey_session", return_value=session),
        ):
            result = survey_service.maybe_start_survey_after_employee_csat(30, 40)

        self.assertTrue(result["started"])
        self.assertEqual(result["session_id"], 44)
        self.assertEqual(sent_messages[0]["chat_id"], 20)
        self.assertIn("Оцените консультацию", sent_messages[0]["text"])

    def test_survey_option_value_is_displayed_as_button_label(self):
        question = {
            "question_type": customer_surveys.QUESTION_TYPE_SINGLE_CHOICE,
            "config": {
                "options": [
                    {"id": "instructions", "label": "Инструкции"},
                    {"id": "memos", "label": "Памятки"},
                ]
            },
        }
        session = {"id": 44, "current_question": question}

        with patch.object(database, "get_active_survey_session", return_value=session):
            display_text = survey_service.get_channel_survey_answer_display_text(20, "memos")

        self.assertEqual(display_text, "Памятки")

    def test_employee_exclusion_question_uses_session_operator_buttons(self):
        question = {
            "question_type": customer_surveys.QUESTION_TYPE_EMPLOYEE_EXCLUSION,
            "config": {},
        }
        session = {
            "operators": [
                {"operator_name": "Арайлым"},
                {"operator_name": "Баглан"},
            ]
        }

        replies = survey_service._answer_quick_replies(question, session=session)

        self.assertEqual(
            [(reply["label"], reply["value"]) for reply in replies],
            [("Нет таких сотрудников", "Нет таких сотрудников"), ("Арайлым", "Арайлым"), ("Баглан", "Баглан")],
        )

    def test_employee_exclusion_none_option_does_not_select_employee(self):
        question = {
            "question_type": customer_surveys.QUESTION_TYPE_EMPLOYEE_EXCLUSION,
            "config": {},
        }
        session = {
            "operators": [
                {"operator_name": "Арайлым"},
            ]
        }

        answer = survey_service._parse_answer(question, "Нет таких сотрудников", session=session)

        self.assertIsNotNone(answer)
        self.assertEqual(answer.raw_text, "Нет таких сотрудников")
        self.assertIsNone(answer.selected_employee_name)

    def test_optional_text_comment_can_be_skipped(self):
        question = {
            "question_type": customer_surveys.QUESTION_TYPE_TEXT_COMMENT,
            "required": False,
            "config": {},
        }

        replies = survey_service._answer_quick_replies(question)
        answer = survey_service._parse_answer(question, "Пропустить")

        self.assertIn(
            {"id": "survey_skip", "label": "Пропустить", "value": "Пропустить", "type": "survey_answer"},
            replies,
        )
        self.assertIsNotNone(answer)
        self.assertEqual(answer.raw_text, "")

        with patch.object(database, "get_active_survey_session", return_value={"current_question": question}):
            display_text = survey_service.get_channel_survey_answer_display_text(20, survey_service.SKIP_OPTION_LABEL)

        self.assertEqual(display_text, survey_service.SKIP_OPTION_LABEL)

    def test_default_after_csat_survey_ends_with_employee_list_and_optional_comment(self):
        questions = customer_surveys.default_after_csat_questions()

        self.assertEqual(len(questions), 8)
        self.assertEqual(questions[6]["question_type"], customer_surveys.QUESTION_TYPE_EMPLOYEE_EXCLUSION)
        self.assertEqual(questions[6]["text"], "С кем из сотрудников вы бы не хотели работать в дальнейшем?")
        self.assertEqual(questions[7]["question_type"], customer_surveys.QUESTION_TYPE_TEXT_COMMENT)
        self.assertFalse(questions[7]["required"])
        self.assertEqual(questions[7]["text"], "Поделитесь, пожалуйста, комментарием о сопровождении.")

    def test_default_after_csat_seed_updates_existing_question_rows(self):
        database_code = (ROOT_DIR / "backend" / "database.py").read_text(encoding="utf-8")

        self.assertIn("UPDATE survey_questions", database_code)
        self.assertIn("WHERE template_id = %s AND sort_order = %s", database_code)
        self.assertIn("question.get(\"anonymity_mode\")", database_code)

    def test_default_after_csat_refreshes_legacy_scale_questions(self):
        legacy_questions = customer_surveys.default_after_csat_questions()
        legacy_questions[6] = {
            **legacy_questions[6],
            "question_type": customer_surveys.QUESTION_TYPE_SCALE,
            "text": "С кем из сотрудников вы бы не хотели работать в дальнейшем?",
            "required": True,
        }
        legacy_questions[7] = {
            **legacy_questions[7],
            "question_type": customer_surveys.QUESTION_TYPE_SCALE,
            "text": "Поделитесь, пожалуйста, комментарием о сопровождении.",
            "required": True,
        }

        self.assertTrue(customer_surveys.default_after_csat_questions_need_refresh(legacy_questions))
        self.assertFalse(
            customer_surveys.default_after_csat_questions_need_refresh(
                customer_surveys.default_after_csat_questions()
            )
        )

    def test_survey_after_appeal_closed_starts_matching_template_and_sends_question(self):
        sent_messages: list[dict] = []
        survey_service.configure_survey_runtime(
            send_channel_message=lambda chat_id, text, **kwargs: sent_messages.append(
                {"chat_id": chat_id, "text": text, **kwargs}
            )
        )
        template = {
            "id": 13,
            "status": customer_surveys.SURVEY_STATUS_ACTIVE,
            "audience": customer_surveys.SURVEY_AUDIENCE_CLIENT,
            "launch_rules": [{"type": customer_surveys.SURVEY_TRIGGER_AFTER_APPEAL_CLOSED}],
        }
        session = {
            "id": 45,
            "chat_id": 20,
            "dialog_id": 30,
            "appeal_id": 40,
            "current_question": {
                "text": "РћС†РµРЅРёС‚Рµ РѕР±СЂР°С‰РµРЅРёРµ РѕС‚ 1 РґРѕ 5",
                "question_type": customer_surveys.QUESTION_TYPE_SCALE,
                "config": {"min": 1, "max": 5},
            },
            "current_question_index": 0,
            "questions_total": 1,
        }

        with (
            patch.object(database, "list_survey_templates", return_value=[template]),
            patch.object(database, "get_chat_dialog", return_value={"chat_id": 20}),
            patch.object(database, "start_survey_session", return_value=session),
        ):
            result = survey_service.maybe_start_survey_after_appeal_closed(30, 40)

        self.assertTrue(result["started"])
        self.assertEqual(result["session_id"], 45)
        self.assertEqual(sent_messages[0]["chat_id"], 20)
        self.assertIn("РћС†РµРЅРёС‚Рµ РѕР±СЂР°С‰РµРЅРёРµ", sent_messages[0]["text"])

    def test_operator_close_onec_dialog_waits_for_rating_before_survey(self):
        api.app.dependency_overrides[api.get_current_user] = lambda: {
            "id": 1,
            "role": database.ROLE_ADMIN,
            "name": "Admin",
        }

        with (
            patch.object(api.database, "get_chat_dialog", return_value={"id": 30, "chat_id": 20}),
            patch.object(api.database, "user_can_access_chat", return_value=True),
            patch.object(
                api.database,
                "get_chat",
                return_value={
                    "type": "onec",
                    "title": "1C client",
                    "section": None,
                    "external_chat_id": "onec-chat",
                    "bin": "181818181818",
                },
            ),
            patch.object(api.database, "close_chat_dialog", return_value={"id": 30}),
            patch.object(api.database, "set_dialog_operator_mode"),
            patch.object(api.database, "get_latest_closed_appeal_id", return_value=40),
            patch.object(api.database, "create_employee_client_assessments_for_dialog", return_value=[]),
            patch.object(api.database, "save_message", return_value=501),
            patch.object(api.database, "outbox_enqueue_onec"),
            patch.object(api, "_publish_new_message_event"),
            patch.object(
                api.survey_service,
                "maybe_start_survey_after_appeal_closed",
                return_value={"started": True},
                create=True,
            ) as start_survey,
        ):
            response = self.client.post("/api/dialogs/30/close")

        self.assertEqual(response.status_code, 200)
        start_survey.assert_not_called()

    def test_onec_close_creates_employee_assessment_request(self):
        with (
            patch.object(api, "_resolve_onec_chat_id", return_value=20),
            patch.object(api.database, "get_active_chat_dialog", return_value={"id": 30}),
            patch.object(api.database, "close_chat_dialog"),
            patch.object(api.database, "get_latest_dialog_stats", return_value={"appeal_id": 40, "is_ai_closed": False}),
            patch.object(api.database, "get_latest_closed_appeal_id", return_value=40),
            patch.object(api.database, "create_employee_client_assessments_for_dialog", return_value=[{"id": 90}], create=True) as create_assessment,
            patch.object(api, "send_csat_request"),
        ):
            response = self.client.post(
                "/integrations/1c/close",
                json={"external_chat_id": "onec-chat"},
            )

        self.assertEqual(response.status_code, 200)
        create_assessment.assert_called_once_with(30, appeal_id=40)
        self.assertEqual(response.json()["employee_assessment_count"], 1)

    def test_onec_repeated_message_stores_dialog_resumed_notice(self):
        stored_messages: list[dict] = []

        with (
            patch.object(api, "_resolve_onec_chat_id", return_value=20),
            patch.object(api.database, "get_active_chat_dialog"),
            patch.object(api.database, "get_latest_closed_chat_dialog_id"),
            patch.object(api.database, "get_chat_dialog"),
            patch.object(api.database, "upsert_chat"),
            patch.object(api.database, "ensure_active_chat_dialog", return_value=(30, True)),
            patch.object(api.database, "save_message", return_value=501),
            patch.object(api.database, "get_message_attachments_map", return_value={}),
            patch.object(api, "_publish_new_message_event"),
            patch.object(api.database, "get_messages", return_value=[{"id": 1}, {"id": 501}]),
            patch.object(api.database, "has_organization_without_contract", return_value=False),
            patch.object(api, "_store_onec_outgoing_text_message", side_effect=lambda **kwargs: stored_messages.append(kwargs) or 900),
            patch.object(api, "_process_onec_incoming_message"),
        ):
            response = self.client.post(
                "/integrations/1c/messages",
                json={
                    "external_chat_id": "onec-chat",
                    "bin": "181818181818",
                    "text": "Повторное обращение",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(any("возобнов" in item["text"].lower() for item in stored_messages))

    def test_onec_survey_answer_does_not_resume_closed_dialog(self):
        stored_messages: list[dict] = []
        session = {
            "id": 44,
            "dialog_id": 30,
            "current_question": {
                "question_type": customer_surveys.QUESTION_TYPE_TEXT_COMMENT,
                "required": False,
                "config": {},
            },
        }

        def save_message(**kwargs):
            self.assertEqual(kwargs["dialog_id"], 30)
            self.assertEqual(kwargs["text"], survey_service.SKIP_OPTION_LABEL)
            return 501

        with (
            patch.object(api, "_resolve_onec_chat_id", return_value=20),
            patch.object(api.database, "get_active_survey_session", return_value=session),
            patch.object(api.database, "upsert_chat"),
            patch.object(api.database, "ensure_active_chat_dialog", return_value=(30, True)) as ensure_dialog,
            patch.object(api.database, "save_message", side_effect=save_message),
            patch.object(api.database, "get_message_attachments_map", return_value={}),
            patch.object(api, "_publish_new_message_event"),
            patch.object(api, "_store_onec_outgoing_text_message", side_effect=lambda **kwargs: stored_messages.append(kwargs) or 900),
            patch.object(api, "_process_onec_incoming_message"),
        ):
            response = self.client.post(
                "/integrations/1c/messages",
                json={
                    "external_chat_id": "onec-chat",
                    "bin": "181818181818",
                    "text": survey_service.SKIP_OPTION_LABEL,
                },
            )

        self.assertEqual(response.status_code, 200)
        ensure_dialog.assert_not_called()
        self.assertEqual(stored_messages, [])

    def test_onec_rating_falls_back_to_legacy_after_close_survey_template(self):
        with (
            patch.object(api, "_resolve_onec_chat_id", return_value=20),
            patch.object(api.database, "get_dialog_id_for_appeal", return_value=30),
            patch.object(api.database, "save_csat_rating", return_value=True),
            patch.object(api.survey_service, "maybe_start_survey_after_employee_csat", return_value={"started": False}) as start_after_rating,
            patch.object(api.survey_service, "maybe_start_survey_after_appeal_closed", return_value={"started": True}) as start_legacy,
        ):
            response = self.client.post(
                "/integrations/1c/rating",
                json={
                    "external_chat_id": "onec-chat",
                    "appeal_id": 40,
                    "rating": 5,
                    "target": "operator",
                },
            )

        self.assertEqual(response.status_code, 200)
        start_after_rating.assert_called_once_with(30, 40)
        start_legacy.assert_called_once_with(30, 40)
        self.assertEqual(response.json()["survey"], {"started": True})

    def test_onec_client_close_waits_for_rating_before_survey(self):
        with (
            patch.object(api, "_resolve_onec_chat_id", return_value=20),
            patch.object(api.database, "get_active_chat_dialog", return_value={"id": 30}),
            patch.object(api.database, "close_chat_dialog"),
            patch.object(api.database, "get_latest_dialog_stats", return_value={"appeal_id": 40, "is_ai_closed": False}),
            patch.object(api.database, "get_latest_closed_appeal_id", return_value=40),
            patch.object(api.database, "create_employee_client_assessments_for_dialog", return_value=[]),
            patch.object(api, "send_csat_request"),
            patch.object(api.survey_service, "maybe_start_survey_after_appeal_closed", return_value={"started": True}) as start_survey,
        ):
            response = self.client.post(
                "/integrations/1c/close",
                json={"external_chat_id": "onec-chat"},
        )

        self.assertEqual(response.status_code, 200)
        start_survey.assert_not_called()


if __name__ == "__main__":
    unittest.main()
