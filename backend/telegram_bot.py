"""Telegram bot that writes incoming messages into the database."""
from __future__ import annotations

import io
import logging
import os
import re
from datetime import date, datetime, timezone
from typing import Optional

import telebot
from telebot import types

from . import database, survey_service
from .customer_ratings import (
    OPERATOR_CSAT_PREFIX,
    build_operator_csat_callback,
    parse_operator_csat_callback,
)
from .ai_manager import ai_manager
from .media import MediaValidationError, media_service
from . import contract_checker
import asyncio

logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
if not TELEGRAM_BOT_TOKEN:
    raise RuntimeError("TELEGRAM_BOT_TOKEN environment variable is required")

bot = telebot.TeleBot(TELEGRAM_BOT_TOKEN, parse_mode=None, threaded=True)

SECTION_COMMANDS = {section["id"]: section for section in database.SECTIONS}
FAQ_BY_SECTION = {section["id"]: database.list_faq(section["id"]) for section in database.SECTIONS}
FAQ_TRIGGER = "С‡Р°СЃС‚С‹Рµ РІРѕРїСЂРѕСЃС‹"
OPERATOR_TRIGGER = "СЃРІСЏР·Р°С‚СЊСЃСЏ СЃ РѕРїРµСЂР°С‚РѕСЂРѕРј"
MOJIBAKE_HINT_RE = re.compile("(?:\u0420.|\u0421.|\u00d0.|\u00d1.){2,}")
BIN_PATTERN = re.compile(r"^\d{12}$")
START_BUTTON = "в–¶пёЏ РЎС‚Р°СЂС‚"
NEW_BIN_BUTTON = "вћ• Р”РѕР±Р°РІРёС‚СЊ Р‘РРќ"
SELECT_BIN_BUTTON = "рџ“‚ Р’С‹Р±СЂР°С‚СЊ Р‘РРќ"
FINISH_BUTTON = "вЏ№ Р—Р°РІРµСЂС€РёС‚СЊ"
FAQ_BUTTON = "Р§Р°СЃС‚С‹Рµ РІРѕРїСЂРѕСЃС‹"
OPERATOR_BUTTON = "рџ‘ЁвЂЌрџ’ј РћРїРµСЂР°С‚РѕСЂ"
AI_ENABLE_BUTTON = "\U0001f916 \u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c AI"
OPERATOR_REQUEST_MARKER = "[\u0417\u0410\u041f\u0420\u041e\u0421 \u041e\u041f\u0415\u0420\u0410\u0422\u041e\u0420\u0410]"
SWITCH_BIN_CALLBACK = "switch_bin"
SECTION_ICONS = {
    "general": "рџ’¬",
    "finance": "рџ’°",
    "support": "рџ› ",
    "hr": "рџ‘Ґ",
}

def _count_cyrillic(value: str) -> int:
    return sum(1 for ch in value if "\u0400" <= ch <= "\u04ff")

def _repair_mojibake(value: str) -> str | None:
    if not value:
        return None
    suspicious = "\ufffd" in value or bool(MOJIBAKE_HINT_RE.search(value)) or _count_cyrillic(value) == 0
    if not suspicious:
        return None
    for encoding in ("cp1251", "latin1"):
        try:
            repaired = value.encode(encoding).decode("utf-8").strip()
        except (UnicodeEncodeError, UnicodeDecodeError):
            continue
        if repaired and repaired != value:
            repaired_cyrillic = _count_cyrillic(repaired)
            original_cyrillic = _count_cyrillic(value)
            if repaired_cyrillic >= max(3, original_cyrillic // 2) or (
                repaired_cyrillic >= 3 and len(repaired) < len(value)
            ):
                return repaired
    return None

def _sanitize_telegram_text(value: str | None, fallback: str = "") -> str:
    normalized = re.sub(r"\s+", " ", value or "").strip()
    if not normalized:
        return fallback
    repaired = _repair_mojibake(normalized) or normalized
    cleaned = repaired.replace("\ufffd", "").strip()
    return cleaned or fallback

def _compact_button_text(value: str | None, max_len: int = 28) -> str:
    text = _sanitize_telegram_text(value)
    text = text.replace("%s", "").strip()
    if len(text) <= max_len:
        return text
    trimmed = text[: max_len - 3].rstrip(" .,:;!?-")
    return f"{trimmed}..."

def _section_button_text(section: dict) -> str:
    title = _sanitize_telegram_text(section.get("title"), "Р Р°Р·РґРµР»")
    icon = SECTION_ICONS.get(section.get("id"), "")
    return f"{icon} {title}".strip()

SECTION_TITLES = {
    _sanitize_telegram_text(section["title"]).lower(): section for section in database.SECTIONS
}
SECTION_TITLES.update({
    _section_button_text(section).lower(): section for section in database.SECTIONS
})

# Global AI session state
AI_SESSIONS = {}  # {chat_id: {'ai_enabled': True, 'operator_requested': False, 'waiting_message_id': None}}

def get_ai_session(chat_id: int) -> dict:
    """РџРѕР»СѓС‡Р°РµС‚ РёР»Рё СЃРѕР·РґР°РµС‚ AI СЃРµСЃСЃРёСЋ РґР»СЏ С‡Р°С‚Р°"""
    if chat_id not in AI_SESSIONS:
        AI_SESSIONS[chat_id] = {
            'ai_enabled': True,  # РР—РќРђР§РђР›Р¬РќРћ Р’РљР›Р®Р§Р•Рќ
            'operator_requested': False,
            'waiting_message_id': None  # ID СЃРѕРѕР±С‰РµРЅРёСЏ "РџРѕРґРѕР¶РґРёС‚Рµ..."
        }
    return AI_SESSIONS[chat_id]

def enable_ai_session(chat_id: int) -> None:
    """РЎР±СЂР°СЃС‹РІР°РµС‚ С„Р»Р°РіРё Рё РІРєР»СЋС‡Р°РµС‚ AI РґР»СЏ СѓРєР°Р·Р°РЅРЅРѕРіРѕ С‡Р°С‚Р°."""
    session = get_ai_session(chat_id)
    session['ai_enabled'] = True
    session['operator_requested'] = False

    if session.get('waiting_message_id'):
        try:
            bot.delete_message(chat_id, session['waiting_message_id'])
        except Exception:
            pass
        session['waiting_message_id'] = None


def disable_ai_session(chat_id: int, *, operator_requested: bool = True) -> None:
    session = get_ai_session(chat_id)
    session['ai_enabled'] = False
    session['operator_requested'] = operator_requested
    if session.get('waiting_message_id'):
        try:
            bot.delete_message(chat_id, session['waiting_message_id'])
        except Exception:
            pass
        session['waiting_message_id'] = None


def _is_ai_allowed(chat_id: int, dialog_id: int | None = None) -> bool:
    resolved_dialog_id = dialog_id if dialog_id is not None else database.get_active_chat_dialog_id(chat_id)
    if resolved_dialog_id is not None and database.is_dialog_in_operator_mode(resolved_dialog_id):
        disable_ai_session(chat_id, operator_requested=True)
        return False
    session = get_ai_session(chat_id)
    return bool(session['ai_enabled'] and not session['operator_requested'])


def _register_operator_request(chat_id: int, *, section: str | None = None) -> int | None:
    dialog_id = database.get_active_chat_dialog_id(chat_id)
    if dialog_id is not None:
        database.set_dialog_operator_mode(dialog_id, True)
    disable_ai_session(chat_id, operator_requested=True)
    chat_record = database.get_chat(chat_id) or {}
    database.create_operator_request_notifications(
        chat_id,
        dialog_id=dialog_id,
        chat_title=chat_record.get('title'),
        section=section or chat_record.get('section'),
        bin_value=chat_record.get('bin'),
    )
    return dialog_id
        
def _section_keyboard() -> types.ReplyKeyboardMarkup:
    keyboard = types.ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=False, row_width=2)
    keyboard.row(
        types.KeyboardButton(START_BUTTON),
        types.KeyboardButton(FINISH_BUTTON),
    )
    keyboard.row(
        types.KeyboardButton(NEW_BIN_BUTTON),
        types.KeyboardButton(SELECT_BIN_BUTTON),
    )
    section_buttons = [types.KeyboardButton(_section_button_text(section)) for section in database.SECTIONS]
    for index in range(0, len(section_buttons), 2):
        keyboard.row(*section_buttons[index:index + 2])
    keyboard.row(
        types.KeyboardButton(FAQ_BUTTON),
        types.KeyboardButton(OPERATOR_BUTTON),
    )
    keyboard.row(types.KeyboardButton("\U0001f916 \u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c AI"))
    return keyboard

def _generate_ai_response(message: telebot.types.Message, section: str | None) -> None:
    """Generate and send AI response with typing indicator."""
    chat_id = message.chat.id
    ai_session = get_ai_session(chat_id)

    active_dialog_id = database.get_active_chat_dialog_id(chat_id)
    if not _is_ai_allowed(chat_id, active_dialog_id):
        return

    try:
        bot.send_chat_action(chat_id, 'typing')
        waiting_msg = bot.send_message(chat_id, "рџ¤– РџРѕРґРѕР¶РґРёС‚Рµ, AI РґСѓРјР°РµС‚...")
        ai_session['waiting_message_id'] = waiting_msg.message_id

        chat_history = database.get_messages(chat_id, limit=6, dialog_id=active_dialog_id)

        if not _is_ai_allowed(chat_id, active_dialog_id):
            try:
                bot.delete_message(chat_id, waiting_msg.message_id)
            except Exception:
                pass
            ai_session['waiting_message_id'] = None
            return

        ai_response = ai_manager.generate_response(message.text, chat_history, operator_hint="/operator")

        if not _is_ai_allowed(chat_id, active_dialog_id):
            try:
                bot.delete_message(chat_id, waiting_msg.message_id)
            except Exception:
                pass
            ai_session['waiting_message_id'] = None
            return

        try:
            bot.delete_message(chat_id, waiting_msg.message_id)
        except Exception:
            pass
        ai_session['waiting_message_id'] = None

        _send_and_store_message(
            chat_id,
            f"рџ¤– {ai_response}",
            stored_text=ai_response,
            section=section,
            author="AI Assistant",
        )
        logger.info("AI response sent to chat %s", chat_id)

    except Exception as e:
        logger.error("Failed to generate AI response for chat %s: %s", chat_id, e)
        if ai_session['waiting_message_id']:
            try:
                bot.delete_message(chat_id, ai_session['waiting_message_id'])
            except Exception:
                pass
            ai_session['waiting_message_id'] = None

        _send_and_store_message(
            chat_id,
            "вќЊ Р’СЂРµРјРµРЅРЅР°СЏ РѕС€РёР±РєР° AI РїРѕРјРѕС‰РЅРёРєР°. РџСЂРё РЅРµРѕР±С…РѕРґРёРјРѕСЃС‚Рё РЅР°РїРёС€РёС‚Рµ 'РѕРїРµСЂР°С‚РѕСЂ'",
            section=section,
            author="System",
        )

# Р”РѕР±Р°РІР»СЏРµРј РѕР±СЂР°Р±РѕС‚С‡РёРєРё РєРѕРјР°РЅРґ AI
@bot.message_handler(commands=['ai_on', 'ai_off', 'operator', 'ai'])
def handle_ai_commands(message: telebot.types.Message) -> None:
    """Handle AI control commands."""
    chat_id = message.chat.id
    command = message.text.split('@')[0].lower()
    active_dialog_id = database.get_active_chat_dialog_id(chat_id)

    if command == '/ai_on' or command == '/ai':
        if active_dialog_id is not None:
            database.set_dialog_operator_mode(active_dialog_id, False)
        enable_ai_session(chat_id)
        bot.send_message(
            chat_id,
            "\u2705 AI \u043f\u043e\u043c\u043e\u0449\u043d\u0438\u043a \u0432\u043a\u043b\u044e\u0447\u0435\u043d. \u0417\u0430\u0434\u0430\u0432\u0430\u0439\u0442\u0435 \u0432\u043e\u043f\u0440\u043e\u0441\u044b \u043f\u043e \u0431\u0443\u0445\u0433\u0430\u043b\u0442\u0435\u0440\u0438\u0438 \u0438 \u043d\u0430\u043b\u043e\u0433\u0430\u043c \u0420\u041a!\n\n"
            "\u0427\u0442\u043e\u0431\u044b \u043e\u0442\u043a\u043b\u044e\u0447\u0438\u0442\u044c AI, \u043d\u0430\u043f\u0438\u0448\u0438\u0442\u0435 /ai_off. \u0427\u0442\u043e\u0431\u044b \u043f\u043e\u0437\u0432\u0430\u0442\u044c \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0430, \u043d\u0430\u043f\u0438\u0448\u0438\u0442\u0435 '\u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440'."
        )
        logger.info("AI enabled for chat %s", chat_id)

    elif command == '/ai_off':
        if active_dialog_id is not None:
            database.set_dialog_operator_mode(active_dialog_id, True)
        disable_ai_session(chat_id, operator_requested=True)
        bot.send_message(
            chat_id,
            "\u274c AI \u043f\u043e\u043c\u043e\u0449\u043d\u0438\u043a \u0432\u044b\u043a\u043b\u044e\u0447\u0435\u043d. \u0412\u0430\u0448\u0438 \u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f \u0431\u0443\u0434\u0443\u0442 \u0436\u0434\u0430\u0442\u044c \u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440\u0430.\n\n"
            "\u0427\u0442\u043e\u0431\u044b \u0441\u043d\u043e\u0432\u0430 \u0432\u043a\u043b\u044e\u0447\u0438\u0442\u044c AI, \u043d\u0430\u043f\u0438\u0448\u0438\u0442\u0435 /ai_on"
        )
        logger.info("AI disabled for chat %s", chat_id)

    elif command == '/operator':
        active_section = database.get_dialog_section(chat_id)
        if not active_section:
            chat_record = database.get_chat(chat_id)
            active_section = chat_record.get("section") if chat_record else None
        dialog_id = _register_operator_request(chat_id, section=active_section)
        bot.send_message(
            chat_id,
            "\U0001f468\u200d\U0001f4bc \u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0430\u044e \u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440\u0430... AI \u043f\u043e\u043c\u043e\u0449\u043d\u0438\u043a \u043e\u0442\u043a\u043b\u044e\u0447\u0435\u043d.\n"
            "\u041e\u043f\u0435\u0440\u0430\u0442\u043e\u0440 \u043e\u0442\u0432\u0435\u0442\u0438\u0442 \u0432 \u0431\u043b\u0438\u0436\u0430\u0439\u0448\u0435\u0435 \u0432\u0440\u0435\u043c\u044f."
        )
        logger.info("Operator requested for chat %s, AI disabled", chat_id)
        _persist_message(
            message,
            direction="incoming",
            override_text=OPERATOR_REQUEST_MARKER,
            section=active_section,
            dialog_id=dialog_id,
        )

@bot.message_handler(commands=["start"])
def handle_start(message: telebot.types.Message) -> None:
    chat = message.chat
    database.upsert_chat(chat.id, chat.title or chat.username or str(chat.id), chat.username, chat.type)
    database.close_active_chat_dialog(chat.id)

    # РРЅРёС†РёР°Р»РёР·РёСЂСѓРµРј AI СЃРµСЃСЃРёСЋ (Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РІРєР»СЋС‡РµРЅ)
    get_ai_session(chat.id)

    bot.send_message(
        chat.id,
        "Р—РґСЂР°РІСЃС‚РІСѓР№С‚Рµ! РЇ РїРѕРјРѕРіСѓ СЃРІСЏР·Р°С‚СЊСЃСЏ СЃ РѕРїРµСЂР°С‚РѕСЂРѕРј.",
    )
    bot.send_message(
        chat.id,
        "рџ¤– AI РїРѕРјРѕС‰РЅРёРє Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РІРєР»СЋС‡РµРЅ Рё РіРѕС‚РѕРІ РѕС‚РІРµС‡Р°С‚СЊ РЅР° РІРѕРїСЂРѕСЃС‹ РїРѕ Р±СѓС…РіР°Р»С‚РµСЂРёРё Рё РЅР°Р»РѕРіР°Рј Р Рљ!\n\n"
        "РљРѕРјР°РЅРґС‹:\n"
        "/ai_on - РІРєР»СЋС‡РёС‚СЊ AI РїРѕРјРѕС‰РЅРёРєР°\n"
        "/ai_off - РІС‹РєР»СЋС‡РёС‚СЊ AI РїРѕРјРѕС‰РЅРёРєР°\n"
        "/operator - СЃРІСЏР·Р°С‚СЊСЃСЏ СЃ РѕРїРµСЂР°С‚РѕСЂРѕРј\n\n"
        "Р”Р»СЏ РЅР°С‡Р°Р»Р° СѓРєР°Р¶РёС‚Рµ Р‘РРќ РІР°С€РµР№ РѕСЂРіР°РЅРёР·Р°С†РёРё (12 С†РёС„СЂ).",
        reply_markup=_section_keyboard()
    )
    logger.info("Start command handled for chat %s", chat.id)


section_ids = list(SECTION_COMMANDS.keys())


@bot.message_handler(commands=section_ids)
def handle_section_commands(message: telebot.types.Message) -> None:
    section_id = message.text.lstrip("/").split()[0]
    chat = message.chat
    database.upsert_chat(chat.id, chat.title or chat.username or str(chat.id), chat.username, chat.type)
    chat_record = database.get_chat(chat.id)
    if chat_record and not chat_record.get("bin"):
        bot.send_message(chat.id, "РЎРЅР°С‡Р°Р»Р° СѓРєР°Р¶РёС‚Рµ Р‘РРќ РѕСЂРіР°РЅРёР·Р°С†РёРё.")
        _persist_message(message, direction="incoming", section=None)
        return
    _persist_message(message, direction="incoming", section=None)
    _select_section(chat.id, section_id)


@bot.message_handler(commands=["faq"])
def handle_faq_command(message: telebot.types.Message) -> None:
    chat = message.chat
    chat_record = database.get_chat(chat.id)
    section_id = chat_record.get("section") if chat_record else None
    if not section_id:
        bot.send_message(chat.id, "РЎРЅР°С‡Р°Р»Р° РІС‹Р±РµСЂРёС‚Рµ СЂР°Р·РґРµР», С‡С‚РѕР±С‹ РїРѕРєР°Р·Р°С‚СЊ FAQ.")
        _persist_message(message, direction="incoming", section=None)
        return
    _persist_message(message, direction="incoming", section=section_id)
    _send_faq_menu(chat.id, section_id)


@bot.message_handler(content_types=["text", "photo", "document", "audio", "video", "voice", "sticker"])
def handle_updates(message: telebot.types.Message) -> None:
    chat = message.chat
    database.upsert_chat(chat.id, chat.title or chat.username or str(chat.id), chat.username, chat.type)

    text = message.text or ""
    chat_record = database.get_chat(chat.id)
    
    # РџРѕР»СѓС‡Р°РµРј AI СЃРµСЃСЃРёСЋ
    get_ai_session(chat.id)

    # РћР±СЂР°Р±Р°С‚С‹РІР°РµРј С‚РµРєСЃС‚РѕРІС‹Рµ РєРѕРјР°РЅРґС‹ СѓРїСЂР°РІР»РµРЅРёСЏ AI
    if message.content_type == "text":
        stripped_text = text.strip()
        if stripped_text == START_BUTTON:
            _persist_message(message, direction="incoming", override_text="[РљРћРњРђРќР”Рђ] РЎС‚Р°СЂС‚", section=None)
            handle_start(message)
            return
        if stripped_text == NEW_BIN_BUTTON:
            enable_ai_session(chat.id)
            bot.send_message(chat.id, "\u041e\u0442\u043f\u0440\u0430\u0432\u044c\u0442\u0435 \u0411\u0418\u041d \u043e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0446\u0438\u0438 \u0447\u0438\u0441\u043b\u043e\u043c \u0438\u0437 12 \u0446\u0438\u0444\u0440, \u0447\u0442\u043e\u0431\u044b \u043d\u0430\u0447\u0430\u0442\u044c \u043d\u043e\u0432\u044b\u0439 \u0434\u0438\u0430\u043b\u043e\u0433.")
            _persist_message(message, direction="incoming", override_text="[???????] ???????? ???", section=None)
            return
        if stripped_text == SELECT_BIN_BUTTON:
            _persist_message(message, direction="incoming", override_text="[РљРћРњРђРќР”Рђ] Р’С‹Р±СЂР°С‚СЊ Р‘РРќ", section=None)
            _send_bin_selection_menu(chat.id)
            return
        if stripped_text == FINISH_BUTTON:
            active_dialog = database.get_active_chat_dialog(chat.id)
            database.close_active_chat_dialog(chat.id)
            enable_ai_session(chat.id)
            if active_dialog:
                bot.send_message(
                    chat.id,
                    "РћР±СЂР°С‰РµРЅРёРµ Р·Р°РІРµСЂС€РµРЅРѕ. рџ¤– AI РїРѕРјРѕС‰РЅРёРє СЃРЅРѕРІР° РІРєР»СЋС‡РµРЅ.\n"
                    "Р§С‚РѕР±С‹ РІРѕР·РѕР±РЅРѕРІРёС‚СЊ РґРёР°Р»РѕРі, РІС‹Р±РµСЂРёС‚Рµ РёР»Рё РѕС‚РїСЂР°РІСЊС‚Рµ Р‘РРќ.",
                    reply_markup=_section_keyboard(),
                )
                try:
                    latest_stats = database.get_latest_dialog_stats(int(active_dialog["id"]))
                    latest_appeal_id = (
                        int(latest_stats["appeal_id"])
                        if latest_stats and latest_stats.get("appeal_id") is not None
                        else database.get_latest_closed_appeal_id(int(active_dialog["id"]))
                    )
                    if latest_appeal_id is not None:
                        if latest_stats and bool(latest_stats.get("is_ai_closed")):
                            send_ai_csat_request(chat.id, int(active_dialog["id"]), latest_appeal_id)
                        else:
                            send_csat_request(chat.id, int(active_dialog["id"]), latest_appeal_id)
                except Exception:
                    logger.warning(
                        "Failed to send rating request after FINISH for dialog %s",
                        active_dialog.get("id"),
                        exc_info=True,
                    )
            else:
                bot.send_message(
                    chat.id,
                    "РђРєС‚РёРІРЅС‹С… РґРёР°Р»РѕРіРѕРІ РЅРµ Р±С‹Р»Рѕ. РћС‚РїСЂР°РІСЊС‚Рµ Р‘РРќ РѕСЂРіР°РЅРёР·Р°С†РёРё, С‡С‚РѕР±С‹ РЅР°С‡Р°С‚СЊ СЂР°Р±РѕС‚Сѓ.",
                    reply_markup=_section_keyboard(),
                )
            _persist_message(message, direction="incoming", override_text="[РљРћРњРђРќР”Рђ] Р—Р°РІРµСЂС€РёС‚СЊ СЂР°Р±РѕС‚Сѓ", section=None)
            return
        normalized = text.strip().lower()

        if normalized == AI_ENABLE_BUTTON.lower():
            active_dialog_id = database.get_active_chat_dialog_id(chat.id)
            if active_dialog_id is not None:
                database.set_dialog_operator_mode(active_dialog_id, False)
            enable_ai_session(chat.id)
            bot.send_message(chat.id, "\u2705 AI \u043f\u043e\u043c\u043e\u0449\u043d\u0438\u043a \u0432\u043a\u043b\u044e\u0447\u0435\u043d. \u041c\u043e\u0436\u0435\u0442\u0435 \u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0430\u0442\u044c \u0434\u0438\u0430\u043b\u043e\u0433.")
            _persist_message(message, direction="incoming", section=None)
            return

        elif normalized == OPERATOR_BUTTON.lower() or normalized == "\u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440":
            active_section = database.get_dialog_section(chat.id)
            if not active_section:
                active_section = chat_record.get("section") if chat_record else None
            dialog_id = _register_operator_request(chat.id, section=active_section)
            bot.send_message(chat.id, "\U0001f468\u200d\U0001f4bc \u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0430\u044e \u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440\u0430...")
            _persist_message(
                message,
                direction="incoming",
                override_text=OPERATOR_REQUEST_MARKER,
                section=active_section,
                dialog_id=dialog_id,
            )
            return

    if message.content_type == "text" and survey_service.handle_telegram_survey_text_answer(message):
        return

    normalized_text = (text or "").strip()
    is_text_message = message.content_type == "text"
    is_bin_message = is_text_message and BIN_PATTERN.match(normalized_text)

    # РўСЂРµР±СѓРµРј Р‘РРќ, РµСЃР»Рё РѕРЅ РµС‰С‘ РЅРµ СѓРєР°Р·Р°РЅ
    if chat_record and not chat_record.get("bin") and not is_bin_message:
        bot.send_message(chat.id, "РћС‚РїСЂР°РІСЊС‚Рµ Р‘РРќ РѕСЂРіР°РЅРёР·Р°С†РёРё С‡РёСЃР»РѕРј РёР· 12 С†РёС„СЂ.")
        if is_text_message:
            _persist_message(message, direction="incoming", section=None)
        else:
            _persist_message(
                message,
                direction="incoming",
                override_text=_humanize_message(message),
                section=None,
            )
        return

    if is_bin_message:
        dialog_id, _ = database.set_chat_bin(chat.id, normalized_text)
        enable_ai_session(chat.id)
        contract_result = contract_checker.check_customer_contracts(normalized_text)
        has_contract = contract_result.get("has_contract", False)

        if not has_contract:
            _send_and_store_message(
                chat.id,
                "\u26a0\ufe0f \u0412\u043d\u0438\u043c\u0430\u043d\u0438\u0435: \u0443 \u0432\u0430\u0448\u0435\u0439 \u043e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0446\u0438\u0438 \u043d\u0435\u0442 \u0434\u0435\u0439\u0441\u0442\u0432\u0443\u044e\u0449\u0435\u0433\u043e \u0434\u043e\u0433\u043e\u0432\u043e\u0440\u0430 \u0441 \u043d\u0430\u043c\u0438 \u043d\u0430 2026 \u0433\u043e\u0434.\n\u0412\u044b \u043c\u043e\u0436\u0435\u0442\u0435 \u043e\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u043e\u0431\u0440\u0430\u0449\u0435\u043d\u0438\u0435, \u0438 \u043c\u044b \u0435\u0433\u043e \u043f\u0440\u043e\u0432\u0435\u0440\u0438\u043c.",
                dialog_id=dialog_id,
                author="System",
            )

        _send_and_store_message(
            chat.id,
            "\u0411\u0418\u041d \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d. \u0420\u0430\u0437\u0434\u0435\u043b \u043c\u043e\u0436\u043d\u043e \u0432\u044b\u0431\u0440\u0430\u0442\u044c \u043a\u043d\u043e\u043f\u043a\u0430\u043c\u0438 \u043d\u0438\u0436\u0435, \u043d\u043e \u044d\u0442\u043e \u043d\u0435\u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e ? \u043c\u043e\u0436\u0435\u0442\u0435 \u0441\u0440\u0430\u0437\u0443 \u0437\u0430\u0434\u0430\u0442\u044c \u0432\u043e\u043f\u0440\u043e\u0441.\n\n\U0001f916 AI \u043f\u043e\u043c\u043e\u0449\u043d\u0438\u043a \u0443\u0436\u0435 \u0432\u043a\u043b\u044e\u0447\u0451\u043d.",
            reply_markup=_section_keyboard(),
            dialog_id=dialog_id,
            author="System",
        )
        _persist_message(message, direction="incoming", section=None, dialog_id=dialog_id)
        return


    active_dialog = database.get_active_chat_dialog(chat.id)
    if active_dialog is None:
        resumed = database.resume_last_closed_dialog(chat.id)
        if resumed:
            enable_ai_session(chat.id)
            appeal_num = resumed["appeal_num"]
            resumed_bin = resumed["bin"] or "?"
            bot.send_message(
                chat.id,
                f"рџ“‹ Р”РёР°Р»РѕРі РїРѕ Р‘РРќ {resumed_bin} РІРѕР·РѕР±РЅРѕРІР»С‘РЅ. РќРѕРІРѕРµ РѕР±СЂР°С‰РµРЅРёРµ в„–{appeal_num}.\n"
                "рџ¤– AI РїРѕРјРѕС‰РЅРёРє РІРєР»СЋС‡РµРЅ.",
                reply_markup=_section_keyboard(),
            )
            # Re-fetch chat record with updated BIN
            chat_record = database.get_chat(chat.id)

    # РћР±СЂР°Р±РѕС‚РєР° СЂР°Р·РґРµР»РѕРІ Рё FAQ
    selected_section = None
    if message.content_type == "text":
        normalized = text.strip().lower()
        if normalized in SECTION_TITLES:
            selected_section = SECTION_TITLES[normalized]["id"]
        elif normalized == FAQ_TRIGGER:
            _persist_message(message, direction="incoming", section=None)
            if chat_record and chat_record.get("section"):
                _send_faq_menu(chat.id, chat_record["section"])
            else:
                bot.send_message(chat.id, "РЎРЅР°С‡Р°Р»Р° РІС‹Р±РµСЂРёС‚Рµ СЂР°Р·РґРµР» С‡РµСЂРµР· РєРѕРјР°РЅРґС‹ РёР»Рё РєРЅРѕРїРєРё.", reply_markup=_section_keyboard())
            return
        elif normalized == OPERATOR_TRIGGER:
            active_section = database.get_dialog_section(chat.id)
            if not active_section:
                active_section = chat_record.get("section") if chat_record else None
            dialog_id = _register_operator_request(chat.id, section=active_section)
            _persist_message(
                message,
                direction="incoming",
                override_text=OPERATOR_REQUEST_MARKER,
                section=active_section,
                dialog_id=dialog_id,
            )
            bot.send_message(chat.id, "\U0001f468\u200d\U0001f4bc \u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0430\u044e \u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440\u0430...")
            return

    if selected_section:
        _persist_message(message, direction="incoming", section=selected_section)
        _select_section(chat.id, selected_section)
        return

    # РџРѕР»СѓС‡Р°РµРј СЂР°Р·РґРµР» РёР· Р°РєС‚РёРІРЅРѕРіРѕ РґРёР°Р»РѕРіР° (РїСЂРёРІСЏР·Р°РЅ Рє Р‘РРќСѓ), Р° РЅРµ РёР· С‡Р°С‚Р°
    current_section = database.get_dialog_section(chat.id)
    if not current_section:
        chat_record = database.get_chat(chat.id)
        current_section = chat_record.get("section") if chat_record else None

    _persist_message(
        message,
        direction="incoming",
        override_text=_humanize_message(message),
        section=current_section,
    )

    active_dialog_id = active_dialog["id"] if active_dialog else None
    if not _is_ai_allowed(chat.id, active_dialog_id):
        logger.info("AI disabled for chat %s. Message saved for operator.", chat.id)
        return

    if message.content_type == "text" and ai_manager is not None:
        _generate_ai_response(message, current_section)


def _extract_telegram_attachment_ids(message: telebot.types.Message) -> list[int]:
    if message.content_type not in ("photo", "video"):
        return []
    try:
        if message.content_type == "photo":
            photo = message.photo[-1] if message.photo else None
            if photo is None:
                return []
            file_id = photo.file_id
            original_name = f"telegram_photo_{message.message_id}.jpg"
            claimed_mime = "image/jpeg"
        else:
            video = message.video
            if video is None:
                return []
            file_id = video.file_id
            original_name = video.file_name or f"telegram_video_{message.message_id}.mp4"
            claimed_mime = video.mime_type or "video/mp4"
        file_info = bot.get_file(file_id)
        payload = bot.download_file(file_info.file_path)
        media = media_service.ingest_upload(
            io.BytesIO(payload),
            original_name=original_name,
            claimed_mime_type=claimed_mime,
        )
        return [media.media_id]
    except MediaValidationError as exc:
        logger.warning("Telegram media validation failed for chat %s: %s", message.chat.id, exc.message)
    except Exception as exc:
        logger.exception("Failed to ingest Telegram media for chat %s: %s", message.chat.id, exc)
    return []


def _humanize_message(message: telebot.types.Message) -> str:
    if message.content_type == "text":
        return message.text or ""
    return f"[{message.content_type} СЃРѕРѕР±С‰РµРЅРёРµ]"


def _resolve_dialog_id(chat_id: int, dialog_id: Optional[int] = None) -> Optional[int]:
    if dialog_id is not None:
        return dialog_id
    return database.get_active_chat_dialog_id(chat_id)


def _publish_message_event(
    *,
    chat_id: int,
    dialog_id: Optional[int],
    message_id: int,
    text: str,
    direction: str,
    author: Optional[str],
) -> None:
    try:
        from .api import event_bus

        if not event_bus.loop:
            return
        asyncio.run_coroutine_threadsafe(
            event_bus.publish_all("new_message", {
                "chat_id": chat_id,
                "dialog_id": dialog_id,
                "message_id": message_id,
                "text": text,
                "direction": direction,
                "author": author,
            }),
            event_bus.loop,
        )
    except Exception as e:
        logger.error("Failed to publish SSE event: %s", e)


def _store_outgoing_message(
    message: telebot.types.Message,
    *,
    text: str,
    section: Optional[str] = None,
    author: Optional[str] = "Bot",
    dialog_id: Optional[int] = None,
) -> int:
    chat = message.chat
    resolved_dialog_id = _resolve_dialog_id(chat.id, dialog_id)
    stored_message_id = database.save_message(
        chat_id=chat.id,
        direction="outgoing",
        text=text,
        message_id=message.message_id,
        author=author,
        chat_title=chat.title or chat.username or str(chat.id),
        username=chat.username,
        chat_type=chat.type,
        section=section,
        dialog_id=resolved_dialog_id,
    )
    _publish_message_event(
        chat_id=chat.id,
        dialog_id=resolved_dialog_id,
        message_id=stored_message_id,
        text=text,
        direction="outgoing",
        author=author,
    )
    return stored_message_id


def _send_and_store_message(
    chat_id: int,
    text: str,
    *,
    stored_text: str | None = None,
    section: Optional[str] = None,
    author: Optional[str] = "Bot",
    dialog_id: Optional[int] = None,
    persist: bool = True,
    **kwargs,
) -> telebot.types.Message:
    message = bot.send_message(chat_id, text, **kwargs)
    if persist:
        _store_outgoing_message(
            message,
            text=stored_text if stored_text is not None else text,
            section=section,
            author=author,
            dialog_id=dialog_id,
        )
    return message


def _send_onec_outgoing_message(
    chat_id: int,
    text: str,
    *,
    dialog_id: Optional[int] = None,
    author: Optional[str] = "System",
    section: Optional[str] = None,
    quick_replies: Optional[list[dict]] = None,
) -> int:
    chat = database.get_chat(chat_id) or {}
    chat_title = str(chat.get("title") or f"1C chat {chat_id}")
    external_chat_id = str(chat.get("external_chat_id") or chat_id)
    bin_value = chat.get("bin")
    message_id = database.save_message(
        chat_id=chat_id,
        direction="outgoing",
        text=text,
        message_id=None,
        author=author,
        chat_title=chat_title,
        username=None,
        chat_type="onec",
        section=section,
        dialog_id=dialog_id,
        quick_replies=quick_replies,
    )
    payload = {
        "external_chat_id": external_chat_id,
        "chat_id": chat_id,
        "dialog_id": dialog_id,
        "text": text,
        "author": author,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds") + "Z",
        "bin": bin_value,
        "section": section,
        "direction": "outgoing",
        "attachments": [],
    }
    if quick_replies:
        payload["quick_replies"] = quick_replies
    database.outbox_enqueue_onec(
        message_id=message_id,
        chat_id=chat_id,
        external_chat_id=external_chat_id,
        bin_value=str(bin_value) if bin_value is not None else None,
        payload=payload,
    )
    _publish_message_event(
        chat_id=chat_id,
        dialog_id=dialog_id,
        message_id=message_id,
        text=text,
        direction="outgoing",
        author=author,
    )
    return message_id


def _send_survey_channel_message(
    chat_id: int,
    text: str,
    *,
    dialog_id: Optional[int] = None,
    author: Optional[str] = "System",
    section: Optional[str] = None,
    quick_replies: Optional[list[dict]] = None,
) -> None:
    chat = database.get_chat(chat_id)
    if chat and chat.get("type") == "onec":
        _send_onec_outgoing_message(
            chat_id,
            text,
            dialog_id=dialog_id,
            author=author,
            section=section,
            quick_replies=quick_replies,
        )
        return
    logger.warning(
        "Survey delivery blocked for non-1C chat %s (type=%s)",
        chat_id,
        (chat or {}).get("type"),
    )


def _persist_message(
    message: telebot.types.Message,
    *,
    direction: str,
    override_text: str | None = None,
    section: Optional[str] = None,
    author: Optional[str] = None,
    dialog_id: Optional[int] = None,
) -> None:
    chat = message.chat
    attachment_ids = _extract_telegram_attachment_ids(message)
    if override_text is not None:
        text = override_text
    elif message.content_type in ("photo", "video"):
        text = (message.caption or "").strip()
    else:
        text = _humanize_message(message)
    if not text.strip() and not attachment_ids:
        text = _humanize_message(message) or f"[{message.content_type} СЃРѕРѕР±С‰РµРЅРёРµ]"
    message_author = author
    resolved_dialog_id = _resolve_dialog_id(chat.id, dialog_id)

    if not message_author and message.from_user:
        message_author = message.from_user.username or message.from_user.full_name

    message_id = database.save_message(
        chat_id=chat.id,
        direction=direction,
        text=text,
        message_id=message.message_id,
        author=message_author,
        chat_title=chat.title or chat.username or str(chat.id),
        username=chat.username,
        chat_type=chat.type,
        section=section,
        dialog_id=resolved_dialog_id,
        attachment_ids=attachment_ids,
    )
    logger.info("Stored %s message from chat %s", direction, chat.id)
    _publish_message_event(
        chat_id=chat.id,
        dialog_id=resolved_dialog_id,
        message_id=message_id,
        text=text,
        direction=direction,
        author=message_author,
    )


survey_service.configure_survey_runtime(
    send_channel_message=_send_survey_channel_message,
    persist_telegram_message=_persist_message,
)


def _select_section(chat_id: int, section_id: str) -> None:
    section = SECTION_COMMANDS.get(section_id)
    if not section:
        return
    database.set_chat_section(chat_id, section_id)
    _send_and_store_message(
        chat_id,
        f"Р Р°Р·РґРµР» В«{section['title']}В» РІС‹Р±СЂР°РЅ. РћРїРёС€РёС‚Рµ РІР°С€ РІРѕРїСЂРѕСЃ.",
        reply_markup=_section_keyboard(),
        section=section_id,
        author="System",
    )
    logger.info("Chat %s selected section %s", chat_id, section_id)
    _send_faq_menu(chat_id, section_id)


def _faq_keyboard(section_id: str) -> Optional[types.InlineKeyboardMarkup]:
    entries = FAQ_BY_SECTION.get(section_id) or []
    if not entries:
        return None
    keyboard = types.InlineKeyboardMarkup(row_width=2)
    row: list[types.InlineKeyboardButton] = []
    for index, entry in enumerate(entries):
        row.append(
            types.InlineKeyboardButton(
                _compact_button_text(entry.get("question"), max_len=30),
                callback_data=f"faq:{section_id}:{index}",
            )
        )
        if len(row) == 2:
            keyboard.row(*row)
            row = []
    if row:
        keyboard.row(*row)
    keyboard.row(
        types.InlineKeyboardButton(
            "\U0001f468\u200d\U0001f4bc \u041d\u0443\u0436\u0435\u043d \u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440",
            callback_data=f"operator:{section_id}",
        )
    )
    return keyboard

def _send_faq_menu(chat_id: int, section_id: str) -> None:
    keyboard = _faq_keyboard(section_id)
    if not keyboard:
        return
    section = SECTION_COMMANDS.get(section_id)
    section_title = _sanitize_telegram_text(section.get("title") if section else None, "\u0440\u0430\u0437\u0434\u0435\u043b")
    _send_and_store_message(
        chat_id,
        f"\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0431\u044b\u0441\u0442\u0440\u044b\u0439 \u0432\u043e\u043f\u0440\u043e\u0441 \u043f\u043e \u0440\u0430\u0437\u0434\u0435\u043b\u0443 \u00ab{section_title}\u00bb \u0438\u043b\u0438 \u043d\u0430\u0436\u043c\u0438\u0442\u0435 \u043a\u043d\u043e\u043f\u043a\u0443 \u043d\u0438\u0436\u0435, \u0447\u0442\u043e\u0431\u044b \u043f\u043e\u0437\u0432\u0430\u0442\u044c \u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440\u0430.",
        reply_markup=keyboard,
        section=section_id,
        author="System",
    )

def _send_bin_selection_menu(chat_id: int) -> None:
    # Use client_bins for persistent BIN list (not deleted with dialogs)
    client_bins = database.list_client_bins(chat_id)
    if not client_bins:
        bot.send_message(
            chat_id,
            "РЎРѕС…СЂР°РЅС‘РЅРЅС‹С… Р‘РРќРѕРІ РїРѕРєР° РЅРµС‚. Р”РѕР±Р°РІСЊС‚Рµ РЅРѕРІС‹Р№ Р‘РРќ С‡РµСЂРµР· РєРЅРѕРїРєСѓ"
            " РёР»Рё РїСЂРѕСЃС‚Рѕ РѕС‚РїСЂР°РІСЊС‚Рµ Р‘РРќ С‡РёСЃР»РѕРј РёР· 12 С†РёС„СЂ.",
        )
        return
    keyboard = types.InlineKeyboardMarkup()
    # Check which BIN has active dialog
    active_dialog = database.get_active_chat_dialog(chat_id)
    active_bin = active_dialog["bin"] if active_dialog else None
    for bin_value in client_bins:
        label = bin_value
        if bin_value == active_bin:
            label = f"{label} вЂў С‚РµРєСѓС‰РёР№"
        keyboard.add(
            types.InlineKeyboardButton(
                label,
                callback_data=f"{SWITCH_BIN_CALLBACK}:{bin_value}",
            )
        )
    bot.send_message(
        chat_id,
        "Р’С‹Р±РµСЂРёС‚Рµ Р‘РРќ, С‡С‚РѕР±С‹ РїСЂРѕРґРѕР»Р¶РёС‚СЊ СЂР°Р±РѕС‚Сѓ СЃ СЃРѕРѕС‚РІРµС‚СЃС‚РІСѓСЋС‰РёРј РґРёР°Р»РѕРіРѕРј.",
        reply_markup=keyboard,
    )


def _try_auto_answer(message: telebot.types.Message, section_id: str) -> None:
    entry = database.find_faq_entry_by_keywords(message.text or "", section_id)
    if not entry:
        return

    answer_text = entry.get("answer", "")
    if not answer_text:
        return

    _send_and_store_message(
        message.chat.id,
        _sanitize_telegram_text(answer_text, "\u041e\u0442\u0432\u0435\u0442 \u043f\u043e\u043a\u0430 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d."),
        section=entry.get("section") or section_id,
        author="AutoBot",
    )


@bot.callback_query_handler(func=lambda call: call.data.startswith("faq:"))
def handle_faq_callback(call: telebot.types.CallbackQuery) -> None:
    _, section_id, index_str = call.data.split(":", 2)
    entries = FAQ_BY_SECTION.get(section_id) or []
    try:
        entry = entries[int(index_str)]
    except (ValueError, IndexError):
        bot.answer_callback_query(call.id, "РќРµ СѓРґР°Р»РѕСЃСЊ РЅР°Р№С‚Рё РѕС‚РІРµС‚")
        return
    chat = call.message.chat
    bot.answer_callback_query(call.id, "РћС‚РІРµС‚ РѕС‚РїСЂР°РІР»РµРЅ")
    database.set_chat_section(chat.id, section_id)
    author = None
    if call.from_user:
        author = call.from_user.username or call.from_user.full_name
    database.save_message(
        chat_id=chat.id,
        direction="incoming",
        text=f"[FAQ] {_sanitize_telegram_text(entry.get('question'), 'FAQ')}",
        message_id=None,
        author=author,
        chat_title=chat.title or chat.username or str(chat.id),
        username=chat.username,
        chat_type=chat.type,
        section=section_id,
    )
    _send_and_store_message(
        chat.id,
        _sanitize_telegram_text(entry.get("answer"), "\u041e\u0442\u0432\u0435\u0442 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d."),
        section=section_id,
        author="AutoBot",
    )


@bot.callback_query_handler(func=lambda call: call.data.startswith("operator:"))
def handle_operator_callback(call: telebot.types.CallbackQuery) -> None:
    _, section_id = call.data.split(":", 1)
    chat = call.message.chat
    database.set_chat_section(chat.id, section_id)
    dialog_id = _register_operator_request(chat.id, section=section_id)
    bot.answer_callback_query(call.id, "\u0417\u0430\u043f\u0440\u043e\u0441 \u043f\u0435\u0440\u0435\u0434\u0430\u043d \u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440\u0443")

    author = None
    if call.from_user:
        author = call.from_user.username or call.from_user.full_name
    database.save_message(
        chat_id=chat.id,
        direction="incoming",
        text="[FAQ] \u0421\u0432\u044f\u0437\u0430\u0442\u044c\u0441\u044f \u0441 \u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440\u043e\u043c",
        message_id=None,
        author=author,
        chat_title=chat.title or chat.username or str(chat.id),
        username=chat.username,
        chat_type=chat.type,
        section=section_id,
        dialog_id=dialog_id,
    )
    _send_and_store_message(chat.id, "\u0417\u0430\u043f\u0440\u043e\u0441 \u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440\u0443 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d...", section=section_id, dialog_id=dialog_id, author="System")

@bot.callback_query_handler(func=lambda call: call.data.startswith(f"{SWITCH_BIN_CALLBACK}:"))
def handle_switch_bin_callback(call: telebot.types.CallbackQuery) -> None:
    try:
        _, bin_value = call.data.split(":", 1)
        bin_value = bin_value.strip()
    except (ValueError, IndexError):
        bot.answer_callback_query(call.id, "РќРµ СѓРґР°Р»РѕСЃСЊ РѕРїСЂРµРґРµР»РёС‚СЊ Р‘РРќ")
        return
    if not bin_value:
        bot.answer_callback_query(call.id, "Р‘РРќ РЅРµ СѓРєР°Р·Р°РЅ")
        return
    chat = call.message.chat
    dialog_id, is_resumed = database.set_chat_bin(chat.id, bin_value)
    if dialog_id is None:
        bot.answer_callback_query(call.id, "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ РґРёР°Р»РѕРі")
        return
    enable_ai_session(chat.id)
    if is_resumed:
        appeal_num = database.count_appeals(dialog_id)
        bot.answer_callback_query(call.id, "Р‘РРќ РїРµСЂРµРєР»СЋС‡РµРЅ")
        _send_and_store_message(
            chat.id,
            f"рџ“‹ Р’РѕР·РѕР±РЅРѕРІР»С‘РЅ РґРёР°Р»РѕРі РїРѕ Р‘РРќ {bin_value}. РќРѕРІРѕРµ РѕР±СЂР°С‰РµРЅРёРµ в„–{appeal_num}. AI РїРѕРјРѕС‰РЅРёРє РІРєР»СЋС‡РµРЅ.",
            reply_markup=_section_keyboard(),
            dialog_id=dialog_id,
            author="System",
        )
    else:
        bot.answer_callback_query(call.id, "Р‘РРќ РїРµСЂРµРєР»СЋС‡РµРЅ")
        _send_and_store_message(
            chat.id,
            f"РђРєС‚РёРІРёСЂРѕРІР°РЅ РґРёР°Р»РѕРі РїРѕ Р‘РРќ {bin_value}. AI РїРѕРјРѕС‰РЅРёРє РІРєР»СЋС‡РµРЅ.",
            reply_markup=_section_keyboard(),
            dialog_id=dialog_id,
            author="System",
        )


# -----------------------------------------------------------
# CSAT / Customer Satisfaction Rating
# -----------------------------------------------------------

CSAT_PREFIX = "csat_"
AI_CSAT_PREFIX = "ai_csat_"


def _send_rating_request(
    chat_id: int,
    dialog_id: int,
    *,
    appeal_id: int | None,
    prefix: str,
    prompt: str,
) -> None:
    """Send rating request (1-5) with callback payload bound to dialog/appeal."""
    markup = types.InlineKeyboardMarkup(row_width=5)
    callback_prefix = f"{prefix}{dialog_id}_"
    if appeal_id is not None:
        callback_prefix = f"{prefix}{dialog_id}_{appeal_id}_"
    buttons = [
        types.InlineKeyboardButton(
            text=f"{'в­ђ' * i}",
            callback_data=f"{callback_prefix}{i}",
        )
        for i in range(1, 6)
    ]
    markup.add(*buttons)
    _send_and_store_message(chat_id, prompt, reply_markup=markup, dialog_id=dialog_id, author="System")



def _send_operator_rating_request(
    chat_id: int,
    dialog_id: int,
    *,
    operator_stat_id: int,
    operator_name: str,
) -> None:
    """Send one CSAT request for a concrete employee."""
    markup = types.InlineKeyboardMarkup(row_width=5)
    buttons = [
        types.InlineKeyboardButton(
            text=f"{chr(0x2B50) * i}",
            callback_data=build_operator_csat_callback(
                operator_stat_id=operator_stat_id,
                rating=i,
            ),
        )
        for i in range(1, 6)
    ]
    markup.add(*buttons)
    _send_and_store_message(
        chat_id,
        f"\U0001f4ca \u041f\u043e\u0436\u0430\u043b\u0443\u0439\u0441\u0442\u0430, \u043e\u0446\u0435\u043d\u0438\u0442\u0435 \u0440\u0430\u0431\u043e\u0442\u0443 \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0430 {operator_name}:",
        reply_markup=markup,
        dialog_id=dialog_id,
        author="System",
    )

def send_csat_request(chat_id: int, dialog_id: int, appeal_id: int | None = None) -> None:
    """Send operator CSAT request."""
    operator_targets = database.list_operator_rating_targets(dialog_id, appeal_id)
    if operator_targets:
        for target in operator_targets:
            _send_operator_rating_request(
                chat_id,
                dialog_id,
                operator_stat_id=int(target["id"]),
                operator_name=str(target["operator_name"]),
            )
        return

    _send_rating_request(
        chat_id,
        dialog_id,
        appeal_id=appeal_id,
        prefix=CSAT_PREFIX,
        prompt="\U0001f4ca \u041f\u043e\u0436\u0430\u043b\u0443\u0439\u0441\u0442\u0430, \u043e\u0446\u0435\u043d\u0438\u0442\u0435 \u043a\u0430\u0447\u0435\u0441\u0442\u0432\u043e \u043e\u0431\u0441\u043b\u0443\u0436\u0438\u0432\u0430\u043d\u0438\u044f:",
    )


def send_ai_csat_request(chat_id: int, dialog_id: int, appeal_id: int | None = None) -> None:
    """Send AI CSAT request for AI-resolved appeals."""
    _send_rating_request(
        chat_id,
        dialog_id,
        appeal_id=appeal_id,
        prefix=AI_CSAT_PREFIX,
        prompt="рџ¤– РџРѕР¶Р°Р»СѓР№СЃС‚Р°, РѕС†РµРЅРёС‚Рµ РєР°С‡РµСЃС‚РІРѕ РѕС‚РІРµС‚Р° AI:",
    )



def _finalize_rating_message(call: types.CallbackQuery, text: str) -> None:
    """Best-effort UI update after rating click."""
    message = getattr(call, "message", None)
    chat = getattr(message, "chat", None)
    chat_id = getattr(chat, "id", None)
    message_id = getattr(message, "message_id", None)
    if chat_id is None or message_id is None:
        return

    try:
        bot.edit_message_text(
            text,
            chat_id=chat_id,
            message_id=message_id,
            reply_markup=None,
        )
        return
    except Exception:
        logger.warning("Failed to edit rating message for callback %s", call.data, exc_info=True)

    try:
        bot.edit_message_reply_markup(
            chat_id=chat_id,
            message_id=message_id,
            reply_markup=None,
        )
    except Exception:
        logger.warning("Failed to clear rating keyboard for callback %s", call.data, exc_info=True)

    try:
        bot.send_message(chat_id, text)
    except Exception:
        logger.warning("Failed to send rating confirmation for callback %s", call.data, exc_info=True)

@bot.callback_query_handler(func=lambda call: call.data and call.data.startswith(OPERATOR_CSAT_PREFIX))
def operator_csat_callback_handler(call: types.CallbackQuery) -> None:
    """Handle employee-specific CSAT callback from inline buttons."""
    logger.info(
        "Operator CSAT callback received: data=%s chat_id=%s message_id=%s",
        getattr(call, "data", None),
        getattr(getattr(getattr(call, "message", None), "chat", None), "id", None),
        getattr(getattr(call, "message", None), "message_id", None),
    )
    try:
        parsed = parse_operator_csat_callback(getattr(call, "data", None))
        if parsed is None:
            bot.answer_callback_query(call.id, "\u041e\u0448\u0438\u0431\u043a\u0430 \u0434\u0430\u043d\u043d\u044b\u0445")
            return

        existing = database.get_operator_csat_for_target(parsed.operator_stat_id)
        if existing is not None:
            bot.answer_callback_query(call.id, f"\u0412\u044b \u0443\u0436\u0435 \u043e\u0446\u0435\u043d\u0438\u043b\u0438 \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0430: {chr(0x2B50) * existing}")
            return

        target = database.get_operator_rating_target(parsed.operator_stat_id)
        operator_name = str(target["operator_name"]) if target else "\u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0430"
        saved = database.save_operator_csat_rating(
            parsed.operator_stat_id,
            parsed.rating,
            rater_chat_id=getattr(getattr(getattr(call, "message", None), "chat", None), "id", None),
            channel=database.RATING_CHANNEL_TELEGRAM_BOT,
        )
        if not saved:
            bot.answer_callback_query(call.id, "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c \u043e\u0446\u0435\u043d\u043a\u0443")
            return

        bot.answer_callback_query(call.id, f"\u0421\u043f\u0430\u0441\u0438\u0431\u043e \u0437\u0430 \u043e\u0446\u0435\u043d\u043a\u0443! {chr(0x2B50) * parsed.rating}")
        _finalize_rating_message(
            call,
            f"\U0001f4ca \u0421\u043f\u0430\u0441\u0438\u0431\u043e \u0437\u0430 \u043e\u0446\u0435\u043d\u043a\u0443 \u0441\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a\u0430 {operator_name}: {chr(0x2B50) * parsed.rating}\n\u041c\u044b \u0446\u0435\u043d\u0438\u043c \u0432\u0430\u0448 \u043e\u0442\u0437\u044b\u0432!",
        )
        if target:
            survey_service.maybe_start_survey_after_employee_csat(
                int(target["dialog_id"]),
                int(target["appeal_id"]) if target.get("appeal_id") is not None else None,
            )
    except Exception:
        logger.error("Operator CSAT callback error", exc_info=True)
        bot.answer_callback_query(call.id, "\u041f\u0440\u043e\u0438\u0437\u043e\u0448\u043b\u0430 \u043e\u0448\u0438\u0431\u043a\u0430")

@bot.callback_query_handler(func=lambda call: call.data and call.data.startswith(CSAT_PREFIX))
def csat_callback_handler(call: types.CallbackQuery) -> None:
    """Handle CSAT rating callback from inline buttons."""
    logger.info("CSAT callback received: data=%s chat_id=%s message_id=%s", getattr(call, "data", None), getattr(getattr(getattr(call, "message", None), "chat", None), "id", None), getattr(getattr(call, "message", None), "message_id", None))
    try:
        # Parse callback_data:
        # - csat_{dialog_id}_{rating} (legacy)
        # - csat_{dialog_id}_{appeal_id}_{rating} (current)
        parts = call.data[len(CSAT_PREFIX):].split("_")
        if len(parts) not in (2, 3):
            bot.answer_callback_query(call.id, "РћС€РёР±РєР° РґР°РЅРЅС‹С…")
            return

        dialog_id = int(parts[0])
        appeal_id: int | None = None
        if len(parts) == 3:
            appeal_id = int(parts[1])
            rating = int(parts[2])
        else:
            rating = int(parts[1])

        if rating < 1 or rating > 5:
            bot.answer_callback_query(call.id, "РќРµРєРѕСЂСЂРµРєС‚РЅР°СЏ РѕС†РµРЅРєР°")
            return

        # Check if already rated
        if appeal_id is not None:
            existing = database.get_csat_for_appeal(appeal_id)
        else:
            existing = database.get_csat_for_dialog(dialog_id)
        if existing is not None:
            bot.answer_callback_query(call.id, f"Р’С‹ СѓР¶Рµ РѕС†РµРЅРёР»Рё: {'в­ђ' * existing}")
            return

        # Save the rating
        saved = database.save_csat_rating(
            dialog_id,
            rating,
            appeal_id=appeal_id,
            rater_chat_id=getattr(getattr(getattr(call, "message", None), "chat", None), "id", None),
            channel=database.RATING_CHANNEL_TELEGRAM_BOT,
        )
        if not saved:
            bot.answer_callback_query(call.id, "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ РѕС†РµРЅРєСѓ")
            return

        # Acknowledge and update the message
        bot.answer_callback_query(call.id, f"\u0421\u043f\u0430\u0441\u0438\u0431\u043e \u0437\u0430 \u043e\u0446\u0435\u043d\u043a\u0443! {chr(0x2B50) * rating}")
        _finalize_rating_message(
            call,
            f"\U0001f4ca \u0421\u043f\u0430\u0441\u0438\u0431\u043e \u0437\u0430 \u0432\u0430\u0448\u0443 \u043e\u0446\u0435\u043d\u043a\u0443: {chr(0x2B50) * rating}\n\u041c\u044b \u0446\u0435\u043d\u0438\u043c \u0432\u0430\u0448 \u043e\u0442\u0437\u044b\u0432!",
        )
        survey_service.maybe_start_survey_after_employee_csat(dialog_id, appeal_id)

    except (ValueError, IndexError):
        logger.warning("Invalid CSAT callback data: %s", call.data, exc_info=True)
        bot.answer_callback_query(call.id, "РћС€РёР±РєР° РѕР±СЂР°Р±РѕС‚РєРё")
    except Exception:
        logger.error("CSAT callback error", exc_info=True)
        bot.answer_callback_query(call.id, "РџСЂРѕРёР·РѕС€Р»Р° РѕС€РёР±РєР°")


@bot.callback_query_handler(func=lambda call: call.data and call.data.startswith(AI_CSAT_PREFIX))
def ai_csat_callback_handler(call: types.CallbackQuery) -> None:
    """Handle AI CSAT callback from inline buttons."""
    logger.info("AI CSAT callback received: data=%s chat_id=%s message_id=%s", getattr(call, "data", None), getattr(getattr(getattr(call, "message", None), "chat", None), "id", None), getattr(getattr(call, "message", None), "message_id", None))
    try:
        # Parse callback_data:
        # - ai_csat_{dialog_id}_{rating} (legacy)
        # - ai_csat_{dialog_id}_{appeal_id}_{rating} (current)
        parts = call.data[len(AI_CSAT_PREFIX):].split("_")
        if len(parts) not in (2, 3):
            bot.answer_callback_query(call.id, "РћС€РёР±РєР° РґР°РЅРЅС‹С…")
            return

        dialog_id = int(parts[0])
        appeal_id: int | None = None
        if len(parts) == 3:
            appeal_id = int(parts[1])
            rating = int(parts[2])
        else:
            rating = int(parts[1])

        if rating < 1 or rating > 5:
            bot.answer_callback_query(call.id, "РќРµРєРѕСЂСЂРµРєС‚РЅР°СЏ РѕС†РµРЅРєР°")
            return

        if appeal_id is not None:
            existing = database.get_ai_csat_for_appeal(appeal_id)
        else:
            existing = database.get_ai_csat_for_dialog(dialog_id)
        if existing is not None:
            bot.answer_callback_query(call.id, f"Р’С‹ СѓР¶Рµ РѕС†РµРЅРёР»Рё AI: {'в­ђ' * existing}")
            return

        saved = database.save_ai_csat_rating(
            dialog_id,
            rating,
            appeal_id=appeal_id,
            rater_chat_id=getattr(getattr(getattr(call, "message", None), "chat", None), "id", None),
            channel=database.RATING_CHANNEL_TELEGRAM_BOT,
        )
        if not saved:
            bot.answer_callback_query(call.id, "РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ РѕС†РµРЅРєСѓ AI")
            return

        bot.answer_callback_query(call.id, f"\u0421\u043f\u0430\u0441\u0438\u0431\u043e \u0437\u0430 \u043e\u0446\u0435\u043d\u043a\u0443 AI! {chr(0x2B50) * rating}")
        _finalize_rating_message(
            call,
            f"\U0001f916 \u0421\u043f\u0430\u0441\u0438\u0431\u043e \u0437\u0430 \u043e\u0446\u0435\u043d\u043a\u0443 AI: {chr(0x2B50) * rating}\n\u041c\u044b \u0443\u043b\u0443\u0447\u0448\u0430\u0435\u043c \u043e\u0442\u0432\u0435\u0442\u044b \u043d\u0430 \u043e\u0441\u043d\u043e\u0432\u0435 \u0432\u0430\u0448\u0435\u0439 \u043e\u0431\u0440\u0430\u0442\u043d\u043e\u0439 \u0441\u0432\u044f\u0437\u0438.",
        )
    except (ValueError, IndexError):
        logger.warning("Invalid AI CSAT callback data: %s", call.data, exc_info=True)
        bot.answer_callback_query(call.id, "РћС€РёР±РєР° РѕР±СЂР°Р±РѕС‚РєРё")
    except Exception:
        logger.error("AI CSAT callback error", exc_info=True)
        bot.answer_callback_query(call.id, "РџСЂРѕРёР·РѕС€Р»Р° РѕС€РёР±РєР°")


try:
    bot.set_my_commands(
        [
            types.BotCommand("start", "РќР°С‡Р°С‚СЊ СЂР°Р±РѕС‚Сѓ"),
            types.BotCommand("faq", "Р§Р°СЃС‚С‹Рµ РІРѕРїСЂРѕСЃС‹"),
            types.BotCommand("ai", "Р’РєР»СЋС‡РёС‚СЊ AI РїРѕРјРѕС‰РЅРёРєР°"),
            types.BotCommand("operator", "РЎРІСЏР·Р°С‚СЊСЃСЏ СЃ РѕРїРµСЂР°С‚РѕСЂРѕРј"),
            *[
                types.BotCommand(section_id, _sanitize_telegram_text(section["title"], section_id))
                for section_id, section in SECTION_COMMANDS.items()
            ],
        ]
    )
except Exception:
    logger.warning("Failed to register Telegram bot commands during startup")






@bot.callback_query_handler(func=lambda call: True)
def unhandled_callback_query_handler(call: types.CallbackQuery) -> None:
    """Log any callback that did not match a dedicated handler."""
    logger.warning(
        "Unhandled callback query: data=%r chat_id=%s message_id=%s",
        getattr(call, "data", None),
        getattr(getattr(getattr(call, "message", None), "chat", None), "id", None),
        getattr(getattr(call, "message", None), "message_id", None),
    )
    try:
        bot.answer_callback_query(call.id, "\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043f\u043e\u043a\u0430 \u043d\u0435 \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044f")
    except Exception:
        logger.warning("Failed to answer unhandled callback query: %r", getattr(call, "data", None), exc_info=True)



