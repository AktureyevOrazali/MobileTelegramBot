"""Telegram bot that writes incoming messages into the database."""
from __future__ import annotations

import logging
import os
import re
from typing import Optional

import telebot
from telebot import types

from . import database
from .ai_manager import ai_manager
from . import contract_checker
import asyncio

logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
if not TELEGRAM_BOT_TOKEN:
    raise RuntimeError("TELEGRAM_BOT_TOKEN environment variable is required")

bot = telebot.TeleBot(TELEGRAM_BOT_TOKEN, parse_mode=None, threaded=True)

SECTION_COMMANDS = {section["id"]: section for section in database.SECTIONS}
SECTION_TITLES = {section["title"].lower(): section for section in database.SECTIONS}
FAQ_BY_SECTION = {section["id"]: database.list_faq(section["id"]) for section in database.SECTIONS}
FAQ_TRIGGER = "частые вопросы"
OPERATOR_TRIGGER = "связаться с оператором"
BIN_PATTERN = re.compile(r"^\d{12}$")
START_BUTTON = "▶️ Старт"
NEW_BIN_BUTTON = "➕ Добавить БИН"
SELECT_BIN_BUTTON = "📂 Выбрать БИН"
FINISH_BUTTON = "⏹ Завершить работу"
SWITCH_BIN_CALLBACK = "switch_bin"

# Глобальный словарь для управления AI сессиями
AI_SESSIONS = {}  # {chat_id: {'ai_enabled': True, 'operator_requested': False, 'waiting_message_id': None}}

def get_ai_session(chat_id: int) -> dict:
    """Получает или создает AI сессию для чата"""
    if chat_id not in AI_SESSIONS:
        AI_SESSIONS[chat_id] = {
            'ai_enabled': True,  # ИЗНАЧАЛЬНО ВКЛЮЧЕН
            'operator_requested': False,
            'waiting_message_id': None  # ID сообщения "Подождите..."
        }
    return AI_SESSIONS[chat_id]

def enable_ai_session(chat_id: int) -> None:
    """Сбрасывает флаги и включает AI для указанного чата."""
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
    keyboard = types.ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=False)
    keyboard.add(types.KeyboardButton(START_BUTTON))
    keyboard.row(
        types.KeyboardButton(NEW_BIN_BUTTON),
        types.KeyboardButton(SELECT_BIN_BUTTON),
    )
    keyboard.add(types.KeyboardButton(FINISH_BUTTON))
    for section in database.SECTIONS:
        keyboard.add(types.KeyboardButton(section["title"]))
    keyboard.add(types.KeyboardButton("Частые вопросы"))
    keyboard.add(types.KeyboardButton("Связаться с оператором"))
    # Добавляем кнопки управления AI
    keyboard.add(types.KeyboardButton("🤖 Включить AI"), types.KeyboardButton("👨‍💼 Оператор"))
    return keyboard

def _generate_ai_response(message: telebot.types.Message, section: str) -> None:
    """Генерирует и отправляет AI ответ с индикатором ожидания"""
    chat_id = message.chat.id
    ai_session = get_ai_session(chat_id)
    
    # ПРОВЕРЯЕМ ЧТО AI ЕЩЕ ВКЛЮЧЕН (на случай если пользователь отправил оператора во время генерации)
    if not ai_session['ai_enabled'] or ai_session['operator_requested']:
        return
    
    try:
        # Показываем индикатор набора текста
        bot.send_chat_action(chat_id, 'typing')
        
        # ОТПРАВЛЯЕМ СООБЩЕНИЕ "ПОДОЖДИТЕ"
        waiting_msg = bot.send_message(chat_id, "⏳ Подождите, бот думает...")
        ai_session['waiting_message_id'] = waiting_msg.message_id
        
        # Получаем историю чата для контекста
        chat_history = database.get_messages(chat_id, limit=6)
        
        # ДВОЙНАЯ ПРОВЕРКА что AI еще включен
        if not ai_session['ai_enabled'] or ai_session['operator_requested']:
            try:
                bot.delete_message(chat_id, waiting_msg.message_id)
            except:
                pass
            ai_session['waiting_message_id'] = None
            return
            
        # Генерируем AI ответ
        ai_response = ai_manager.generate_response(message.text, chat_history)
        
        # ТРОЙНАЯ ПРОВЕРКА что AI еще включен
        if not ai_session['ai_enabled'] or ai_session['operator_requested']:
            try:
                bot.delete_message(chat_id, waiting_msg.message_id)
            except:
                pass
            ai_session['waiting_message_id'] = None
            return
        
        # УДАЛЯЕМ СООБЩЕНИЕ "ПОДОЖДИТЕ"
        try:
            bot.delete_message(chat_id, waiting_msg.message_id)
        except:
            pass  # Если не удалось удалить - не страшно
        ai_session['waiting_message_id'] = None
        
        # Отправляем ответ пользователю
        sent_message = bot.send_message(chat_id, f"🤖 {ai_response}")
        
        # Сохраняем AI ответ в базу
        database.save_message(
            chat_id=chat_id,
            direction="outgoing",
            text=ai_response,
            message_id=sent_message.message_id,
            author="AI Assistant",
            chat_title=sent_message.chat.title or sent_message.chat.username or str(sent_message.chat.id),
            username=sent_message.chat.username,
            chat_type=sent_message.chat.type,
            section=section,
        )
        
        logger.info("AI ответ отправлен в чат %s", chat_id)
        
    except Exception as e:
        logger.error("Ошибка генерации AI ответа для чата %s: %s", chat_id, e)
        
        # УДАЛЯЕМ СООБЩЕНИЕ "ПОДОЖДИТЕ" ПРИ ОШИБКЕ
        if ai_session['waiting_message_id']:
            try:
                bot.delete_message(chat_id, ai_session['waiting_message_id'])
            except:
                pass
            ai_session['waiting_message_id'] = None
        
        # В случае ошибки предлагаем оператора
        error_msg = bot.send_message(
            chat_id,
            "⚠️ Произошла ошибка AI помощника. Для консультации напишите 'оператор'"
        )
        _persist_message(
            error_msg,
            direction="outgoing",
            section=section,
            author="System"
        )


# Добавляем обработчики команд AI
@bot.message_handler(commands=['ai_on', 'ai_off', 'operator', 'ai'])
def handle_ai_commands(message: telebot.types.Message) -> None:
    """Обработчик команд управления AI"""
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
        logger.info("AI включен для чата %s", chat_id)
        
    elif command == '/ai_off':
        session['ai_enabled'] = False
        bot.send_message(
            chat_id,
            "❌ AI помощник выключен. Ваши сообщения будут направлены оператору.\n\n"
            "Чтобы включить AI напишите /ai_on"
        )
        logger.info("AI выключен для чата %s", chat_id)
        
    elif command == '/operator':
        # ВКЛЮЧАЕМ РЕЖИМ ОПЕРАТОРА И ОТКЛЮЧАЕМ AI
        session['operator_requested'] = True
        session['ai_enabled'] = False  # АВТОМАТИЧЕСКОЕ ОТКЛЮЧЕНИЕ
        
        # УДАЛЯЕМ СООБЩЕНИЕ "ПОДОЖДИТЕ" ЕСЛИ ОНО ЕСТЬ
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
        logger.info("Запрошен оператор для чата %s, AI отключен", chat_id)
        
        # Сохраняем запрос оператора в историю
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

    # Инициализируем AI сессию (автоматически включен)
    session = get_ai_session(chat.id)
    
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
    
    # Получаем AI сессию
    ai_session = get_ai_session(chat.id)

    # Обрабатываем текстовые команды управления AI
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
            else:
                bot.send_message(
                    chat.id,
                    "Активных диалогов не было. Отправьте БИН организации, чтобы начать работу.",
                    reply_markup=_section_keyboard(),
                )
            _persist_message(message, direction="incoming", override_text="[КОМАНДА] Завершить работу", section=None)
            return
        normalized = text.strip().lower()
        
        # Кнопки управления AI
        if normalized == "🤖 включить ai":
            ai_session['ai_enabled'] = True
            ai_session['operator_requested'] = False
            bot.send_message(chat.id, "✅ AI помощник включен!")
            _persist_message(message, direction="incoming", section=None)
            return
            
        elif normalized == "👨‍💼 оператор" or normalized == "оператор":
            # АВТОМАТИЧЕСКОЕ ОТКЛЮЧЕНИЕ AI ПРИ ЗАПРОСЕ ОПЕРАТОРА
            ai_session['operator_requested'] = True
            ai_session['ai_enabled'] = False
            
            # УДАЛЯЕМ СООБЩЕНИЕ "ПОДОЖДИТЕ" ЕСЛИ ОНО ЕСТЬ
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

    # Требуем БИН, если он ещё не указан
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
        # Check if customer has a valid contract for 2026
        contract_result = contract_checker.check_customer_contracts(normalized_text)
        has_contract = contract_result.get("has_contract", False)
        
        # Save organization without contract info (for admin tracking)
        if not has_contract:
            database.add_organization_without_contract(
                customer_bin=normalized_text,
                customer_legal_address=contract_result.get("customer_legal_address"),
                customer_bank_name_ru=contract_result.get("customer_bank_name_ru"),
            )
            logger.info("Organization %s saved as organization without contract", normalized_text)
        
        # Create dialog for ALL BINs (with or without contract)
        was_empty_bin = not chat_record or not chat_record.get("bin")
        dialog_id, is_resumed = database.set_chat_bin(chat.id, normalized_text)
        # Save BIN to client's persistent list (survives dialog deletion)
        database.add_client_bin(chat.id, normalized_text)
        ai_session['ai_enabled'] = True
        ai_session['operator_requested'] = False
        
        if is_resumed:
            appeal_num = database.count_appeals(dialog_id)
            bot.send_message(chat.id, f"Диалог по БИН {normalized_text} возобновлён. Новое обращение №{appeal_num}.")
        elif was_empty_bin:
            bot.send_message(chat.id, f"Спасибо! БИН {normalized_text} сохранён.")
        else:
            bot.send_message(chat.id, f"БИН обновлён. Открыт диалог для {normalized_text}.")
        
        # Notify about contract status
        if not has_contract:
            bot.send_message(
                chat.id,
                "⚠️ Обратите внимание: у вашей организации нет действующего договора с нами на 2026 год.\n"
                "Для заключения договора обратитесь в наш офис.",
            )
        
        bot.send_message(
            chat.id,
            "Теперь выберите подходящий раздел.\n\n"
            "🤖 AI помощник автоматически включен и готов отвечать на ваши вопросы!",
            reply_markup=_section_keyboard(),
        )
        _persist_message(message, direction="incoming", section=None, dialog_id=dialog_id)
        return

    # ── Auto-resume: если нет активного диалога, но есть закрытый — возобновляем ──
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

    # Обработка разделов и FAQ
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
            # АВТОМАТИЧЕСКОЕ ОТКЛЮЧЕНИЕ AI ПРИ ЗАПРОСЕ ОПЕРАТОРА
            ai_session['operator_requested'] = True
            ai_session['ai_enabled'] = False
            
            # УДАЛЯЕМ СООБЩЕНИЕ "ПОДОЖДИТЕ" ЕСЛИ ОНО ЕСТЬ
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

    # Получаем раздел из активного диалога (привязан к БИНу), а не из чата
    current_section = database.get_dialog_section(chat.id)
    # Если section пустой в диалоге - берём из чата для обратной совместимости
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

    # СОХРАНЯЕМ сообщение пользователя в любом случае
    _persist_message(
        message,
        direction="incoming",
        override_text=_humanize_message(message),
        section=current_section,
    )

    # ЕСЛИ AI ВЫКЛЮЧЕН ИЛИ ЗАПРОШЕН ОПЕРАТОР - выходим (НИКАКИХ AI ОТВЕТОВ)
    if not ai_session['ai_enabled'] or ai_session['operator_requested']:
        logger.info("AI отключен для чата %s. Сообщение сохранено для оператора.", chat.id)
        return

    # ЕСЛИ AI ВКЛЮЧЕН - генерируем ответ С ИНДИКАТОРОМ ОЖИДАНИЯ
    if message.content_type == "text" and ai_manager is not None:
        _generate_ai_response(message, current_section)


def _humanize_message(message: telebot.types.Message) -> str:
    if message.content_type == "text":
        return message.text or ""
    return f"[{message.content_type} сообщение]"


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
    text = override_text if override_text is not None else _humanize_message(message)
    message_author = author
    
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
        dialog_id=dialog_id,
    )
    logger.info("Stored %s message from chat %s", direction, chat.id)
    
    # ── Notify SSE clients ──
    try:
        from .api import event_bus
        asyncio.run_coroutine_threadsafe(
            event_bus.publish_all("new_message", {
                "chat_id": chat.id,
                "dialog_id": dialog_id,
                "message_id": message_id,
                "text": text,
                "direction": direction,
                "author": message_author,
            }),
            asyncio.get_event_loop()
        )
    except Exception as e:
        logger.error("Failed to publish SSE event: %s", e)


def _select_section(chat_id: int, section_id: str) -> None:
    section = SECTION_COMMANDS.get(section_id)
    if not section:
        return
    database.set_chat_section(chat_id, section_id)
    bot.send_message(
        chat_id,
        f"Раздел «{section['title']}» выбран. Напишите свой вопрос.",
        reply_markup=_section_keyboard(),
    )
    logger.info("Chat %s selected section %s", chat_id, section_id)
    _send_faq_menu(chat_id, section_id)


def _faq_keyboard(section_id: str) -> Optional[types.InlineKeyboardMarkup]:
    entries = FAQ_BY_SECTION.get(section_id) or []
    if not entries:
        return None
    keyboard = types.InlineKeyboardMarkup()
    for index, entry in enumerate(entries):
        keyboard.add(
            types.InlineKeyboardButton(
                entry["question"], callback_data=f"faq:{section_id}:{index}"
            )
        )
    keyboard.add(
        types.InlineKeyboardButton(
            "Связаться с оператором", callback_data=f"operator:{section_id}"
        )
    )
    return keyboard


def _send_faq_menu(chat_id: int, section_id: str) -> None:
    keyboard = _faq_keyboard(section_id)
    if not keyboard:
        return
    bot.send_message(
        chat_id,
        "Посмотрите частые вопросы по разделу или свяжитесь с оператором.",
        reply_markup=keyboard,
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

    sent = bot.send_message(message.chat.id, answer_text)
    database.save_message(
        chat_id=message.chat.id,
        direction="outgoing",
        text=answer_text,
        message_id=sent.message_id,
        author="AutoBot",
        chat_title=sent.chat.title or sent.chat.username or str(sent.chat.id),
        username=sent.chat.username,
        chat_type=sent.chat.type,
        section=entry.get("section") or section_id,
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
        text=f"[FAQ] {entry['question']}",
        message_id=None,
        author=author,
        chat_title=chat.title or chat.username or str(chat.id),
        username=chat.username,
        chat_type=chat.type,
        section=section_id,
    )
    sent = bot.send_message(chat.id, entry["answer"])
    database.save_message(
        chat_id=chat.id,
        direction="outgoing",
        text=entry["answer"],
        message_id=sent.message_id,
        author="AutoBot",
        chat_title=sent.chat.title or sent.chat.username or str(sent.chat.id),
        username=sent.chat.username,
        chat_type=sent.chat.type,
        section=section_id,
    )


@bot.callback_query_handler(func=lambda call: call.data.startswith("operator:"))
def handle_operator_callback(call: telebot.types.CallbackQuery) -> None:
    _, section_id = call.data.split(":", 1)
    chat = call.message.chat
    database.set_chat_section(chat.id, section_id)
    bot.answer_callback_query(call.id, "Подключаем оператора")
    
    # АВТОМАТИЧЕСКОЕ ОТКЛЮЧЕНИЕ AI ПРИ ЗАПРОСЕ ОПЕРАТОРА
    ai_session = get_ai_session(chat.id)
    ai_session['operator_requested'] = True
    ai_session['ai_enabled'] = False
    
    # УДАЛЯЕМ СООБЩЕНИЕ "ПОДОЖДИТЕ" ЕСЛИ ОНО ЕСТЬ
    if ai_session['waiting_message_id']:
        try:
            bot.delete_message(chat.id, ai_session['waiting_message_id'])
        except:
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
    bot.send_message(chat.id, "👨‍💼 Подключаю оператора...")


@bot.callback_query_handler(func=lambda call: call.data.startswith(f"{SWITCH_BIN_CALLBACK}:"))
def handle_switch_bin_callback(call: telebot.types.CallbackQuery) -> None:
    try:
        _, bin_value = call.data.split(":", 1)
        bin_value = bin_value.strip()
    except (ValueError, IndexError):
        bot.answer_callback_query(call.id, "Не удалось распознать БИН")
        return
    if not bin_value:
        bot.answer_callback_query(call.id, "БИН не указан")
        return
    chat = call.message.chat
    # Create or activate dialog for this BIN
    dialog_id, is_resumed = database.set_chat_bin(chat.id, bin_value)
    if dialog_id is None:
        bot.answer_callback_query(call.id, "Ошибка активации диалога")
        return
    ai_session = get_ai_session(chat.id)
    ai_session['ai_enabled'] = True
    ai_session['operator_requested'] = False
    if is_resumed:
        appeal_num = database.count_appeals(dialog_id)
        bot.answer_callback_query(call.id, "Диалог возобновлён")
        bot.send_message(
            chat.id,
            f"📋 Возобновлён диалог по БИН {bin_value}. Новое обращение №{appeal_num}. AI помощник включен.",
            reply_markup=_section_keyboard(),
        )
    else:
        bot.answer_callback_query(call.id, "Диалог активирован")
        bot.send_message(
            chat.id,
            f"Активирован диалог по БИН {bin_value}. AI помощник включен.",
            reply_markup=_section_keyboard(),
        )


# ═══════════════════════════════════════════
# CSAT — Customer Satisfaction Rating
# ═══════════════════════════════════════════

CSAT_PREFIX = "csat_"


def send_csat_request(chat_id: int, dialog_id: int) -> None:
    """Send an inline keyboard with 1–5 star buttons for CSAT rating."""
    markup = types.InlineKeyboardMarkup(row_width=5)
    buttons = [
        types.InlineKeyboardButton(
            text=f"{'⭐' * i}",
            callback_data=f"{CSAT_PREFIX}{dialog_id}_{i}",
        )
        for i in range(1, 6)
    ]
    markup.add(*buttons)
    bot.send_message(
        chat_id,
        "📊 Пожалуйста, оцените качество обслуживания:",
        reply_markup=markup,
    )


@bot.callback_query_handler(func=lambda call: call.data and call.data.startswith(CSAT_PREFIX))
def csat_callback_handler(call: types.CallbackQuery) -> None:
    """Handle CSAT rating callback from inline buttons."""
    try:
        # Parse callback_data: csat_{dialog_id}_{rating}
        parts = call.data[len(CSAT_PREFIX):].split("_")
        if len(parts) != 2:
            bot.answer_callback_query(call.id, "Ошибка данных")
            return

        dialog_id = int(parts[0])
        rating = int(parts[1])

        if rating < 1 or rating > 5:
            bot.answer_callback_query(call.id, "Некорректная оценка")
            return

        # Check if already rated
        existing = database.get_csat_for_dialog(dialog_id)
        if existing is not None:
            bot.answer_callback_query(call.id, f"Вы уже оценили: {'⭐' * existing}")
            return

        # Save the rating
        saved = database.save_csat_rating(dialog_id, rating)
        if not saved:
            bot.answer_callback_query(call.id, "Не удалось сохранить оценку")
            return

        # Acknowledge and update the message
        bot.answer_callback_query(call.id, f"Спасибо за оценку! {'⭐' * rating}")
        try:
            bot.edit_message_text(
                f"📊 Спасибо за вашу оценку: {'⭐' * rating}\nМы ценим ваш отзыв!",
                chat_id=call.message.chat.id,
                message_id=call.message.message_id,
                reply_markup=None,
            )
        except Exception:
            pass  # Best-effort message update

    except (ValueError, IndexError):
        logger.warning("Invalid CSAT callback data: %s", call.data, exc_info=True)
        bot.answer_callback_query(call.id, "Ошибка обработки")
    except Exception:
        logger.error("CSAT callback error", exc_info=True)
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