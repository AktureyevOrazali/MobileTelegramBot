from __future__ import annotations

_CP1251_UTF8_CONTINUATION_CHARS: set[str] = set()

for _byte in range(0x80, 0xC0):
    try:
        _CP1251_UTF8_CONTINUATION_CHARS.add(bytes([_byte]).decode("cp1251"))
    except UnicodeDecodeError:
        pass


def _looks_like_latin_marker_mojibake(text: str) -> bool:
    pairs = 0
    for index, char in enumerate(text[:-1]):
        if char in {"P", "C"} and text[index + 1] in _CP1251_UTF8_CONTINUATION_CHARS:
            pairs += 1
            if pairs >= 2:
                return True
    return False


def _normalize_latin_mojibake_markers(text: str) -> str:
    if not _looks_like_latin_marker_mojibake(text):
        return text

    normalized: list[str] = []
    for index, char in enumerate(text):
        next_char = text[index + 1] if index + 1 < len(text) else ""
        if char == "P" and next_char in _CP1251_UTF8_CONTINUATION_CHARS:
            normalized.append("\u0420")
        elif char == "C" and next_char in _CP1251_UTF8_CONTINUATION_CHARS:
            normalized.append("\u0421")
        else:
            normalized.append(char)
    return "".join(normalized)


def _repair_cp1251_utf8_mojibake(text: str) -> str | None:
    normalized = _normalize_latin_mojibake_markers(text)
    if not (
        "\u0420" in normalized
        or "\u0421" in normalized
        or "\u00d0" in normalized
        or "\u00d1" in normalized
    ):
        return None
    try:
        repaired = normalized.encode("cp1251").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return None
    return repaired if repaired and repaired != text else None


def repair_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value)
    if not text:
        return text
    repaired = _repair_cp1251_utf8_mojibake(text)
    if repaired is not None:
        return repaired
    try:
        repaired = text.encode("latin1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text
    mojibake_markers = ("Р", "СЃ", "С‚", "вЂ", "Ð")
    if any(marker in text for marker in mojibake_markers):
        return repaired
    return text


def parse_amount(text: str | None) -> float | None:
    if not text:
        return None
    import re
    # Remove spaces
    cleaned = text.replace(" ", "").strip()
    if "," in cleaned and "." in cleaned:
        cleaned = cleaned.replace(",", "")
    else:
        cleaned = cleaned.replace(",", ".")
    match = re.search(r'\d+(?:\.\d+)?', cleaned)
    if match:
        try:
            return float(match.group(0))
        except ValueError:
            return None
    return None
