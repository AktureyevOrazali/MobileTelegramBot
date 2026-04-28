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
