"""SQLite helpers for storing Telegram chat history, users and sections."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple

from uuid import uuid4

DB_PATH = Path(__file__).resolve().parent / "bot.db"
_connection = sqlite3.connect(DB_PATH, check_same_thread=False)
_connection.row_factory = sqlite3.Row
_lock = threading.Lock()

USER_COLUMN_NAMES = (
    "id",
    "email",
    "name",
    "password_hash",
    "created_at",
    "job_title",
    "phone",
    "bio",
    "login",
    "role",
)


AUTOMATION_AUTHOR_NAMES: tuple[str, ...] = ("AutoBot", "AI Assistant", "System")


def _user_columns(prefix: str | None = None) -> str:
    if prefix:
        return ", ".join(f"{prefix}.{column} AS {column}" for column in USER_COLUMN_NAMES)
    return ", ".join(USER_COLUMN_NAMES)


def _init_db() -> None:
    with _connection:
        _connection.execute(
            """
            CREATE TABLE IF NOT EXISTS chats (
                chat_id INTEGER PRIMARY KEY,
                title TEXT,
                username TEXT,
                type TEXT,
                updated_at TEXT,
                section TEXT,
                bin TEXT
            )
            """
        )
        _connection.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_dialogs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                bin TEXT NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                last_message_at TEXT,
                FOREIGN KEY(chat_id) REFERENCES chats(chat_id) ON DELETE CASCADE
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
                section TEXT,
                dialog_id INTEGER,
                FOREIGN KEY(chat_id) REFERENCES chats(chat_id),
                FOREIGN KEY(dialog_id) REFERENCES chat_dialogs(id) ON DELETE SET NULL
            )
            """
        )
        _connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL,
                job_title TEXT,
                phone TEXT,
                bio TEXT,
                login TEXT UNIQUE,
                role TEXT
            )
            """
        )
        _connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        _connection.execute(
            """
            CREATE TABLE IF NOT EXISTS user_sections (
                user_id INTEGER NOT NULL,
                section TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, section),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        _connection.execute(
            """
            CREATE TABLE IF NOT EXISTS user_bins (
                user_id INTEGER NOT NULL,
                bin TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT,
                assigned_by INTEGER,
                PRIMARY KEY (user_id, bin),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        _connection.execute(
            """
            CREATE TABLE IF NOT EXISTS favorites (
                user_id INTEGER NOT NULL,
                dialog_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, dialog_id),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(dialog_id) REFERENCES chat_dialogs(id) ON DELETE CASCADE
            )
            """
        )
        _connection.execute(
            """
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                kind TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )

    _ensure_column("chats", "section", "TEXT")
    _ensure_column("chats", "bin", "TEXT")
    _ensure_column("messages", "section", "TEXT")
    _ensure_column("messages", "dialog_id", "INTEGER")
    _ensure_column("chat_dialogs", "last_message_at", "TEXT")
    _ensure_column("users", "job_title", "TEXT")
    _ensure_column("users", "phone", "TEXT")
    _ensure_column("users", "bio", "TEXT")
    _ensure_column("users", "login", "TEXT")
    _ensure_column("users", "role", "TEXT")
    _ensure_column("user_bins", "expires_at", "TEXT")
    _ensure_column("user_bins", "assigned_by", "INTEGER")

    with _lock, _connection:
        _connection.execute(
            "UPDATE users SET login = email WHERE login IS NULL OR TRIM(login) = ''"
        )
        _connection.execute(
            "UPDATE users SET role = 'moderator' WHERE role IS NULL OR TRIM(role) = ''"
        )

    _ensure_admin_account()
    _ensure_chat_dialog_records()
    _ensure_favorites_schema()


def _ensure_column(table: str, column: str, definition: str) -> None:
    with _lock, _connection:
        info = _connection.execute(f"PRAGMA table_info({table})").fetchall()
        if not any(row[1] == column for row in info):
            _connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


ROLE_ADMIN = "admin"
ROLE_MODERATOR = "moderator"
ROLE_VIEWER = "viewer"
ALL_ROLES: Iterable[str] = (ROLE_ADMIN, ROLE_MODERATOR, ROLE_VIEWER)


def _ensure_admin_account() -> None:
    password_hash = hashlib.sha256("admin".encode("utf-8")).hexdigest()
    with _lock, _connection:
        row = _connection.execute(
            "SELECT id FROM users WHERE login = ?", ("admin",)
        ).fetchone()
        if row:
            _connection.execute(
                """
                UPDATE users
                SET role = ?,
                    password_hash = ?,
                    name = ?,
                    email = COALESCE(email, ?),
                    login = 'admin',
                    job_title = COALESCE(job_title, '')
                WHERE id = ?
                """,
                (ROLE_ADMIN, password_hash, "Администратор", "admin@example.com", row["id"]),
            )
            return
    now = datetime.utcnow().isoformat()
    _connection.execute(
        """
        INSERT INTO users (email, name, password_hash, created_at, job_title, phone, bio, login, role)
        VALUES (?, ?, ?, ?, ?, '', '', ?, ?)
        """,
        (
            "admin@example.com",
            "Администратор",
            password_hash,
            now,
            "Администратор",
            "admin",
            ROLE_ADMIN,
        ),
    )


def _ensure_chat_dialog_records() -> None:
    with _lock, _connection:
        rows = _connection.execute(
            """
            SELECT chat_id, bin, updated_at
            FROM chats
            WHERE bin IS NOT NULL AND TRIM(bin) != ''
            """
        ).fetchall()
        for row in rows:
            exists = _connection.execute(
                "SELECT 1 FROM chat_dialogs WHERE chat_id = ? LIMIT 1",
                (row["chat_id"],),
            ).fetchone()
            if exists:
                continue
            updated_at = row["updated_at"] or datetime.utcnow().isoformat()
            _connection.execute(
                """
                INSERT INTO chat_dialogs (chat_id, bin, started_at, last_message_at)
                VALUES (?, ?, ?, ?)
                """,
                (row["chat_id"], row["bin"], updated_at, updated_at),
            )


def _ensure_favorites_schema() -> None:
    """Мигрирует таблицу избранного на привязку к диалогам."""
    with _lock, _connection:
        info = _connection.execute("PRAGMA table_info(favorites)").fetchall()
        columns = {row["name"] for row in info}
        if "dialog_id" in columns:
            return

        _connection.execute(
            """
            CREATE TABLE IF NOT EXISTS favorites_new (
                user_id INTEGER NOT NULL,
                dialog_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, dialog_id),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(dialog_id) REFERENCES chat_dialogs(id) ON DELETE CASCADE
            )
            """
        )
        existing = _connection.execute(
            "SELECT user_id, chat_id, created_at FROM favorites"
        ).fetchall()
        for row in existing:
            dialog_row = _connection.execute(
                """
                SELECT id
                FROM chat_dialogs
                WHERE chat_id = ?
                ORDER BY COALESCE(last_message_at, started_at) DESC
                LIMIT 1
                """,
                (row["chat_id"],),
            ).fetchone()
            if not dialog_row:
                continue
            _connection.execute(
                """
                INSERT OR IGNORE INTO favorites_new (user_id, dialog_id, created_at)
                VALUES (?, ?, ?)
                """,
                (row["user_id"], dialog_row["id"], row["created_at"]),
            )
        _connection.execute("DROP TABLE favorites")
        _connection.execute("ALTER TABLE favorites_new RENAME TO favorites")


_init_db()


def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def _fetch_user(where_clause: str, *params: object) -> dict | None:
    with _lock, _connection:
        row = _connection.execute(
            f"SELECT {_user_columns('u')} FROM users u WHERE {where_clause}",
            params,
        ).fetchone()
    return _row_to_user(row) if row else None


@dataclass
class Chat:
    chat_id: int
    title: str
    username: str | None
    type: str
    updated_at: datetime
    section: str | None
    bin: str | None

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "Chat":
        return cls(
            chat_id=row["chat_id"],
            title=row["title"],
            username=row["username"],
            type=row["type"],
            updated_at=datetime.fromisoformat(row["updated_at"]),
            section=row["section"],
            bin=row["bin"],
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
    section: str | None
    dialog_id: int | None

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
            section=row["section"],
            dialog_id=row["dialog_id"],
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
    section: str | None,
    dialog_id: int | None = None,
) -> None:
    now = datetime.utcnow().isoformat()
    resolved_dialog_id = dialog_id
    if resolved_dialog_id is None:
        active_dialog = get_active_chat_dialog(chat_id)
        if active_dialog:
            resolved_dialog_id = active_dialog["id"]
    with _lock, _connection:
        _connection.execute(
            """
            INSERT INTO messages (chat_id, direction, text, message_id, author, created_at, section, dialog_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (chat_id, direction, text, message_id, author, now, section, resolved_dialog_id),
        )
        if resolved_dialog_id is not None:
            _connection.execute(
                "UPDATE chat_dialogs SET last_message_at = ? WHERE id = ?",
                (now, resolved_dialog_id),
            )
    upsert_chat(chat_id, chat_title, username, chat_type)


def list_chat_dialogs(chat_id: int) -> List[Dict[str, object]]:
    with _lock, _connection:
        rows = _connection.execute(
            """
            SELECT id, bin, started_at, ended_at, last_message_at
            FROM chat_dialogs
            WHERE chat_id = ?
            ORDER BY COALESCE(last_message_at, started_at) DESC
            """,
            (chat_id,),
        ).fetchall()
    result: List[Dict[str, object]] = []
    for row in rows:
        result.append(
            {
                "id": int(row["id"]),
                "bin": row["bin"],
                "started_at": row["started_at"],
                "ended_at": row["ended_at"],
                "last_message_at": row["last_message_at"],
            }
        )
    return result


def get_chat_dialog(dialog_id: int) -> Optional[Dict[str, object]]:
    with _lock, _connection:
        row = _connection.execute(
            """
            SELECT id, chat_id, bin, started_at, ended_at, last_message_at
            FROM chat_dialogs
            WHERE id = ?
            """,
            (dialog_id,),
        ).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "chat_id": row["chat_id"],
        "bin": row["bin"],
        "started_at": row["started_at"],
        "ended_at": row["ended_at"],
        "last_message_at": row["last_message_at"],
    }


def get_active_chat_dialog(chat_id: int) -> Optional[Dict[str, object]]:
    with _lock, _connection:
        row = _connection.execute(
            """
            SELECT id, chat_id, bin, started_at, ended_at, last_message_at
            FROM chat_dialogs
            WHERE chat_id = ? AND ended_at IS NULL
            ORDER BY started_at DESC
            LIMIT 1
            """,
            (chat_id,),
        ).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "chat_id": row["chat_id"],
        "bin": row["bin"],
        "started_at": row["started_at"],
        "ended_at": row["ended_at"],
        "last_message_at": row["last_message_at"],
    }


def get_active_chat_dialog_id(chat_id: int) -> int | None:
    dialog = get_active_chat_dialog(chat_id)
    if dialog is None:
        return None
    return int(dialog["id"])


def activate_chat_dialog(dialog_id: int, *, chat_id: int | None = None) -> Optional[Dict[str, object]]:
    now = datetime.utcnow().isoformat()
    with _lock, _connection:
        dialog_row = _connection.execute(
            "SELECT id, chat_id, bin FROM chat_dialogs WHERE id = ?",
            (dialog_id,),
        ).fetchone()
        if dialog_row is None:
            return None
        if chat_id is not None and dialog_row["chat_id"] != chat_id:
            return None
        chat_id_value = dialog_row["chat_id"]
        _connection.execute(
            "UPDATE chat_dialogs SET ended_at = ? WHERE chat_id = ? AND ended_at IS NULL AND id != ?",
            (now, chat_id_value, dialog_id),
        )
        _connection.execute(
            "UPDATE chat_dialogs SET ended_at = NULL, last_message_at = COALESCE(last_message_at, started_at) WHERE id = ?",
            (dialog_id,),
        )
        section_row = _connection.execute(
            """
            SELECT section
            FROM messages
            WHERE dialog_id = ? AND section IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (dialog_id,),
        ).fetchone()
        section_value = section_row["section"] if section_row else None
        _connection.execute(
            """
            UPDATE chats
            SET bin = ?, section = ?, updated_at = ?
            WHERE chat_id = ?
            """,
            (dialog_row["bin"], section_value, now, chat_id_value),
        )
        dialog = _connection.execute(
            """
            SELECT id, chat_id, bin, started_at, ended_at, last_message_at
            FROM chat_dialogs
            WHERE id = ?
            """,
            (dialog_id,),
        ).fetchone()
    if dialog is None:
        return None
    return {
        "id": dialog["id"],
        "chat_id": dialog["chat_id"],
        "bin": dialog["bin"],
        "started_at": dialog["started_at"],
        "ended_at": dialog["ended_at"],
        "last_message_at": dialog["last_message_at"],
    }


def close_active_chat_dialog(chat_id: int) -> None:
    now = datetime.utcnow().isoformat()
    with _lock, _connection:
        active = _connection.execute(
            """
            SELECT id FROM chat_dialogs
            WHERE chat_id = ? AND ended_at IS NULL
            ORDER BY started_at DESC
            LIMIT 1
            """,
            (chat_id,),
        ).fetchone()
        if active:
            _connection.execute(
                "UPDATE chat_dialogs SET ended_at = ?, last_message_at = COALESCE(last_message_at, ?) WHERE id = ?",
                (now, now, active["id"]),
            )
        _connection.execute(
            "UPDATE chats SET bin = NULL, section = NULL, updated_at = ? WHERE chat_id = ?",
            (now, chat_id),
        )


def list_chats_for_user(
    user_id: int,
    role: str,
    *,
    favorite_only: bool = False,
    bin_query: str | None = None,
) -> List[dict]:
    query_parts = [
        "SELECT",
        "  c.chat_id,",
        "  c.title,",
        "  c.username,",
        "  c.type,",
        "  c.section,",
        "  c.updated_at AS chat_updated_at,",
        "  cd.id AS dialog_id,",
        "  cd.bin AS dialog_bin,",
        "  cd.started_at AS dialog_started_at,",
        "  cd.ended_at AS dialog_ended_at,",
        "  cd.last_message_at AS dialog_last_message_at,",
        "  f.user_id AS fav_user_id",
        "FROM chat_dialogs cd",
        "JOIN chats c ON c.chat_id = cd.chat_id",
        "LEFT JOIN favorites f ON f.dialog_id = cd.id AND f.user_id = ?",
    ]
    params: List[object] = [user_id]
    filters: List[str] = []
    if role != ROLE_ADMIN:
        allowed_sections = get_user_sections(user_id)
        assigned_bins = get_user_bins(user_id)
        if not allowed_sections or not assigned_bins:
            return []
        section_placeholders = ",".join("?" for _ in allowed_sections)
        filters.append(f"c.section IN ({section_placeholders})")
        params.extend(allowed_sections)
        bin_placeholders = ",".join("?" for _ in assigned_bins)
        filters.append(f"cd.bin IN ({bin_placeholders})")
        params.extend(assigned_bins)
    if favorite_only:
        filters.append("f.user_id IS NOT NULL")
    if bin_query:
        filters.append("cd.bin LIKE ?")
        params.append(f"%{bin_query.strip()}%")
    if filters:
        query_parts.append("WHERE " + " AND ".join(filters))
    query_parts.append(
        "ORDER BY COALESCE(cd.last_message_at, c.updated_at, cd.started_at) DESC"
    )
    sql = "\n".join(query_parts)
    with _lock, _connection:
        rows = _connection.execute(sql, params).fetchall()
    chats: List[dict] = []
    for row in rows:
        updated_raw = (
            row["dialog_last_message_at"]
            or row["chat_updated_at"]
            or row["dialog_started_at"]
        )
        if not updated_raw:
            updated_raw = datetime.utcnow().isoformat()
        chats.append(
            {
                "chat_id": row["chat_id"],
                "dialog_id": row["dialog_id"],
                "title": row["title"],
                "username": row["username"],
                "type": row["type"],
                "updated_at": updated_raw,
                "dialog_started_at": row["dialog_started_at"],
                "dialog_closed_at": row["dialog_ended_at"],
                "section": row["section"],
                "bin": row["dialog_bin"],
                "is_favorite": bool(row["fav_user_id"]),
            }
        )
    return chats


def get_messages(
    chat_id: int,
    limit: int = 50,
    allowed_sections: Optional[Iterable[str]] = None,
    *,
    dialog_id: int | None = None,
) -> List[dict]:
    query_parts = [
        "SELECT id, chat_id, direction, text, message_id, author, created_at, section, dialog_id",
        "FROM messages",
        "WHERE chat_id = ?",
    ]
    params: List[object] = [chat_id]
    if dialog_id is not None:
        query_parts.append("AND dialog_id = ?")
        params.append(dialog_id)
    if allowed_sections is not None:
        allowed_list = [section for section in allowed_sections if section]
        if allowed_list:
            placeholders = ",".join("?" for _ in allowed_list)
            query_parts.append(
                f"AND (section IS NULL OR section IN ({placeholders}))"
            )
            params.extend(allowed_list)
        else:
            query_parts.append("AND section IS NULL")
    query_parts.append("ORDER BY created_at DESC")
    query_parts.append("LIMIT ?")
    params.append(limit)
    sql = "\n".join(query_parts)
    with _lock, _connection:
        rows = _connection.execute(sql, params).fetchall()
    messages = []
    for row in rows:
        message = asdict(Message.from_row(row))
        message["created_at"] = message["created_at"].isoformat()
        messages.append(message)
    return list(reversed(messages))


def set_chat_section(chat_id: int, section: str | None) -> None:
    with _lock, _connection:
        _connection.execute(
            "UPDATE chats SET section = ? WHERE chat_id = ?",
            (section, chat_id),
        )


def set_chat_bin(chat_id: int, bin_value: str | None) -> int | None:
    normalized = (bin_value or "").strip()
    now = datetime.utcnow().isoformat()
    with _lock, _connection:
        if not normalized:
            _connection.execute(
                """
                UPDATE chats
                SET bin = NULL, section = NULL, updated_at = ?
                WHERE chat_id = ?
                """,
                (now, chat_id),
            )
            _connection.execute(
                "UPDATE chat_dialogs SET ended_at = COALESCE(ended_at, ?) WHERE chat_id = ? AND ended_at IS NULL",
                (now, chat_id),
            )
            return None

        _connection.execute(
            "UPDATE chat_dialogs SET ended_at = ? WHERE chat_id = ? AND ended_at IS NULL",
            (now, chat_id),
        )
        _connection.execute(
            """
            INSERT INTO chat_dialogs (chat_id, bin, started_at, last_message_at)
            VALUES (?, ?, ?, ?)
            """,
            (chat_id, normalized, now, now),
        )
        dialog_id_row = _connection.execute("SELECT last_insert_rowid()").fetchone()
        _connection.execute(
            """
            UPDATE chats
            SET bin = ?, section = NULL, updated_at = ?
            WHERE chat_id = ?
            """,
            (normalized, now, chat_id),
        )
    return int(dialog_id_row[0]) if dialog_id_row else None


def get_chat(chat_id: int) -> Optional[Dict[str, object]]:
    with _lock, _connection:
        row = _connection.execute(
            """
            SELECT chat_id, title, username, type, updated_at, section, bin
            FROM chats
            WHERE chat_id = ?
            """,
            (chat_id,),
        ).fetchone()
    if row is None:
        return None
    return dict(asdict(Chat.from_row(row)))


def get_user_sections(user_id: int) -> List[str]:
    with _lock, _connection:
        rows = _connection.execute(
            "SELECT section FROM user_sections WHERE user_id = ? ORDER BY section ASC",
            (user_id,),
        ).fetchall()
    return [row["section"] for row in rows]


def set_user_sections(user_id: int, sections: Iterable[str]) -> List[str]:
    normalized = sorted({section.strip() for section in sections if section and section.strip()})
    now = datetime.utcnow().isoformat()
    with _lock, _connection:
        if normalized:
            placeholders = ",".join("?" for _ in normalized)
            _connection.execute(
                f"DELETE FROM user_sections WHERE user_id = ? AND section NOT IN ({placeholders})",
                (user_id, *normalized),
            )
        else:
            _connection.execute("DELETE FROM user_sections WHERE user_id = ?", (user_id,))
        for section in normalized:
            _connection.execute(
                """
                INSERT OR IGNORE INTO user_sections (user_id, section, created_at)
                VALUES (?, ?, ?)
                """,
                (user_id, section, now),
            )
    return get_user_sections(user_id)


def _normalize_expires_at(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, str):
        parsed = _parse_datetime(value)
        if parsed is None:
            return None
        return parsed.isoformat()
    return None


def _normalize_bin_assignment_payload(bins: Iterable[Any]) -> Dict[str, str | None]:
    normalized: Dict[str, str | None] = {}
    for entry in bins:
        bin_value: str | None = None
        expires_at: str | None = None
        if isinstance(entry, str):
            bin_value = entry.strip()
        elif hasattr(entry, "bin"):
            raw_bin = getattr(entry, "bin", None)
            if raw_bin is not None:
                bin_value = str(raw_bin).strip()
            expires_at = _normalize_expires_at(getattr(entry, "expires_at", None))
        elif isinstance(entry, Mapping):
            raw_bin = entry.get("bin") or entry.get("value")
            if raw_bin is not None:
                bin_value = str(raw_bin).strip()
            raw_expires = entry.get("expires_at") or entry.get("expiresAt")
            expires_at = _normalize_expires_at(raw_expires)
        else:
            try:
                raw_bin = getattr(entry, "value")  # type: ignore[attr-defined]
                if raw_bin is not None:
                    bin_value = str(raw_bin).strip()
            except AttributeError:
                continue
        if not bin_value:
            continue
        normalized[bin_value] = expires_at
    return normalized


def _get_sections_for_bin(bin_value: str) -> Set[str]:
    normalized = (bin_value or "").strip()
    if not normalized:
        return set()
    with _lock, _connection:
        rows = _connection.execute(
           """
            SELECT DISTINCT COALESCE(c.section, '') AS section
            FROM chat_dialogs cd
            LEFT JOIN chats c ON c.chat_id = cd.chat_id
            WHERE cd.bin = ?
              AND cd.ended_at IS NULL
              AND c.section IS NOT NULL
              AND TRIM(c.section) != ''
            """,
            (normalized,),
        ).fetchall()
    return {row["section"] for row in rows if row["section"]}


def refresh_bin_assignments(now: datetime | None = None) -> None:
    current_time = now or datetime.utcnow()
    now_iso = current_time.isoformat()
    expired_pairs: List[Tuple[int, str]] = []
    with _lock, _connection:
        rows = _connection.execute(
            """
            SELECT user_id, bin
            FROM user_bins
            WHERE expires_at IS NOT NULL
              AND TRIM(expires_at) != ''
              AND expires_at <= ?
            """,
            (now_iso,),
        ).fetchall()
        for row in rows:
            user_id = int(row["user_id"])
            bin_value = row["bin"]
            expired_pairs.append((user_id, bin_value))
            _connection.execute(
                "DELETE FROM user_bins WHERE user_id = ? AND bin = ?",
                (user_id, bin_value),
            )

    if not expired_pairs:
        return

    # Переназначаем освободившиеся БИНы вне блокировки, чтобы избежать дедлоков
    unique_bins = sorted({bin_value for _, bin_value in expired_pairs if bin_value})
    for bin_value in unique_bins:
        _assign_bin_to_next_available(bin_value, current_time)


def _assign_bin_to_next_available(bin_value: str, now: datetime) -> None:
    candidate = _find_bin_candidate(bin_value, now)
    if candidate is None:
        return
    now_iso = now.isoformat()
    with _lock, _connection:
        _connection.execute(
            """
            INSERT INTO user_bins (user_id, bin, created_at, expires_at, assigned_by)
            VALUES (?, ?, ?, NULL, NULL)
            ON CONFLICT(user_id, bin) DO UPDATE SET
                expires_at = excluded.expires_at,
                assigned_by = excluded.assigned_by,
                created_at = excluded.created_at
            """,
            (candidate, bin_value, now_iso),
        )
    _create_notification(
        candidate,
        "bin_assigned",
        {"bin": bin_value, "assigned_by": None},
        created_at=now_iso,
    )


def _find_bin_candidate(bin_value: str, now: datetime) -> int | None:
    normalized = (bin_value or "").strip()
    if not normalized:
        return None
    required_sections = _get_sections_for_bin(normalized)
    now_iso = now.isoformat()
    with _lock, _connection:
        candidate_rows = _connection.execute(
            """
            SELECT
                u.id AS user_id,
                SUM(
                    CASE
                        WHEN ub.expires_at IS NULL OR ub.expires_at > ? THEN 1
                        ELSE 0
                    END
                ) AS active_bins
            FROM users u
            LEFT JOIN user_bins ub ON ub.user_id = u.id
            WHERE u.role IN (?, ?)
            GROUP BY u.id
            ORDER BY active_bins ASC, u.id ASC
            """,
            (now_iso, ROLE_ADMIN, ROLE_MODERATOR),
        ).fetchall()
        section_rows = _connection.execute(
            "SELECT user_id, section FROM user_sections",
        ).fetchall()
        active_assignments = _connection.execute(
            """
            SELECT user_id, bin
            FROM user_bins
            WHERE expires_at IS NULL OR expires_at > ?
            """,
            (now_iso,),
        ).fetchall()

    sections_by_user: Dict[int, Set[str]] = {}
    for row in section_rows:
        section_value = (row["section"] or "").strip()
        if not section_value:
            continue
        sections_by_user.setdefault(int(row["user_id"]), set()).add(section_value)

    active_bins_by_user: Dict[int, Set[str]] = {}
    for row in active_assignments:
        user_id = int(row["user_id"])
        bin_label = row["bin"]
        if not bin_label:
            continue
        active_bins_by_user.setdefault(user_id, set()).add(bin_label)

    best_user: int | None = None
    best_load: int | None = None
    for row in candidate_rows:
        user_id = int(row["user_id"])
        assigned_bins = active_bins_by_user.get(user_id, set())
        if normalized in assigned_bins:
            continue
        if required_sections and not (required_sections & sections_by_user.get(user_id, set())):
            continue
        load = len(assigned_bins)
        if best_user is None or load < best_load or (load == best_load and user_id < best_user):
            best_user = user_id
            best_load = load
    return best_user


def get_user_bin_assignments(user_id: int, *, include_expired: bool = False) -> List[Dict[str, object]]:
    refresh_bin_assignments()
    reference = datetime.utcnow().isoformat()
    query_parts = [
        "SELECT bin, created_at, expires_at, assigned_by",
        "FROM user_bins",
        "WHERE user_id = ?",
    ]
    params: List[object] = [user_id]
    if not include_expired:
        query_parts.append("AND (expires_at IS NULL OR expires_at > ?)")
        params.append(reference)
    query_parts.append("ORDER BY bin ASC")
    sql = "\n".join(query_parts)
    with _lock, _connection:
        rows = _connection.execute(sql, params).fetchall()
    assignments: List[Dict[str, object]] = []
    for row in rows:
        assignments.append(
            {
                "bin": row["bin"],
                "assigned_at": row["created_at"],
                "expires_at": row["expires_at"],
                "assigned_by": row["assigned_by"],
            }
        )
    return assignments


def get_user_bins(user_id: int) -> List[str]:
    return [assignment["bin"] for assignment in get_user_bin_assignments(user_id)]


def set_user_bins(
    user_id: int,
    bins: Iterable[Any],
    *,
    assigned_by: int | None = None,
) -> List[Dict[str, object]]:
    normalized = _normalize_bin_assignment_payload(bins)
    now = datetime.utcnow()
    now_iso = now.isoformat()
    with _lock, _connection:
        existing_rows = _connection.execute(
            "SELECT bin FROM user_bins WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        current_bins = {row["bin"] for row in existing_rows}
        new_bins = set(normalized.keys())
        if new_bins:
            placeholders = ",".join("?" for _ in new_bins)
            _connection.execute(
                f"DELETE FROM user_bins WHERE user_id = ? AND bin NOT IN ({placeholders})",
                (user_id, *new_bins),
            )
        else:
            _connection.execute("DELETE FROM user_bins WHERE user_id = ?", (user_id,))
        
        added_bins = sorted(new_bins - current_bins)
        for bin_value in new_bins:
            expires_at = normalized[bin_value]
            if bin_value in current_bins:
                _connection.execute(
                    """
                    UPDATE user_bins
                    SET expires_at = ?,
                        assigned_by = CASE WHEN ? IS NOT NULL THEN ? ELSE assigned_by END
                    WHERE user_id = ? AND bin = ?
                    """,
                    (expires_at, assigned_by, assigned_by, user_id, bin_value),
                )
            else:
                _connection.execute(
                    """
                    INSERT INTO user_bins (user_id, bin, created_at, expires_at, assigned_by)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (user_id, bin_value, now_iso, expires_at, assigned_by),
                )

    for bin_value in added_bins:
        _create_notification(
            user_id,
            "bin_assigned",
            {"bin": bin_value, "assigned_by": assigned_by},
            created_at=now_iso,
        )
    
    refresh_bin_assignments()
    return get_user_bin_assignments(user_id)


def delete_user(user_id: int) -> None:
    with _lock, _connection:
        cursor = _connection.execute("DELETE FROM users WHERE id = ?", (user_id,))
        if cursor.rowcount == 0:
            raise ValueError("Пользователь не найден")


def list_favorite_dialog_ids(user_id: int) -> List[int]:
    with _lock, _connection:
        rows = _connection.execute(
            "SELECT dialog_id FROM favorites WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    return [int(row["dialog_id"]) for row in rows]


def set_favorite_dialog(user_id: int, dialog_id: int, favorite: bool) -> None:
    with _lock, _connection:
        dialog = _connection.execute(
            "SELECT id FROM chat_dialogs WHERE id = ?",
            (dialog_id,),
        ).fetchone()
        if dialog is None:
            raise ValueError("Диалог не найден")
        if favorite:
            now = datetime.utcnow().isoformat()
            _connection.execute(
                """
                INSERT OR REPLACE INTO favorites (user_id, dialog_id, created_at)
                VALUES (?, ?, ?)
                """,
                (user_id, dialog_id, now),
            )
        else:
            _connection.execute(
                "DELETE FROM favorites WHERE user_id = ? AND dialog_id = ?",
                (user_id, dialog_id),
            )


def is_favorite_dialog(user_id: int, dialog_id: int) -> bool:
    with _lock, _connection:
        row = _connection.execute(
            "SELECT 1 FROM favorites WHERE user_id = ? AND dialog_id = ?",
            (user_id, dialog_id),
        ).fetchone()
    return row is not None


def list_bins(query: str | None = None) -> List[str]:
    refresh_bin_assignments()
    clauses = [
        "SELECT DISTINCT bin FROM chat_dialogs WHERE bin IS NOT NULL AND TRIM(bin) != ''"
    ]
    params: List[object] = []
    if query:
        clauses.append("AND bin LIKE ?")
        params.append(f"%{query.strip()}%")
    clauses.append("ORDER BY bin ASC")
    sql = "\n".join(clauses)
    with _lock, _connection:
        rows = _connection.execute(sql, params).fetchall()
    return [row["bin"] for row in rows]


def list_unanswered_bins() -> List[Dict[str, object]]:
    refresh_bin_assignments()
    with _lock, _connection:
        rows = _connection.execute(
            """
            WITH last_messages AS (
                SELECT
                    m.dialog_id,
                    MAX(m.created_at) AS last_created_at
                FROM messages m
                WHERE m.dialog_id IS NOT NULL
                GROUP BY m.dialog_id
            )
            SELECT
                cd.bin AS bin,
                COUNT(*) AS pending_dialogs
            FROM chat_dialogs cd
            JOIN last_messages lm ON lm.dialog_id = cd.id
            JOIN messages m ON m.dialog_id = lm.dialog_id AND m.created_at = lm.last_created_at
            WHERE cd.ended_at IS NULL
              AND cd.bin IS NOT NULL
              AND TRIM(cd.bin) != ''
              AND m.direction = 'incoming'
            GROUP BY cd.bin
            ORDER BY pending_dialogs DESC, cd.bin ASC
            """
        ).fetchall()
    return [
        {
            "bin": row["bin"],
            "pending_dialogs": int(row["pending_dialogs"] or 0),
        }
        for row in rows
        if row["bin"]
    ]


def _create_notification(
    user_id: int,
    kind: str,
    payload: Dict[str, object],
    *,
    created_at: str | None = None,
) -> None:
    timestamp = created_at or datetime.utcnow().isoformat()
    serialized = json.dumps(payload, ensure_ascii=False)
    with _lock, _connection:
        _connection.execute(
            """
            INSERT INTO notifications (user_id, kind, payload, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (user_id, kind, serialized, timestamp),
        )


def list_notifications_since(user_id: int, since: Optional[datetime] = None) -> List[dict]:
    query = [
        "SELECT id, kind, payload, created_at",
        "FROM notifications",
        "WHERE user_id = ?",
    ]
    params: List[object] = [user_id]
    if since is not None:
        query.append("AND created_at > ?")
        params.append(since.isoformat())
    query.append("ORDER BY created_at ASC, id ASC")
    sql = "\n".join(query)
    with _lock, _connection:
        rows = _connection.execute(sql, params).fetchall()
    notifications: List[dict] = []
    for row in rows:
        created_at = datetime.fromisoformat(row["created_at"])
        try:
            payload = json.loads(row["payload"])
        except json.JSONDecodeError:
            payload = {"raw": row["payload"]}
        notifications.append(
            {
                "id": row["id"],
                "kind": row["kind"],
                "payload": payload,
                "created_at": created_at,
            }
        )
    return notifications


def delete_chat(chat_id: int) -> None:
    with _lock, _connection:
        existing = _connection.execute(
            "SELECT chat_id FROM chats WHERE chat_id = ?",
            (chat_id,),
        ).fetchone()
        if existing is None:
            raise ValueError("Chat not found")
        _connection.execute("DELETE FROM messages WHERE chat_id = ?", (chat_id,))
        dialog_rows = _connection.execute(
            "SELECT id FROM chat_dialogs WHERE chat_id = ?",
            (chat_id,),
        ).fetchall()
        dialog_ids = [row["id"] for row in dialog_rows]
        if dialog_ids:
            placeholders = ",".join("?" for _ in dialog_ids)
            _connection.execute(
                f"DELETE FROM favorites WHERE dialog_id IN ({placeholders})",
                dialog_ids,
            )
        _connection.execute("DELETE FROM chat_dialogs WHERE chat_id = ?", (chat_id,))
        _connection.execute("DELETE FROM chats WHERE chat_id = ?", (chat_id,))


def delete_chat_dialog(dialog_id: int) -> None:
    with _lock, _connection:
        dialog_row = _connection.execute(
            "SELECT id, chat_id FROM chat_dialogs WHERE id = ?",
            (dialog_id,),
        ).fetchone()
        if dialog_row is None:
            raise ValueError("Диалог не найден")
        chat_id = dialog_row["chat_id"]
        _connection.execute("DELETE FROM messages WHERE dialog_id = ?", (dialog_id,))
        _connection.execute(
            "DELETE FROM favorites WHERE dialog_id = ?",
            (dialog_id,),
        )
        _connection.execute("DELETE FROM chat_dialogs WHERE id = ?", (dialog_id,))
        latest = _connection.execute(
            """
            SELECT id, bin, started_at, last_message_at
            FROM chat_dialogs
            WHERE chat_id = ?
            ORDER BY started_at DESC
            LIMIT 1
            """,
            (chat_id,),
        ).fetchone()
        if latest:
            timestamp = latest["last_message_at"] or latest["started_at"] or datetime.utcnow().isoformat()
            section_row = _connection.execute(
                """
                SELECT section
                FROM messages
                WHERE dialog_id = ? AND section IS NOT NULL
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (latest["id"],),
            ).fetchone()
            section_value = section_row["section"] if section_row else None
            _connection.execute(
                "UPDATE chats SET bin = ?, section = ?, updated_at = ? WHERE chat_id = ?",
                (latest["bin"], section_value, timestamp, chat_id),
            )
        else:
            _connection.execute(
                "UPDATE chats SET bin = NULL, section = NULL WHERE chat_id = ?",
                (chat_id,),
            )


def _row_to_user(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return {
        "id": row["id"],
        "email": row["email"],
        "name": row["name"],
        "password_hash": row["password_hash"],
        "created_at": row["created_at"],
        "job_title": row["job_title"] or "",
        "phone": row["phone"] or "",
        "bio": row["bio"] or "",
        "login": row["login"],
        "role": row["role"],
    }


def _sanitize_user_payload(user: dict | None, *, include_sections: bool = True) -> dict:
    if user is None:
        raise ValueError("User not found")
    sanitized = {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "created_at": user["created_at"],
        "job_title": user.get("job_title", ""),
        "phone": user.get("phone", ""),
        "bio": user.get("bio", ""),
        "login": user.get("login", ""),
        "role": user.get("role", ROLE_VIEWER),
    }
    if include_sections:
        sanitized["sections"] = get_user_sections(user["id"])
    else:
        sanitized["sections"] = []
    sanitized["bins"] = get_user_bin_assignments(user["id"])
    return sanitized


def create_user(
    email: str,
    name: str,
    password_hash: str,
    *,
    job_title: str | None = None,
    phone: str | None = None,
    bio: str | None = None,
    login: str | None = None,
    role: str = ROLE_VIEWER,
) -> dict:
    if role not in ALL_ROLES:
        raise ValueError("Invalid role")
    login_value = (login or email).strip()
    existing_login = find_user_by_login(login_value)
    if existing_login:
        raise ValueError("Login already exists")
    now = datetime.utcnow().isoformat()
    with _lock, _connection:
        cursor = _connection.execute(
            """
            INSERT INTO users (email, name, password_hash, created_at, job_title, phone, bio, login, role)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                email,
                name,
                password_hash,
                now,
                job_title or "",
                phone or "",
                bio or "",
                login_value,
                role,
            ),
        )
        user_id = cursor.lastrowid
    return _sanitize_user_payload(
        {
            "id": user_id,
            "email": email,
            "name": name,
            "created_at": now,
            "job_title": job_title or "",
            "phone": phone or "",
            "bio": bio or "",
            "login": login_value,
            "role": role,
        },
        include_sections=False,
    )


def find_user_by_email(email: str) -> Optional[dict]:
    return _fetch_user("email = ?", email)


def find_user_by_login(login: str) -> Optional[dict]:
    return _fetch_user("login = ?", login)


def find_user_by_identifier(identifier: str) -> Optional[dict]:
    normalized = identifier.strip()
    user = find_user_by_login(normalized)
    if user:
        return user
    return find_user_by_email(normalized)


def get_user_by_id(user_id: int) -> Optional[dict]:
    return _fetch_user("id = ?", user_id)


def verify_user_password(user_id: int, password_hash: str) -> bool:
    with _lock, _connection:
        row = _connection.execute(
            "SELECT password_hash FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    if row is None:
        raise ValueError("User not found")
    return row["password_hash"] == password_hash


def delete_sessions_for_user(user_id: int) -> None:
    with _lock, _connection:
        _connection.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))


def update_user_password(user_id: int, password_hash: str) -> dict:
    with _lock, _connection:
        cursor = _connection.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (password_hash, user_id),
        )
        if cursor.rowcount == 0:
            raise ValueError("User not found")
        _connection.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    return _sanitize_user_payload(get_user_by_id(user_id))


def create_session(user_id: int) -> str:
    token = uuid4().hex
    now = datetime.utcnow().isoformat()
    with _lock, _connection:
        _connection.execute(
            "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
            (token, user_id, now),
        )
    return token


def get_user_by_session(token: str) -> Optional[dict]:
    with _lock, _connection:
        row = _connection.execute(
            f"SELECT {_user_columns('u')} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?",
            (token,),
        ).fetchone()
    return _row_to_user(row)


def update_user_profile(
    user_id: int,
    *,
    name: str,
    job_title: str,
    phone: str,
    bio: str,
    email: str | None,
) -> dict:
    with _lock, _connection:
        try:
            _connection.execute(
                """
                UPDATE users
                SET name = ?, job_title = ?, phone = ?, bio = ?, email = ?
                WHERE id = ?
                """,
                (name, job_title, phone, bio, email or "", user_id),
            )
        except sqlite3.IntegrityError as exc:
            raise ValueError("Адрес электронной почты уже используется") from exc
    return _sanitize_user_payload(get_user_by_id(user_id))


def list_users(query: str | None = None) -> List[dict]:
    filters: List[str] = []
    params: List[object] = []
    if query:
        normalized = f"%{query.strip().lower()}%"
        filters.append(
            "(LOWER(email) LIKE ? OR LOWER(login) LIKE ? OR LOWER(name) LIKE ?)"
        )
        params.extend([normalized, normalized, normalized])
    with _lock, _connection:
        sql = [f"SELECT {_user_columns('u')}", "FROM users u"]
        if filters:
            sql.append("WHERE " + " AND ".join(filters))
        sql.append("ORDER BY u.created_at ASC")
        rows = _connection.execute("\n".join(sql), params).fetchall()
    return [
        _sanitize_user_payload(_row_to_user(row))  # type: ignore[arg-type]
        for row in rows
    ]


def update_user_role(user_id: int, role: str) -> dict:
    if role not in ALL_ROLES:
        raise ValueError("Invalid role")
    with _lock, _connection:
        _connection.execute(
            "UPDATE users SET role = ? WHERE id = ?",
            (role, user_id),
        )
    return _sanitize_user_payload(get_user_by_id(user_id))


SECTIONS: List[dict] = [
    {"id": "general", "title": "Общие вопросы"},
    {"id": "finance", "title": "Финансы"},
    {"id": "support", "title": "Техническая поддержка"},
    {"id": "hr", "title": "HR и кадры"},
]


def get_section_by_title(title: str) -> Optional[dict]:
    normalized = title.strip().lower()
    for section in SECTIONS:
        if section["title"].lower() == normalized:
            return section
    return None


FAQ_ENTRIES: List[dict] = [
    {
        "section": "general",
        "question": "Как получить доступ к консультациям по 1С?",
        "answer": "Отправьте нам номер договора или БИН, и консультант откроет доступ к чату и вебинарам по 1С.",
        "keywords": ["доступ", "1с", "консультац"],
    },
    {
        "section": "general",
        "question": "Сколько стоит сопровождение?",
        "answer": "Базовый тариф включает 10 консультаций в месяц. Расширенные пакеты уточните у оператора.",
        "keywords": ["стоим", "тариф", "цен"],
    },
    {
        "section": "finance",
        "question": "Как выгрузить отчёт по НДС в 1С?",
        "answer": "Откройте раздел 'Отчётность', выберите период и используйте отчёт 'Декларация по НДС'.",
        "keywords": ["ндс", "отчет", "выгруз"],
    },
    {
        "section": "finance",
        "question": "Как исправить ошибку при проведении платежа?",
        "answer": "Проверьте реквизиты платежа и перепроведите документ. Если ошибка сохраняется — напишите оператору.",
        "keywords": ["ошиб", "платеж", "проведен"],
    },
    {
        "section": "support",
        "question": "1С не запускается после обновления",
        "answer": "Перезагрузите рабочую станцию и убедитесь, что агент обновления завершил работу. При повторной ошибке свяжитесь с оператором.",
        "keywords": ["не запуска", "обновлен", "ошибка", "support"],
    },
    {
        "section": "support",
        "question": "Как подключить удалённого бухгалтера?",
        "answer": "Добавьте его в группу доступа и отправьте приглашение из раздела 'Сотрудники'.",
        "keywords": ["удален", "бухгалтер", "подключ"],
    },
    {
        "section": "hr",
        "question": "Как выгрузить форму Т-2?",
        "answer": "Перейдите в 'Кадровый учёт' → 'Сотрудники' → 'Карточка сотрудника' и нажмите 'Печать формы Т-2'.",
        "keywords": ["т-2", "форма", "кадров"],
    },
    {
        "section": "hr",
        "question": "Как оформить отпуск сотруднику?",
        "answer": "Создайте документ 'Отпуск' в разделе 'Кадровый учёт', укажите даты и вид отпуска, затем проведите документ.",
        "keywords": ["отпуск", "оформ"],
    },
]


def list_faq(section: str | None = None) -> List[dict]:
    if section:
        return [entry for entry in FAQ_ENTRIES if entry["section"] == section]
    return list(FAQ_ENTRIES)


def get_dashboard_summary(
    *, days: int = 7, questions_limit: int = 5, operator_id: int | None = None
) -> dict:
    now = datetime.utcnow()
    span = max(days, 1)
    start_date = now.date() - timedelta(days=span - 1)
    start_iso = start_date.isoformat()

    response_deltas: List[float] = []

    assigned_bins: List[str] | None = None
    if operator_id is not None:
        assigned_bins = get_user_bins(operator_id)

    def _empty_summary() -> dict:
        recent_activity = [
            {
                "date": (start_date + timedelta(days=offset)).isoformat(),
                "dialogs": 0,
                "incoming_messages": 0,
            }
            for offset in range(span)
        ]
        return {
            "total_dialogs": 0,
            "open_dialogs": 0,
            "closed_dialogs": 0,
            "total_chats": 0,
            "total_messages": 0,
            "total_incoming_messages": 0,
            "total_outgoing_messages": 0,
            "average_messages_per_dialog": 0.0,
            "avg_dialog_duration_minutes": None,
            "avg_response_time_minutes": None,
            "avg_response_time_seconds": None,
            "section_breakdown": [],
            "top_questions": [],
            "questions_by_section": [],
            "agent_breakdown": [],
            "recent_activity": recent_activity,
            "updated_at": now.isoformat(),
        }

    if assigned_bins is not None and not assigned_bins:
        return _empty_summary()

    placeholders = ", ".join("?" for _ in assigned_bins) if assigned_bins is not None else ""

    with _lock, _connection:
        total_dialogs = _connection.execute(
            "SELECT COUNT(*) AS total FROM chat_dialogs"
            + (
                f" WHERE bin IN ({placeholders})"
                if assigned_bins is not None
                else ""
            ),
            tuple(assigned_bins or []),
        ).fetchone()["total"] or 0
        open_dialogs = _connection.execute(
            "SELECT COUNT(*) AS total FROM chat_dialogs WHERE ended_at IS NULL"
            + (
                f" AND bin IN ({placeholders})"
                if assigned_bins is not None
                else ""
            ),
            tuple(assigned_bins or []),
        ).fetchone()["total"] or 0
        total_incoming = _connection.execute(
            """
            SELECT COUNT(*) AS total
            FROM messages m
            LEFT JOIN chat_dialogs cd ON cd.id = m.dialog_id
            LEFT JOIN chats c ON c.chat_id = m.chat_id
            WHERE m.direction = 'incoming'
        """
            + (
                f" AND COALESCE(cd.bin, c.bin) IN ({placeholders})"
                if assigned_bins is not None
                else ""
            ),
            tuple(assigned_bins or []),
        ).fetchone()["total"] or 0
        total_outgoing = _connection.execute(
            """
            SELECT COUNT(*) AS total
            FROM messages m
            LEFT JOIN chat_dialogs cd ON cd.id = m.dialog_id
            LEFT JOIN chats c ON c.chat_id = m.chat_id
            WHERE m.direction = 'outgoing'
        """
            + (
                f" AND COALESCE(cd.bin, c.bin) IN ({placeholders})"
                if assigned_bins is not None
                else ""
            ),
            tuple(assigned_bins or []),
        ).fetchone()["total"] or 0
        total_messages = total_incoming + total_outgoing
        total_chats = _connection.execute(
            "SELECT COUNT(DISTINCT chat_id) AS total FROM chat_dialogs"
            + (
                f" WHERE bin IN ({placeholders})"
                if assigned_bins is not None
                else ""
            ),
            tuple(assigned_bins or []),
        ).fetchone()["total"] or 0
        section_rows = _connection.execute(
            """
            SELECT COALESCE(c.section, '') AS section_id, COUNT(*) AS dialog_count
            FROM chat_dialogs cd
            LEFT JOIN chats c ON c.chat_id = cd.chat_id
        """
            + (
                f" WHERE cd.bin IN ({placeholders})"
                if assigned_bins is not None
                else ""
            )
            + """
            GROUP BY COALESCE(c.section, '')
            ORDER BY dialog_count DESC
            """,
            tuple(assigned_bins or []),
        ).fetchall()
        duration_rows = _connection.execute(
            "SELECT started_at, ended_at FROM chat_dialogs"
            " WHERE started_at IS NOT NULL AND ended_at IS NOT NULL"
            + (
                f" AND bin IN ({placeholders})"
                if assigned_bins is not None
                else ""
            ),
            tuple(assigned_bins or []),
        ).fetchall()
        dialogs_by_day_rows = _connection.execute(
            """
            SELECT substr(started_at, 1, 10) AS day, COUNT(*) AS cnt
            FROM chat_dialogs
            WHERE started_at IS NOT NULL AND started_at >= ?
        """
            + (
                f" AND bin IN ({placeholders})"
                if assigned_bins is not None
                else ""
            )
            + """
            GROUP BY substr(started_at, 1, 10)
            ORDER BY day ASC
            """,
            (start_iso, * (assigned_bins or [])),
        ).fetchall()
        incoming_by_day_rows = _connection.execute(
            """
            SELECT substr(m.created_at, 1, 10) AS day, COUNT(*) AS cnt
            FROM messages m
            LEFT JOIN chat_dialogs cd ON cd.id = m.dialog_id
            LEFT JOIN chats c ON c.chat_id = m.chat_id
            WHERE m.created_at >= ? AND m.direction = 'incoming'
        """
            + (
                f" AND COALESCE(cd.bin, c.bin) IN ({placeholders})"
                if assigned_bins is not None
                else ""
            )
            + """
            GROUP BY substr(m.created_at, 1, 10)
            ORDER BY day ASC
            """,
            (start_iso, * (assigned_bins or [])),
        ).fetchall()
        question_rows = _connection.execute(
            """
           SELECT m.text, m.created_at, m.section
            FROM messages m
            LEFT JOIN chat_dialogs cd ON cd.id = m.dialog_id
            LEFT JOIN chats c ON c.chat_id = m.chat_id
            WHERE m.direction = 'incoming' AND m.text IS NOT NULL AND TRIM(m.text) != ''
        """
            + (
                f" AND COALESCE(cd.bin, c.bin) IN ({placeholders})"
                if assigned_bins is not None
                else ""
            ),
            tuple(assigned_bins or []),
        ).fetchall()
        agent_rows = _connection.execute(
            """
            SELECT
                TRIM(COALESCE(m.author, '')) AS author,
                COUNT(*) AS message_count,
                COUNT(DISTINCT m.dialog_id) AS dialog_count,
                MAX(m.created_at) AS last_activity
            FROM messages m
            LEFT JOIN chat_dialogs cd ON cd.id = m.dialog_id
            LEFT JOIN chats c ON c.chat_id = m.chat_id
            WHERE m.direction = 'outgoing' AND m.author IS NOT NULL AND TRIM(m.author) != ''
        """
            + (
                f" AND COALESCE(cd.bin, c.bin) IN ({placeholders})"
                if assigned_bins is not None
                else ""
            )
            + """
            GROUP BY TRIM(COALESCE(m.author, ''))
            ORDER BY message_count DESC
            """
        ,
            tuple(assigned_bins or []),
        ).fetchall()

        operator_request_rows = _connection.execute(
            """
            SELECT m.id, m.chat_id, m.dialog_id, m.created_at
            FROM messages m
            LEFT JOIN chat_dialogs cd ON cd.id = m.dialog_id
            LEFT JOIN chats c ON c.chat_id = m.chat_id
            WHERE m.direction = 'incoming'
              AND m.text IN ('[ЗАПРОС ОПЕРАТОРА]', '[FAQ] Связаться с оператором')
        """
            + (
                f" AND COALESCE(cd.bin, c.bin) IN ({placeholders})"
                if assigned_bins is not None
                else ""
            )
            + """
            ORDER BY m.created_at ASC
            """
        ,
            tuple(assigned_bins or []),
        ).fetchall()

        if operator_request_rows:
            automation_author_placeholders = ", ".join("?" for _ in AUTOMATION_AUTHOR_NAMES)
            automation_clause = (
                f"AND TRIM(author) NOT IN ({automation_author_placeholders})"
                if AUTOMATION_AUTHOR_NAMES
                else ""
            )

            for request_row in operator_request_rows:
                request_created_raw = request_row["created_at"]
                request_at = _parse_datetime(request_created_raw)
                if request_at is None:
                    continue

                query_parts = [
                    "SELECT m.created_at, m.author",
                    "FROM messages m",
                    "LEFT JOIN chat_dialogs cd ON cd.id = m.dialog_id",
                    "LEFT JOIN chats c ON c.chat_id = m.chat_id",
                    "WHERE m.direction = 'outgoing'",
                    "  AND m.chat_id = ?",
                    "  AND m.created_at > ?",
                    "  AND m.author IS NOT NULL",
                    "  AND TRIM(m.author) != ''",
                ]
                params: List[object] = [request_row["chat_id"], request_created_raw]
                dialog_id = request_row["dialog_id"]
                if dialog_id is not None:
                    query_parts.append("  AND m.dialog_id = ?")
                    params.append(dialog_id)
                if automation_clause:
                    query_parts.append(f"  {automation_clause.replace('author', 'm.author')}")
                    params.extend(AUTOMATION_AUTHOR_NAMES)
                if assigned_bins is not None:
                    query_parts.append(
                        f"  AND COALESCE(cd.bin, c.bin) IN ({placeholders})"
                    )
                    params.extend(assigned_bins)
                query_parts.append("ORDER BY created_at ASC LIMIT 1")
                sql = "\n".join(query_parts)
                candidate = _connection.execute(sql, params).fetchone()
                if candidate is None:
                    continue
                reply_at = _parse_datetime(candidate["created_at"])
                if reply_at is None or reply_at <= request_at:
                    continue
                response_deltas.append((reply_at - request_at).total_seconds())

    closed_dialogs = max(total_dialogs - open_dialogs, 0)
    average_messages_per_dialog = (
        total_messages / total_dialogs if total_dialogs else 0.0
    )

    if response_deltas:
        avg_response_time_seconds = sum(response_deltas) / len(response_deltas)
        avg_response_time_minutes: Optional[float] = avg_response_time_seconds / 60.0
    else:
        avg_response_time_seconds = None
        avg_response_time_minutes = None

    durations: List[float] = []
    for row in duration_rows:
        started_at = _parse_datetime(row["started_at"])
        ended_at = _parse_datetime(row["ended_at"])
        if started_at and ended_at and ended_at > started_at:
            durations.append((ended_at - started_at).total_seconds())
    avg_dialog_duration_minutes: Optional[float]
    if durations:
        avg_dialog_duration_minutes = sum(durations) / len(durations) / 60.0
    else:
        avg_dialog_duration_minutes = None

    section_map = {section["id"]: section["title"] for section in SECTIONS}
    section_breakdown: List[dict] = []
    for row in section_rows:
        section_id = row["section_id"] or None
        dialogs = row["dialog_count"] or 0
        if not dialogs:
            continue
        title = section_map.get(section_id or "", section_id or "Без раздела")
        percentage = (dialogs / total_dialogs * 100.0) if total_dialogs else 0.0
        section_breakdown.append(
            {
                "section": section_id,
                "title": title,
                "dialogs": dialogs,
                "percentage": percentage,
            }
        )

    dialogs_by_day = {row["day"]: row["cnt"] for row in dialogs_by_day_rows}
    incoming_by_day = {row["day"]: row["cnt"] for row in incoming_by_day_rows}
    recent_activity: List[dict] = []
    for offset in range(span):
        day = start_date + timedelta(days=offset)
        day_key = day.isoformat()
        recent_activity.append(
            {
                "date": day_key,
                "dialogs": int(dialogs_by_day.get(day_key, 0)),
                "incoming_messages": int(incoming_by_day.get(day_key, 0)),
            }
        )

    question_stats: Dict[str, dict] = {}
    section_question_stats: Dict[Optional[str], Dict[str, dict]] = {}
    for row in question_rows:
        text = (row["text"] or "").strip()
        if not text:
            continue
        normalized = text.lower()
        seen_at = _parse_datetime(row["created_at"])
        entry = question_stats.get(normalized)
        if entry is None:
            entry = {"question": text, "count": 0, "last_seen": seen_at}
            question_stats[normalized] = entry
        entry["count"] += 1
        if seen_at and (entry["last_seen"] is None or seen_at > entry["last_seen"]):
            entry["last_seen"] = seen_at
        if len(text) < len(entry["question"]):
            entry["question"] = text

        section_id = (row["section"] or "").strip() or None
        section_bucket = section_question_stats.setdefault(section_id, {})
        section_entry = section_bucket.get(normalized)
        if section_entry is None:
            section_entry = {"question": text, "count": 0, "last_seen": seen_at}
            section_bucket[normalized] = section_entry
        section_entry["count"] += 1
        if seen_at and (section_entry["last_seen"] is None or seen_at > section_entry["last_seen"]):
            section_entry["last_seen"] = seen_at
        if len(text) < len(section_entry["question"]):
            section_entry["question"] = text

    sorted_questions = sorted(
        question_stats.values(),
        key=lambda item: (-item["count"], item["last_seen"] or datetime.min),
    )
    top_questions = [
        {"question": item["question"], "count": int(item["count"])}
        for item in sorted_questions[: max(questions_limit, 0)]
    ]

    questions_by_section: List[dict] = []
    for section_id, bucket in section_question_stats.items():
        if not bucket:
            continue
        questions_sorted = sorted(
            bucket.values(),
            key=lambda item: (-item["count"], item["last_seen"] or datetime.min),
        )
        questions_by_section.append(
            {
                "section": section_id,
                "title": section_map.get(section_id or "", section_id or "Без раздела"),
                "questions": [
                    {"question": item["question"], "count": int(item["count"])}
                    for item in questions_sorted[: max(questions_limit, 0)]
                ],
            }
        )

    agent_breakdown: List[dict] = []
    for row in agent_rows:
        name = row["author"] or "Без имени"
        messages_sent = int(row["message_count"] or 0)
        dialogs_handled = int(row["dialog_count"] or 0)
        last_activity = _parse_datetime(row["last_activity"])
        avg_messages = (
            messages_sent / dialogs_handled if dialogs_handled else 0.0
        )
        agent_breakdown.append(
            {
                "name": name,
                "messages": messages_sent,
                "dialogs": dialogs_handled,
                "avg_messages_per_dialog": avg_messages,
                "last_activity": last_activity.isoformat() if last_activity else None,
            }
        )

    return {
        "total_dialogs": int(total_dialogs),
        "open_dialogs": int(open_dialogs),
        "closed_dialogs": int(closed_dialogs),
        "total_chats": int(total_chats),
        "total_messages": int(total_messages),
        "total_incoming_messages": int(total_incoming),
        "total_outgoing_messages": int(total_outgoing),
        "average_messages_per_dialog": average_messages_per_dialog,
        "avg_dialog_duration_minutes": avg_dialog_duration_minutes,
        "avg_response_time_minutes": avg_response_time_minutes,
        "avg_response_time_seconds": avg_response_time_seconds,
        "section_breakdown": section_breakdown,
        "top_questions": top_questions,
        "questions_by_section": questions_by_section,
        "agent_breakdown": agent_breakdown,
        "recent_activity": recent_activity,
        "updated_at": now.isoformat(),
    }


def user_can_access_chat(
    user_id: int,
    role: str,
    chat_id: int,
    dialog_id: int | None = None,
) -> bool:
    if role == ROLE_ADMIN:
        return True
    dialog_bin = None
    if dialog_id is not None:
        dialog = get_chat_dialog(dialog_id)
        if dialog is None or dialog["chat_id"] != chat_id:
            return False
        dialog_bin = dialog.get("bin")
    chat = get_chat(chat_id)
    if chat is None:
        return False
    section = chat.get("section")
    if section is None and dialog_id is not None:
        with _lock, _connection:
            section_row = _connection.execute(
                """
                SELECT section
                FROM messages
                WHERE dialog_id = ? AND section IS NOT NULL
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (dialog_id,),
            ).fetchone()
        if section_row is not None:
            section = section_row["section"]
    chat_bin = dialog_bin or chat.get("bin")
    if section is None or chat_bin is None:
        return False
    allowed = set(get_user_sections(user_id))
    assigned_bins = set(get_user_bins(user_id))
    return section in allowed and chat_bin in assigned_bins


def list_updates_since(
    user_id: int,
    role: str,
    since: Optional[datetime] = None,
) -> List[dict]:
    allowed_sections: Optional[List[str]] = None
    assigned_bins: Optional[List[str]] = None
    if role != ROLE_ADMIN:
        allowed_sections = get_user_sections(user_id)
        assigned_bins = get_user_bins(user_id)
    updates: List[dict] = []
    params: List[object] = []
    if role == ROLE_ADMIN or (allowed_sections and assigned_bins):
        query_parts = [
            "SELECT m.id, m.chat_id, m.text, m.created_at, m.section, m.dialog_id, c.title,",
            "       COALESCE(cd.bin, c.bin) AS dialog_bin",
            "FROM messages m",
            "JOIN chats c ON c.chat_id = m.chat_id",
            "LEFT JOIN chat_dialogs cd ON cd.id = m.dialog_id",
            "WHERE m.direction = 'incoming'",
        ]
        if since is not None:
            query_parts.append("AND m.created_at > ?")
            params.append(since.isoformat())
        if role != ROLE_ADMIN and allowed_sections and assigned_bins:
            section_placeholders = ",".join("?" for _ in allowed_sections)
            query_parts.append(
                f"AND (m.section IS NULL OR m.section IN ({section_placeholders}))"
            )
            params.extend(allowed_sections)
            bin_placeholders = ",".join("?" for _ in assigned_bins)
            query_parts.append(f"AND COALESCE(cd.bin, c.bin) IN ({bin_placeholders})")
            params.extend(assigned_bins)
        query_parts.append("ORDER BY m.created_at ASC")
        sql = "\n".join(query_parts)
        with _lock, _connection:
            rows = _connection.execute(sql, params).fetchall()
        for row in rows:
            created_at = datetime.fromisoformat(row["created_at"])
            updates.append(
                {
                    "type": "message",
                    "chat_id": row["chat_id"],
                    "chat_title": row["title"],
                    "text": row["text"],
                    "created_at": created_at,
                    "section": row["section"],
                    "bin": row["dialog_bin"],
                    "dialog_id": row["dialog_id"],
                }
            )
    notification_rows = list_notifications_since(user_id, since)
    for entry in notification_rows:
        payload = entry.get("payload", {}) or {}
        updates.append(
            {
                "type": entry.get("kind", "notification"),
                "chat_id": payload.get("chat_id"),
                "chat_title": payload.get("chat_title"),
                "text": payload.get("text", ""),
                "created_at": entry["created_at"],
                "section": payload.get("section"),
                "bin": payload.get("bin"),
                "metadata": payload,
            }
        )
    updates.sort(key=lambda item: item["created_at"])
    return updates