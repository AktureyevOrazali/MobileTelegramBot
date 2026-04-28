from __future__ import annotations


COMPLETED_SESSION_STATUSES = {
    "completed",
    "closed",
    "submitted",
}


def is_completed_session_status(status: object) -> bool:
    return str(status or "").strip().lower() in COMPLETED_SESSION_STATUSES
