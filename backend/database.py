"""Database helpers for storing Telegram chat history, users and sections."""
from __future__ import annotations

import hashlib
import logging
import json
import threading
import time
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence

from uuid import uuid4

import psycopg2
import psycopg2.extras
import psycopg2.pool
from psycopg2 import sql

from . import require_env

logger = logging.getLogger(__name__)

DB_NAME = require_env("DB_NAME")
DB_USER = require_env("DB_USER")
DB_PASSWORD = require_env("DB_PASSWORD")
DB_HOST = require_env("DB_HOST")
try:
    DB_PORT = int(require_env("DB_PORT"))
except ValueError as exc:  # pragma: no cover - defensive
    raise RuntimeError("DB_PORT must be an integer") from exc

_POOL_MINCONN = 2
try:
    _POOL_MAXCONN = int(require_env("DB_POOL_MAXCONN", default="60"))
except ValueError as exc:  # pragma: no cover - defensive
    raise RuntimeError("DB_POOL_MAXCONN must be an integer") from exc
if _POOL_MAXCONN < _POOL_MINCONN:
    raise RuntimeError("DB_POOL_MAXCONN must be >= 2")

_pool = psycopg2.pool.ThreadedConnectionPool(
    minconn=_POOL_MINCONN,
    maxconn=_POOL_MAXCONN,
    dbname=DB_NAME,
    user=DB_USER,
    password=DB_PASSWORD,
    host=DB_HOST,
    port=DB_PORT,
)
_pool_slots = threading.BoundedSemaphore(_POOL_MAXCONN)

_thread_local = threading.local()


def _borrow_connection_with_retry(timeout_seconds: float = 15.0):
    deadline = time.monotonic() + timeout_seconds
    while True:
        try:
            return _pool.getconn()
        except psycopg2.pool.PoolError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.05)


class _PooledLock:
    """Drop-in replacement for threading.Lock using a connection pool.

    Each ``with _lock:`` block borrows a connection from the pool and stores
    it in thread-local storage so that ``execute()`` can use it.  Different
    threads get different connections, enabling parallel DB access.

    Re-entrant: nested ``with _lock:`` blocks reuse the same connection.
    """

    def __enter__(self):
        depth = getattr(_thread_local, "depth", 0)
        if depth == 0:
            _pool_slots.acquire()
            try:
                conn = _borrow_connection_with_retry()
                conn.autocommit = True
                conn.set_client_encoding("UTF8")
                _thread_local.conn = conn
            except Exception:
                _pool_slots.release()
                raise
        _thread_local.depth = depth + 1
        return self

    def __exit__(self, *exc_info):
        _thread_local.depth -= 1
        if _thread_local.depth == 0:
            conn = _thread_local.conn
            _thread_local.conn = None
            try:
                _pool.putconn(conn)
            finally:
                _pool_slots.release()


_lock = _PooledLock()


def execute(query: str, params: Sequence[Any] | None = None):
    """Execute a SQL query using a pooled connection.

    If called inside a ``with _lock:`` block, reuses that block's connection.
    Otherwise borrows a one-off connection from the pool.

    Automatically retries once on ``OperationalError`` (stale/broken
    connection) by discarding the bad connection and borrowing a fresh one.
    """
    conn = getattr(_thread_local, "conn", None)
    if conn is None:
        return _execute_oneoff(query, params)
    return _execute_with_retry(conn, query, params)


def _execute_oneoff(query: str, params: Sequence[Any] | None):
    """Borrow a one-off connection, execute, and return the cursor."""
    _pool_slots.acquire()
    conn = None
    try:
        conn = _borrow_connection_with_retry()
        conn.autocommit = True
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            cursor.execute(query, params or ())
        except psycopg2.OperationalError:
            # Connection is stale — discard and retry with a fresh one.
            _pool.putconn(conn, close=True)
            conn = _borrow_connection_with_retry()
            conn.autocommit = True
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cursor.execute(query, params or ())
    except Exception:
        if conn is not None:
            _pool.putconn(conn, close=True)
        raise
    else:
        _pool.putconn(conn)
        return cursor
    finally:
        _pool_slots.release()


def _execute_with_retry(conn, query: str, params: Sequence[Any] | None):
    """Execute using the thread-local connection, reconnect on stale error."""
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cursor.execute(query, params or ())
        return cursor
    except psycopg2.OperationalError:
        # The connection held by _lock is dead.  Replace it in-place.
        _pool.putconn(conn, close=True)
        new_conn = _borrow_connection_with_retry()
        new_conn.autocommit = True
        new_conn.set_client_encoding("UTF8")
        _thread_local.conn = new_conn
        cursor = new_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cursor.execute(query, params or ())
        return cursor

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
    "is_approved",
)


AUTOMATION_AUTHOR_NAMES: tuple[str, ...] = ("AutoBot", "AI Assistant", "System")


def _user_columns(prefix: str | None = None) -> str:
    if prefix:
        return ", ".join(f"{prefix}.{column} AS {column}" for column in USER_COLUMN_NAMES)
    return ", ".join(USER_COLUMN_NAMES)


def _init_db() -> None:
    tables_sql = [
        """
        CREATE TABLE IF NOT EXISTS chats (
            chat_id BIGINT PRIMARY KEY,
            title TEXT NOT NULL,
            username TEXT,
            type TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            section TEXT,
            bin TEXT,
            external_chat_id TEXT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS chat_dialogs (
            id BIGSERIAL PRIMARY KEY,
            chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
            bin TEXT,
            title TEXT,
            created_at TEXT,
            started_at TEXT,
            ended_at TEXT,
            last_message_at TEXT,
            operator_mode INTEGER DEFAULT 0
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS messages (
            id BIGSERIAL PRIMARY KEY,
            chat_id BIGINT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
            direction TEXT NOT NULL,
            text TEXT NOT NULL,
            message_id BIGINT,
            author TEXT,
            created_at TEXT NOT NULL,
            section TEXT,
            dialog_id BIGINT REFERENCES chat_dialogs(id) ON DELETE SET NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS messages_archive (
            id BIGSERIAL PRIMARY KEY,
            chat_id BIGINT NOT NULL,
            direction TEXT NOT NULL,
            text TEXT NOT NULL,
            message_id BIGINT,
            author TEXT,
            created_at TEXT NOT NULL,
            section TEXT,
            dialog_id BIGINT,
            archived_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS users (
            id BIGSERIAL PRIMARY KEY,
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
        """,
        """
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS user_sections (
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            section TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (user_id, section)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS user_bins (
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            bin TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT,
            assigned_by BIGINT,
            PRIMARY KEY (user_id, bin)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS favorites (
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            dialog_id BIGINT NOT NULL REFERENCES chat_dialogs(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            PRIMARY KEY (user_id, dialog_id)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS dialog_reads (
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            dialog_id BIGINT NOT NULL REFERENCES chat_dialogs(id) ON DELETE CASCADE,
            last_read_at TEXT NOT NULL,
            PRIMARY KEY (user_id, dialog_id)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS notifications (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS outbox_onec (
            id BIGSERIAL PRIMARY KEY,
            chat_id BIGINT NOT NULL,
            external_chat_id TEXT NOT NULL,
            bin TEXT,
            message_id BIGINT,
            payload TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_outbox_onec_status_ext_id
        ON outbox_onec(status, external_chat_id, id)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_outbox_onec_message
        ON outbox_onec(message_id)
        """,
        """
        CREATE TABLE IF NOT EXISTS dialog_stats (
            id BIGSERIAL PRIMARY KEY,
            dialog_id BIGINT NOT NULL UNIQUE,
            chat_id BIGINT NOT NULL,
            bin TEXT,
            section TEXT,
            started_at TEXT,
            ended_at TEXT,
            msg_incoming INTEGER DEFAULT 0,
            msg_outgoing INTEGER DEFAULT 0,
            msg_total INTEGER DEFAULT 0,
            avg_response_time_seconds REAL,
            response_count INTEGER DEFAULT 0,
            fast_responses INTEGER DEFAULT 0,
            medium_responses INTEGER DEFAULT 0,
            slow_responses INTEGER DEFAULT 0,
            sla_violations INTEGER DEFAULT 0,
            is_ai_closed BOOLEAN DEFAULT FALSE,
            operator_requested BOOLEAN DEFAULT FALSE,
            ai_messages_count INTEGER DEFAULT 0,
            msgs_before_transfer INTEGER,
            first_message_text TEXT,
            first_message_length INTEGER,
            has_contract BOOLEAN,
            created_at TEXT NOT NULL
        )
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_dialog_stats_started
        ON dialog_stats(started_at)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_dialog_stats_bin
        ON dialog_stats(bin)
        """,
        """
        CREATE TABLE IF NOT EXISTS dialog_operator_stats (
            id BIGSERIAL PRIMARY KEY,
            dialog_id BIGINT NOT NULL,
            operator_name TEXT NOT NULL,
            messages_sent INTEGER DEFAULT 0,
            avg_response_seconds REAL,
            response_count INTEGER DEFAULT 0,
            started_at TEXT
        )
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_dialog_op_stats_started
        ON dialog_operator_stats(started_at)
        """,
        """
        CREATE TABLE IF NOT EXISTS stat_questions (
            id BIGSERIAL PRIMARY KEY,
            dialog_id BIGINT,
            text TEXT NOT NULL,
            created_at TEXT NOT NULL,
            section TEXT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS organizations_without_contracts (
            id BIGSERIAL PRIMARY KEY,
            customer_bin TEXT NOT NULL UNIQUE,
            customer_legal_address TEXT,
            customer_bank_name_ru TEXT,
            created_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS all_bins (
            id BIGSERIAL PRIMARY KEY,
            bin TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS client_bins (
            id BIGSERIAL PRIMARY KEY,
            chat_id BIGINT NOT NULL,
            bin TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(chat_id, bin)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS appeals (
            id BIGSERIAL PRIMARY KEY,
            dialog_id BIGINT NOT NULL REFERENCES chat_dialogs(id) ON DELETE CASCADE,
            chat_id BIGINT NOT NULL,
            section TEXT,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            closed_by TEXT
        )
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_appeals_dialog_id
        ON appeals(dialog_id)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_appeals_chat_id
        ON appeals(chat_id)
        """,
    ]

    with _lock:
        for statement in tables_sql:
            execute(statement)

    _ensure_column("chats", "section", "TEXT")
    _ensure_column("chats", "bin", "TEXT")
    _ensure_column("chats", "external_chat_id", "TEXT")
    _ensure_column("messages", "section", "TEXT")
    _ensure_column("messages", "dialog_id", "BIGINT")
    _ensure_column("chat_dialogs", "bin", "TEXT")
    _ensure_column("chat_dialogs", "started_at", "TEXT")
    _ensure_column("chat_dialogs", "ended_at", "TEXT")
    _ensure_column("chat_dialogs", "last_message_at", "TEXT")
    _ensure_column("chat_dialogs", "operator_mode", "INTEGER DEFAULT 0")
    _ensure_column("chat_dialogs", "section", "TEXT")
    _ensure_column("users", "job_title", "TEXT")
    _ensure_column("users", "phone", "TEXT")
    _ensure_column("users", "bio", "TEXT")
    _ensure_column("users", "login", "TEXT")
    _ensure_column("users", "role", "TEXT")
    _ensure_column("users", "is_approved", "INTEGER DEFAULT 1")
    _ensure_column("user_bins", "expires_at", "TEXT")
    _ensure_column("user_bins", "assigned_by", "BIGINT")

    # dialog_stats migration (extend existing table with new metric columns)
    _ensure_column("dialog_stats", "msg_total", "INTEGER DEFAULT 0")
    _ensure_column("dialog_stats", "avg_response_time_seconds", "REAL")
    _ensure_column("dialog_stats", "response_count", "INTEGER DEFAULT 0")
    _ensure_column("dialog_stats", "fast_responses", "INTEGER DEFAULT 0")
    _ensure_column("dialog_stats", "medium_responses", "INTEGER DEFAULT 0")
    _ensure_column("dialog_stats", "slow_responses", "INTEGER DEFAULT 0")
    _ensure_column("dialog_stats", "sla_violations", "INTEGER DEFAULT 0")
    _ensure_column("dialog_stats", "is_ai_closed", "BOOLEAN DEFAULT FALSE")
    _ensure_column("dialog_stats", "operator_requested", "BOOLEAN DEFAULT FALSE")
    _ensure_column("dialog_stats", "ai_messages_count", "INTEGER DEFAULT 0")
    _ensure_column("dialog_stats", "msgs_before_transfer", "INTEGER")
    _ensure_column("dialog_stats", "first_message_text", "TEXT")
    _ensure_column("dialog_stats", "first_message_length", "INTEGER")
    _ensure_column("dialog_stats", "has_contract", "BOOLEAN")
    _ensure_column("dialog_stats", "appeal_id", "BIGINT")

    # Unique constraint on dialog_stats — one row per appeal
    with _lock:
        # Drop legacy unique constraint on dialog_id (allows multiple rows per dialog)
        # and drop old non-unique appeal_id index so we can recreate as unique
        execute(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM pg_class c
                    JOIN pg_index i ON i.indexrelid = c.oid
                    WHERE c.relname = 'idx_dialog_stats_dialog_id'
                    AND i.indisunique
                ) THEN
                    DROP INDEX idx_dialog_stats_dialog_id;
                END IF;

                IF EXISTS (
                    SELECT 1 FROM pg_class c
                    JOIN pg_index i ON i.indexrelid = c.oid
                    WHERE c.relname = 'idx_dialog_stats_appeal_id'
                    AND NOT i.indisunique
                ) THEN
                    DROP INDEX idx_dialog_stats_appeal_id;
                END IF;
            END $$
            """
        )
        execute(
            "CREATE INDEX IF NOT EXISTS idx_dialog_stats_dialog_id ON dialog_stats (dialog_id)"
        )
        execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_dialog_stats_appeal_id ON dialog_stats (appeal_id) WHERE appeal_id IS NOT NULL"
        )

    with _lock:
        execute("UPDATE users SET login = email WHERE login IS NULL OR TRIM(login) = ''")
        execute(
            "UPDATE users SET role = 'operator' WHERE role IS NULL OR TRIM(role) = ''"
        )
        execute("UPDATE users SET role = 'operator' WHERE role = 'viewer'")
        execute("UPDATE users SET is_approved = 1 WHERE is_approved IS NULL")
        execute(
            "UPDATE chat_dialogs SET operator_mode = 0 WHERE operator_mode IS NULL"
        )


def _sync_sequence(table: str, column: str = "id") -> None:
    with _lock:
        execute(
            sql.SQL(
                """
                SELECT setval(
                    pg_get_serial_sequence(%s, %s),
                    GREATEST(COALESCE((SELECT MAX({column}) FROM {table}), 0), 1)
                )
                """
            ).format(table=sql.Identifier(table), column=sql.Identifier(column)),
            (table, column),
        )


def _sync_sequences() -> None:
    for table in (
        "users",
        "chat_dialogs",
        "messages",
        "messages_archive",
        "notifications",
        "outbox_onec",
        "dialog_stats",
        "dialog_operator_stats",
        "stat_questions",
        "appeals",
    ):
        _sync_sequence(table)


def _column_exists(table: str, column: str) -> bool:
    cursor = execute(
        """
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = %s AND column_name = %s
        """,
        (table, column),
    )
    return cursor.fetchone() is not None


def _ensure_column(table: str, column: str, definition: str) -> None:
    if _column_exists(table, column):
        return

    with _lock:
        if _column_exists(table, column):
            return
        # Build raw SQL string — execute() handles connection pooling
        raw_query = f'ALTER TABLE "{table}" ADD COLUMN "{column}" {definition}'
        execute(raw_query)


ROLE_ADMIN = "admin"
ROLE_MODERATOR = "moderator"
ROLE_OPERATOR = "operator"
ALL_ROLES: Iterable[str] = (ROLE_ADMIN, ROLE_MODERATOR, ROLE_OPERATOR)


def is_admin_like(role: str) -> bool:
    return role in (ROLE_ADMIN, ROLE_MODERATOR)


def _ensure_admin_account() -> None:
    password_hash = hashlib.sha256("admin".encode("utf-8")).hexdigest()
    with _lock:
        row = execute(
            "SELECT id FROM users WHERE login = %s", ("admin",)
        ).fetchone()
        if row:
            execute(
                """
                UPDATE users
                SET role = %s,
                    password_hash = %s,
                    name = %s,
                    email = COALESCE(email, %s),
                    login = 'admin',
                    job_title = COALESCE(job_title, ''),
                    is_approved = 1
                WHERE id = %s
                """,
                (ROLE_ADMIN, password_hash, "Администратор", "admin@example.com", row["id"]),
            )
            return
    now = datetime.now(timezone.utc).isoformat()
    execute(
        """
        INSERT INTO users (email, name, password_hash, created_at, job_title, phone, bio, login, role, is_approved)
        VALUES (%s, %s, %s, %s, %s, '', '', %s, %s, 1)
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
_sync_sequences()
_ensure_admin_account()


def _parse_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _fetch_user(where_clause: str, *params: object) -> dict | None:
    with _lock:
        row = execute(
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
    external_chat_id: str | None

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> "Chat":
        return cls(
            chat_id=row["chat_id"],
            title=row["title"],
            username=row["username"],
            type=row["type"],
            updated_at=datetime.fromisoformat(row["updated_at"]),
            section=row["section"],
            bin=row["bin"],
            external_chat_id=row["external_chat_id"],
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
    def from_row(cls, row: Mapping[str, Any]) -> "Message":
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


def upsert_chat(
    chat_id: int,
    title: str,
    username: str | None,
    chat_type: str,
    *,
    external_chat_id: str | None = None,
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    normalized_external = (external_chat_id or "").strip() or None
    with _lock:
        execute(
            """
            INSERT INTO chats (chat_id, title, username, type, updated_at, external_chat_id)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT(chat_id) DO UPDATE SET
                title=excluded.title,
                username=excluded.username,
                type=excluded.type,
                updated_at=excluded.updated_at,
                external_chat_id=COALESCE(excluded.external_chat_id, chats.external_chat_id)
            """,
            (chat_id, title, username, chat_type, now, normalized_external),
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
) -> int:
    now = datetime.now(timezone.utc).isoformat()
    resolved_dialog_id = dialog_id
    if resolved_dialog_id is None:
        active_dialog = get_active_chat_dialog(chat_id)
        if active_dialog:
            resolved_dialog_id = active_dialog["id"]
            
    with _lock:
        cursor = execute(
            """
            INSERT INTO messages (chat_id, direction, text, message_id, author, created_at, section, dialog_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (chat_id, direction, text, message_id, author, now, section, resolved_dialog_id),
        )
        inserted_row = cursor.fetchone()
        if inserted_row is None:
            raise RuntimeError("Failed to persist message")
        inserted_id = int(inserted_row["id"])
        if resolved_dialog_id is not None:
            execute(
                "UPDATE chat_dialogs SET last_message_at = %s WHERE id = %s",
                (now, resolved_dialog_id),
            )
    upsert_chat(chat_id, chat_title, username, chat_type)
    return inserted_id


def list_user_ids_by_bin(bin_value: str) -> List[int]:
    refresh_bin_assignments()
    now_iso = datetime.now(timezone.utc).isoformat()
    with _lock:
        rows = execute(
            """
            SELECT DISTINCT user_id
            FROM user_bins
            WHERE bin = %s
              AND (expires_at IS NULL OR expires_at > %s)
            """,
            (bin_value, now_iso),
        ).fetchall()
    return [int(row["user_id"]) for row in rows]


def create_operator_request_notifications(
    chat_id: int,
    *,
    dialog_id: int | None = None,
    chat_title: str | None = None,
    section: str | None = None,
    bin_value: str | None = None,
    created_at: str | None = None,
) -> None:
    resolved_dialog_bin = bin_value
    resolved_chat_title = chat_title

    if dialog_id and not resolved_dialog_bin:
        dialog = get_chat_dialog(dialog_id)
        if dialog:
            resolved_dialog_bin = dialog.get("bin") or resolved_dialog_bin

    chat_record = get_chat(chat_id)
    if chat_record:
        resolved_chat_title = resolved_chat_title or chat_record.get("title") or str(chat_id)
        resolved_dialog_bin = resolved_dialog_bin or chat_record.get("bin")
        section = section or chat_record.get("section")

    if not resolved_dialog_bin:
        return

    recipients = list_user_ids_by_bin(resolved_dialog_bin)
    if not recipients:
        return

    payload = {
        "chat_id": chat_id,
        "chat_title": resolved_chat_title or str(chat_id),
        "text": "Клиент запросил оператора.",
        "section": section,
        "bin": resolved_dialog_bin,
        "dialog_id": dialog_id,
    }

    for user_id in recipients:
        _create_notification(
            user_id,
            "operator_request",
            payload,
            created_at=created_at,
        )


def list_chat_dialogs(chat_id: int) -> List[Dict[str, object]]:
    with _lock:
        rows = execute(
            """
            SELECT id, bin, started_at, ended_at, last_message_at, operator_mode
            FROM chat_dialogs
            WHERE chat_id = %s
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
                "operator_mode": bool(row["operator_mode"]),
            }
        )
    return result


def get_chat_dialog(dialog_id: int) -> Optional[Dict[str, object]]:
    with _lock:
        row = execute(
            """
            SELECT id, chat_id, bin, started_at, ended_at, last_message_at, operator_mode
            FROM chat_dialogs
            WHERE id = %s
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
        "operator_mode": bool(row["operator_mode"]),
    }


def get_active_chat_dialog(chat_id: int) -> Optional[Dict[str, object]]:
    """Returns the currently active dialog."""
    with _lock:
        row = execute(
            """
            SELECT id, chat_id, bin, started_at, ended_at, last_message_at, operator_mode
            FROM chat_dialogs
            WHERE chat_id = %s AND ended_at IS NULL
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
        "operator_mode": bool(row["operator_mode"]),
    }


def get_active_chat_dialog_id(chat_id: int) -> int | None:
    dialog = get_active_chat_dialog(chat_id)
    if dialog is None:
        return None
    return int(dialog["id"])


def set_dialog_operator_mode(dialog_id: int, operator_mode: bool) -> None:
    with _lock:
        execute(
            "UPDATE chat_dialogs SET operator_mode = %s WHERE id = %s",
            (1 if operator_mode else 0, dialog_id),
        )


def is_dialog_in_operator_mode(dialog_id: int) -> bool:
    with _lock:
        row = execute(
            "SELECT operator_mode FROM chat_dialogs WHERE id = %s",
            (dialog_id,),
        ).fetchone()
    if row is None:
        return False
    return bool(row["operator_mode"])


def resume_last_closed_dialog(chat_id: int) -> Optional[Dict[str, object]]:
    """Resume the most recently closed dialog for a chat.

    Clears ``ended_at``, creates a new appeal, and returns dialog info.
    Returns ``None`` if no closed dialog exists.
    """
    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        row = execute(
            """
            SELECT id, bin, started_at, last_message_at
            FROM chat_dialogs
            WHERE chat_id = %s AND ended_at IS NOT NULL
            ORDER BY COALESCE(last_message_at, ended_at) DESC
            LIMIT 1
            """,
            (chat_id,),
        ).fetchone()
        if row is None:
            return None
        dialog_id = int(row["id"])
        dialog_bin = row["bin"]
        execute(
            "UPDATE chat_dialogs SET ended_at = NULL, last_message_at = %s WHERE id = %s",
            (now, dialog_id),
        )
        execute(
            "UPDATE chats SET bin = %s, updated_at = %s WHERE chat_id = %s",
            (dialog_bin, now, chat_id),
        )
    # Create new appeal
    appeal_id = create_appeal(dialog_id, chat_id)
    appeal_num = count_appeals(dialog_id)
    return {
        "dialog_id": dialog_id,
        "bin": dialog_bin,
        "appeal_id": appeal_id,
        "appeal_num": appeal_num,
    }


def activate_chat_dialog(dialog_id: int, *, chat_id: int | None = None) -> Optional[Dict[str, object]]:
    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        dialog_row = execute(
            "SELECT id, chat_id, bin FROM chat_dialogs WHERE id = %s",
            (dialog_id,),
        ).fetchone()
        if dialog_row is None:
            return None
        if chat_id is not None and dialog_row["chat_id"] != chat_id:
            return None
        chat_id_value = dialog_row["chat_id"]
        execute(
            "UPDATE chat_dialogs SET ended_at = %s WHERE chat_id = %s AND ended_at IS NULL AND id != %s",
            (now, chat_id_value, dialog_id),
        )
        execute(
            "UPDATE chat_dialogs SET ended_at = NULL, last_message_at = COALESCE(last_message_at, started_at) WHERE id = %s",
            (dialog_id,),
        )
        section_row = execute(
            """
            SELECT section
            FROM messages
            WHERE dialog_id = %s AND section IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (dialog_id,),
        ).fetchone()
        section_value = section_row["section"] if section_row else None
        execute(
            """
            UPDATE chats
            SET bin = %s, section = %s, updated_at = %s
            WHERE chat_id = %s
            """,
            (dialog_row["bin"], section_value, now, chat_id_value),
        )
        dialog = execute(
            """
            SELECT id, chat_id, bin, started_at, ended_at, last_message_at
            FROM chat_dialogs
            WHERE id = %s
            """,
            (dialog_id,),
        ).fetchone()
    if dialog is None:
        return None
    # Create a new appeal for this reactivation
    chat_id_resolved = int(dialog["chat_id"])
    create_appeal(dialog_id, chat_id_resolved)
    return {
        "id": dialog["id"],
        "chat_id": dialog["chat_id"],
        "bin": dialog["bin"],
        "started_at": dialog["started_at"],
        "ended_at": dialog["ended_at"],
        "last_message_at": dialog["last_message_at"],
    }


def close_chat_dialog(dialog_id: int, *, closed_by: str = "operator") -> Optional[int]:
    """Закрывает указанный диалог, записывает метрики в dialog_stats."""

    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        dialog_row = execute(
            "SELECT chat_id FROM chat_dialogs WHERE id = %s",
            (dialog_id,),
        ).fetchone()
        if dialog_row is None:
            return None
        chat_id = int(dialog_row["chat_id"])
        execute(
            """
            UPDATE chat_dialogs
            SET ended_at = %s, last_message_at = COALESCE(last_message_at, %s), operator_mode = 0
            WHERE id = %s
            """,
            (now, now, dialog_id),
        )
    # Close active appeal and snapshot metrics
    close_appeal(dialog_id, closed_by)
    snapshot_dialog_metrics(dialog_id)
    return chat_id


def close_active_chat_dialog(chat_id: int) -> None:
    now = datetime.now(timezone.utc).isoformat()
    closed_dialog_id: Optional[int] = None
    with _lock:
        active = execute(
            """
            SELECT id FROM chat_dialogs
            WHERE chat_id = %s AND ended_at IS NULL
            ORDER BY started_at DESC
            LIMIT 1
            """,
            (chat_id,),
        ).fetchone()
        if active:
            closed_dialog_id = int(active["id"])
            execute(
                "UPDATE chat_dialogs SET ended_at = %s, last_message_at = COALESCE(last_message_at, %s) WHERE id = %s",
                (now, now, closed_dialog_id),
            )
    if closed_dialog_id is not None:
        close_appeal(closed_dialog_id, "client")
        snapshot_dialog_metrics(closed_dialog_id)


# ──────────────────── Appeals (обращения) ────────────────────


def create_appeal(
    dialog_id: int, chat_id: int, section: str | None = None
) -> int:
    """Create a new appeal (обращение) within a dialog."""
    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        # Close any lingering active appeal for this dialog
        execute(
            "UPDATE appeals SET ended_at = %s, closed_by = 'system' WHERE dialog_id = %s AND ended_at IS NULL",
            (now, dialog_id),
        )
        cursor = execute(
            """
            INSERT INTO appeals (dialog_id, chat_id, section, started_at)
            VALUES (%s, %s, %s, %s)
            RETURNING id
            """,
            (dialog_id, chat_id, section, now),
        )
        row = cursor.fetchone()
    if row is None:
        raise RuntimeError("Failed to create appeal")
    appeal_id = int(row["id"])
    logger.info(
        "Created appeal %s for dialog %s, chat %s", appeal_id, dialog_id, chat_id
    )
    return appeal_id


def close_appeal(
    dialog_id: int, closed_by: str = "system"
) -> Optional[int]:
    """Close the active appeal for a dialog. Returns appeal_id or None."""
    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        active = execute(
            """
            SELECT id, section FROM appeals
            WHERE dialog_id = %s AND ended_at IS NULL
            ORDER BY started_at DESC LIMIT 1
            """,
            (dialog_id,),
        ).fetchone()
        if active is None:
            return None
        appeal_id = int(active["id"])
        execute(
            "UPDATE appeals SET ended_at = %s, closed_by = %s WHERE id = %s",
            (now, closed_by, appeal_id),
        )
    logger.info(
        "Closed appeal %s for dialog %s (by %s)", appeal_id, dialog_id, closed_by
    )
    return appeal_id


def get_active_appeal(dialog_id: int) -> Optional[Dict[str, object]]:
    """Return the currently active appeal for a dialog, or None."""
    with _lock:
        row = execute(
            """
            SELECT id, dialog_id, chat_id, section, started_at, ended_at, closed_by
            FROM appeals
            WHERE dialog_id = %s AND ended_at IS NULL
            ORDER BY started_at DESC LIMIT 1
            """,
            (dialog_id,),
        ).fetchone()
    if row is None:
        return None
    return {
        "id": int(row["id"]),
        "dialog_id": int(row["dialog_id"]),
        "chat_id": int(row["chat_id"]),
        "section": row["section"],
        "started_at": row["started_at"],
        "ended_at": row["ended_at"],
        "closed_by": row["closed_by"],
    }


def count_appeals(dialog_id: int) -> int:
    """Count total appeals in a dialog."""
    with _lock:
        row = execute(
            "SELECT COUNT(*) AS cnt FROM appeals WHERE dialog_id = %s",
            (dialog_id,),
        ).fetchone()
    return int(row["cnt"]) if row else 0

def snapshot_dialog_metrics(dialog_id: int) -> None:
    """Вычисляет и сохраняет метрики обращения в dialog_stats.

    Находит последнее закрытое обращение (appeal) для диалога и считает
    метрики только по сообщениям в рамках этого обращения.
    """
    now = datetime.now(timezone.utc).isoformat()
    automation_set = {name.strip().lower() for name in AUTOMATION_AUTHOR_NAMES}

    with _lock:
        # ── 0. Find the most recently closed appeal ──
        appeal_row = execute(
            """
            SELECT id, started_at, ended_at, section
            FROM appeals
            WHERE dialog_id = %s AND ended_at IS NOT NULL
            ORDER BY ended_at DESC LIMIT 1
            """,
            (dialog_id,),
        ).fetchone()

        appeal_id: int | None = None
        appeal_started_at: str | None = None
        appeal_ended_at: str | None = None
        appeal_section: str | None = None
        if appeal_row:
            appeal_id = int(appeal_row["id"])
            appeal_started_at = appeal_row["started_at"]
            appeal_ended_at = appeal_row["ended_at"]
            appeal_section = appeal_row["section"]

        # ── 1. Dialog metadata ──
        dialog = execute(
            """
            SELECT id, chat_id, bin, section, started_at, ended_at
            FROM chat_dialogs WHERE id = %s
            """,
            (dialog_id,),
        ).fetchone()
        if dialog is None:
            return

        chat_id = int(dialog["chat_id"])
        dialog_bin = dialog["bin"]
        section = appeal_section or dialog.get("section")
        # Use appeal time range if available, else dialog range
        started_at = appeal_started_at or dialog["started_at"]
        ended_at = appeal_ended_at or dialog["ended_at"]

        # Resolve BIN from chat if dialog doesn't have one
        if not dialog_bin:
            chat_row = execute(
                "SELECT bin FROM chats WHERE chat_id = %s", (chat_id,)
            ).fetchone()
            if chat_row:
                dialog_bin = chat_row["bin"]

        # Resolve section from chat if dialog doesn't have one
        if not section:
            chat_row2 = execute(
                "SELECT section FROM chats WHERE chat_id = %s", (chat_id,)
            ).fetchone()
            if chat_row2:
                section = chat_row2["section"]

        # ── 2. Messages scoped to this appeal's time range ──
        if appeal_started_at and appeal_ended_at:
            messages = execute(
                """
                SELECT direction, text, author, created_at
                FROM messages
                WHERE dialog_id = %s AND created_at >= %s AND created_at <= %s
                ORDER BY created_at ASC
                """,
                (dialog_id, appeal_started_at, appeal_ended_at),
            ).fetchall()
        elif appeal_started_at:
            messages = execute(
                """
                SELECT direction, text, author, created_at
                FROM messages
                WHERE dialog_id = %s AND created_at >= %s
                ORDER BY created_at ASC
                """,
                (dialog_id, appeal_started_at),
            ).fetchall()
        else:
            # Legacy fallback: no appeal info, use all messages
            messages = execute(
                """
                SELECT direction, text, author, created_at
                FROM messages
                WHERE dialog_id = %s
                ORDER BY created_at ASC
                """,
                (dialog_id,),
            ).fetchall()

        msg_incoming = 0
        msg_outgoing = 0
        ai_messages_count = 0
        operator_requested = False
        first_incoming_text: Optional[str] = None
        first_incoming_length: Optional[int] = None
        operator_message_counts: Dict[str, int] = {}

        operator_request_keywords = {
            "[запрос оператора]",
            "[faq] связаться с оператором",
            "оператор",
            "👨‍💼 оператор",
        }

        for msg in messages:
            direction = (msg.get("direction") or "").strip()
            author_raw = (msg.get("author") or "").strip()
            author_lower = author_raw.lower()
            text = (msg.get("text") or "").strip()

            if direction == "incoming":
                msg_incoming += 1
                if first_incoming_text is None:
                    first_incoming_text = text
                    first_incoming_length = len(text)
                if text.lower() in operator_request_keywords:
                    operator_requested = True
            elif direction == "outgoing":
                msg_outgoing += 1
                if author_lower in automation_set:
                    ai_messages_count += 1
                elif author_raw and author_raw != "System":
                    # A human operator answered — mark as operator-handled
                    operator_requested = True
                    operator_message_counts[author_raw] = (
                        operator_message_counts.get(author_raw, 0) + 1
                    )

        msg_total = msg_incoming + msg_outgoing
        is_ai_closed = (ended_at is not None) and (not operator_requested)

        # ── 3. Response time analysis ──
        # Find incoming message timestamps that started customer request sequences
        incoming_times = []
        for msg in messages:
            direction = (msg.get("direction") or "").strip()
            if direction == "incoming":
                parsed = _parse_datetime(msg.get("created_at"))
                if parsed:
                    incoming_times.append(parsed)

        response_deltas: List[float] = []
        operator_response_deltas: Dict[str, List[float]] = {}

        if incoming_times:
            # For each incoming message, find the first human operator response
            request_index = 0
            pending_request = incoming_times[0]
            responded = False

            for msg in messages:
                created = _parse_datetime(msg.get("created_at"))
                if created is None:
                    continue

                # Advance to next request if needed
                while (
                    request_index + 1 < len(incoming_times)
                    and created >= incoming_times[request_index + 1]
                ):
                    request_index += 1
                    pending_request = incoming_times[request_index]
                    responded = False

                direction = (msg.get("direction") or "").strip()
                if direction != "outgoing":
                    continue

                author_raw = (msg.get("author") or "").strip()
                if not author_raw:
                    continue
                author_lower = author_raw.lower()
                if author_lower in automation_set:
                    continue
                if responded or created <= pending_request:
                    continue

                delta_seconds = (created - pending_request).total_seconds()
                responded = True
                response_deltas.append(delta_seconds)
                operator_response_deltas.setdefault(author_raw, []).append(
                    delta_seconds
                )

        avg_response_time_seconds: Optional[float] = None
        response_count = len(response_deltas)
        fast_responses = 0
        medium_responses = 0
        slow_responses = 0
        sla_violations = 0

        if response_deltas:
            avg_response_time_seconds = sum(response_deltas) / len(response_deltas)
            for d in response_deltas:
                minutes = d / 60.0
                if minutes <= 5:
                    fast_responses += 1
                elif minutes <= 15:
                    medium_responses += 1
                else:
                    slow_responses += 1
                if d > 300:  # > 5 minutes = SLA violation
                    sla_violations += 1

        # ── 4. Messages before first human operator reply (for transfer metric) ──
        msgs_before_transfer: Optional[int] = None
        if operator_requested and response_deltas:
            # Count incoming messages before first outgoing human reply
            first_human_reply_time: Optional[datetime] = None
            for msg in messages:
                direction = (msg.get("direction") or "").strip()
                if direction != "outgoing":
                    continue
                author_raw = (msg.get("author") or "").strip()
                if not author_raw or author_raw.lower() in automation_set:
                    continue
                parsed = _parse_datetime(msg.get("created_at"))
                if parsed:
                    first_human_reply_time = parsed
                    break

            if first_human_reply_time:
                count = 0
                for msg in messages:
                    direction = (msg.get("direction") or "").strip()
                    if direction != "incoming":
                        continue
                    parsed = _parse_datetime(msg.get("created_at"))
                    if parsed and parsed < first_human_reply_time:
                        count += 1
                msgs_before_transfer = count

        # ── 5. Check contract ──
        has_contract: Optional[bool] = None
        if dialog_bin:
            owc_row = execute(
                "SELECT 1 FROM organizations_without_contracts WHERE customer_bin = %s",
                (dialog_bin,),
            ).fetchone()
            has_contract = owc_row is None

        # ── 6. Write dialog_stats (one row per appeal) ──
        if appeal_id is not None:
            execute(
                """
                INSERT INTO dialog_stats (
                    dialog_id, appeal_id, chat_id, bin, section, started_at, ended_at,
                    msg_incoming, msg_outgoing, msg_total,
                    avg_response_time_seconds, response_count,
                    fast_responses, medium_responses, slow_responses,
                    sla_violations, is_ai_closed, operator_requested,
                    ai_messages_count, msgs_before_transfer,
                    first_message_text, first_message_length,
                    has_contract, created_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s,
                    %s, %s, %s,
                    %s, %s, %s,
                    %s, %s,
                    %s, %s,
                    %s, %s
                )
                ON CONFLICT (appeal_id) WHERE appeal_id IS NOT NULL DO UPDATE SET
                    ended_at = EXCLUDED.ended_at,
                    msg_incoming = EXCLUDED.msg_incoming,
                    msg_outgoing = EXCLUDED.msg_outgoing,
                    msg_total = EXCLUDED.msg_total,
                    avg_response_time_seconds = EXCLUDED.avg_response_time_seconds,
                    response_count = EXCLUDED.response_count,
                    fast_responses = EXCLUDED.fast_responses,
                    medium_responses = EXCLUDED.medium_responses,
                    slow_responses = EXCLUDED.slow_responses,
                    sla_violations = EXCLUDED.sla_violations,
                    is_ai_closed = EXCLUDED.is_ai_closed,
                    operator_requested = EXCLUDED.operator_requested,
                    ai_messages_count = EXCLUDED.ai_messages_count,
                    msgs_before_transfer = EXCLUDED.msgs_before_transfer,
                    first_message_text = EXCLUDED.first_message_text,
                    first_message_length = EXCLUDED.first_message_length,
                    has_contract = EXCLUDED.has_contract
                """,
                (
                    dialog_id, appeal_id, chat_id, dialog_bin, section, started_at, ended_at,
                    msg_incoming, msg_outgoing, msg_total,
                    avg_response_time_seconds, response_count,
                    fast_responses, medium_responses, slow_responses,
                    sla_violations, is_ai_closed, operator_requested,
                    ai_messages_count, msgs_before_transfer,
                    first_incoming_text, first_incoming_length,
                    has_contract, now,
                ),
            )
        else:
            # Legacy path: no appeal, store per-dialog
            execute(
                """
                INSERT INTO dialog_stats (
                    dialog_id, chat_id, bin, section, started_at, ended_at,
                    msg_incoming, msg_outgoing, msg_total,
                    avg_response_time_seconds, response_count,
                    fast_responses, medium_responses, slow_responses,
                    sla_violations, is_ai_closed, operator_requested,
                    ai_messages_count, msgs_before_transfer,
                    first_message_text, first_message_length,
                    has_contract, created_at
                ) VALUES (
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s,
                    %s, %s, %s,
                    %s, %s, %s,
                    %s, %s,
                    %s, %s,
                    %s, %s
                )
                """,
                (
                    dialog_id, chat_id, dialog_bin, section, started_at, ended_at,
                    msg_incoming, msg_outgoing, msg_total,
                    avg_response_time_seconds, response_count,
                    fast_responses, medium_responses, slow_responses,
                    sla_violations, is_ai_closed, operator_requested,
                    ai_messages_count, msgs_before_transfer,
                    first_incoming_text, first_incoming_length,
                    has_contract, now,
                ),
            )

        # Ensure idempotency for sub-tables
        execute("DELETE FROM dialog_operator_stats WHERE dialog_id = %s", (dialog_id,))
        execute("DELETE FROM stat_questions WHERE dialog_id = %s", (dialog_id,))

        # ── 7. Write dialog_operator_stats ──
        for op_name, deltas in operator_response_deltas.items():
            avg_op = sum(deltas) / len(deltas) if deltas else None
            execute(
                """
                INSERT INTO dialog_operator_stats
                    (dialog_id, operator_name, messages_sent,
                     avg_response_seconds, response_count, started_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    dialog_id,
                    op_name,
                    operator_message_counts.get(op_name, 0),
                    avg_op,
                    len(deltas),
                    started_at,
                ),
            )
        # Also save operators who sent messages but had no response deltas
        for op_name, msg_count in operator_message_counts.items():
            if op_name not in operator_response_deltas:
                execute(
                    """
                    INSERT INTO dialog_operator_stats
                        (dialog_id, operator_name, messages_sent,
                         avg_response_seconds, response_count, started_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (dialog_id, op_name, msg_count, None, 0, started_at),
                )

        # ── 8. Write stat_questions (incoming messages for question analytics) ──
        execute(
            "DELETE FROM stat_questions WHERE dialog_id = %s",
            (dialog_id,),
        )
        for msg in messages:
            direction = (msg.get("direction") or "").strip()
            if direction != "incoming":
                continue
            text = (msg.get("text") or "").strip()
            if not text:
                continue
            # Skip operator request keywords
            if text.lower() in operator_request_keywords:
                continue
            msg_created = msg.get("created_at") or now
            execute(
                """
                INSERT INTO stat_questions (dialog_id, text, created_at, section)
                VALUES (%s, %s, %s, %s)
                """,
                (dialog_id, text, msg_created, section),
            )


def cleanup_expired_dialogs(max_age_hours: int = 24) -> int:
    """Удаляет закрытые диалоги старше max_age_hours часов.

    Удаляет messages, favorites, dialog_reads, outbox_onec записи,
    и сам chat_dialogs. Метрики в dialog_stats остаются.
    Returns количество удалённых диалогов.
    """
    cutoff = (
        datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
    ).isoformat()

    with _lock:
        # Find dialogs closed before cutoff
        expired_rows = execute(
            """
            SELECT id, chat_id, bin FROM chat_dialogs
            WHERE ended_at IS NOT NULL AND ended_at < %s
            """,
            (cutoff,),
        ).fetchall()

        if not expired_rows:
            return 0

        expired_ids = [int(row["id"]) for row in expired_rows]
        bins_to_check = {row["bin"] for row in expired_rows if row["bin"]}
        placeholders = ",".join("%s" for _ in expired_ids)

        # Delete outbox entries linked to those messages (BEFORE deleting messages)
        execute(
            f"""
            DELETE FROM outbox_onec
            WHERE message_id IN (
                SELECT id FROM messages WHERE dialog_id IN ({placeholders})
            )
            """,
            expired_ids,
        )

        # Delete related messages
        execute(
            f"DELETE FROM messages WHERE dialog_id IN ({placeholders})",
            expired_ids,
        )

        # Delete favorites
        execute(
            f"DELETE FROM favorites WHERE dialog_id IN ({placeholders})",
            expired_ids,
        )

        # Delete read marks
        execute(
            f"DELETE FROM dialog_reads WHERE dialog_id IN ({placeholders})",
            expired_ids,
        )

        # Delete appeals
        execute(
            f"DELETE FROM appeals WHERE dialog_id IN ({placeholders})",
            expired_ids,
        )

        # Delete the dialogs themselves
        execute(
            f"DELETE FROM chat_dialogs WHERE id IN ({placeholders})",
            expired_ids,
        )

        # Clean orphaned BINs
        _cleanup_orphaned_bins(bins_to_check)

    logger.info(
        "Cleanup: removed %d expired dialog(s) closed before %s",
        len(expired_ids),
        cutoff,
    )
    return len(expired_ids)


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
        "  COALESCE(cd.section, c.section) AS section,",
        "  c.updated_at AS chat_updated_at,",
        "  cd.id AS dialog_id,",
        "  cd.bin AS dialog_bin,",
        "  cd.started_at AS dialog_started_at,",
        "  cd.ended_at AS dialog_ended_at,",
        "  cd.last_message_at AS dialog_last_message_at,",
        "  cd.operator_mode AS dialog_operator_mode,",
        "  f.user_id AS fav_user_id,",
        "  dr.last_read_at AS last_read_at,",
        "  COALESCE((",
        "    SELECT COUNT(*) FROM messages m",
        "    WHERE m.chat_id = c.chat_id",
        "      AND m.dialog_id = cd.id",
        "      AND m.direction = 'incoming'",
        "      AND (dr.last_read_at IS NULL OR m.created_at > dr.last_read_at)",
        "  ), 0) AS unread_count",
        "FROM chat_dialogs cd",
        "JOIN chats c ON c.chat_id = cd.chat_id",
        "LEFT JOIN favorites f ON f.dialog_id = cd.id AND f.user_id = %s",
        "LEFT JOIN dialog_reads dr ON dr.dialog_id = cd.id AND dr.user_id = %s",
    ]
    params: List[object] = [user_id, user_id]
    filters: List[str] = []
    if not is_admin_like(role):
        allowed_sections = get_user_sections(user_id)
        assigned_bins = get_user_bins(user_id)
        if not assigned_bins:
            return []
        if allowed_sections:
            section_placeholders = ",".join("%s" for _ in allowed_sections)
            filters.append(f"(COALESCE(cd.section, c.section) IN ({section_placeholders}) OR COALESCE(cd.section, c.section) IS NULL)")
            params.extend(allowed_sections)
        bin_placeholders = ",".join("%s" for _ in assigned_bins)
        filters.append(f"cd.bin IN ({bin_placeholders})")
        params.extend(assigned_bins)
    if favorite_only:
        filters.append("f.user_id IS NOT NULL")
    if bin_query:
        filters.append("cd.bin LIKE %s")
        params.append(f"%{bin_query.strip()}%")
    if filters:
        query_parts.append("WHERE " + " AND ".join(filters))
    query_parts.append(
        "ORDER BY COALESCE(cd.last_message_at, c.updated_at, cd.started_at) DESC"
    )
    sql = "\n".join(query_parts)
    with _lock:
        rows = execute(sql, params).fetchall()
    chats: List[dict] = []
    for row in rows:
        updated_raw = (
            row["dialog_last_message_at"]
            or row["chat_updated_at"]
            or row["dialog_started_at"]
        )
        if not updated_raw:
            updated_raw = datetime.now(timezone.utc).isoformat()
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
                "operator_mode": bool(row["dialog_operator_mode"]),
                "unread_count": int(row["unread_count"] or 0),
            }
        )
    return chats


def mark_dialog_read(user_id: int, dialog_id: int) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        execute(
            """
            INSERT INTO dialog_reads (user_id, dialog_id, last_read_at)
            VALUES (%s, %s, %s)
            ON CONFLICT (user_id, dialog_id)
            DO UPDATE SET last_read_at = excluded.last_read_at
            """,
            (user_id, dialog_id, now),
        )


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
        "WHERE chat_id = %s",
    ]
    params: List[object] = [chat_id]
    if dialog_id is not None:
        query_parts.append("AND dialog_id = %s")
        params.append(dialog_id)
    if allowed_sections is not None:
        allowed_list = [section for section in allowed_sections if section]
        if allowed_list:
            placeholders = ",".join("%s" for _ in allowed_list)
            query_parts.append(
                f"AND (section IS NULL OR section IN ({placeholders}))"
            )
            params.extend(allowed_list)
        else:
            query_parts.append("AND section IS NULL")
    query_parts.append("ORDER BY created_at DESC")
    query_parts.append("LIMIT %s")
    params.append(limit)
    sql = "\n".join(query_parts)
    with _lock:
        rows = execute(sql, params).fetchall()
    messages = []
    for row in rows:
        message = asdict(Message.from_row(row))
        message["created_at"] = message["created_at"].isoformat()
        messages.append(message)
    return list(reversed(messages))


def set_chat_section(chat_id: int, section: str | None, dialog_id: int | None = None) -> None:
    """Устанавливает раздел для активного диалога (по БИН), а не для чата целиком."""
    target_dialog_id = dialog_id
    if target_dialog_id is None:
        active = get_active_chat_dialog(chat_id)
        if active:
            target_dialog_id = active["id"]

    with _lock:
        if target_dialog_id:
            execute(
                "UPDATE chat_dialogs SET section = %s WHERE id = %s",
                (section, target_dialog_id),
            )
        # Также обновляем chats.section для обратной совместимости
        execute(
            "UPDATE chats SET section = %s WHERE chat_id = %s",
            (section, chat_id),
        )


def get_dialog_section(chat_id: int, dialog_id: int | None = None) -> str | None:
    """Получить раздел из активного диалога (по БИН)."""
    target_dialog_id = dialog_id
    if target_dialog_id is None:
        active = get_active_chat_dialog(chat_id)
        if active:
            target_dialog_id = active["id"]

    if target_dialog_id:
        with _lock:
            row = execute(
                "SELECT section FROM chat_dialogs WHERE id = %s",
                (target_dialog_id,),
            ).fetchone()
            return row["section"] if row else None
            
    return None


def set_chat_bin(chat_id: int, bin_value: str | None) -> tuple[int | None, bool]:
    """Activate or create a dialog for the given BIN.

    Returns ``(dialog_id, is_resumed)`` where *is_resumed* is True when a
    previously-closed dialog was re-opened.
    """
    normalized = (bin_value or "").strip()
    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        if not normalized:
            execute(
                """
                UPDATE chats
                SET bin = NULL, section = NULL, updated_at = %s
                WHERE chat_id = %s
                """,
                (now, chat_id),
            )
            execute(
                "UPDATE chat_dialogs SET ended_at = COALESCE(ended_at, %s) WHERE chat_id = %s AND ended_at IS NULL",
                (now, chat_id),
            )
            return None, False

        # Add BIN to all_bins for persistent storage
        existing = execute(
            "SELECT 1 FROM all_bins WHERE bin = %s", (normalized,)
        ).fetchone()
        if not existing:
            execute(
                "INSERT INTO all_bins (bin, created_at) VALUES (%s, %s)",
                (normalized, now),
            )

        # Check for existing active dialog with same BIN
        active = execute(
            """
            SELECT id, bin FROM chat_dialogs
            WHERE chat_id = %s AND ended_at IS NULL
            ORDER BY started_at DESC LIMIT 1
            """,
            (chat_id,),
        ).fetchone()

        if active and active["bin"] == normalized:
            # Already have active dialog with this BIN — ensure appeal exists
            dialog_id = int(active["id"])
            active_appeal = execute(
                "SELECT 1 FROM appeals WHERE dialog_id = %s AND ended_at IS NULL LIMIT 1",
                (dialog_id,),
            ).fetchone()
            execute(
                "UPDATE chats SET bin = %s, updated_at = %s WHERE chat_id = %s",
                (normalized, now, chat_id),
            )
            if not active_appeal:
                create_appeal(dialog_id, chat_id)
            return dialog_id, False

        # Close any active dialog with DIFFERENT BIN
        if active:
            old_dialog_id = int(active["id"])
            execute(
                "UPDATE chat_dialogs SET ended_at = %s, last_message_at = COALESCE(last_message_at, %s) WHERE id = %s",
                (now, now, old_dialog_id),
            )

        # Look for previously closed dialog with this BIN
        previous = execute(
            """
            SELECT id FROM chat_dialogs
            WHERE chat_id = %s AND bin = %s
            ORDER BY started_at DESC LIMIT 1
            """,
            (chat_id, normalized),
        ).fetchone()

        is_resumed = False
        if previous:
            # Reactivate existing dialog
            dialog_id = int(previous["id"])
            execute(
                "UPDATE chat_dialogs SET ended_at = NULL, last_message_at = %s WHERE id = %s",
                (now, dialog_id),
            )
            is_resumed = True
        else:
            # Create brand new dialog
            cursor = execute(
                """
                INSERT INTO chat_dialogs (chat_id, bin, started_at, last_message_at, operator_mode)
                VALUES (%s, %s, %s, %s, 0)
                RETURNING id
                """,
                (chat_id, normalized, now, now),
            )
            dialog_id_row = cursor.fetchone()
            dialog_id = int(dialog_id_row["id"]) if dialog_id_row else None
            if dialog_id is None:
                raise RuntimeError("Failed to create dialog")

        execute(
            """
            UPDATE chats
            SET bin = %s, section = NULL, updated_at = %s
            WHERE chat_id = %s
            """,
            (normalized, now, chat_id),
        )

    # Close appeal + snapshot for old dialog (if we switched BINs)
    if active and active["bin"] != normalized:
        old_dialog_id = int(active["id"])
        close_appeal(old_dialog_id, "system")
        snapshot_dialog_metrics(old_dialog_id)

    # Create new appeal for this activation
    create_appeal(dialog_id, chat_id)
    return dialog_id, is_resumed


def ensure_active_chat_dialog(chat_id: int, bin_value: str, section: str | None = None) -> int:
    """Ensure there is an active dialog for the chat with the given BIN."""

    normalized = (bin_value or "").strip()
    if not normalized:
        raise ValueError("BIN value is required to create a dialog")

    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        existing_bin = execute(
            "SELECT 1 FROM all_bins WHERE bin = %s",
            (normalized,),
        ).fetchone()
        if not existing_bin:
            execute(
                "INSERT INTO all_bins (bin, created_at) VALUES (%s, %s)",
                (normalized, now),
            )

        existing = execute(
            """
            SELECT id, bin
            FROM chat_dialogs
            WHERE chat_id = %s AND ended_at IS NULL
            ORDER BY started_at DESC
            LIMIT 1
            """,
            (chat_id,),
        ).fetchone()

        if existing and existing["bin"] == normalized:
            dialog_id = int(existing["id"])
            # Update section if provided
            if section:
                execute(
                    "UPDATE chat_dialogs SET section = %s, last_message_at = COALESCE(last_message_at, %s) WHERE id = %s",
                    (section, now, dialog_id),
                )
            else:
                execute(
                    "UPDATE chat_dialogs SET last_message_at = COALESCE(last_message_at, %s) WHERE id = %s",
                    (now, dialog_id),
                )
            execute(
                "UPDATE chats SET bin = %s, updated_at = %s WHERE chat_id = %s",
                (normalized, now, chat_id),
            )
            # Ensure appeal exists for this dialog
            appeal_exists = execute(
                "SELECT 1 FROM appeals WHERE dialog_id = %s AND ended_at IS NULL LIMIT 1",
                (dialog_id,),
            ).fetchone()
            if not appeal_exists:
                create_appeal(dialog_id, chat_id, section)
            return dialog_id

        # Закрываем активные диалоги с другим БИН, чтобы исключить дубликаты
        execute(
            "UPDATE chat_dialogs SET ended_at = COALESCE(ended_at, %s), last_message_at = COALESCE(last_message_at, %s) WHERE chat_id = %s AND ended_at IS NULL",
            (now, now, chat_id),
        )

        # Проверяем, существует ли ранее созданный диалог с тем же БИН
        previous = execute(
            """
            SELECT id, ended_at
            FROM chat_dialogs
            WHERE chat_id = %s AND bin = %s
            ORDER BY started_at DESC
            LIMIT 1
            """,
            (chat_id, normalized),
        ).fetchone()

        if previous:
            dialog_id = int(previous["id"])
            # Reactivate with section
            if section:
                execute(
                    "UPDATE chat_dialogs SET ended_at = NULL, section = %s, last_message_at = COALESCE(last_message_at, %s) WHERE id = %s",
                    (section, now, dialog_id),
                )
            else:
                execute(
                    "UPDATE chat_dialogs SET ended_at = NULL, last_message_at = COALESCE(last_message_at, %s) WHERE id = %s",
                    (now, dialog_id),
                )
            execute(
                "UPDATE chats SET bin = %s, section = NULL, updated_at = %s WHERE chat_id = %s",
                (normalized, now, chat_id),
            )
            # Create new appeal for reactivated dialog
            create_appeal(dialog_id, chat_id, section)
            return dialog_id

        cursor = execute(
            """
            INSERT INTO chat_dialogs (chat_id, bin, section, started_at, last_message_at, operator_mode)
            VALUES (%s, %s, %s, %s, %s, 0)
            RETURNING id
            """,
            (chat_id, normalized, section, now, now),
        )
        dialog_id_row = cursor.fetchone()
        execute(
            """
            UPDATE chats
            SET bin = %s, section = NULL, updated_at = %s
            WHERE chat_id = %s
            """,
            (normalized, now, chat_id),
        )

    if not dialog_id_row:
        raise RuntimeError("Failed to create chat dialog")
    dialog_id = int(dialog_id_row["id"])
    # Create first appeal for new dialog
    create_appeal(dialog_id, chat_id, section)
    return dialog_id


def get_chat(chat_id: int) -> Optional[Dict[str, object]]:
    with _lock:
        row = execute(
            """
            SELECT chat_id, title, username, type, updated_at, section, bin, external_chat_id
            FROM chats
            WHERE chat_id = %s
            """,
            (chat_id,),
        ).fetchone()
    if row is None:
        return None
    return dict(asdict(Chat.from_row(row)))


def get_user_sections(user_id: int) -> List[str]:
    with _lock:
        rows = execute(
            "SELECT section FROM user_sections WHERE user_id = %s ORDER BY section ASC",
            (user_id,),
        ).fetchall()
    return [row["section"] for row in rows]


def set_user_sections(user_id: int, sections: Iterable[str]) -> List[str]:
    normalized = sorted({section.strip() for section in sections if section and section.strip()})
    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        if normalized:
            placeholders = ",".join("%s" for _ in normalized)
            execute(
                f"DELETE FROM user_sections WHERE user_id = %s AND section NOT IN ({placeholders})",
                (user_id, *normalized),
            )
        else:
            execute("DELETE FROM user_sections WHERE user_id = %s", (user_id,))
        for section in normalized:
            execute(
                """
                INSERT INTO user_sections (user_id, section, created_at)
                VALUES (%s, %s, %s)
                ON CONFLICT (user_id, section) DO NOTHING
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


_last_bin_refresh: datetime | None = None
_BIN_REFRESH_INTERVAL = timedelta(seconds=60)


def refresh_bin_assignments(now: datetime | None = None) -> None:
    global _last_bin_refresh
    current_time = now or datetime.now(timezone.utc)
    if _last_bin_refresh and (current_time - _last_bin_refresh) < _BIN_REFRESH_INTERVAL:
        return
    _last_bin_refresh = current_time
    now_iso = current_time.isoformat()
    with _lock:
        rows = execute(
            """
            SELECT user_id, bin
            FROM user_bins
            WHERE expires_at IS NOT NULL
              AND TRIM(expires_at) != ''
              AND expires_at <= %s
            """,
            (now_iso,),
        ).fetchall()
        for row in rows:
            user_id = int(row["user_id"])
            bin_value = row["bin"]
            execute(
                "DELETE FROM user_bins WHERE user_id = %s AND bin = %s",
                (user_id, bin_value),
            )




def get_user_bin_assignments(user_id: int, *, include_expired: bool = False) -> List[Dict[str, object]]:
    refresh_bin_assignments()
    reference = datetime.now(timezone.utc).isoformat()
    query_parts = [
        "SELECT bin, created_at, expires_at, assigned_by",
        "FROM user_bins",
        "WHERE user_id = %s",
    ]
    params: List[object] = [user_id]
    if not include_expired:
        query_parts.append("AND (expires_at IS NULL OR expires_at > %s)")
        params.append(reference)
    query_parts.append("ORDER BY bin ASC")
    sql = "\n".join(query_parts)
    with _lock:
        rows = execute(sql, params).fetchall()
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
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    with _lock:
        existing_rows = execute(
            "SELECT bin FROM user_bins WHERE user_id = %s",
            (user_id,),
        ).fetchall()
        current_bins = {row["bin"] for row in existing_rows}
        new_bins = set(normalized.keys())
        if new_bins:
            placeholders = ",".join("%s" for _ in new_bins)
            execute(
                f"DELETE FROM user_bins WHERE user_id = %s AND bin NOT IN ({placeholders})",
                (user_id, *new_bins),
            )
        else:
            execute("DELETE FROM user_bins WHERE user_id = %s", (user_id,))
        
        added_bins = sorted(new_bins - current_bins)
        for bin_value in new_bins:
            expires_at = normalized[bin_value]
            if bin_value in current_bins:
                execute(
                    """
                    UPDATE user_bins
                    SET expires_at = %s,
                        assigned_by = CASE WHEN %s IS NOT NULL THEN %s ELSE assigned_by END
                    WHERE user_id = %s AND bin = %s
                    """,
                    (expires_at, assigned_by, assigned_by, user_id, bin_value),
                )
            else:
                execute(
                    """
                    INSERT INTO user_bins (user_id, bin, created_at, expires_at, assigned_by)
                    VALUES (%s, %s, %s, %s, %s)
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
    with _lock:
        cursor = execute("DELETE FROM users WHERE id = %s", (user_id,))
        if cursor.rowcount == 0:
            raise ValueError("Пользователь не найден")


def list_favorite_dialog_ids(user_id: int) -> List[int]:
    with _lock:
        rows = execute(
            "SELECT dialog_id FROM favorites WHERE user_id = %s ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    return [int(row["dialog_id"]) for row in rows]


def set_favorite_dialog(user_id: int, dialog_id: int, favorite: bool) -> None:
    with _lock:
        dialog = execute(
            "SELECT id FROM chat_dialogs WHERE id = %s",
            (dialog_id,),
        ).fetchone()
        if dialog is None:
            raise ValueError("Диалог не найден")
        if favorite:
            now = datetime.now(timezone.utc).isoformat()
            execute(
                """
                INSERT INTO favorites (user_id, dialog_id, created_at)
                VALUES (%s, %s, %s)
                ON CONFLICT (user_id, dialog_id) DO UPDATE
                SET created_at = EXCLUDED.created_at
                """,
                (user_id, dialog_id, now),
            )
        else:
            execute(
                "DELETE FROM favorites WHERE user_id = %s AND dialog_id = %s",
                (user_id, dialog_id),
            )


def is_favorite_dialog(user_id: int, dialog_id: int) -> bool:
    with _lock:
        row = execute(
            "SELECT 1 FROM favorites WHERE user_id = %s AND dialog_id = %s",
            (user_id, dialog_id),
        ).fetchone()
    return row is not None


def list_bins(query: str | None = None) -> List[str]:
    """Возвращает список всех БИНов из таблицы all_bins."""
    clauses = [
        "SELECT bin FROM all_bins WHERE bin IS NOT NULL AND TRIM(bin) != ''"
    ]
    params: List[object] = []
    if query:
        clauses.append("AND bin LIKE %s")
        params.append(f"%{query.strip()}%")
    clauses.append("ORDER BY bin ASC")
    sql = "\n".join(clauses)
    with _lock:
        rows = execute(sql, params).fetchall()
    return [row["bin"] for row in rows]


def add_bin(bin_value: str) -> bool:
    """Добавляет БИН в таблицу all_bins."""
    normalized = (bin_value or "").strip()
    if not normalized:
        return False
    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        existing = execute(
            "SELECT 1 FROM all_bins WHERE bin = %s", (normalized,)
        ).fetchone()
        if existing:
            return False
        execute(
            "INSERT INTO all_bins (bin, created_at) VALUES (%s, %s)",
            (normalized, now),
        )
    return True


def remove_bin(bin_value: str) -> bool:
    """Удаляет БИН из all_bins и связанных таблиц."""
    normalized = (bin_value or "").strip()
    if not normalized:
        return False
    with _lock:
        # Remove from all_bins
        cursor = execute("DELETE FROM all_bins WHERE bin = %s", (normalized,))
        deleted = cursor.rowcount > 0
        if deleted:
            # Cascade: remove from client_bins
            execute("DELETE FROM client_bins WHERE bin = %s", (normalized,))
            # Cascade: remove from organizations_without_contracts
            execute("DELETE FROM organizations_without_contracts WHERE customer_bin = %s", (normalized,))
            # Cascade: remove from user_bins
            execute("DELETE FROM user_bins WHERE bin = %s", (normalized,))
    return deleted


def add_client_bin(chat_id: int, bin_value: str) -> bool:
    """Добавляет БИН для клиента (chat_id) в client_bins."""
    normalized = (bin_value or "").strip()
    if not normalized:
        return False
    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        existing = execute(
            "SELECT 1 FROM client_bins WHERE chat_id = %s AND bin = %s",
            (chat_id, normalized),
        ).fetchone()
        if existing:
            return False
        execute(
            "INSERT INTO client_bins (chat_id, bin, created_at) VALUES (%s, %s, %s)",
            (chat_id, normalized, now),
        )
    return True


def list_client_bins(chat_id: int) -> List[str]:
    """Возвращает список БИНов клиента."""
    with _lock:
        rows = execute(
            "SELECT bin FROM client_bins WHERE chat_id = %s ORDER BY created_at DESC",
            (chat_id,),
        ).fetchall()
    return [row["bin"] for row in rows]


def remove_client_bin(chat_id: int, bin_value: str) -> bool:
    """Удаляет БИН клиента."""
    normalized = (bin_value or "").strip()
    if not normalized:
        return False
    with _lock:
        cursor = execute(
            "DELETE FROM client_bins WHERE chat_id = %s AND bin = %s",
            (chat_id, normalized),
        )
    return cursor.rowcount > 0


def list_unassigned_bins() -> List[Dict[str, object]]:
    """
    Возвращает список всех БИНов, которые не назначены ни одному сотруднику.
    Включает поле has_contract для отображения статуса договора.
    """
    refresh_bin_assignments()
    reference = datetime.now(timezone.utc).isoformat()
    with _lock:
        rows = execute(
            """
            WITH assigned_bins AS (
                SELECT DISTINCT bin
                FROM user_bins
                WHERE bin IS NOT NULL
                  AND TRIM(bin) != ''
                  AND (expires_at IS NULL OR expires_at > %s)
            ),
            dialogs_count AS (
                SELECT
                    cd.bin AS bin,
                    COUNT(*) AS open_dialogs
                FROM chat_dialogs cd
                WHERE cd.ended_at IS NULL
                  AND cd.bin IS NOT NULL
                  AND TRIM(cd.bin) != ''
                GROUP BY cd.bin
            )
            SELECT
                ab.bin AS bin,
                COALESCE(dc.open_dialogs, 0) AS open_dialogs,
                CASE WHEN owc.customer_bin IS NULL THEN 1 ELSE 0 END AS has_contract
            FROM all_bins ab
            LEFT JOIN assigned_bins asb ON asb.bin = ab.bin
            LEFT JOIN organizations_without_contracts owc ON owc.customer_bin = ab.bin
            LEFT JOIN dialogs_count dc ON dc.bin = ab.bin
            WHERE ab.bin IS NOT NULL
              AND TRIM(ab.bin) != ''
              AND asb.bin IS NULL
            ORDER BY COALESCE(dc.open_dialogs, 0) DESC, ab.bin ASC
            """,
            (reference,),
        ).fetchall()
    return [
        {
            "bin": row["bin"],
            "open_dialogs": int(row["open_dialogs"] or 0),
            "has_contract": bool(row["has_contract"]),
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
    timestamp = created_at or datetime.now(timezone.utc).isoformat()
    serialized = json.dumps(payload, ensure_ascii=False)
    with _lock:
        execute(
            """
            INSERT INTO notifications (user_id, kind, payload, created_at)
            VALUES (%s, %s, %s, %s)
            """,
            (user_id, kind, serialized, timestamp),
        )


def list_notifications_since(user_id: int, since: Optional[datetime] = None) -> List[dict]:
    query = [
        "SELECT id, kind, payload, created_at",
        "FROM notifications",
        "WHERE user_id = %s",
    ]
    params: List[object] = [user_id]
    if since is not None:
        query.append("AND created_at > %s")
        params.append(since.isoformat())
    query.append("ORDER BY created_at ASC, id ASC")
    sql = "\n".join(query)
    with _lock:
        rows = execute(sql, params).fetchall()
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
    with _lock:
        existing = execute(
            "SELECT chat_id FROM chats WHERE chat_id = %s",
            (chat_id,),
        ).fetchone()
        if existing is None:
            raise ValueError("Chat not found")
        # Метрики уже записаны в dialog_stats при закрытии диалога — архивация не нужна
        execute("DELETE FROM messages WHERE chat_id = %s", (chat_id,))
        dialog_rows = execute(
            "SELECT id, bin FROM chat_dialogs WHERE chat_id = %s",
            (chat_id,),
        ).fetchall()
        dialog_ids = [row["id"] for row in dialog_rows]
        bins_to_check = {row["bin"] for row in dialog_rows if row["bin"]}
        if dialog_ids:
            placeholders = ",".join("%s" for _ in dialog_ids)
            execute(
                f"DELETE FROM favorites WHERE dialog_id IN ({placeholders})",
                dialog_ids,
            )
        execute("DELETE FROM chat_dialogs WHERE chat_id = %s", (chat_id,))
        _cleanup_orphaned_bins(bins_to_check)
        execute("DELETE FROM chats WHERE chat_id = %s", (chat_id,))


def delete_chat_dialog(dialog_id: int) -> None:
    with _lock:
        dialog_row = execute(
            "SELECT id, chat_id, bin FROM chat_dialogs WHERE id = %s",
            (dialog_id,),
        ).fetchone()
        if dialog_row is None:
            raise ValueError("Диалог не найден")
        chat_id = dialog_row["chat_id"]
        dialog_bin = dialog_row["bin"]
        message_rows = execute(
            "SELECT id, message_id FROM messages WHERE dialog_id = %s",
            (dialog_id,),
        ).fetchall()
        message_ids = [row["message_id"] for row in message_rows if row["message_id"] is not None]
        if message_ids:
            placeholders = ",".join("%s" for _ in message_ids)
            execute(
                f"DELETE FROM outbox_onec WHERE message_id IN ({placeholders})",
                message_ids,
            )
        # Метрики уже записаны в dialog_stats при закрытии — архивация не нужна
        execute("DELETE FROM messages WHERE dialog_id = %s", (dialog_id,))
        execute(
            "DELETE FROM favorites WHERE dialog_id = %s",
            (dialog_id,),
        )
        execute("DELETE FROM chat_dialogs WHERE id = %s", (dialog_id,))
        _cleanup_orphaned_bins({dialog_bin} if dialog_bin else set())
        latest = execute(
            """
            SELECT id, bin, started_at, last_message_at
            FROM chat_dialogs
            WHERE chat_id = %s
            ORDER BY started_at DESC
            LIMIT 1
            """,
            (chat_id,),
        ).fetchone()
        if latest:
            timestamp = latest["last_message_at"] or latest["started_at"] or datetime.now(timezone.utc).isoformat()
            section_row = execute(
                """
                SELECT section
                FROM messages
                WHERE dialog_id = %s AND section IS NOT NULL
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (latest["id"],),
            ).fetchone()
            section_value = section_row["section"] if section_row else None
            execute(
                "UPDATE chats SET bin = %s, section = %s, updated_at = %s WHERE chat_id = %s",
                (latest["bin"], section_value, timestamp, chat_id),
            )
        # NOTE: When no dialogs remain, keep existing bin in chats table
        # to allow client to create new dialog with same BIN


def _cleanup_orphaned_bins(bins: Iterable[str]) -> None:
    cleaned = {str(bin_value).strip() for bin_value in bins if bin_value and str(bin_value).strip()}
    if not cleaned:
        return
    placeholders = ",".join("%s" for _ in cleaned)
    existing_rows = execute(
        f"SELECT DISTINCT bin FROM chat_dialogs WHERE bin IN ({placeholders})",
        tuple(cleaned),
    ).fetchall()
    existing_bins = {row["bin"] for row in existing_rows}
    orphaned = cleaned - existing_bins
    if not orphaned:
        return
    orphan_placeholders = ",".join("%s" for _ in orphaned)
    execute(
        f"DELETE FROM user_bins WHERE bin IN ({orphan_placeholders})",
        tuple(orphaned),
    )


def _row_to_user(row: Mapping[str, Any] | None) -> dict | None:
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
        "is_approved": bool(row.get("is_approved", 1)),
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
        "role": user.get("role", ROLE_OPERATOR),
        "is_approved": bool(user.get("is_approved", True)),
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
    role: str = ROLE_OPERATOR,
    is_approved: bool = True,
) -> dict:
    if role not in ALL_ROLES:
        raise ValueError("Invalid role")
    login_value = (login or email).strip()
    existing_login = find_user_by_login(login_value)
    if existing_login:
        raise ValueError("Login already exists")
    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        cursor = execute(
            """
            INSERT INTO users (email, name, password_hash, created_at, job_title, phone, bio, login, role, is_approved)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
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
                1 if is_approved else 0,
            ),
        )
        user_row = cursor.fetchone()
        if not user_row:
            raise RuntimeError("Failed to insert user")
        user_id = int(user_row["id"])
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
            "is_approved": is_approved,
        },
        include_sections=False,
    )


def find_user_by_email(email: str) -> Optional[dict]:
    return _fetch_user("email = %s", email)


def find_user_by_login(login: str) -> Optional[dict]:
    return _fetch_user("login = %s", login)


def find_user_by_identifier(identifier: str) -> Optional[dict]:
    normalized = identifier.strip()
    user = find_user_by_login(normalized)
    if user:
        return user
    return find_user_by_email(normalized)


def get_user_by_id(user_id: int) -> Optional[dict]:
    return _fetch_user("id = %s", user_id)


def verify_user_password(user_id: int, password_hash: str) -> bool:
    with _lock:
        row = execute(
            "SELECT password_hash FROM users WHERE id = %s",
            (user_id,),
        ).fetchone()
    if row is None:
        raise ValueError("User not found")
    return row["password_hash"] == password_hash


def delete_sessions_for_user(user_id: int) -> None:
    with _lock:
        execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))


def update_user_password(user_id: int, password_hash: str) -> dict:
    with _lock:
        cursor = execute(
            "UPDATE users SET password_hash = %s WHERE id = %s",
            (password_hash, user_id),
        )
        if cursor.rowcount == 0:
            raise ValueError("User not found")
        execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))
    return _sanitize_user_payload(get_user_by_id(user_id))


def create_session(user_id: int) -> str:
    token = uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        execute(
            "INSERT INTO sessions (token, user_id, created_at) VALUES (%s, %s, %s)",
            (token, user_id, now),
        )
    return token


def get_user_by_session(token: str) -> Optional[dict]:
    with _lock:
        row = execute(
            f"SELECT {_user_columns('u')} FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = %s",
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
    with _lock:
        try:
            execute(
                """
                UPDATE users
                SET name = %s, job_title = %s, phone = %s, bio = %s, email = %s
                WHERE id = %s
                """,
                (name, job_title, phone, bio, email or "", user_id),
            )
        except psycopg2.errors.UniqueViolation as exc:
            raise ValueError("Адрес электронной почты уже используется") from exc
    return _sanitize_user_payload(get_user_by_id(user_id))


def list_users(query: str | None = None) -> List[dict]:
    filters: List[str] = []
    params: List[object] = []
    if query:
        normalized = f"%{query.strip().lower()}%"
        filters.append(
            "(LOWER(email) LIKE %s OR LOWER(login) LIKE %s OR LOWER(name) LIKE %s)"
        )
        params.extend([normalized, normalized, normalized])
    with _lock:
        sql = [f"SELECT {_user_columns('u')}", "FROM users u"]
        if filters:
            sql.append("WHERE " + " AND ".join(filters))
        sql.append("ORDER BY u.created_at ASC")
        rows = execute("\n".join(sql), params).fetchall()
    return [
        _sanitize_user_payload(_row_to_user(row))  # type: ignore[arg-type]
        for row in rows
    ]


def list_pending_users() -> List[dict]:
    with _lock:
        rows = execute(
            f"SELECT {_user_columns('u')} FROM users u WHERE COALESCE(u.is_approved, 0) = 0 ORDER BY u.created_at DESC"
        ).fetchall()
    return [_row_to_user(row) for row in rows]


def set_user_approved(user_id: int, is_approved: bool) -> dict:
    with _lock:
        execute(
            "UPDATE users SET is_approved = %s WHERE id = %s",
            (1 if is_approved else 0, user_id),
        )
    return _sanitize_user_payload(get_user_by_id(user_id))


def update_user_role(user_id: int, role: str) -> dict:
    if role not in ALL_ROLES:
        raise ValueError("Invalid role")
    with _lock:
        execute(
            "UPDATE users SET role = %s WHERE id = %s",
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
        "question": "Как получить доступ к консультациям по 1С%s",
        "answer": "Отправьте нам номер договора или БИН, и консультант откроет доступ к чату и вебинарам по 1С.",
        "keywords": ["доступ", "1с", "консультац"],
    },
    {
        "section": "general",
        "question": "Сколько стоит сопровождение%s",
        "answer": "Базовый тариф включает 10 консультаций в месяц. Расширенные пакеты уточните у оператора.",
        "keywords": ["стоим", "тариф", "цен"],
    },
    {
        "section": "finance",
        "question": "Как выгрузить отчёт по НДС в 1С%s",
        "answer": "Откройте раздел 'Отчётность', выберите период и используйте отчёт 'Декларация по НДС'.",
        "keywords": ["ндс", "отчет", "выгруз"],
    },
    {
        "section": "finance",
        "question": "Как исправить ошибку при проведении платежа%s",
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
        "question": "Как подключить удалённого бухгалтера%s",
        "answer": "Добавьте его в группу доступа и отправьте приглашение из раздела 'Сотрудники'.",
        "keywords": ["удален", "бухгалтер", "подключ"],
    },
    {
        "section": "hr",
        "question": "Как выгрузить форму Т-2%s",
        "answer": "Перейдите в 'Кадровый учёт' → 'Сотрудники' → 'Карточка сотрудника' и нажмите 'Печать формы Т-2'.",
        "keywords": ["т-2", "форма", "кадров"],
    },
    {
        "section": "hr",
        "question": "Как оформить отпуск сотруднику%s",
        "answer": "Создайте документ 'Отпуск' в разделе 'Кадровый учёт', укажите даты и вид отпуска, затем проведите документ.",
        "keywords": ["отпуск", "оформ"],
    },
]


def list_faq(section: str | None = None) -> List[dict]:
    if section:
        return [entry for entry in FAQ_ENTRIES if entry["section"] == section]
    return list(FAQ_ENTRIES)


def find_faq_entry_by_keywords(text: str, section: str | None = None) -> Optional[dict]:
    """Возвращает FAQ запись, ключевые слова которой встречаются в тексте."""

    normalized = (text or "").strip().lower()
    if not normalized:
        return None

    entries: List[dict] = []
    if section:
        entries.extend(list_faq(section))

    entries.extend(
        entry
        for entry in FAQ_ENTRIES
        if not section or entry["section"] != section
    )

    for entry in entries:
        for keyword in entry.get("keywords", []):
            normalized_keyword = keyword.lower()
            if normalized_keyword and normalized_keyword in normalized:
                return entry
    return None


def get_dashboard_summary(
    *,
    days: int = 7,
    questions_limit: int = 5,
    operator_id: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
) -> dict:
    """Dashboard summary reading from pre-aggregated dialog_stats.

    For closed dialogs: reads from dialog_stats, dialog_operator_stats, stat_questions.
    For open dialogs: computes live metrics from chat_dialogs + messages.
    """
    now = datetime.now(timezone.utc)
    if start_date is None and end_date is None:
        span = max(days, 1)
        end_date = now.date()
        start_date = end_date - timedelta(days=span - 1)
    else:
        if end_date is None:
            end_date = now.date()
        if start_date is None:
            start_date = end_date
        if start_date > end_date:
            start_date, end_date = end_date, start_date
        span = (end_date - start_date).days + 1
    start_iso = start_date.isoformat()
    end_exclusive_iso = (end_date + timedelta(days=1)).isoformat()

    section_map = {section["id"]: section["title"] for section in SECTIONS}

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
            "ai_closed_dialogs": 0,
            "transferred_to_operator_dialogs": 0,
            "ai_messages_count": 0,
            "avg_messages_before_transfer": None,
            "requests_with_contract": 0,
            "requests_without_contract": 0,
            "recurring_requests_count": 0,
            "recurring_requests_percentage": None,
            "sla_violations_count": 0,
            "sla_compliance_percentage": None,
            "average_first_message_length": None,
            "average_messages_per_dialog": 0.0,
            "avg_dialog_duration_minutes": None,
            "avg_response_time_minutes": None,
            "avg_response_time_seconds": None,
            "response_time_dialogs": [],
            "dialog_metrics": [],
            "section_breakdown": [],
            "top_questions": [],
            "questions_by_section": [],
            "agent_breakdown": [],
            "recent_activity": recent_activity,
            "top_bins_without_contract": [],
            "top_bins_with_contract": [],
            "peak_load_heatmap": [],
            "updated_at": now.isoformat(),
        }

    # ── Operator filtering ──
    operator_assigned_bins: List[str] | None = None
    operator_bin_filter_sql = ""
    operator_bin_filter_params: List[str] = []

    if operator_id is not None:
        target = get_user_by_id(operator_id)
        if not target:
            return _empty_summary()
        operator_assigned_bins = get_user_bins(operator_id)
        if not operator_assigned_bins:
            return _empty_summary()

        _bin_placeholders = ", ".join("%s" for _ in operator_assigned_bins)
        operator_bin_filter_sql = f" AND ds.bin IN ({_bin_placeholders})"
        operator_bin_filter_params = list(operator_assigned_bins)

    with _lock:
        # ══════════════════════════════════════════════════════
        # 1. CLOSED DIALOGS — from dialog_stats (pre-aggregated)
        # ══════════════════════════════════════════════════════
        agg_row = execute(
            """
            SELECT
                COUNT(*) AS total,
                COALESCE(SUM(msg_incoming), 0) AS incoming,
                COALESCE(SUM(msg_outgoing), 0) AS outgoing,
                COALESCE(SUM(msg_total), 0) AS messages,
                COALESCE(SUM(CASE WHEN is_ai_closed THEN 1 ELSE 0 END), 0) AS ai_closed,
                COALESCE(SUM(ai_messages_count), 0) AS ai_msgs,
                COALESCE(SUM(response_count), 0) AS resp_count,
                COALESCE(SUM(fast_responses), 0) AS fast,
                COALESCE(SUM(medium_responses), 0) AS medium,
                COALESCE(SUM(slow_responses), 0) AS slow,
                COALESCE(SUM(sla_violations), 0) AS sla_v,
                AVG(msgs_before_transfer) AS avg_before_transfer,
                AVG(first_message_length) AS avg_first_msg_len,
                COALESCE(SUM(CASE WHEN has_contract = true THEN 1 ELSE 0 END), 0) AS with_contract,
                COALESCE(SUM(CASE WHEN has_contract = false THEN 1 ELSE 0 END), 0) AS without_contract
            FROM dialog_stats ds
            WHERE ds.started_at >= %s AND ds.started_at < %s
            """
            + operator_bin_filter_sql,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchone()

        closed_dialogs = int(agg_row["total"] or 0)
        closed_incoming = int(agg_row["incoming"] or 0)
        closed_outgoing = int(agg_row["outgoing"] or 0)
        closed_messages = int(agg_row["messages"] or 0)
        ai_closed_dialogs = int(agg_row["ai_closed"] or 0)
        ai_messages_count = int(agg_row["ai_msgs"] or 0)
        total_resp_count = int(agg_row["resp_count"] or 0)
        fast_responses = int(agg_row["fast"] or 0)
        medium_responses = int(agg_row["medium"] or 0)
        slow_responses = int(agg_row["slow"] or 0)
        sla_violations_count = int(agg_row["sla_v"] or 0)
        avg_messages_before_transfer = (
            float(agg_row["avg_before_transfer"])
            if agg_row["avg_before_transfer"] is not None else None
        )
        average_first_message_length = (
            float(agg_row["avg_first_msg_len"])
            if agg_row["avg_first_msg_len"] is not None else None
        )
        requests_with_contract = int(agg_row["with_contract"] or 0)
        requests_without_contract = int(agg_row["without_contract"] or 0)

        # Weighted average response time from dialog_stats
        avg_rt_row = execute(
            """
            SELECT SUM(avg_response_time_seconds * response_count) / NULLIF(SUM(response_count), 0) AS weighted_avg
            FROM dialog_stats ds
            WHERE ds.started_at >= %s AND ds.started_at < %s
              AND avg_response_time_seconds IS NOT NULL
            """
            + operator_bin_filter_sql,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchone()
        avg_response_time_seconds: Optional[float] = (
            float(avg_rt_row["weighted_avg"])
            if avg_rt_row and avg_rt_row["weighted_avg"] is not None else None
        )

        transferred_to_operator_dialogs = max(0, closed_dialogs - ai_closed_dialogs)

        # ══════════════════════════════════════════════════════
        # 2. OPEN DIALOGS — live from chat_dialogs + messages
        # ══════════════════════════════════════════════════════
        open_filter = operator_bin_filter_sql.replace("ds.", "cd.")
        open_params = list(operator_bin_filter_params)

        open_row = execute(
            """
            SELECT COUNT(*) AS total
            FROM chat_dialogs cd
            WHERE cd.ended_at IS NULL
              AND cd.started_at >= %s AND cd.started_at < %s
            """
            + open_filter,
            (start_iso, end_exclusive_iso, *open_params),
        ).fetchone()
        open_dialogs = int(open_row["total"] or 0)

        # Messages in open dialogs
        open_msg_row = execute(
            """
            SELECT
                COALESCE(SUM(CASE WHEN m.direction = 'incoming' THEN 1 ELSE 0 END), 0) AS incoming,
                COALESCE(SUM(CASE WHEN m.direction = 'outgoing' THEN 1 ELSE 0 END), 0) AS outgoing
            FROM messages m
            JOIN chat_dialogs cd ON cd.id = m.dialog_id
            WHERE cd.ended_at IS NULL
              AND cd.started_at >= %s AND cd.started_at < %s
            """
            + open_filter,
            (start_iso, end_exclusive_iso, *open_params),
        ).fetchone()
        open_incoming = int(open_msg_row["incoming"] or 0)
        open_outgoing = int(open_msg_row["outgoing"] or 0)

        # ── Combined totals ──
        total_dialogs = closed_dialogs + open_dialogs
        total_incoming = closed_incoming + open_incoming
        total_outgoing = closed_outgoing + open_outgoing
        total_messages = closed_messages + open_incoming + open_outgoing

        # total_chats - from both live and deleted dialogs
        live_chats_row = execute(
            """
            SELECT COUNT(DISTINCT cd.chat_id) AS total FROM chat_dialogs cd
            WHERE cd.started_at >= %s AND cd.started_at < %s
            """
            + open_filter,
            (start_iso, end_exclusive_iso, *open_params),
        ).fetchone()
        stats_chats_row = execute(
            """
            SELECT COUNT(DISTINCT ds.chat_id) AS total FROM dialog_stats ds
            WHERE ds.started_at >= %s AND ds.started_at < %s
            """
            + operator_bin_filter_sql,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchone()
        total_chats = max(
            int(live_chats_row["total"] or 0),
            int(stats_chats_row["total"] or 0),
        )

        # ══════════════════════════════════════════════════════
        # 3. DERIVED METRICS
        # ══════════════════════════════════════════════════════
        average_messages_per_dialog = (
            total_messages / total_dialogs if total_dialogs else 0.0
        )
        avg_response_time_minutes: Optional[float] = (
            avg_response_time_seconds / 60.0
            if avg_response_time_seconds is not None else None
        )
        sla_compliance_percentage: Optional[float] = None
        if total_resp_count > 0:
            sla_compliance_percentage = (
                (total_resp_count - sla_violations_count) / total_resp_count
            ) * 100

        # Dialog duration (from dialog_stats)
        dur_row = execute(
            """
            SELECT AVG(
                EXTRACT(EPOCH FROM (CAST(ds.ended_at AS TIMESTAMP) - CAST(ds.started_at AS TIMESTAMP)))
            ) / 60.0 AS avg_min
            FROM dialog_stats ds
            WHERE ds.started_at >= %s AND ds.started_at < %s
              AND ds.ended_at IS NOT NULL
            """
            + operator_bin_filter_sql,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchone()
        avg_dialog_duration_minutes: Optional[float] = (
            float(dur_row["avg_min"]) if dur_row and dur_row["avg_min"] is not None else None
        )

        # Per-operator per-dialog response times (for speed donut chart)
        if operator_bin_filter_params:
            rt_dialog_rows = execute(
                """
                SELECT dos.dialog_id, dos.operator_name AS author,
                       dos.avg_response_seconds / 60.0 AS response_time_minutes
                FROM dialog_operator_stats dos
                JOIN dialog_stats ds ON ds.dialog_id = dos.dialog_id
                WHERE dos.started_at >= %s AND dos.started_at < %s
                  AND dos.avg_response_seconds IS NOT NULL
                """
                + operator_bin_filter_sql
                + """
                ORDER BY dos.dialog_id
                """,
                (start_iso, end_exclusive_iso, *operator_bin_filter_params),
            ).fetchall()
        else:
            rt_dialog_rows = execute(
                """
                SELECT dialog_id, operator_name AS author,
                       avg_response_seconds / 60.0 AS response_time_minutes
                FROM dialog_operator_stats
                WHERE started_at >= %s AND started_at < %s
                  AND avg_response_seconds IS NOT NULL
                ORDER BY dialog_id
                """,
                (start_iso, end_exclusive_iso),
            ).fetchall()

        response_time_dialogs: List[dict] = [
            {
                "dialog_id": int(row["dialog_id"]),
                "author": row["author"] or "",
                "response_time_minutes": float(row["response_time_minutes"]),
            }
            for row in rt_dialog_rows
        ]

        # ══════════════════════════════════════════════════════
        # 4. SECTION BREAKDOWN
        # ══════════════════════════════════════════════════════
        section_rows = execute(
            """
            SELECT ds.section, COUNT(*) AS dialog_count
            FROM dialog_stats ds
            WHERE ds.started_at >= %s AND ds.started_at < %s
            """
            + operator_bin_filter_sql
            + """
            GROUP BY ds.section
            """,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchall()

        open_section_rows = execute(
            """
            SELECT COALESCE(cd.section, c.section) AS section,
                   COUNT(*) AS dialog_count
            FROM chat_dialogs cd
            LEFT JOIN chats c ON c.chat_id = cd.chat_id
            WHERE cd.ended_at IS NULL
              AND cd.started_at >= %s AND cd.started_at < %s
            """
            + open_filter
            + """
            GROUP BY COALESCE(cd.section, c.section)
            """,
            (start_iso, end_exclusive_iso, *open_params),
        ).fetchall()

        section_counts: Dict[Optional[str], int] = {}
        for row in section_rows:
            section_counts[row["section"]] = int(row["dialog_count"] or 0)
        for row in open_section_rows:
            key = row["section"]
            section_counts[key] = section_counts.get(key, 0) + int(row["dialog_count"] or 0)

        section_breakdown: List[dict] = []
        for sec_id, sec_dialogs in section_counts.items():
            if not sec_dialogs:
                continue
            title = section_map.get(sec_id or "", sec_id or "Без раздела")
            percentage = (sec_dialogs / total_dialogs * 100.0) if total_dialogs else 0.0
            section_breakdown.append({
                "section": sec_id,
                "title": title,
                "dialogs": sec_dialogs,
                "percentage": percentage,
            })
        section_breakdown.sort(key=lambda s: s["dialogs"], reverse=True)

        # ══════════════════════════════════════════════════════
        # 5. TOP QUESTIONS (from stat_questions)
        # ══════════════════════════════════════════════════════
        sq_bin_filter = ""
        sq_params: list = [start_iso, end_exclusive_iso]
        if operator_bin_filter_params:
            _sq_ph = ", ".join("%s" for _ in operator_bin_filter_params)
            sq_bin_filter = f"""
                AND sq.dialog_id IN (
                    SELECT ds2.dialog_id FROM dialog_stats ds2
                    WHERE ds2.bin IN ({_sq_ph})
                )
            """
            sq_params.extend(operator_bin_filter_params)

        question_rows = execute(
            """
            SELECT sq.text, sq.section, COUNT(*) AS cnt
            FROM stat_questions sq
            WHERE sq.created_at >= %s AND sq.created_at < %s
            """
            + sq_bin_filter
            + """
            GROUP BY sq.text, sq.section
            ORDER BY cnt DESC
            """,
            sq_params,
        ).fetchall()

        question_stats: Dict[str, dict] = {}
        section_question_stats: Dict[Optional[str], Dict[str, dict]] = {}
        for row in question_rows:
            text = (row["text"] or "").strip()
            if not text:
                continue
            normalized = text.lower()
            count = int(row["cnt"] or 0)
            entry = question_stats.get(normalized)
            if entry is None:
                entry = {"question": text, "count": 0}
                question_stats[normalized] = entry
            entry["count"] += count
            if len(text) < len(entry["question"]):
                entry["question"] = text

            section_id = (row["section"] or "").strip() or None
            section_bucket = section_question_stats.setdefault(section_id, {})
            section_entry = section_bucket.get(normalized)
            if section_entry is None:
                section_entry = {"question": text, "count": 0}
                section_bucket[normalized] = section_entry
            section_entry["count"] += count
            if len(text) < len(section_entry["question"]):
                section_entry["question"] = text

        sorted_questions = sorted(
            question_stats.values(), key=lambda item: -item["count"],
        )
        top_questions = [
            {"question": item["question"], "count": int(item["count"])}
            for item in sorted_questions[:max(questions_limit, 0)]
        ]

        questions_by_section: List[dict] = []
        for sec_id, bucket in section_question_stats.items():
            if not bucket:
                continue
            qs = sorted(bucket.values(), key=lambda item: -item["count"])
            questions_by_section.append({
                "section": sec_id,
                "title": section_map.get(sec_id or "", sec_id or "Без раздела"),
                "questions": [
                    {"question": item["question"], "count": int(item["count"])}
                    for item in qs[:max(questions_limit, 0)]
                ],
            })

        # ══════════════════════════════════════════════════════
        # 6. AGENT BREAKDOWN (from dialog_operator_stats)
        # ══════════════════════════════════════════════════════
        if operator_bin_filter_params:
            agent_rows = execute(
                """
                SELECT dos.operator_name,
                       SUM(dos.messages_sent) AS message_count,
                       COUNT(DISTINCT dos.dialog_id) AS dialog_count,
                       SUM(dos.avg_response_seconds * dos.response_count) / NULLIF(SUM(dos.response_count), 0) AS avg_response_time
                FROM dialog_operator_stats dos
                JOIN dialog_stats ds ON ds.dialog_id = dos.dialog_id
                WHERE dos.started_at >= %s AND dos.started_at < %s
                """
                + operator_bin_filter_sql
                + """
                GROUP BY dos.operator_name
                ORDER BY dialog_count DESC
                """,
                (start_iso, end_exclusive_iso, *operator_bin_filter_params),
            ).fetchall()
        else:
            agent_rows = execute(
                """
                SELECT operator_name,
                       SUM(messages_sent) AS message_count,
                       COUNT(DISTINCT dialog_id) AS dialog_count,
                       SUM(avg_response_seconds * response_count) / NULLIF(SUM(response_count), 0) AS avg_response_time
                FROM dialog_operator_stats
                WHERE started_at >= %s AND started_at < %s
                GROUP BY operator_name
                ORDER BY dialog_count DESC
                """,
                (start_iso, end_exclusive_iso),
            ).fetchall()

        agent_breakdown: List[dict] = []
        for row in agent_rows:
            agent_name = row["operator_name"] or "Без имени"
            messages_sent = int(row["message_count"] or 0)
            dialogs_handled = int(row["dialog_count"] or 0)
            avg_msgs = messages_sent / dialogs_handled if dialogs_handled else 0.0
            avg_rt = (
                float(row["avg_response_time"]) / 60.0
                if row["avg_response_time"] is not None else None
            )
            agent_breakdown.append({
                "name": agent_name,
                "messages": messages_sent,
                "dialogs": dialogs_handled,
                "avg_messages_per_dialog": avg_msgs,
                "avg_response_time_minutes": avg_rt,
                "last_activity": None,
            })

        # ══════════════════════════════════════════════════════
        # 7. RECENT ACTIVITY (by day)
        # ══════════════════════════════════════════════════════
        activity_rows = execute(
            """
            SELECT DATE(started_at) AS day, COUNT(*) AS cnt
            FROM dialog_stats ds
            WHERE ds.started_at >= %s AND ds.started_at < %s
            """
            + operator_bin_filter_sql
            + """
            GROUP BY day
            """,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchall()

        open_activity_rows = execute(
            """
            SELECT DATE(started_at) AS day, COUNT(*) AS cnt
            FROM chat_dialogs cd
            WHERE cd.ended_at IS NULL
              AND cd.started_at >= %s AND cd.started_at < %s
            """
            + open_filter
            + """
            GROUP BY day
            """,
            (start_iso, end_exclusive_iso, *open_params),
        ).fetchall()

        incoming_by_day_rows = execute(
            """
            SELECT DATE(sq.created_at) AS day, COUNT(*) AS cnt
            FROM stat_questions sq
            WHERE sq.created_at >= %s AND sq.created_at < %s
            """
            + sq_bin_filter
            + """
            GROUP BY day
            """,
            sq_params,
        ).fetchall()

        dialogs_by_day: Dict[str, int] = {}
        for row in activity_rows:
            dialogs_by_day[str(row["day"])] = int(row["cnt"] or 0)
        for row in open_activity_rows:
            day_key = str(row["day"])
            dialogs_by_day[day_key] = dialogs_by_day.get(day_key, 0) + int(row["cnt"] or 0)

        incoming_by_day: Dict[str, int] = {}
        for row in incoming_by_day_rows:
            incoming_by_day[str(row["day"])] = int(row["cnt"] or 0)

        recent_activity: List[dict] = []
        for offset in range(span):
            day = start_date + timedelta(days=offset)
            day_key = day.isoformat()
            recent_activity.append({
                "date": day_key,
                "dialogs": dialogs_by_day.get(day_key, 0),
                "incoming_messages": incoming_by_day.get(day_key, 0),
            })

        # ══════════════════════════════════════════════════════
        # 8. RECURRING REQUESTS (self-join on dialog_stats by BIN)
        # ══════════════════════════════════════════════════════
        recurring_requests_count = 0
        recurring_requests_percentage: Optional[float] = None
        _rec_bin_filter = operator_bin_filter_sql.replace("ds.", "ds2.")
        recurring_row = execute(
            """
            SELECT COUNT(DISTINCT ds2.dialog_id) AS recurring_count
            FROM dialog_stats ds1
            JOIN dialog_stats ds2 ON ds1.bin = ds2.bin
            WHERE ds1.ended_at IS NOT NULL
              AND ds2.started_at > ds1.ended_at
              AND CAST(ds2.started_at AS TIMESTAMP) <= CAST(ds1.ended_at AS TIMESTAMP) + INTERVAL '%s days'
              AND ds2.started_at >= %s AND ds2.started_at < %s
            """
            + _rec_bin_filter,
            (span, start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchone()
        recurring_requests_count = int(recurring_row["recurring_count"] or 0)

        total_period_dialogs = requests_with_contract + requests_without_contract
        if total_period_dialogs > 0:
            recurring_requests_percentage = (
                recurring_requests_count / total_period_dialogs
            ) * 100

        # ══════════════════════════════════════════════════════
        # 9. PEAK LOAD HEATMAP
        # ══════════════════════════════════════════════════════
        heatmap_rows = execute(
            """
            SELECT
                EXTRACT(ISODOW FROM CAST(ds.started_at AS TIMESTAMP WITH TIME ZONE) AT TIME ZONE 'Asia/Almaty') AS day_of_week,
                EXTRACT(HOUR FROM CAST(ds.started_at AS TIMESTAMP WITH TIME ZONE) AT TIME ZONE 'Asia/Almaty') AS hour_of_day,
                COUNT(*) AS count
            FROM dialog_stats ds
            WHERE ds.started_at >= %s AND ds.started_at < %s
            """
            + operator_bin_filter_sql
            + """
            GROUP BY day_of_week, hour_of_day
            """,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchall()

        peak_load_heatmap = [
            {
                "day_of_week": int(row["day_of_week"]) - 1,
                "hour": int(row["hour_of_day"]),
                "count": int(row["count"]),
            }
            for row in heatmap_rows
        ]

        # ══════════════════════════════════════════════════════
        # 10. CONTRACT ANALYTICS (top BINs)
        # ══════════════════════════════════════════════════════
        contract_rows = execute(
            """
            SELECT ds.bin, ds.has_contract, COUNT(*) AS dialog_count
            FROM dialog_stats ds
            WHERE ds.started_at >= %s AND ds.started_at < %s
              AND ds.bin IS NOT NULL
            """
            + operator_bin_filter_sql
            + """
            GROUP BY ds.bin, ds.has_contract
            """,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchall()

        top_bins_without_contract_raw = [
            {"bin": row["bin"] or "Неизвестно", "requests": int(row["dialog_count"])}
            for row in contract_rows if row["has_contract"] is False
        ]
        top_bins_without_contract_raw.sort(key=lambda x: x["requests"], reverse=True)
        top_bins_without_contract = top_bins_without_contract_raw[:10]

        top_bins_with_contract_raw = [
            {"bin": row["bin"] or "Неизвестно", "requests": int(row["dialog_count"])}
            for row in contract_rows if row["has_contract"] is True
        ]
        top_bins_with_contract_raw.sort(key=lambda x: x["requests"], reverse=True)
        top_bins_with_contract = top_bins_with_contract_raw[:10]

        # ══════════════════════════════════════════════════════
        # 11. DIALOG METRICS (for region map)
        # ══════════════════════════════════════════════════════
        dm_rows = execute(
            """
            SELECT dialog_id, bin, is_ai_closed, avg_response_time_seconds
            FROM dialog_stats ds
            WHERE ds.started_at >= %s AND ds.started_at < %s
            """
            + operator_bin_filter_sql,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchall()

        dialog_metrics: List[dict] = []
        for row in dm_rows:
            rt_min = (
                float(row["avg_response_time_seconds"]) / 60.0
                if row["avg_response_time_seconds"] is not None else None
            )
            dialog_metrics.append({
                "dialog_id": int(row["dialog_id"]),
                "bin": row["bin"],
                "is_open": False,
                "is_ai_closed": bool(row["is_ai_closed"]),
                "response_time_minutes": rt_min,
            })

        # Add open dialogs to dialog_metrics
        open_dm_rows = execute(
            """
            SELECT cd.id AS dialog_id,
                   COALESCE(cd.bin, c.bin) AS bin
            FROM chat_dialogs cd
            LEFT JOIN chats c ON c.chat_id = cd.chat_id
            WHERE cd.ended_at IS NULL
              AND cd.started_at >= %s AND cd.started_at < %s
            """
            + open_filter,
            (start_iso, end_exclusive_iso, *open_params),
        ).fetchall()
        for row in open_dm_rows:
            dialog_metrics.append({
                "dialog_id": int(row["dialog_id"]),
                "bin": row["bin"],
                "is_open": True,
                "is_ai_closed": False,
                "response_time_minutes": None,
            })

    return {
        "total_dialogs": int(total_dialogs),
        "open_dialogs": int(open_dialogs),
        "closed_dialogs": int(closed_dialogs),
        "total_chats": int(total_chats),
        "total_messages": int(total_messages),
        "total_incoming_messages": int(total_incoming),
        "total_outgoing_messages": int(total_outgoing),
        "ai_closed_dialogs": int(ai_closed_dialogs),
        "transferred_to_operator_dialogs": int(transferred_to_operator_dialogs),
        "avg_messages_before_transfer": avg_messages_before_transfer,
        "ai_messages_count": int(ai_messages_count),
        "requests_with_contract": int(requests_with_contract),
        "requests_without_contract": int(requests_without_contract),
        "recurring_requests_count": int(recurring_requests_count),
        "recurring_requests_percentage": recurring_requests_percentage,
        "sla_violations_count": int(sla_violations_count),
        "sla_compliance_percentage": sla_compliance_percentage,
        "average_first_message_length": average_first_message_length,
        "average_messages_per_dialog": average_messages_per_dialog,
        "avg_dialog_duration_minutes": avg_dialog_duration_minutes,
        "avg_response_time_minutes": avg_response_time_minutes,
        "avg_response_time_seconds": avg_response_time_seconds,
        "response_time_dialogs": response_time_dialogs,
        "dialog_metrics": dialog_metrics,
        "section_breakdown": section_breakdown,
        "top_questions": top_questions,
        "questions_by_section": questions_by_section,
        "agent_breakdown": agent_breakdown,
        "recent_activity": recent_activity,
        "top_bins_without_contract": top_bins_without_contract,
        "top_bins_with_contract": top_bins_with_contract,
        "peak_load_heatmap": peak_load_heatmap,
        "updated_at": now.isoformat(),
    }



def user_can_access_chat(
    user_id: int,
    role: str,
    chat_id: int,
    dialog_id: int | None = None,
) -> bool:
    if is_admin_like(role):
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
        with _lock:
            section_row = execute(
                """
                SELECT section
                FROM messages
                WHERE dialog_id = %s AND section IS NOT NULL
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (dialog_id,),
            ).fetchone()
        if section_row is not None:
            section = section_row["section"]
    chat_bin = dialog_bin or chat.get("bin")
    if chat_bin is None:
        return False
    assigned_bins = set(get_user_bins(user_id))
    if not assigned_bins:
        return False
    allowed = set(get_user_sections(user_id))
    if allowed and section is not None and section not in allowed:
        return False
    # Remove `if allowed and section is None: return False` to allow access to unsectioned chats
    return chat_bin in assigned_bins


def list_updates_since(
    user_id: int,
    role: str,
    since: Optional[datetime] = None,
) -> List[dict]:
    allowed_sections: Optional[List[str]] = None
    assigned_bins: Optional[List[str]] = None
    if not is_admin_like(role):
        allowed_sections = get_user_sections(user_id)
        assigned_bins = get_user_bins(user_id)
    updates: List[dict] = []
    params: List[object] = []
    if is_admin_like(role) or assigned_bins:
        query_parts = [
            "SELECT m.id, m.chat_id, m.text, m.created_at, m.section, m.dialog_id, c.title,",
            "       COALESCE(cd.bin, c.bin) AS dialog_bin",
            "FROM messages m",
            "JOIN chats c ON c.chat_id = m.chat_id",
            "LEFT JOIN chat_dialogs cd ON cd.id = m.dialog_id",
            "WHERE m.direction = 'incoming'",
        ]
        if since is not None:
            query_parts.append("AND m.created_at > %s")
            params.append(since.isoformat())
        if not is_admin_like(role) and assigned_bins:
            if allowed_sections:
                section_placeholders = ",".join("%s" for _ in allowed_sections)
                query_parts.append(
                    f"AND (m.section IS NULL OR m.section IN ({section_placeholders}))"
                )
                params.extend(allowed_sections)
            bin_placeholders = ",".join("%s" for _ in assigned_bins)
            query_parts.append(f"AND COALESCE(cd.bin, c.bin) IN ({bin_placeholders})")
            params.extend(assigned_bins)
        query_parts.append("ORDER BY m.created_at ASC")
        sql = "\n".join(query_parts)
        with _lock:
            rows = execute(sql, params).fetchall()
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


# =========================
#        OUTBOX 1C
# =========================

def outbox_enqueue_onec(
    *,
    message_id: int | None,
    chat_id: int,
    external_chat_id: str,
    bin_value: str | None,
    payload: Mapping[str, Any],
) -> int:
    """Кладёт сообщение оператора в outbox для 1С."""
    now = datetime.now(timezone.utc).isoformat()
    serialized = json.dumps(dict(payload), ensure_ascii=False, separators=(",", ":"))
    with _lock:
        cursor = execute(
            """
            INSERT INTO outbox_onec (chat_id, external_chat_id, bin, message_id, payload, status, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, 'pending', %s, %s)
            RETURNING id
            """,
            (chat_id, external_chat_id, (bin_value or None), message_id, serialized, now, now),
        )
        inserted_row = cursor.fetchone()
        if inserted_row is None:
            raise RuntimeError("Failed to enqueue 1C outbox item")
        return int(inserted_row["id"])


def outbox_list_pending_onec(external_chat_id: str, limit: int = 100) -> List[Dict[str, Any]]:
    """Возвращает pending-сообщения для указанного external_chat_id (в порядке FIFO)."""
    normalized = (external_chat_id or "").strip()
    if not normalized:
        return []
    with _lock:
        rows = execute(
            """
            SELECT id, chat_id, external_chat_id, bin, message_id, payload, status, error, created_at, updated_at
            FROM outbox_onec
            WHERE status = 'pending' AND external_chat_id = %s
            ORDER BY id ASC
            LIMIT %s
            """,
            (normalized, limit),
        ).fetchall()
    result: List[Dict[str, Any]] = []
    for r in rows:
        try:
            payload = json.loads(r["payload"])
        except Exception:
            payload = {"raw": r["payload"]}
        result.append(
            {
                "id": int(r["id"]),
                "chat_id": r["chat_id"],
                "external_chat_id": r["external_chat_id"],
                "bin": r["bin"],
                "message_id": r["message_id"],
                "payload": payload,
                "status": r["status"],
                "error": r["error"],
                "created_at": r["created_at"],
                "updated_at": r["updated_at"],
            }
        )
    return result


def outbox_mark_delivered_onec(ids: Sequence[int]) -> None:
    """Помечает элементы как доставленные."""
    if not ids:
        return
    now = datetime.now(timezone.utc).isoformat()
    placeholders = ",".join("%s" for _ in ids)
    with _lock:
        execute(
            f"UPDATE outbox_onec SET status = 'delivered', error = NULL, updated_at = %s WHERE id IN ({placeholders})",
            (now, *ids),
        )


def outbox_mark_failed_onec(failed: Sequence[Mapping[str, Any]]) -> None:
    """Помечает элементы как 'failed' с сообщением об ошибке.
    Ожидается массив словарей вида: {"id": 1, "error": "text"}.
    """
    if not failed:
        return
    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        for item in failed:
            outbox_id = item.get("id")
            err_text = item.get("error")
            if not outbox_id:
                continue
            execute(
                "UPDATE outbox_onec SET status = 'failed', error = %s, updated_at = %s WHERE id = %s",
                (str(err_text) if err_text is not None else "", now, int(outbox_id)),
            )


# ============================================================================
# Organizations Without Contracts
# ============================================================================

def add_organization_without_contract(
    customer_bin: str,
    customer_legal_address: str | None = None,
    customer_bank_name_ru: str | None = None,
) -> Dict[str, Any] | None:
    """Добавляет организацию без договора в базу."""
    normalized_bin = (customer_bin or "").strip()
    if not normalized_bin:
        return None

    now = datetime.now(timezone.utc).isoformat()
    # Use atomic upsert to avoid UniqueViolation race conditions
    # between concurrent requests for the same BIN.
    execute(
        """
        INSERT INTO organizations_without_contracts
            (customer_bin, customer_legal_address, customer_bank_name_ru, created_at)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (customer_bin) DO UPDATE
        SET customer_legal_address = COALESCE(EXCLUDED.customer_legal_address, organizations_without_contracts.customer_legal_address),
            customer_bank_name_ru = COALESCE(EXCLUDED.customer_bank_name_ru, organizations_without_contracts.customer_bank_name_ru)
        """,
        (normalized_bin, customer_legal_address, customer_bank_name_ru, now),
    )
    return {
        "customer_bin": normalized_bin,
        "customer_legal_address": customer_legal_address,
        "customer_bank_name_ru": customer_bank_name_ru,
        "created_at": now,
    }


def list_organizations_without_contracts() -> List[Dict[str, Any]]:
    """Возвращает список организаций без договоров."""
    with _lock:
        rows = execute(
            """
            SELECT customer_bin, customer_legal_address, customer_bank_name_ru, created_at
            FROM organizations_without_contracts
            ORDER BY created_at DESC
            """
        ).fetchall()
    return [
        {
            "customer_bin": row["customer_bin"],
            "customer_legal_address": row["customer_legal_address"],
            "customer_bank_name_ru": row["customer_bank_name_ru"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def has_organization_without_contract(customer_bin: str) -> bool:
    """Проверяет, есть ли организация в списке без договоров."""
    normalized_bin = (customer_bin or "").strip()
    if not normalized_bin:
        return False
    with _lock:
        row = execute(
            "SELECT 1 FROM organizations_without_contracts WHERE customer_bin = %s",
            (normalized_bin,),
        ).fetchone()
    return row is not None


def remove_organization_without_contract(customer_bin: str) -> bool:
    """Удаляет организацию из списка без договоров."""
    normalized_bin = (customer_bin or "").strip()
    if not normalized_bin:
        return False
    with _lock:
        cursor = execute(
            "DELETE FROM organizations_without_contracts WHERE customer_bin = %s",
            (normalized_bin,),
        )
    return cursor.rowcount > 0


def sync_bins_with_contracts() -> Dict[str, Any]:
    """
    Синхронизирует все БИНы с информацией о договорах.
    Добавляет БИНы без договора в organizations_without_contracts,
    удаляет БИНы с договором из этой таблицы.
    
    Returns:
        Статистика синхронизации: added, removed, total
    """
    from . import contract_checker
    
    all_bins = list_bins()
    bins_with_contracts = contract_checker.get_all_customer_bins_with_contracts()
    
    added = 0
    removed = 0
    
    for bin_value in all_bins:
        if bin_value in bins_with_contracts:
            # У БИНа есть договор - удаляем из без договора если есть
            if remove_organization_without_contract(bin_value):
                removed += 1
        else:
            # У БИНа нет договора - проверяем и добавляем в без договора
            if not has_organization_without_contract(bin_value):
                # Получаем информацию об адресе/банке из исторических данных
                contract_data = contract_checker.check_customer_contracts(bin_value)
                add_organization_without_contract(
                    bin_value,
                    customer_legal_address=contract_data.get("customer_legal_address"),
                    customer_bank_name_ru=contract_data.get("customer_bank_name_ru"),
                )
                added += 1
    
    return {
        "added": added,
        "removed": removed,
        "total_bins": len(all_bins),
        "bins_with_contracts": len(bins_with_contracts),
    }
