"""SQLite helpers for storing Telegram chat history, users and sections."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional

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
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                direction TEXT NOT NULL,
                text TEXT NOT NULL,
                message_id INTEGER,
                author TEXT,
                created_at TEXT NOT NULL,
                section TEXT,
                FOREIGN KEY(chat_id) REFERENCES chats(chat_id)
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
                PRIMARY KEY (user_id, bin),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        _connection.execute(
            """
            CREATE TABLE IF NOT EXISTS favorites (
                user_id INTEGER NOT NULL,
                chat_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, chat_id),
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY(chat_id) REFERENCES chats(chat_id) ON DELETE CASCADE
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
    _ensure_column("users", "job_title", "TEXT")
    _ensure_column("users", "phone", "TEXT")
    _ensure_column("users", "bio", "TEXT")
    _ensure_column("users", "login", "TEXT")
    _ensure_column("users", "role", "TEXT")

    with _lock, _connection:
        _connection.execute(
            "UPDATE users SET login = email WHERE login IS NULL OR TRIM(login) = ''"
        )
        _connection.execute(
            "UPDATE users SET role = 'moderator' WHERE role IS NULL OR TRIM(role) = ''"
        )

    _ensure_admin_account()


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


_init_db()


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
) -> None:
    now = datetime.utcnow().isoformat()
    with _lock, _connection:
        _connection.execute(
            """
            INSERT INTO messages (chat_id, direction, text, message_id, author, created_at, section)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (chat_id, direction, text, message_id, author, now, section),
        )
    upsert_chat(chat_id, chat_title, username, chat_type)


def list_chats_for_user(
    user_id: int,
    role: str,
    *,
    favorite_only: bool = False,
    bin_query: str | None = None,
) -> List[dict]:
    query_parts = [
        "SELECT c.chat_id, c.title, c.username, c.type, c.updated_at, c.section, c.bin,",
        "       f.user_id AS fav_user_id",
        "FROM chats c",
        "LEFT JOIN favorites f ON f.chat_id = c.chat_id AND f.user_id = ?",
    ]
    params: List[object] = [user_id]
    filters: List[str] = []
    if role != ROLE_ADMIN:
        allowed_sections = get_user_sections(user_id)
        assigned_bins = get_user_bins(user_id)
        if not allowed_sections or not assigned_bins:
            return []
        placeholders = ",".join("?" for _ in allowed_sections)
        filters.append(f"c.section IN ({placeholders})")
        params.extend(allowed_sections)
        bin_placeholders = ",".join("?" for _ in assigned_bins)
        filters.append(f"c.bin IN ({bin_placeholders})")
        params.extend(assigned_bins)
    if favorite_only:
        filters.append("f.user_id IS NOT NULL")
    if bin_query:
        filters.append("c.bin LIKE ?")
        params.append(f"%{bin_query.strip()}%")
    if filters:
        query_parts.append("WHERE " + " AND ".join(filters))
    query_parts.append("ORDER BY c.updated_at DESC")
    sql = "\n".join(query_parts)
    with _lock, _connection:
        rows = _connection.execute(sql, params).fetchall()
    chats: List[dict] = []
    for row in rows:
        chat = dict(asdict(Chat.from_row(row)))
        chat["updated_at"] = chat["updated_at"].isoformat()
        chat["is_favorite"] = bool(row["fav_user_id"])
        chats.append(chat)
    return chats


def get_messages(
    chat_id: int,
    limit: int = 50,
    allowed_sections: Optional[Iterable[str]] = None,
) -> List[dict]:
    query_parts = [
        "SELECT id, chat_id, direction, text, message_id, author, created_at, section",
        "FROM messages",
        "WHERE chat_id = ?",
    ]
    params: List[object] = [chat_id]
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


def set_chat_bin(chat_id: int, bin_value: str | None) -> None:
    with _lock, _connection:
        _connection.execute(
            "UPDATE chats SET bin = ? WHERE chat_id = ?",
            (bin_value, chat_id),
        )


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


def get_user_bins(user_id: int) -> List[str]:
    with _lock, _connection:
        rows = _connection.execute(
            "SELECT bin FROM user_bins WHERE user_id = ? ORDER BY bin ASC",
            (user_id,),
        ).fetchall()
    return [row["bin"] for row in rows]


def set_user_bins(user_id: int, bins: Iterable[str], *, assigned_by: int | None = None) -> List[str]:
    normalized = sorted({bin_value.strip() for bin_value in bins if bin_value and bin_value.strip()})
    now = datetime.utcnow().isoformat()
    added: List[str] = []
    with _lock, _connection:
        existing_rows = _connection.execute(
            "SELECT bin FROM user_bins WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        current = {row["bin"] for row in existing_rows}
        new_values = set(normalized)
        if new_values:
            placeholders = ",".join("?" for _ in new_values)
            _connection.execute(
                f"DELETE FROM user_bins WHERE user_id = ? AND bin NOT IN ({placeholders})",
                (user_id, *new_values),
            )
        else:
            _connection.execute("DELETE FROM user_bins WHERE user_id = ?", (user_id,))
        for bin_value in new_values:
            _connection.execute(
                """
                INSERT OR IGNORE INTO user_bins (user_id, bin, created_at)
                VALUES (?, ?, ?)
                """,
                (user_id, bin_value, now),
            )
        added = sorted(new_values - current)
    for bin_value in added:
        _create_notification(
            user_id,
            "bin_assigned",
            {"bin": bin_value, "assigned_by": assigned_by},
            created_at=now,
        )
    return sorted(new_values)


def list_favorite_chat_ids(user_id: int) -> List[int]:
    with _lock, _connection:
        rows = _connection.execute(
            "SELECT chat_id FROM favorites WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    return [row["chat_id"] for row in rows]


def set_favorite_chat(user_id: int, chat_id: int, favorite: bool) -> None:
    with _lock, _connection:
        if favorite:
            now = datetime.utcnow().isoformat()
            _connection.execute(
                """
                INSERT OR REPLACE INTO favorites (user_id, chat_id, created_at)
                VALUES (?, ?, ?)
                """,
                (user_id, chat_id, now),
            )
        else:
            _connection.execute(
                "DELETE FROM favorites WHERE user_id = ? AND chat_id = ?",
                (user_id, chat_id),
            )


def is_favorite_chat(user_id: int, chat_id: int) -> bool:
    with _lock, _connection:
        row = _connection.execute(
            "SELECT 1 FROM favorites WHERE user_id = ? AND chat_id = ?",
            (user_id, chat_id),
        ).fetchone()
    return row is not None


def list_bins(query: str | None = None) -> List[str]:
    clauses = ["SELECT DISTINCT bin FROM chats WHERE bin IS NOT NULL AND TRIM(bin) != ''"]
    params: List[object] = []
    if query:
        clauses.append("AND bin LIKE ?")
        params.append(f"%{query.strip()}%")
    clauses.append("ORDER BY bin ASC")
    sql = "\n".join(clauses)
    with _lock, _connection:
        rows = _connection.execute(sql, params).fetchall()
    return [row["bin"] for row in rows]


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
        _connection.execute("DELETE FROM favorites WHERE chat_id = ?", (chat_id,))
        _connection.execute("DELETE FROM chats WHERE chat_id = ?", (chat_id,))


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
    sanitized["bins"] = get_user_bins(user["id"])
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
) -> dict:
    with _lock, _connection:
        _connection.execute(
            """
            UPDATE users
            SET name = ?, job_title = ?, phone = ?, bio = ?
            WHERE id = ?
            """,
            (name, job_title, phone, bio, user_id),
        )
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


def user_can_access_chat(user_id: int, role: str, chat_id: int) -> bool:
    if role == ROLE_ADMIN:
        return True
    chat = get_chat(chat_id)
    if chat is None:
        return False
    section = chat.get("section")
    chat_bin = chat.get("bin")
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
            "SELECT m.id, m.chat_id, m.text, m.created_at, m.section, c.title, c.bin",
            "FROM messages m",
            "JOIN chats c ON c.chat_id = m.chat_id",
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
            query_parts.append(f"AND c.bin IN ({bin_placeholders})")
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
                    "bin": row["bin"],
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