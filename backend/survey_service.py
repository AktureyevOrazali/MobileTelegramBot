from __future__ import annotations

from typing import Any, Callable, Mapping

from . import customer_surveys, database

_send_channel_message: Callable[..., None] | None = None
_persist_telegram_message: Callable[..., None] | None = None


def configure_survey_runtime(
    *,
    send_channel_message: Callable[..., None] | None = None,
    persist_telegram_message: Callable[..., None] | None = None,
) -> None:
    global _send_channel_message, _persist_telegram_message
    _send_channel_message = send_channel_message
    _persist_telegram_message = persist_telegram_message


def handle_telegram_survey_text_answer(message: Any) -> bool:
    chat = getattr(message, "chat", None)
    chat_id = getattr(chat, "id", None)
    text = getattr(message, "text", None)
    if chat_id is None or text is None:
        return False
    handled = handle_channel_survey_text_answer(int(chat_id), str(text))
    if handled and _persist_telegram_message is not None:
        _persist_telegram_message(message, direction="incoming")
    return handled


def _template_has_trigger(template: Mapping[str, Any], trigger_type: str) -> bool:
    rules = template.get("launch_rules") or []
    if isinstance(rules, str):
        return str(template.get("trigger_type") or "").strip().lower() == trigger_type
    for rule in rules:
        if isinstance(rule, Mapping) and str(rule.get("type") or "").strip().lower() == trigger_type:
            return True
    return str(template.get("trigger_type") or "").strip().lower() == trigger_type


def _answer_quick_replies(question: Mapping[str, Any]) -> list[dict[str, str]]:
    question_type = customer_surveys.normalize_question_type(question.get("question_type"))
    config = question.get("config") or {}
    if question_type == customer_surveys.QUESTION_TYPE_SCALE:
        try:
            minimum = int(config.get("min", 1)) if isinstance(config, Mapping) else 1
            maximum = int(config.get("max", 5)) if isinstance(config, Mapping) else 5
        except (TypeError, ValueError):
            minimum, maximum = 1, 5
        minimum = max(1, minimum)
        maximum = min(10, max(minimum, maximum))
        return [
            {"id": f"survey_{value}", "label": str(value), "value": str(value), "type": "survey_answer"}
            for value in range(minimum, maximum + 1)
        ]
    if isinstance(config, Mapping):
        options = customer_surveys.normalize_options(config)
        return [
            {
                "id": f"survey_{option['id']}",
                "label": str(option["label"]),
                "value": str(option["id"]),
                "type": "survey_answer",
            }
            for option in options
        ]
    return []


def _question_text(session: Mapping[str, Any]) -> str:
    question = session.get("current_question") or {}
    index = int(session.get("current_question_index") or 0) + 1
    total = int(session.get("questions_total") or 1)
    text = str(question.get("text") or "Оцените обращение от 1 до 5").strip()
    if total > 1:
        return f"Опрос, вопрос {index} из {total}.\n{text}"
    return text


def _send_current_survey_question(session: Mapping[str, Any]) -> None:
    if _send_channel_message is None:
        return
    question = session.get("current_question") or {}
    _send_channel_message(
        int(session["chat_id"]),
        _question_text(session),
        dialog_id=session.get("dialog_id"),
        author="System",
        quick_replies=_answer_quick_replies(question if isinstance(question, Mapping) else {}),
    )


def _parse_answer(question: Mapping[str, Any], raw_text: str) -> customer_surveys.SurveyAnswerParseResult | None:
    text = str(raw_text or "").strip()
    if not text:
        return None
    question_type = customer_surveys.normalize_question_type(question.get("question_type"))
    config = question.get("config") or {}
    if question_type == customer_surveys.QUESTION_TYPE_SCALE:
        try:
            value = float(text.replace(",", "."))
        except ValueError:
            return None
        minimum = float(config.get("min", 1)) if isinstance(config, Mapping) else 1.0
        maximum = float(config.get("max", 5)) if isinstance(config, Mapping) else 5.0
        if value < minimum or value > maximum:
            return None
        return customer_surveys.SurveyAnswerParseResult(numeric_score=value, raw_text=text)
    if question_type == customer_surveys.QUESTION_TYPE_TEXT_COMMENT:
        return customer_surveys.SurveyAnswerParseResult(raw_text=text)
    if question_type == customer_surveys.QUESTION_TYPE_EMPLOYEE_EXCLUSION:
        return customer_surveys.SurveyAnswerParseResult(raw_text=text, selected_employee_name=text)
    options = customer_surveys.normalize_options(config if isinstance(config, Mapping) else {})
    selected: list[str] = []
    normalized_text = text.casefold()
    for option in options:
        option_id = str(option["id"])
        label = str(option["label"])
        if normalized_text in {option_id.casefold(), label.casefold()}:
            selected.append(option_id)
            break
    if not selected and question_type == customer_surveys.QUESTION_TYPE_MULTI_CHOICE:
        parts = [part.strip().casefold() for part in text.replace(";", ",").split(",") if part.strip()]
        for option in options:
            option_id = str(option["id"])
            label = str(option["label"])
            if option_id.casefold() in parts or label.casefold() in parts:
                selected.append(option_id)
    if selected:
        return customer_surveys.SurveyAnswerParseResult(raw_text=text, selected_options=selected)
    return None


def handle_channel_survey_text_answer(chat_id: int, text: str) -> bool:
    session = database.get_active_survey_session(int(chat_id))
    if not session:
        return False
    question = session.get("current_question")
    if not isinstance(question, Mapping):
        database.complete_survey_session(int(session["id"]))
        return False
    answer = _parse_answer(question, text)
    if answer is None:
        if _send_channel_message is not None:
            _send_channel_message(
                int(chat_id),
                "Не удалось распознать ответ. Пожалуйста, выберите вариант кнопкой или отправьте число от 1 до 5.",
                dialog_id=session.get("dialog_id"),
                author="System",
                quick_replies=_answer_quick_replies(question),
            )
        return True
    database.save_survey_answer(session_id=int(session["id"]), question=question, answer=answer)
    next_session = database.advance_survey_session(int(session["id"]))
    if next_session:
        _send_current_survey_question(next_session)
    elif _send_channel_message is not None:
        _send_channel_message(
            int(chat_id),
            "Спасибо, ваш ответ сохранён.",
            dialog_id=session.get("dialog_id"),
            author="System",
        )
    return True


def _maybe_start_survey_for_trigger(
    *,
    dialog_id: int,
    appeal_id: int | None,
    trigger_type: str,
) -> dict[str, Any]:
    dialog = database.get_chat_dialog(int(dialog_id))
    if not dialog:
        return {
            "dialog_id": int(dialog_id),
            "appeal_id": int(appeal_id) if appeal_id is not None else None,
            "started": False,
            "reason": "dialog_not_found",
        }
    chat_id = int(dialog["chat_id"])
    templates = database.list_survey_templates(
        status=customer_surveys.SURVEY_STATUS_ACTIVE,
        audience=customer_surveys.SURVEY_AUDIENCE_CLIENT,
    )
    for template in templates:
        if not _template_has_trigger(template, trigger_type):
            continue
        session = database.start_survey_session(
            template_id=int(template["id"]),
            chat_id=chat_id,
            dialog_id=int(dialog_id),
            appeal_id=int(appeal_id) if appeal_id is not None else None,
            trigger_source=trigger_type,
        )
        if not session:
            continue
        _send_current_survey_question(session)
        return {
            "dialog_id": int(dialog_id),
            "appeal_id": int(appeal_id) if appeal_id is not None else None,
            "started": True,
            "session_id": int(session["id"]),
            "template_id": int(template["id"]),
        }
    return {
        "dialog_id": int(dialog_id),
        "appeal_id": int(appeal_id) if appeal_id is not None else None,
        "started": False,
        "reason": "no_matching_template",
    }


def maybe_start_survey_after_appeal_closed(dialog_id: int, appeal_id: int | None = None) -> dict[str, Any]:
    return _maybe_start_survey_for_trigger(
        dialog_id=int(dialog_id),
        appeal_id=int(appeal_id) if appeal_id is not None else None,
        trigger_type=customer_surveys.SURVEY_TRIGGER_AFTER_APPEAL_CLOSED,
    )


def maybe_start_survey_after_employee_csat(dialog_id: int, appeal_id: int | None = None) -> dict[str, Any]:
    return _maybe_start_survey_for_trigger(
        dialog_id=int(dialog_id),
        appeal_id=int(appeal_id) if appeal_id is not None else None,
        trigger_type=customer_surveys.SURVEY_TRIGGER_AFTER_EMPLOYEE_CSAT,
    )


def start_periodic_surveys() -> dict[str, Any]:
    # Restored minimal implementation. Periodic dispatch should not break
    # backend startup even if scheduling rules are incomplete.
    return {
        "started": [],
        "skipped": [],
        "started_count": 0,
        "skipped_count": 0,
    }
