from __future__ import annotations

from typing import Any, Iterable, Mapping

SYSTEM_OPERATOR_NAMES = {
    "",
    "system",
    "bot",
    "autobot",
    "ai assistant",
    "ai",
    "assistant",
    "unknown",
    "неизвестно",
    "система",
}

OPERATOR_CSAT_PREFIX = "operator_csat:"


def _normalize_name(value: Any) -> str:
    return str(value or "").strip()


def is_human_operator_name(value: Any) -> bool:
    name = _normalize_name(value)
    if not name:
        return False
    lowered = name.casefold()
    if lowered in SYSTEM_OPERATOR_NAMES:
        return False
    return not lowered.startswith("ai ")


def select_operator_rating_targets(rows: Iterable[Mapping[str, Any]]) -> list[dict[str, object]]:
    unique: dict[str, dict[str, object]] = {}
    for row in rows:
        operator_name = _normalize_name(row.get("operator_name"))
        if not is_human_operator_name(operator_name):
            continue
        key = operator_name.casefold()
        current = unique.get(key)
        candidate = {
            "id": int(row["id"]) if row.get("id") is not None else None,
            "dialog_id": int(row["dialog_id"]) if row.get("dialog_id") is not None else None,
            "appeal_id": int(row["appeal_id"]) if row.get("appeal_id") is not None else None,
            "operator_name": operator_name,
            "messages_sent": int(row.get("messages_sent") or 0),
            "response_count": int(row.get("response_count") or 0),
        }
        if current is None or (
            candidate["messages_sent"],
            candidate["response_count"],
            candidate["operator_name"],
        ) > (
            int(current.get("messages_sent") or 0),
            int(current.get("response_count") or 0),
            str(current.get("operator_name") or ""),
        ):
            unique[key] = candidate
    return sorted(
        unique.values(),
        key=lambda item: (
            -int(item.get("messages_sent") or 0),
            -int(item.get("response_count") or 0),
            str(item.get("operator_name") or ""),
        ),
    )


def build_operator_csat_callback(dialog_id: int, appeal_id: int | None, operator_name: str, rating: int) -> str:
    safe_name = _normalize_name(operator_name).replace("|", " ").strip()
    appeal_part = "" if appeal_id is None else str(int(appeal_id))
    return f"{OPERATOR_CSAT_PREFIX}{int(dialog_id)}|{appeal_part}|{safe_name}|{int(rating)}"


def parse_operator_csat_callback(data: str) -> dict[str, object]:
    if not str(data or "").startswith(OPERATOR_CSAT_PREFIX):
        raise ValueError("Unsupported callback prefix")
    payload = str(data)[len(OPERATOR_CSAT_PREFIX):]
    dialog_id_raw, appeal_id_raw, operator_name, rating_raw = payload.split("|", 3)
    return {
        "dialog_id": int(dialog_id_raw),
        "appeal_id": int(appeal_id_raw) if appeal_id_raw else None,
        "operator_name": operator_name.strip(),
        "rating": int(rating_raw),
    }
