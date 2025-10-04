"""SQLite helpers for storing Telegram chat history, users and sections."""
from __future__ import annotations

import hashlib
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
        if not allowed_sections:
            return []
        placeholders = ",".join("?" for _ in allowed_sections)
        filters.append(f"c.section IN ({placeholders})")
        params.extend(allowed_sections)
    if favorite_only:
        filters.append("f.user_id IS NOT NULL")
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


def get_messages(chat_id: int, limit: int = 50) -> List[dict]:
    with _lock, _connection:
        rows = _connection.execute(
            """
            SELECT id, chat_id, direction, text, message_id, author, created_at, section
            FROM messages
            WHERE chat_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (chat_id, limit),
        ).fetchall()
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


def _row_to_user(row: sqlite3.Row) -> dict:
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
    return {
        "id": user_id,
        "email": email,
        "name": name,
        "created_at": now,
        "job_title": job_title or "",
        "phone": phone or "",
        "bio": bio or "",
        "login": login_value,
        "role": role,
        "sections": [],
    }


def find_user_by_email(email: str) -> Optional[dict]:
    with _lock, _connection:
        row = _connection.execute(
            """
            SELECT id, email, name, password_hash, created_at, job_title, phone, bio, login, role
            FROM users
            WHERE email = ?
            """,
            (email,),
        ).fetchone()
    if row is None:
        return None
    return _row_to_user(row)


def find_user_by_login(login: str) -> Optional[dict]:
    with _lock, _connection:
        row = _connection.execute(
            """
            SELECT id, email, name, password_hash, created_at, job_title, phone, bio, login, role
            FROM users
            WHERE login = ?
            """,
            (login,),
        ).fetchone()
    if row is None:
        return None
    return _row_to_user(row)


def find_user_by_identifier(identifier: str) -> Optional[dict]:
    normalized = identifier.strip()
    user = find_user_by_login(normalized)
    if user:
        return user
    return find_user_by_email(normalized)


def get_user_by_id(user_id: int) -> Optional[dict]:
    with _lock, _connection:
        row = _connection.execute(
            """
            SELECT id, email, name, password_hash, created_at, job_title, phone, bio, login, role
            FROM users
            WHERE id = ?
            """,
            (user_id,),
        ).fetchone()
    if row is None:
        return None
    return _row_to_user(row)


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
    user = get_user_by_id(user_id)
    if not user:
        raise ValueError("User not found")
    sanitized = dict(user)
    sanitized.pop("password_hash", None)
    sanitized["sections"] = get_user_sections(user_id)
    return sanitized


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
            """
            SELECT u.id, u.email, u.name, u.password_hash, u.created_at, u.job_title, u.phone, u.bio, u.login, u.role
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token = ?
            """,
            (token,),
        ).fetchone()
    if row is None:
        return None
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
    user = get_user_by_id(user_id)
    if not user:
        raise ValueError("User not found")
    return {
        k: user[k]
        for k in (
            "id",
            "email",
            "name",
            "created_at",
            "job_title",
            "phone",
            "bio",
            "login",
            "role",
        )
    } | {"sections": get_user_sections(user_id)}


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
        sql = [
            "SELECT id, email, name, password_hash, created_at, job_title, phone, bio, login, role",
            "FROM users",
        ]
        if filters:
            sql.append("WHERE " + " AND ".join(filters))
        sql.append("ORDER BY created_at ASC")
        rows = _connection.execute("\n".join(sql), params).fetchall()
    users: List[dict] = []
    for row in rows:
        user = dict(_row_to_user(row))
        # remove password hash for API consumers
        user.pop("password_hash", None)
        user["sections"] = get_user_sections(user["id"])
        users.append(user)
    return users


def update_user_role(user_id: int, role: str) -> dict:
    if role not in ALL_ROLES:
        raise ValueError("Invalid role")
    with _lock, _connection:
        _connection.execute(
            "UPDATE users SET role = ? WHERE id = ?",
            (role, user_id),
        )
    user = get_user_by_id(user_id)
    if not user:
        raise ValueError("User not found")
    sanitized = dict(user)
    sanitized.pop("password_hash", None)
    sanitized["sections"] = get_user_sections(user_id)
    return sanitized


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
    if section is None:
        return False
    allowed = set(get_user_sections(user_id))
    return section in allowed


def list_incoming_messages_since(
    user_id: int,
    role: str,
    since: Optional[datetime] = None,
) -> List[dict]:
    query_parts = [
        "SELECT m.id, m.chat_id, m.text, m.created_at, m.section, c.title",
        "FROM messages m",
        "JOIN chats c ON c.chat_id = m.chat_id",
        "WHERE m.direction = 'incoming'",
    ]
    params: List[object] = []
    if since is not None:
        query_parts.append("AND m.created_at > ?")
        params.append(since.isoformat())
    if role != ROLE_ADMIN:
        allowed_sections = get_user_sections(user_id)
        if not allowed_sections:
            return []
        placeholders = ",".join("?" for _ in allowed_sections)
        query_parts.append(f"AND m.section IN ({placeholders})")
        params.extend(allowed_sections)
    query_parts.append("ORDER BY m.created_at ASC")
    sql = "\n".join(query_parts)
    with _lock, _connection:
        rows = _connection.execute(sql, params).fetchall()
    notifications: List[dict] = []
    for row in rows:
        created_at = datetime.fromisoformat(row["created_at"])
        notifications.append(
            {
                "chat_id": row["chat_id"],
                "text": row["text"],
                "created_at": created_at.isoformat(),
                "section": row["section"],
                "chat_title": row["title"],
            }
        )
    return notifications