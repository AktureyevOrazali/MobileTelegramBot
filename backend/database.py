"""SQLite helpers for storing Telegram chat history."""
from __future__ import annotations

import sqlite3
import threading
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import List

DB_PATH = Path(__file__).resolve().parent / "bot.db"
_connection = sqlite3.connect(DB_PATH, check_same_thread=False)
_connection.row_factory = sqlite3.Row
_lock = threading.Lock()


def _init_db() -> None:
    with _connection:
        _connection.execute(
            """
            CREATE TABLE IF NOT EXISTS chats (
                chat_id INTEGER PRIMARY KEY,
                title TEXT,
                username TEXT,
                type TEXT,
                updated_at TEXT
            )
            """
        )
        _connection.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                direction TEXT NOT NULL,
                text TEXT NOT NULL,
                message_id INTEGER,
                author TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(chat_id) REFERENCES chats(chat_id)
            )
            """
        )


_init_db()


@dataclass
class Chat:
    chat_id: int
    title: str
    username: str | None
    type: str
    updated_at: datetime

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "Chat":
        return cls(
            chat_id=row["chat_id"],
            title=row["title"],
            username=row["username"],
            type=row["type"],
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )


@dataclass
class Message:
    id: int
    chat_id: int
    direction: str
    text: str
    message_id: int | None
    author: str | None
    created_at: datetime

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "Message":
        return cls(
            id=row["id"],
            chat_id=row["chat_id"],
            direction=row["direction"],
            text=row["text"],
            message_id=row["message_id"],
            author=row["author"],
            created_at=datetime.fromisoformat(row["created_at"]),
        )


def upsert_chat(chat_id: int, title: str, username: str | None, chat_type: str) -> None:
    now = datetime.utcnow().isoformat()
    with _lock, _connection:
        _connection.execute(
            """
            INSERT INTO chats (chat_id, title, username, type, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(chat_id) DO UPDATE SET
                title=excluded.title,
                username=excluded.username,
                type=excluded.type,
                updated_at=excluded.updated_at
            """,
            (chat_id, title, username, chat_type, now),
        )


def save_message(
    *,
    chat_id: int,
    direction: str,
    text: str,
    message_id: int | None,
    author: str | None,
    chat_title: str,
    username: str | None,
    chat_type: str,
) -> None:
    now = datetime.utcnow().isoformat()
    with _lock, _connection:
        _connection.execute(
            """
            INSERT INTO messages (chat_id, direction, text, message_id, author, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (chat_id, direction, text, message_id, author, now),
        )
    upsert_chat(chat_id, chat_title, username, chat_type)


def list_chats() -> List[dict]:
    with _lock, _connection:
        rows = _connection.execute(
            "SELECT chat_id, title, username, type, updated_at FROM chats ORDER BY updated_at DESC"
        ).fetchall()
    return [dict(asdict(Chat.from_row(row))) for row in rows]


def get_messages(chat_id: int, limit: int = 50) -> List[dict]:
    with _lock, _connection:
        rows = _connection.execute(
            """
            SELECT id, chat_id, direction, text, message_id, author, created_at
            FROM messages
            WHERE chat_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (chat_id, limit),
        ).fetchall()
    messages = [asdict(Message.from_row(row)) for row in rows]
    return list(reversed(messages))