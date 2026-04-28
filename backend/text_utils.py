from __future__ import annotations


def repair_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value)
    if not text:
        return text
    try:
        repaired = text.encode("latin1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text
    mojibake_markers = ("Р", "СЃ", "С‚", "вЂ", "Ð")
    if any(marker in text for marker in mojibake_markers):
        return repaired
    return text
