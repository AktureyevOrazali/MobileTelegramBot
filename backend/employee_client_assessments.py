from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

ASSESSMENT_STATUS_PENDING = "pending"
ASSESSMENT_STATUS_SUBMITTED = "submitted"

INTERACTION_STATUS_PROVIDED_ALL = "provided_all"
INTERACTION_STATUS_PROVIDED_PARTIAL = "provided_partial"
INTERACTION_STATUS_PROVIDED_NONE = "provided_none"
INTERACTION_STATUSES = {
    INTERACTION_STATUS_PROVIDED_ALL,
    INTERACTION_STATUS_PROVIDED_PARTIAL,
    INTERACTION_STATUS_PROVIDED_NONE,
}

INTERACTION_FLAG_CONSTRUCTIVE = "constructive"
INTERACTION_FLAG_REPEATED_CLARIFICATIONS = "repeated_clarifications"
INTERACTION_FLAG_HINDERED_BY_CLIENT = "hindered_by_client"
INTERACTION_FLAGS = {
    INTERACTION_FLAG_CONSTRUCTIVE,
    INTERACTION_FLAG_REPEATED_CLARIFICATIONS,
    INTERACTION_FLAG_HINDERED_BY_CLIENT,
}

REQUEST_REPEAT_FIRST_CONTACT = "first_contact"
REQUEST_REPEAT_NOT_REPEATED = "not_repeated"
REQUEST_REPEAT_REPEATED_SAME_ISSUE = "repeated_same_issue"
REQUEST_REPEAT_STATUSES = {
    REQUEST_REPEAT_FIRST_CONTACT,
    REQUEST_REPEAT_NOT_REPEATED,
    REQUEST_REPEAT_REPEATED_SAME_ISSUE,
}

LOW_SCORE_REASON_UNCLEAR_REQUEST = "unclear_request"
LOW_SCORE_REASON_MISSING_DATA = "missing_data"
LOW_SCORE_REASON_SLOW_RESPONSE = "slow_response"
LOW_SCORE_REASON_COMMUNICATION_ISSUES = "communication_issues"
LOW_SCORE_REASON_NOT_READY = "not_ready"
LOW_SCORE_REASON_DUPLICATE_REQUESTS = "duplicate_requests"
LOW_SCORE_REASON_OTHER = "other"
LOW_SCORE_REASONS = {
    LOW_SCORE_REASON_UNCLEAR_REQUEST,
    LOW_SCORE_REASON_MISSING_DATA,
    LOW_SCORE_REASON_SLOW_RESPONSE,
    LOW_SCORE_REASON_COMMUNICATION_ISSUES,
    LOW_SCORE_REASON_NOT_READY,
    LOW_SCORE_REASON_DUPLICATE_REQUESTS,
    LOW_SCORE_REASON_OTHER,
}

LOW_SCORE_REASON_LABELS = {
    LOW_SCORE_REASON_UNCLEAR_REQUEST: "Некорректная постановка вопроса",
    LOW_SCORE_REASON_MISSING_DATA: "Недостаточно данных и документов",
    LOW_SCORE_REASON_SLOW_RESPONSE: "Медленная обратная связь",
    LOW_SCORE_REASON_COMMUNICATION_ISSUES: "Нарушение деловой коммуникации",
    LOW_SCORE_REASON_NOT_READY: "Клиент не был готов к взаимодействию",
    LOW_SCORE_REASON_DUPLICATE_REQUESTS: "Повторные однотипные обращения",
    LOW_SCORE_REASON_OTHER: "Другая причина",
}

INTERACTION_STATUS_LABELS = {
    INTERACTION_STATUS_PROVIDED_ALL: "Клиент предоставил все необходимые данные",
    INTERACTION_STATUS_PROVIDED_PARTIAL: "Клиент предоставил данные частично",
    INTERACTION_STATUS_PROVIDED_NONE: "Клиент не предоставил данные",
}

INTERACTION_FLAG_LABELS = {
    INTERACTION_FLAG_CONSTRUCTIVE: "Обращение было конструктивным",
    INTERACTION_FLAG_REPEATED_CLARIFICATIONS: "Потребовались повторные уточнения",
    INTERACTION_FLAG_HINDERED_BY_CLIENT: "Обращение было затруднено из-за действий клиента",
}

REQUEST_REPEAT_LABELS = {
    REQUEST_REPEAT_FIRST_CONTACT: "Первое обращение",
    REQUEST_REPEAT_NOT_REPEATED: "Не повторное",
    REQUEST_REPEAT_REPEATED_SAME_ISSUE: "Повторное однотипное",
}


def backfill_historical_assessments() -> None:
    return None


def _safe_float(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _safe_int(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _to_month(value: Any) -> str | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.strftime("%Y-%m")


def _share(items: list[dict[str, Any]], predicate) -> float:
    if not items:
        return 0.0
    return sum(1 for item in items if predicate(item)) / len(items)


def _counter_rows(counter: Counter[str], labels: dict[str, str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for key, count in sorted(counter.items(), key=lambda item: (-item[1], labels.get(item[0], item[0]))):
        if not key:
            continue
        rows.append({"label": labels.get(key, key), "count": int(count)})
    return rows


def _load_submitted_rows(
    *,
    employee_id: int | None = None,
    employee_name: str | None = None,
    client_bin: str | None = None,
) -> list[dict[str, Any]]:
    from . import database

    where = ["status = %s"]
    params: list[Any] = [ASSESSMENT_STATUS_SUBMITTED]
    if employee_id is not None:
        where.append("assigned_user_id = %s")
        params.append(int(employee_id))
    if employee_name:
        where.append("LOWER(COALESCE(assigned_user_name, '')) = LOWER(%s)")
        params.append(str(employee_name).strip())
    if client_bin:
        where.append("client_bin = %s")
        params.append(str(client_bin).strip())
    query = f"""
        SELECT
            id,
            dialog_id,
            appeal_id,
            chat_id,
            client_id,
            client_bin,
            client_name,
            assigned_user_id,
            assigned_user_name,
            overall_score,
            interaction_quality_index,
            client_feedback_delay_hours,
            low_score_reason,
            interaction_status,
            request_repeat_status,
            interaction_flag,
            repeated_request,
            first_contact,
            client_data_overdue,
            hindered_by_client,
            without_clarifications,
            first_time_full_data,
            ai_assisted,
            submitted_at
        FROM employee_client_assessments
        WHERE {" AND ".join(where)}
        ORDER BY COALESCE(submitted_at, updated_at, created_at) DESC, id DESC
    """
    with database._lock:
        rows = database.execute(query, params).fetchall()
    return [dict(row) for row in rows or []]


def submit_employee_assessment(
    assessment_id: int,
    *,
    question_clarity_score: int,
    data_completeness_score: int,
    client_response_speed_score: int,
    business_communication_score: int,
    client_readiness_score: int,
    low_score_reason: str | None,
    internal_comment: str | None,
    interaction_status: str,
    interaction_flag: str,
    request_repeat_status: str,
    client_data_overdue: bool,
) -> dict[str, Any]:
    from . import database

    if interaction_status not in INTERACTION_STATUSES:
        raise ValueError("Unknown interaction status")
    if interaction_flag not in INTERACTION_FLAGS:
        raise ValueError("Unknown interaction flag")
    if request_repeat_status not in REQUEST_REPEAT_STATUSES:
        raise ValueError("Unknown repeat status")
    if low_score_reason and low_score_reason not in LOW_SCORE_REASONS:
        raise ValueError("Unknown low score reason")

    scores = [
        int(question_clarity_score),
        int(data_completeness_score),
        int(client_response_speed_score),
        int(business_communication_score),
        int(client_readiness_score),
    ]
    overall_score = sum(scores) / len(scores)
    interaction_quality_index = round((overall_score / 5.0) * 100.0, 2)
    repeated_request = request_repeat_status == REQUEST_REPEAT_REPEATED_SAME_ISSUE
    first_contact = request_repeat_status == REQUEST_REPEAT_FIRST_CONTACT
    hindered_by_client = interaction_flag == INTERACTION_FLAG_HINDERED_BY_CLIENT
    without_clarifications = interaction_flag == INTERACTION_FLAG_CONSTRUCTIVE
    first_time_full_data = interaction_status == INTERACTION_STATUS_PROVIDED_ALL and first_contact
    submitted_at = datetime.now(timezone.utc).isoformat()

    with database._lock:
        row = database.execute(
            """
            UPDATE employee_client_assessments
            SET question_clarity_score = %s,
                data_completeness_score = %s,
                client_response_speed_score = %s,
                business_communication_score = %s,
                client_readiness_score = %s,
                overall_score = %s,
                interaction_quality_index = %s,
                low_score_reason = %s,
                internal_comment = %s,
                interaction_status = %s,
                request_repeat_status = %s,
                interaction_flag = %s,
                repeated_request = %s,
                first_contact = %s,
                client_data_overdue = %s,
                hindered_by_client = %s,
                without_clarifications = %s,
                first_time_full_data = %s,
                status = %s,
                submitted_at = %s,
                updated_at = %s
            WHERE id = %s
            RETURNING id, dialog_id, status, overall_score, interaction_quality_index, submitted_at
            """,
            (
                scores[0],
                scores[1],
                scores[2],
                scores[3],
                scores[4],
                overall_score,
                interaction_quality_index,
                low_score_reason,
                (internal_comment or "").strip() or None,
                interaction_status,
                request_repeat_status,
                interaction_flag,
                repeated_request,
                first_contact,
                bool(client_data_overdue),
                hindered_by_client,
                without_clarifications,
                first_time_full_data,
                ASSESSMENT_STATUS_SUBMITTED,
                submitted_at,
                submitted_at,
                int(assessment_id),
            ),
        ).fetchone()
    if row is None:
        raise ValueError("Assessment not found")
    return dict(row)


def get_employee_assessment_analytics(
    *,
    employee_id: int | None = None,
    employee_name: str | None = None,
    client_bin: str | None = None,
) -> dict[str, Any]:
    rows = _load_submitted_rows(employee_id=employee_id, employee_name=employee_name, client_bin=client_bin)
    total = len(rows)
    score_values = [_safe_float(row.get("overall_score")) for row in rows]
    score_values = [value for value in score_values if value is not None]
    quality_values = [_safe_float(row.get("interaction_quality_index")) for row in rows]
    quality_values = [value for value in quality_values if value is not None]
    delay_values = [_safe_float(row.get("client_feedback_delay_hours")) for row in rows]
    delay_values = [value for value in delay_values if value is not None]

    low_score_reasons = Counter(str(row.get("low_score_reason") or "") for row in rows if row.get("low_score_reason"))
    interaction_statuses = Counter(str(row.get("interaction_status") or "") for row in rows if row.get("interaction_status"))
    interaction_flags = Counter(str(row.get("interaction_flag") or "") for row in rows if row.get("interaction_flag"))
    request_repeat_statuses = Counter(str(row.get("request_repeat_status") or "") for row in rows if row.get("request_repeat_status"))

    monthly_buckets: dict[str, dict[str, float]] = defaultdict(lambda: {"score_sum": 0.0, "quality_sum": 0.0, "count": 0.0})
    client_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    recent_assessments: list[dict[str, Any]] = []

    for row in rows:
        month = _to_month(row.get("submitted_at"))
        if month:
            monthly_buckets[month]["score_sum"] += _safe_float(row.get("overall_score")) or 0.0
            monthly_buckets[month]["quality_sum"] += _safe_float(row.get("interaction_quality_index")) or 0.0
            monthly_buckets[month]["count"] += 1
        client_key = str(row.get("client_bin") or row.get("client_name") or row.get("client_id") or row.get("chat_id") or row.get("id"))
        client_groups[client_key].append(row)
        if len(recent_assessments) < 20:
            recent_assessments.append(
                {
                    "id": int(row["id"]),
                    "client_name": str(row.get("client_name") or "Клиент"),
                    "client_bin": row.get("client_bin"),
                    "assigned_user_name": row.get("assigned_user_name"),
                    "overall_score": _safe_float(row.get("overall_score")),
                    "interaction_quality_index": _safe_float(row.get("interaction_quality_index")),
                    "low_score_reason": row.get("low_score_reason"),
                    "submitted_at": row.get("submitted_at"),
                    "repeated_request": bool(row.get("repeated_request")),
                    "request_repeat_status": str(row.get("request_repeat_status") or REQUEST_REPEAT_NOT_REPEATED),
                    "client_data_overdue": bool(row.get("client_data_overdue")),
                    "ai_assisted": bool(row.get("ai_assisted")),
                }
            )

    client_ratings: list[dict[str, Any]] = []
    for grouped_rows in client_groups.values():
        if not grouped_rows:
            continue
        first = grouped_rows[0]
        grouped_scores = [_safe_float(item.get("overall_score")) for item in grouped_rows]
        grouped_scores = [value for value in grouped_scores if value is not None]
        grouped_quality = [_safe_float(item.get("interaction_quality_index")) for item in grouped_rows]
        grouped_quality = [value for value in grouped_quality if value is not None]
        grouped_delays = [_safe_float(item.get("client_feedback_delay_hours")) for item in grouped_rows]
        grouped_delays = [value for value in grouped_delays if value is not None]
        client_ratings.append(
            {
                "client_bin": first.get("client_bin"),
                "client_name": str(first.get("client_name") or "Клиент"),
                "task_count": len(grouped_rows),
                "average_overall_score": (sum(grouped_scores) / len(grouped_scores)) if grouped_scores else 0.0,
                "average_interaction_quality_index": (sum(grouped_quality) / len(grouped_quality)) if grouped_quality else 0.0,
                "high_score_share": _share(grouped_rows, lambda item: (_safe_float(item.get("overall_score")) or 0) >= 4.0),
                "low_score_share": _share(grouped_rows, lambda item: (_safe_float(item.get("overall_score")) or 0) <= 2.0),
                "repeated_request_share": _share(grouped_rows, lambda item: bool(item.get("repeated_request"))),
                "first_contact_share": _share(grouped_rows, lambda item: bool(item.get("first_contact"))),
                "average_feedback_delay_hours": (sum(grouped_delays) / len(grouped_delays)) if grouped_delays else None,
                "hindered_count": sum(1 for item in grouped_rows if bool(item.get("hindered_by_client"))),
                "without_clarifications_count": sum(1 for item in grouped_rows if bool(item.get("without_clarifications"))),
                "first_time_full_data_share": _share(grouped_rows, lambda item: bool(item.get("first_time_full_data"))),
                "internal_rating": (sum(grouped_quality) / len(grouped_quality)) if grouped_quality else 0.0,
            }
        )

    client_ratings.sort(key=lambda item: (-float(item.get("average_interaction_quality_index") or 0.0), -int(item.get("task_count") or 0), str(item.get("client_name") or "")))

    return {
        "total_assessments": total,
        "average_overall_score": (sum(score_values) / len(score_values)) if score_values else None,
        "average_interaction_quality_index": (sum(quality_values) / len(quality_values)) if quality_values else None,
        "average_feedback_delay_hours": (sum(delay_values) / len(delay_values)) if delay_values else None,
        "high_score_share": _share(rows, lambda item: (_safe_float(item.get("overall_score")) or 0) >= 4.0),
        "low_score_share": _share(rows, lambda item: (_safe_float(item.get("overall_score")) or 0) <= 2.0),
        "repeated_request_share": _share(rows, lambda item: bool(item.get("repeated_request"))),
        "first_contact_share": _share(rows, lambda item: bool(item.get("first_contact"))),
        "hindered_count": sum(1 for item in rows if bool(item.get("hindered_by_client"))),
        "without_clarifications_count": sum(1 for item in rows if bool(item.get("without_clarifications"))),
        "first_time_full_data_share": _share(rows, lambda item: bool(item.get("first_time_full_data"))),
        "low_score_reasons": _counter_rows(low_score_reasons, LOW_SCORE_REASON_LABELS),
        "interaction_statuses": _counter_rows(interaction_statuses, INTERACTION_STATUS_LABELS),
        "interaction_flags": _counter_rows(interaction_flags, INTERACTION_FLAG_LABELS),
        "request_repeat_statuses": _counter_rows(request_repeat_statuses, REQUEST_REPEAT_LABELS),
        "monthly_scores": [
            {
                "month": month,
                "average_overall_score": values["score_sum"] / values["count"],
                "average_interaction_quality_index": values["quality_sum"] / values["count"],
                "count": int(values["count"]),
            }
            for month, values in sorted(monthly_buckets.items())
            if values["count"] > 0
        ],
        "client_ratings": client_ratings,
        "recent_assessments": recent_assessments,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
