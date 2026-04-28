from __future__ import annotations

from typing import Any, Callable

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
    return False


def maybe_start_survey_after_employee_csat(dialog_id: int, appeal_id: int | None = None) -> dict[str, Any]:
    return {
        "dialog_id": int(dialog_id),
        "appeal_id": int(appeal_id) if appeal_id is not None else None,
        "started": False,
    }


def start_periodic_surveys() -> dict[str, Any]:
    # Restored minimal implementation. Periodic dispatch should not break
    # backend startup even if scheduling rules are incomplete.
    return {
        "started": [],
        "skipped": [],
        "started_count": 0,
        "skipped_count": 0,
    }
