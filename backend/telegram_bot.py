"""Telegram bot that writes incoming messages into the database."""
from __future__ import annotations

import logging
import os
import re
from typing import Optional

import telebot
from telebot import types

from . import database

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

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


def _section_keyboard() -> types.ReplyKeyboardMarkup:
    keyboard = types.ReplyKeyboardMarkup(resize_keyboard=True, one_time_keyboard=False)
    for section in database.SECTIONS:
        keyboard.add(types.KeyboardButton(section["title"]))
    keyboard.add(types.KeyboardButton("Частые вопросы"))
    keyboard.add(types.KeyboardButton("Связаться с оператором"))
    return keyboard


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


@bot.message_handler(commands=["start"])
def handle_start(message: telebot.types.Message) -> None:
    chat = message.chat
    database.upsert_chat(chat.id, chat.title or chat.username or str(chat.id), chat.username, chat.type)
    database.set_chat_section(chat.id, None)
    database.set_chat_bin(chat.id, None)
    bot.send_message(
        chat.id,
        "Здравствуйте! Я помогу связаться с оператором.",
    )
    bot.send_message(
        chat.id,
        "Для начала укажите БИН вашей организации (12 цифр).",
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

    if chat_record and not chat_record.get("bin"):
        if message.content_type != "text":
            bot.send_message(chat.id, "Отправьте БИН организации числом из 12 цифр.")
            _persist_message(message, direction="incoming", override_text=_humanize_message(message), section=None)
            return
        if BIN_PATTERN.match(text.strip()):
            database.set_chat_bin(chat.id, text.strip())
            bot.send_message(chat.id, f"Спасибо! БИН {text.strip()} сохранён.")
            bot.send_message(chat.id, "Теперь выберите подходящий раздел.", reply_markup=_section_keyboard())
        else:
            bot.send_message(chat.id, "БИН должен содержать 12 цифр без пробелов. Попробуйте ещё раз.")
        _persist_message(message, direction="incoming", section=None)
        return

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
            _persist_message(
                message,
                direction="incoming",
                section=chat_record.get("section") if chat_record else None,
            )
            if chat_record and chat_record.get("section"):
                bot.send_message(chat.id, "Пишите свой вопрос, оператор подключится к диалогу.")
            else:
                bot.send_message(
                    chat.id,
                    "Выберите раздел, чтобы оператор видел контекст.",
                    reply_markup=_section_keyboard(),
                )
            return
    if selected_section:
        _persist_message(message, direction="incoming", section=selected_section)
        _select_section(chat.id, selected_section)
        return

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

    _persist_message(
        message,
        direction="incoming",
        override_text=_humanize_message(message),
        section=current_section,
    )
    if message.content_type == "text" and current_section:
        _try_auto_answer(message, current_section)


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
) -> None:
    chat = message.chat
    text = override_text if override_text is not None else _humanize_message(message)
    author = None
    if message.from_user:
        author = message.from_user.username or message.from_user.full_name
    database.save_message(
        chat_id=chat.id,
        direction=direction,
        text=text,
        message_id=message.message_id,
        author=author,
        chat_title=chat.title or chat.username or str(chat.id),
        username=chat.username,
        chat_type=chat.type,
        section=section,
    )
    logger.info("Stored %s message from chat %s", direction, chat.id)


def _try_auto_answer(message: telebot.types.Message, section_id: str) -> None:
    entries = FAQ_BY_SECTION.get(section_id) or []
    normalized = (message.text or "").lower()
    for entry in entries:
        for keyword in entry.get("keywords", []):
            if keyword in normalized:
                sent = bot.send_message(message.chat.id, entry["answer"])
                database.save_message(
                    chat_id=message.chat.id,
                    direction="outgoing",
                    text=entry["answer"],
                    message_id=sent.message_id,
                    author="AutoBot",
                    chat_title=sent.chat.title or sent.chat.username or str(sent.chat.id),
                    username=sent.chat.username,
                    chat_type=sent.chat.type,
                    section=section_id,
                )
                return


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
    bot.send_message(chat.id, "Оператор подключится к переписке. Опишите вашу ситуацию подробнее.")


bot.set_my_commands(
    [
        types.BotCommand("start", "Начать работу"),
        types.BotCommand("faq", "Частые вопросы"),
        *[
            types.BotCommand(section_id, section["title"])
            for section_id, section in SECTION_COMMANDS.items()
        ],
    ]
)