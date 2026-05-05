from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence

SURVEY_AUDIENCE_CLIENT = "client"
SURVEY_AUDIENCE_EMPLOYEE = "employee"
SURVEY_AUDIENCES = {SURVEY_AUDIENCE_CLIENT, SURVEY_AUDIENCE_EMPLOYEE}

SURVEY_STATUS_DRAFT = "draft"
SURVEY_STATUS_ACTIVE = "active"
SURVEY_STATUS_ARCHIVED = "archived"
SURVEY_STATUSES = {SURVEY_STATUS_DRAFT, SURVEY_STATUS_ACTIVE, SURVEY_STATUS_ARCHIVED}

SURVEY_TRIGGER_AFTER_APPEAL_CLOSED = "after_appeal_closed"
SURVEY_TRIGGER_AFTER_EMPLOYEE_CSAT = "after_employee_csat"
SURVEY_TRIGGER_PERIODIC = "periodic"
SURVEY_TRIGGER_MANUAL = "admin_manual"

SURVEY_PERIOD_MONTHLY = "month_start"
SURVEY_PERIOD_QUARTERLY = "quarter_end"
SURVEY_PERIOD_CUSTOM = "custom_dates"

QUESTION_TYPE_SCALE = "scale"
QUESTION_TYPE_SINGLE_CHOICE = "single_choice"
QUESTION_TYPE_MULTI_CHOICE = "multi_choice"
QUESTION_TYPE_TEXT_COMMENT = "text_comment"
QUESTION_TYPE_EMPLOYEE_EXCLUSION = "employee_exclusion"
QUESTION_TYPES = {
    QUESTION_TYPE_SCALE,
    QUESTION_TYPE_SINGLE_CHOICE,
    QUESTION_TYPE_MULTI_CHOICE,
    QUESTION_TYPE_TEXT_COMMENT,
    QUESTION_TYPE_EMPLOYEE_EXCLUSION,
}

ANONYMITY_INHERIT = "inherit"
ANONYMITY_ANONYMOUS = "anonymous"
ANONYMITY_IDENTIFIED = "identified"
QUESTION_ANONYMITY_MODES = {
    ANONYMITY_INHERIT,
    ANONYMITY_ANONYMOUS,
    ANONYMITY_IDENTIFIED,
}

SESSION_STATUS_STARTED = "started"
SESSION_STATUS_CURRENT = "current"
SESSION_STATUS_ANSWER_SAVED = "answer_saved"
SESSION_STATUS_COMPLETED = "completed"
SESSION_STATUS_SKIPPED = "skipped"
SESSION_STATUS_UNAVAILABLE = "unavailable"

DEFAULT_AFTER_CSAT_TITLE = "Оценка качества сопровождения"
DEFAULT_AFTER_CSAT_DESCRIPTION = "Стандартный опрос после оценки сотрудника"


@dataclass(slots=True)
class SurveyAnswerParseResult:
    numeric_score: float | None = None
    raw_text: str | None = None
    selected_options: list[str] | None = None
    selected_employee_name: str | None = None


def normalize_survey_audience(value: Any) -> str:
    audience = str(value or SURVEY_AUDIENCE_CLIENT).strip().lower()
    if audience not in SURVEY_AUDIENCES:
        return SURVEY_AUDIENCE_CLIENT
    return audience


def normalize_question_type(value: Any) -> str:
    question_type = str(value or QUESTION_TYPE_SCALE).strip().lower()
    if question_type not in QUESTION_TYPES:
        return QUESTION_TYPE_SCALE
    return question_type


def normalize_question_anonymity_mode(value: Any) -> str:
    mode = str(value or ANONYMITY_INHERIT).strip().lower()
    if mode not in QUESTION_ANONYMITY_MODES:
        return ANONYMITY_INHERIT
    return mode


def normalize_options(config: Mapping[str, Any]) -> list[dict[str, Any]]:
    raw_options = config.get("options")
    if not isinstance(raw_options, Sequence) or isinstance(raw_options, (str, bytes)):
        return []
    options: list[dict[str, Any]] = []
    for index, item in enumerate(raw_options, start=1):
        if isinstance(item, Mapping):
            option_id = str(item.get("id") or index)
            label = str(item.get("label") or option_id).strip()
            score = item.get("score")
        else:
            option_id = str(index)
            label = str(item).strip()
            score = None
        if not label:
            continue
        options.append({"id": option_id, "label": label, "score": score})
    return options


def effective_question_anonymity(
    question: Mapping[str, Any] | None,
    *,
    template_is_anonymous: bool,
) -> bool:
    mode = normalize_question_anonymity_mode((question or {}).get("anonymity_mode"))
    if mode == ANONYMITY_ANONYMOUS:
        return True
    if mode == ANONYMITY_IDENTIFIED:
        return False
    return bool(template_is_anonymous)


def normalize_launch_rules(
    launch_rules: Sequence[Mapping[str, Any]] | None,
    *,
    legacy_trigger_type: Any = None,
    legacy_periodic_interval: Any = None,
    legacy_scheduled_at: Any = None,
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    if isinstance(launch_rules, Sequence) and not isinstance(launch_rules, (str, bytes)):
        for item in launch_rules:
            if not isinstance(item, Mapping):
                continue
            rule_type = str(item.get("type") or "").strip().lower()
            if rule_type not in {"after_appeal_closed", "after_employee_csat", "calendar"}:
                continue
            rule: dict[str, Any] = {"type": rule_type, "dates": []}
            if rule_type == "calendar":
                schedule = str(item.get("schedule") or SURVEY_PERIOD_MONTHLY).strip()
                if schedule not in {SURVEY_PERIOD_MONTHLY, SURVEY_PERIOD_QUARTERLY, SURVEY_PERIOD_CUSTOM}:
                    schedule = SURVEY_PERIOD_MONTHLY
                rule["schedule"] = schedule
                dates = item.get("dates")
                if isinstance(dates, Sequence) and not isinstance(dates, (str, bytes)):
                    rule["dates"] = [str(value) for value in dates if str(value).strip()]
            normalized.append(rule)
    if normalized:
        return normalized

    legacy_trigger = str(legacy_trigger_type or SURVEY_TRIGGER_PERIODIC).strip().lower()
    if legacy_trigger == SURVEY_TRIGGER_AFTER_APPEAL_CLOSED:
        return [{"type": SURVEY_TRIGGER_AFTER_APPEAL_CLOSED, "dates": []}]
    if legacy_trigger == SURVEY_TRIGGER_AFTER_EMPLOYEE_CSAT:
        return [{"type": SURVEY_TRIGGER_AFTER_EMPLOYEE_CSAT, "dates": []}]

    schedule = str(legacy_periodic_interval or SURVEY_PERIOD_MONTHLY).strip() or SURVEY_PERIOD_MONTHLY
    if schedule not in {SURVEY_PERIOD_MONTHLY, SURVEY_PERIOD_QUARTERLY, SURVEY_PERIOD_CUSTOM}:
        schedule = SURVEY_PERIOD_MONTHLY
    dates = [str(legacy_scheduled_at)] if legacy_scheduled_at else []
    return [{"type": "calendar", "schedule": schedule, "dates": dates}]


def derive_legacy_trigger_fields(launch_rules: Sequence[Mapping[str, Any]] | None) -> tuple[str, str | None, str | None]:
    first_rule = next((item for item in (launch_rules or []) if isinstance(item, Mapping)), None)
    if not first_rule:
        return SURVEY_TRIGGER_PERIODIC, SURVEY_PERIOD_MONTHLY, None
    rule_type = str(first_rule.get("type") or "").strip().lower()
    if rule_type == SURVEY_TRIGGER_AFTER_APPEAL_CLOSED:
        return SURVEY_TRIGGER_AFTER_APPEAL_CLOSED, None, None
    if rule_type == SURVEY_TRIGGER_AFTER_EMPLOYEE_CSAT:
        return SURVEY_TRIGGER_AFTER_EMPLOYEE_CSAT, None, None
    schedule = str(first_rule.get("schedule") or SURVEY_PERIOD_MONTHLY).strip() or SURVEY_PERIOD_MONTHLY
    dates = first_rule.get("dates")
    first_date = None
    if isinstance(dates, Sequence) and not isinstance(dates, (str, bytes)):
        first_date = next((str(value) for value in dates if str(value).strip()), None)
    return SURVEY_TRIGGER_PERIODIC, schedule, first_date


def default_after_csat_questions() -> list[dict[str, Any]]:
    return [
        {
            "sort_order": 1,
            "question_type": QUESTION_TYPE_SCALE,
            "text": "Насколько вы удовлетворены качеством консультации?",
            "topic": "consultation_quality",
            "required": True,
            "anonymity_mode": ANONYMITY_INHERIT,
            "config": {"min": 1, "max": 5, "presentation": "scale"},
        },
        {
            "sort_order": 2,
            "question_type": QUESTION_TYPE_SCALE,
            "text": "Насколько быстро сотрудник отвечал на ваши сообщения?",
            "topic": "response_speed",
            "required": True,
            "anonymity_mode": ANONYMITY_INHERIT,
            "config": {"min": 1, "max": 5, "presentation": "scale"},
        },
        {
            "sort_order": 3,
            "question_type": QUESTION_TYPE_SCALE,
            "text": "Насколько понятно сотрудник объяснил решение?",
            "topic": "answer_clarity",
            "required": True,
            "anonymity_mode": ANONYMITY_INHERIT,
            "config": {"min": 1, "max": 5, "presentation": "scale"},
        },
        {
            "sort_order": 4,
            "question_type": QUESTION_TYPE_SCALE,
            "text": "Насколько полно был решён ваш вопрос?",
            "topic": "resolution_quality",
            "required": True,
            "anonymity_mode": ANONYMITY_INHERIT,
            "config": {"min": 1, "max": 5, "presentation": "scale"},
        },
        {
            "sort_order": 5,
            "question_type": QUESTION_TYPE_SCALE,
            "text": "Насколько вежливым было общение?",
            "topic": "communication_quality",
            "required": True,
            "anonymity_mode": ANONYMITY_INHERIT,
            "config": {"min": 1, "max": 5, "presentation": "scale"},
        },
        {
            "sort_order": 6,
            "question_type": QUESTION_TYPE_MULTI_CHOICE,
            "text": "Какие новые материалы были бы вам полезны?",
            "topic": "instructions",
            "required": True,
            "anonymity_mode": ANONYMITY_INHERIT,
            "config": {
                "options": [
                    {"id": "instructions", "label": "Инструкции"},
                    {"id": "memos", "label": "Памятки"},
                    {"id": "videos", "label": "Видеоуроки"},
                    {"id": "faq", "label": "Короткие ответы на частые вопросы"},
                ]
            },
        },
        {
            "sort_order": 7,
            "question_type": QUESTION_TYPE_EMPLOYEE_EXCLUSION,
            "text": "С кем из сотрудников вы бы не хотели работать в дальнейшем?",
            "topic": "employee_exclusion",
            "required": True,
            "anonymity_mode": ANONYMITY_INHERIT,
            "config": {},
        },
        {
            "sort_order": 8,
            "question_type": QUESTION_TYPE_TEXT_COMMENT,
            "text": "Поделитесь, пожалуйста, комментарием о сопровождении.",
            "topic": "support_improvements",
            "required": False,
            "anonymity_mode": ANONYMITY_INHERIT,
            "config": {},
        },
    ]


def default_after_csat_questions_need_refresh(existing_questions: Sequence[Mapping[str, Any]] | None) -> bool:
    expected = default_after_csat_questions()
    if not isinstance(existing_questions, Sequence) or isinstance(existing_questions, (str, bytes)):
        return True
    if len(existing_questions) < len(expected):
        return True
    for index, expected_question in enumerate(expected):
        if index >= len(existing_questions):
            return True
        existing_question = existing_questions[index]
        if not isinstance(existing_question, Mapping):
            return True
        if normalize_question_type(existing_question.get("question_type")) != expected_question["question_type"]:
            return True
        existing_text = str(existing_question.get("text") or "").strip()
        if existing_text != str(expected_question["text"]).strip():
            return True
        if bool(existing_question.get("required", True)) != bool(expected_question.get("required", True)):
            return True
    return False
