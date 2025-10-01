"""Telegram bot that writes incoming messages into the database."""
from __future__ import annotations

import logging
import os

import telebot

from . import database

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
if not TELEGRAM_BOT_TOKEN:
    raise RuntimeError("TELEGRAM_BOT_TOKEN environment variable is required")

bot = telebot.TeleBot(TELEGRAM_BOT_TOKEN, parse_mode=None, threaded=True)


@bot.message_handler(commands=["start"])
def handle_start(message: telebot.types.Message) -> None:
    bot.send_message(
        message.chat.id,
        "Привет! Я бот-помощник. Пиши мне вопросы, а оператор ответит через мобильное приложение.",
    )
    _persist_message(message, direction="incoming")


@bot.message_handler(content_types=["text", "photo", "document", "audio", "video", "voice", "sticker"])
def handle_updates(message: telebot.types.Message) -> None:
    if message.content_type != "text":
        text = f"[{message.content_type} сообщение]"
    else:
        text = message.text or ""
    _persist_message(message, direction="incoming", override_text=text)


def _persist_message(
    message: telebot.types.Message,
    *,
    direction: str,
    override_text: str | None = None,
) -> None:
    chat = message.chat
    text = override_text if override_text is not None else message.text or ""
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
    )
    logger.info("Stored %s message from chat %s", direction, chat.id)