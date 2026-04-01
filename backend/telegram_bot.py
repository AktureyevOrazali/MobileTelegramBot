"""Telegram bot that writes incoming messages into the database."""
from __future__ import annotations

import io
import logging
import os
import re
from typing import Optional

import telebot
from telebot import types

from . import database
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
FAQ_TRIGGER = "частые вопросы"
OPERATOR_TRIGGER = "связаться с оператором"
MOJIBAKE_HINT_RE = re.compile("(?:\u0420.|\u0421.|\u00d0.|\u00d1.){2,}")
BIN_PATTERN = re.compile(r"^\d{12}$")
START_BUTTON = "▶️ Старт"
NEW_BIN_BUTTON = "➕ Добавить БИН"
SELECT_BIN_BUTTON = "📂 Выбрать БИН"
FINISH_BUTTON = "⏹ Завершить"
FAQ_BUTTON = "Частые вопросы"
OPERATOR_BUTTON = "👨‍💼 Оператор"
SWITCH_BIN_CALLBACK = "switch_bin"
SECTION_ICONS = {
    "general": "💬",
    "finance": "💰",
    "support": "🛠",
    "hr": "👥",
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
    title = _sanitize_telegram_text(section.get("title"), "Раздел")
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

def _generate_ai_response(message: telebot.types.Message, section: str) -> None:
    """Generate and send AI response with typing indicator."""
    chat_id = message.chat.id
    ai_session = get_ai_session(chat_id)

    if not ai_session['ai_enabled'] or ai_session['operator_requested']:
        return

    try:
        bot.send_chat_action(chat_id, 'typing')
        waiting_msg = bot.send_message(chat_id, "🤖 Подождите, AI думает...")
        ai_session['waiting_message_id'] = waiting_msg.message_id

        chat_history = database.get_messages(chat_id, limit=6)

        if not ai_session['ai_enabled'] or ai_session['operator_requested']:
            try:
                bot.delete_message(chat_id, waiting_msg.message_id)
            except Exception:
                pass
            ai_session['waiting_message_id'] = None
            return

        ai_response = ai_manager.generate_response(message.text, chat_history)

        if not ai_session['ai_enabled'] or ai_session['operator_requested']:
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
            f"🤖 {ai_response}",
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
            "❌ Временная ошибка AI помощника. При необходимости напишите 'оператор'",
            section=section,
            author="System",
        )

# Р”РѕР±Р°РІР»СЏРµРј РѕР±СЂР°Р±РѕС‚С‡РёРєРё РєРѕРјР°РЅРґ AI
@bot.message_handler(commands=['ai_on', 'ai_off', 'operator', 'ai'])
def handle_ai_commands(message: telebot.types.Message) -> None:
    """Handle AI control commands."""
    chat_id = message.chat.id
    session = get_ai_session(chat_id)
    command = message.text.split('@')[0].lower()
    
    if command == '/ai_on' or command == '/ai':
        session['ai_enabled'] = True
        session['operator_requested'] = False
        bot.send_message(
            chat_id, 
            "✅ AI помощник включен. Задавайте вопросы по бухгалтерии и налогам РК!\n\n"
            "Чтобы отключить AI напишите /ai_off или 'оператор'"
        )
        logger.info("AI РІРєР»СЋС‡РµРЅ РґР»СЏ С‡Р°С‚Р° %s", chat_id)
        
    elif command == '/ai_off':
        session['ai_enabled'] = False
        bot.send_message(
            chat_id,
            "❌ AI помощник выключен. Ваши сообщения будут направлены оператору.\n\n"
            "Чтобы включить AI напишите /ai_on"
        )
        logger.info("AI РІС‹РєР»СЋС‡РµРЅ РґР»СЏ С‡Р°С‚Р° %s", chat_id)
        
    elif command == '/operator':
        # Р’РљР›Р®Р§РђР•Рњ Р Р•Р–РРњ РћРџР•Р РђРўРћР Рђ Р РћРўРљР›Р®Р§РђР•Рњ AI
        session['operator_requested'] = True
        session['ai_enabled'] = False  # РђР’РўРћРњРђРўРР§Р•РЎРљРћР• РћРўРљР›Р®Р§Р•РќРР•
        
        # РЈР”РђР›РЇР•Рњ РЎРћРћР‘Р©Р•РќРР• "РџРћР”РћР–Р”РРўР•" Р•РЎР›Р РћРќРћ Р•РЎРўР¬
        if session['waiting_message_id']:
            try:
                bot.delete_message(chat_id, session['waiting_message_id'])
            except:
                pass
            session['waiting_message_id'] = None
        
        bot.send_message(
            chat_id,
            "👨‍💼 Подключаю оператора... AI помощник отключен.\n"
            "Оператор ответит в ближайшее время."
        )
        logger.info("Р—Р°РїСЂРѕС€РµРЅ РѕРїРµСЂР°С‚РѕСЂ РґР»СЏ С‡Р°С‚Р° %s, AI РѕС‚РєР»СЋС‡РµРЅ", chat_id)
        
        # РЎРѕС…СЂР°РЅСЏРµРј Р·Р°РїСЂРѕСЃ РѕРїРµСЂР°С‚РѕСЂР° РІ РёСЃС‚РѕСЂРёСЋ
        _persist_message(
            message,
            direction="incoming",
            override_text="[ЗАПРОС ОПЕРАТОРА]",
            section=None
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
        "Здравствуйте! Я помогу связаться с оператором.",
    )
    bot.send_message(
        chat.id,
        "🤖 AI помощник автоматически включен и готов отвечать на вопросы по бухгалтерии и налогам РК!\n\n"
        "Команды:\n"
        "/ai_on - включить AI помощника\n"
        "/ai_off - выключить AI помощника\n"
        "/operator - связаться с оператором\n\n"
        "Для начала укажите БИН вашей организации (12 цифр).",
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
        bot.send_message(chat.id, "Сначала укажите БИН организации.")
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
        bot.send_message(chat.id, "Сначала выберите раздел, чтобы показать FAQ.")
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
    ai_session = get_ai_session(chat.id)

    # РћР±СЂР°Р±Р°С‚С‹РІР°РµРј С‚РµРєСЃС‚РѕРІС‹Рµ РєРѕРјР°РЅРґС‹ СѓРїСЂР°РІР»РµРЅРёСЏ AI
    if message.content_type == "text":
        stripped_text = text.strip()
        if stripped_text == START_BUTTON:
            _persist_message(message, direction="incoming", override_text="[КОМАНДА] Старт", section=None)
            handle_start(message)
            return
        if stripped_text == NEW_BIN_BUTTON:
            ai_session['ai_enabled'] = True
            ai_session['operator_requested'] = False
            bot.send_message(chat.id, "Отправьте БИН организации числом из 12 цифр, чтобы начать новый диалог.")
            _persist_message(message, direction="incoming", override_text="[КОМАНДА] Добавить БИН", section=None)
            return
        if stripped_text == SELECT_BIN_BUTTON:
            _persist_message(message, direction="incoming", override_text="[КОМАНДА] Выбрать БИН", section=None)
            _send_bin_selection_menu(chat.id)
            return
        if stripped_text == FINISH_BUTTON:
            active_dialog = database.get_active_chat_dialog(chat.id)
            database.close_active_chat_dialog(chat.id)
            ai_session['ai_enabled'] = True
            ai_session['operator_requested'] = False
            if active_dialog:
                bot.send_message(
                    chat.id,
                    "Обращение завершено. 🤖 AI помощник снова включен.\n"
                    "Чтобы возобновить диалог, выберите или отправьте БИН.",
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
                    "Активных диалогов не было. Отправьте БИН организации, чтобы начать работу.",
                    reply_markup=_section_keyboard(),
                )
            _persist_message(message, direction="incoming", override_text="[КОМАНДА] Завершить работу", section=None)
            return
        normalized = text.strip().lower()
        
        # РљРЅРѕРїРєРё СѓРїСЂР°РІР»РµРЅРёСЏ AI
        if normalized == "🤖 включить ai":
            ai_session['ai_enabled'] = True
            ai_session['operator_requested'] = False
            bot.send_message(chat.id, "✅ AI помощник включен!")
            _persist_message(message, direction="incoming", section=None)
            return
            
        elif normalized == "👨‍💼 оператор" or normalized == "оператор":
            # РђР’РўРћРњРђРўРР§Р•РЎРљРћР• РћРўРљР›Р®Р§Р•РќРР• AI РџР Р Р—РђРџР РћРЎР• РћРџР•Р РђРўРћР Рђ
            ai_session['operator_requested'] = True
            ai_session['ai_enabled'] = False
            
            # РЈР”РђР›РЇР•Рњ РЎРћРћР‘Р©Р•РќРР• "РџРћР”РћР–Р”РРўР•" Р•РЎР›Р РћРќРћ Р•РЎРўР¬
            if ai_session['waiting_message_id']:
                try:
                    bot.delete_message(chat.id, ai_session['waiting_message_id'])
                except:
                    pass
                ai_session['waiting_message_id'] = None
            
            bot.send_message(chat.id, "👨‍💼 Подключаю оператора...")
            _persist_message(message, direction="incoming", override_text="[ЗАПРОС ОПЕРАТОРА]", section=None)
            return

    normalized_text = (text or "").strip()
    is_text_message = message.content_type == "text"
    is_bin_message = is_text_message and BIN_PATTERN.match(normalized_text)

    # РўСЂРµР±СѓРµРј Р‘РРќ, РµСЃР»Рё РѕРЅ РµС‰С‘ РЅРµ СѓРєР°Р·Р°РЅ
    if chat_record and not chat_record.get("bin") and not is_bin_message:
        bot.send_message(chat.id, "Отправьте БИН организации числом из 12 цифр.")
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
        contract_result = contract_checker.check_customer_contracts(normalized_text)
        has_contract = contract_result.get("has_contract", False)

        if not has_contract:
            _send_and_store_message(
                chat.id,
                "⚠️ Внимание: у вашей организации нет действующего договора с нами на 2026 год.\nВы можете оставить обращение, и мы его проверим.",
                dialog_id=dialog_id,
                author="System",
            )

        _send_and_store_message(
            chat.id,
            "Теперь выберите подходящий раздел.\n\n🤖 AI помощник автоматически включен и будет отвечать по теме раздела!",
            reply_markup=_section_keyboard(),
            dialog_id=dialog_id,
            author="System",
        )
        _persist_message(message, direction="incoming", section=None, dialog_id=dialog_id)
        return


    # в”Ђв”Ђ Auto-resume: РµСЃР»Рё РЅРµС‚ Р°РєС‚РёРІРЅРѕРіРѕ РґРёР°Р»РѕРіР°, РЅРѕ РµСЃС‚СЊ Р·Р°РєСЂС‹С‚С‹Р№ вЂ” РІРѕР·РѕР±РЅРѕРІР»СЏРµРј в”Ђв”Ђ
    active_dialog = database.get_active_chat_dialog(chat.id)
    if active_dialog is None:
        resumed = database.resume_last_closed_dialog(chat.id)
        if resumed:
            ai_session['ai_enabled'] = True
            ai_session['operator_requested'] = False
            appeal_num = resumed["appeal_num"]
            resumed_bin = resumed["bin"] or "?"
            bot.send_message(
                chat.id,
                f"📋 Диалог по БИН {resumed_bin} возобновлён. Новое обращение №{appeal_num}.\n"
                "🤖 AI помощник включен.",
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
                bot.send_message(chat.id, "Сначала выберите раздел через команды или кнопки.", reply_markup=_section_keyboard())
            return
        elif normalized == OPERATOR_TRIGGER:
            # РђР’РўРћРњРђРўРР§Р•РЎРљРћР• РћРўРљР›Р®Р§Р•РќРР• AI РџР Р Р—РђРџР РћРЎР• РћРџР•Р РђРўРћР Рђ
            ai_session['operator_requested'] = True
            ai_session['ai_enabled'] = False
            
            # РЈР”РђР›РЇР•Рњ РЎРћРћР‘Р©Р•РќРР• "РџРћР”РћР–Р”РРўР•" Р•РЎР›Р РћРќРћ Р•РЎРўР¬
            if ai_session['waiting_message_id']:
                try:
                    bot.delete_message(chat.id, ai_session['waiting_message_id'])
                except:
                    pass
                ai_session['waiting_message_id'] = None
                
            _persist_message(message, direction="incoming", section=chat_record.get("section") if chat_record else None)
            bot.send_message(chat.id, "👨‍💼 Подключаю оператора...")
            return
            
    if selected_section:
        _persist_message(message, direction="incoming", section=selected_section)
        _select_section(chat.id, selected_section)
        return

    # РџРѕР»СѓС‡Р°РµРј СЂР°Р·РґРµР» РёР· Р°РєС‚РёРІРЅРѕРіРѕ РґРёР°Р»РѕРіР° (РїСЂРёРІСЏР·Р°РЅ Рє Р‘РРќСѓ), Р° РЅРµ РёР· С‡Р°С‚Р°
    current_section = database.get_dialog_section(chat.id)
    # Р•СЃР»Рё section РїСѓСЃС‚РѕР№ РІ РґРёР°Р»РѕРіРµ - Р±РµСЂС‘Рј РёР· С‡Р°С‚Р° РґР»СЏ РѕР±СЂР°С‚РЅРѕР№ СЃРѕРІРјРµСЃС‚РёРјРѕСЃС‚Рё
    if not current_section:
        chat_record = database.get_chat(chat.id)
        current_section = chat_record.get("section") if chat_record else None
    
    if not current_section:
        bot.send_message(
            chat.id,
            "Пожалуйста, выберите раздел через команды бота или кнопки ниже.",
            reply_markup=_section_keyboard(),
        )
        _persist_message(message, direction="incoming", override_text=_humanize_message(message), section=None)
        return

    # РЎРћРҐР РђРќРЇР•Рњ СЃРѕРѕР±С‰РµРЅРёРµ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ РІ Р»СЋР±РѕРј СЃР»СѓС‡Р°Рµ
    _persist_message(
        message,
        direction="incoming",
        override_text=_humanize_message(message),
        section=current_section,
    )

    # Р•РЎР›Р AI Р’Р«РљР›Р®Р§Р•Рќ РР›Р Р—РђРџР РћРЁР•Рќ РћРџР•Р РђРўРћР  - РІС‹С…РѕРґРёРј (РќРРљРђРљРРҐ AI РћРўР’Р•РўРћР’)
    if not ai_session['ai_enabled'] or ai_session['operator_requested']:
        logger.info("AI РѕС‚РєР»СЋС‡РµРЅ РґР»СЏ С‡Р°С‚Р° %s. РЎРѕРѕР±С‰РµРЅРёРµ СЃРѕС…СЂР°РЅРµРЅРѕ РґР»СЏ РѕРїРµСЂР°С‚РѕСЂР°.", chat.id)
        return

    # Р•РЎР›Р AI Р’РљР›Р®Р§Р•Рќ - РіРµРЅРµСЂРёСЂСѓРµРј РѕС‚РІРµС‚ РЎ РРќР”РРљРђРўРћР РћРњ РћР–РР”РђРќРРЇ
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
    return f"[{message.content_type} сообщение]"


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
        text = _humanize_message(message) or f"[{message.content_type} сообщение]"
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


def _select_section(chat_id: int, section_id: str) -> None:
    section = SECTION_COMMANDS.get(section_id)
    if not section:
        return
    database.set_chat_section(chat_id, section_id)
    _send_and_store_message(
        chat_id,
        f"Раздел «{section['title']}» выбран. Опишите ваш вопрос.",
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
            "Сохранённых БИНов пока нет. Добавьте новый БИН через кнопку"
            " или просто отправьте БИН числом из 12 цифр.",
        )
        return
    keyboard = types.InlineKeyboardMarkup()
    # Check which BIN has active dialog
    active_dialog = database.get_active_chat_dialog(chat_id)
    active_bin = active_dialog["bin"] if active_dialog else None
    for bin_value in client_bins:
        label = bin_value
        if bin_value == active_bin:
            label = f"{label} • текущий"
        keyboard.add(
            types.InlineKeyboardButton(
                label,
                callback_data=f"{SWITCH_BIN_CALLBACK}:{bin_value}",
            )
        )
    bot.send_message(
        chat_id,
        "Выберите БИН, чтобы продолжить работу с соответствующим диалогом.",
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
        bot.answer_callback_query(call.id, "Не удалось найти ответ")
        return
    chat = call.message.chat
    bot.answer_callback_query(call.id, "Ответ отправлен")
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
    bot.answer_callback_query(call.id, "Запрос передан оператору")

    ai_session = get_ai_session(chat.id)
    ai_session['operator_requested'] = True
    ai_session['ai_enabled'] = False

    if ai_session['waiting_message_id']:
        try:
            bot.delete_message(chat.id, ai_session['waiting_message_id'])
        except Exception:
            pass
        ai_session['waiting_message_id'] = None

    author = None
    if call.from_user:
        author = call.from_user.username or call.from_user.full_name
    database.save_message(
        chat_id=chat.id,
        direction="incoming",
        text="[FAQ] Связаться с оператором",
        message_id=None,
        author=author,
        chat_title=chat.title or chat.username or str(chat.id),
        username=chat.username,
        chat_type=chat.type,
        section=section_id,
    )
    _send_and_store_message(chat.id, "Запрос оператору отправлен...", section=section_id, author="System")


@bot.callback_query_handler(func=lambda call: call.data.startswith(f"{SWITCH_BIN_CALLBACK}:"))
def handle_switch_bin_callback(call: telebot.types.CallbackQuery) -> None:
    try:
        _, bin_value = call.data.split(":", 1)
        bin_value = bin_value.strip()
    except (ValueError, IndexError):
        bot.answer_callback_query(call.id, "Не удалось определить БИН")
        return
    if not bin_value:
        bot.answer_callback_query(call.id, "БИН не указан")
        return
    chat = call.message.chat
    dialog_id, is_resumed = database.set_chat_bin(chat.id, bin_value)
    if dialog_id is None:
        bot.answer_callback_query(call.id, "Не удалось открыть диалог")
        return
    ai_session = get_ai_session(chat.id)
    ai_session['ai_enabled'] = True
    ai_session['operator_requested'] = False
    if is_resumed:
        appeal_num = database.count_appeals(dialog_id)
        bot.answer_callback_query(call.id, "БИН переключен")
        _send_and_store_message(
            chat.id,
            f"📋 Возобновлён диалог по БИН {bin_value}. Новое обращение №{appeal_num}. AI помощник включен.",
            reply_markup=_section_keyboard(),
            dialog_id=dialog_id,
            author="System",
        )
    else:
        bot.answer_callback_query(call.id, "БИН переключен")
        _send_and_store_message(
            chat.id,
            f"Активирован диалог по БИН {bin_value}. AI помощник включен.",
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
            text=f"{'⭐' * i}",
            callback_data=f"{callback_prefix}{i}",
        )
        for i in range(1, 6)
    ]
    markup.add(*buttons)
    _send_and_store_message(chat_id, prompt, reply_markup=markup, dialog_id=dialog_id, author="System")


def send_csat_request(chat_id: int, dialog_id: int, appeal_id: int | None = None) -> None:
    """Send operator CSAT request."""
    _send_rating_request(
        chat_id,
        dialog_id,
        appeal_id=appeal_id,
        prefix=CSAT_PREFIX,
        prompt="📊 Пожалуйста, оцените качество обслуживания:",
    )


def send_ai_csat_request(chat_id: int, dialog_id: int, appeal_id: int | None = None) -> None:
    """Send AI CSAT request for AI-resolved appeals."""
    _send_rating_request(
        chat_id,
        dialog_id,
        appeal_id=appeal_id,
        prefix=AI_CSAT_PREFIX,
        prompt="🤖 Пожалуйста, оцените качество ответа AI:",
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
            bot.answer_callback_query(call.id, "Ошибка данных")
            return

        dialog_id = int(parts[0])
        appeal_id: int | None = None
        if len(parts) == 3:
            appeal_id = int(parts[1])
            rating = int(parts[2])
        else:
            rating = int(parts[1])

        if rating < 1 or rating > 5:
            bot.answer_callback_query(call.id, "Некорректная оценка")
            return

        # Check if already rated
        if appeal_id is not None:
            existing = database.get_csat_for_appeal(appeal_id)
        else:
            existing = database.get_csat_for_dialog(dialog_id)
        if existing is not None:
            bot.answer_callback_query(call.id, f"Вы уже оценили: {'⭐' * existing}")
            return

        # Save the rating
        saved = database.save_csat_rating(dialog_id, rating, appeal_id=appeal_id)
        if not saved:
            bot.answer_callback_query(call.id, "Не удалось сохранить оценку")
            return

        # Acknowledge and update the message
        bot.answer_callback_query(call.id, f"\u0421\u043f\u0430\u0441\u0438\u0431\u043e \u0437\u0430 \u043e\u0446\u0435\u043d\u043a\u0443! {chr(0x2B50) * rating}")
        _finalize_rating_message(
            call,
            f"\U0001f4ca \u0421\u043f\u0430\u0441\u0438\u0431\u043e \u0437\u0430 \u0432\u0430\u0448\u0443 \u043e\u0446\u0435\u043d\u043a\u0443: {chr(0x2B50) * rating}\n\u041c\u044b \u0446\u0435\u043d\u0438\u043c \u0432\u0430\u0448 \u043e\u0442\u0437\u044b\u0432!",
        )

    except (ValueError, IndexError):
        logger.warning("Invalid CSAT callback data: %s", call.data, exc_info=True)
        bot.answer_callback_query(call.id, "Ошибка обработки")
    except Exception:
        logger.error("CSAT callback error", exc_info=True)
        bot.answer_callback_query(call.id, "Произошла ошибка")


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
            bot.answer_callback_query(call.id, "Ошибка данных")
            return

        dialog_id = int(parts[0])
        appeal_id: int | None = None
        if len(parts) == 3:
            appeal_id = int(parts[1])
            rating = int(parts[2])
        else:
            rating = int(parts[1])

        if rating < 1 or rating > 5:
            bot.answer_callback_query(call.id, "Некорректная оценка")
            return

        if appeal_id is not None:
            existing = database.get_ai_csat_for_appeal(appeal_id)
        else:
            existing = database.get_ai_csat_for_dialog(dialog_id)
        if existing is not None:
            bot.answer_callback_query(call.id, f"Вы уже оценили AI: {'⭐' * existing}")
            return

        saved = database.save_ai_csat_rating(dialog_id, rating, appeal_id=appeal_id)
        if not saved:
            bot.answer_callback_query(call.id, "Не удалось сохранить оценку AI")
            return

        bot.answer_callback_query(call.id, f"\u0421\u043f\u0430\u0441\u0438\u0431\u043e \u0437\u0430 \u043e\u0446\u0435\u043d\u043a\u0443 AI! {chr(0x2B50) * rating}")
        _finalize_rating_message(
            call,
            f"\U0001f916 \u0421\u043f\u0430\u0441\u0438\u0431\u043e \u0437\u0430 \u043e\u0446\u0435\u043d\u043a\u0443 AI: {chr(0x2B50) * rating}\n\u041c\u044b \u0443\u043b\u0443\u0447\u0448\u0430\u0435\u043c \u043e\u0442\u0432\u0435\u0442\u044b \u043d\u0430 \u043e\u0441\u043d\u043e\u0432\u0435 \u0432\u0430\u0448\u0435\u0439 \u043e\u0431\u0440\u0430\u0442\u043d\u043e\u0439 \u0441\u0432\u044f\u0437\u0438.",
        )
    except (ValueError, IndexError):
        logger.warning("Invalid AI CSAT callback data: %s", call.data, exc_info=True)
        bot.answer_callback_query(call.id, "Ошибка обработки")
    except Exception:
        logger.error("AI CSAT callback error", exc_info=True)
        bot.answer_callback_query(call.id, "Произошла ошибка")


bot.set_my_commands(
    [
        types.BotCommand("start", "Начать работу"),
        types.BotCommand("faq", "Частые вопросы"),
        types.BotCommand("ai", "Включить AI помощника"),
        types.BotCommand("operator", "Связаться с оператором"),
        *[
            types.BotCommand(section_id, section["title"])
            for section_id, section in SECTION_COMMANDS.items()
        ],
    ]
)






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
