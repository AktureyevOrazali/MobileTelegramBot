from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable, Mapping


COMPLETED_SESSION_STATUSES = {
    "completed",
    "closed",
    "submitted",
}


def is_completed_session_status(status: object) -> bool:
    return str(status or "").strip().lower() in COMPLETED_SESSION_STATUSES


def _month_from_value(value: object) -> str:
    text = str(value or "")
    if not text:
        return ""
    try:
        normalized = text.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized).strftime("%Y-%m")
    except ValueError:
        return text[:7]


def _top_items(source: Mapping[str, int], limit: int = 10) -> list[dict[str, Any]]:
    return [
        {"label": label, "count": count}
        for label, count in sorted(source.items(), key=lambda item: (-item[1], item[0]))[:limit]
    ]


def _score_label(value: float) -> str:
    if value.is_integer():
        return str(int(value))
    return str(value).rstrip("0").rstrip(".")


def _score_distribution_items(source: Mapping[str, int]) -> list[dict[str, Any]]:
    def sort_key(item: tuple[str, int]) -> tuple[float, str]:
        label, _count = item
        try:
            return (-float(label), label)
        except ValueError:
            return (0.0, label)

    return [{"label": label, "count": count} for label, count in sorted(source.items(), key=sort_key)]


def _question_key_part(value: object) -> str:
    return " ".join(str(value or "").split()).casefold()


def _question_group_key(row: Mapping[str, Any]) -> tuple[str, str, str]:
    text_key = _question_key_part(row.get("question_text"))
    if not text_key:
        text_key = str(row["question_id"])
    return (
        _question_key_part(row.get("question_type")),
        _question_key_part(row.get("topic")),
        text_key,
    )


def summarize_question_analytics(rows: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    questions: dict[tuple[str, str, str], dict[str, Any]] = {}

    for row in rows:
        question_id = int(row["question_id"])
        sort_order = int(row.get("sort_order") or 0)
        bucket = questions.setdefault(
            _question_group_key(row),
            {
                "question_id": question_id,
                "question_text": str(row.get("question_text") or ""),
                "question_type": str(row.get("question_type") or ""),
                "topic": row.get("topic"),
                "sort_order": sort_order,
                "answer_count": 0,
                "score_sum": 0.0,
                "score_count": 0,
                "score_distribution_counts": {},
                "top_answer_counts": {},
            },
        )
        bucket["question_id"] = min(int(bucket["question_id"]), question_id)
        bucket["sort_order"] = min(int(bucket["sort_order"]), sort_order)
        bucket["answer_count"] += 1

        score = row.get("numeric_score")
        if score is not None:
            numeric_score = float(score)
            bucket["score_sum"] += numeric_score
            bucket["score_count"] += 1
            label = _score_label(numeric_score)
            score_counts = bucket["score_distribution_counts"]
            score_counts[label] = score_counts.get(label, 0) + 1

        question_type = str(row.get("question_type") or "")
        answer_counts = bucket["top_answer_counts"]
        if question_type == "employee_exclusion":
            employee_name = str(row.get("selected_employee_name") or "").strip()
            if employee_name:
                answer_counts[employee_name] = answer_counts.get(employee_name, 0) + 1
            continue

        if question_type in {"single_choice", "multi_choice"}:
            labels_by_id = row.get("option_labels_by_id")
            if not isinstance(labels_by_id, Mapping):
                labels_by_id = {}
            selected_options = row.get("selected_options")
            if isinstance(selected_options, list):
                for option_id in selected_options:
                    label = str(labels_by_id.get(str(option_id), option_id)).strip()
                    if label:
                        answer_counts[label] = answer_counts.get(label, 0) + 1
            continue

        if question_type == "text_comment":
            raw_text = str(row.get("raw_text") or "").strip()
            if raw_text:
                answer_counts[raw_text] = answer_counts.get(raw_text, 0) + 1

    result: list[dict[str, Any]] = []
    for bucket in sorted(questions.values(), key=lambda item: (int(item["sort_order"]), int(item["question_id"]))):
        score_count = int(bucket["score_count"])
        result.append(
            {
                "question_id": int(bucket["question_id"]),
                "question_text": bucket["question_text"],
                "question_type": bucket["question_type"],
                "topic": bucket["topic"],
                "sort_order": int(bucket["sort_order"]),
                "answer_count": int(bucket["answer_count"]),
                "average_score": (float(bucket["score_sum"]) / score_count) if score_count else None,
                "score_distribution": _score_distribution_items(bucket["score_distribution_counts"]),
                "top_answers": _top_items(bucket["top_answer_counts"]),
            }
        )
    return result


def summarize_completed_survey_scores(rows: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    sessions: dict[int, dict[str, Any]] = {}

    for row in rows:
        if not is_completed_session_status(row.get("session_status")):
            continue
        score = row.get("numeric_score")
        if score is None:
            continue
        session_id = int(row["session_id"])
        bucket = sessions.setdefault(
            session_id,
            {
                "score_sum": 0.0,
                "score_count": 0,
                "created_at": row.get("created_at"),
            },
        )
        bucket["score_sum"] += float(score)
        bucket["score_count"] += 1
        if row.get("created_at"):
            bucket["created_at"] = row.get("created_at")

    survey_scores: list[dict[str, Any]] = []
    for session in sessions.values():
        if session["score_count"] <= 0:
            continue
        survey_scores.append(
            {
                "score": session["score_sum"] / session["score_count"],
                "month": _month_from_value(session.get("created_at")),
            }
        )

    score_count = len(survey_scores)
    score_sum = sum(item["score"] for item in survey_scores)
    positive = sum(1 for item in survey_scores if item["score"] >= 4)
    neutral = sum(1 for item in survey_scores if 3 <= item["score"] < 4)
    negative = sum(1 for item in survey_scores if item["score"] < 3)

    monthly: dict[str, dict[str, float]] = {}
    for item in survey_scores:
        month = item["month"]
        if not month:
            continue
        bucket = monthly.setdefault(month, {"sum": 0.0, "count": 0.0})
        bucket["sum"] += item["score"]
        bucket["count"] += 1

    return {
        "average_score": (score_sum / score_count) if score_count else None,
        "score_count": score_count,
        "positive_count": positive,
        "neutral_count": neutral,
        "negative_count": negative,
        "positive_share": (positive / score_count) if score_count else 0,
        "neutral_share": (neutral / score_count) if score_count else 0,
        "negative_share": (negative / score_count) if score_count else 0,
        "monthly_satisfaction": [
            {
                "month": month,
                "average_score": values["sum"] / values["count"],
                "count": int(values["count"]),
            }
            for month, values in sorted(monthly.items())
        ],
    }
