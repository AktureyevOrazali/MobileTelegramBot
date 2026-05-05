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
from .customer_ratings import is_human_operator_name, select_operator_rating_targets
from . import customer_surveys
from . import survey_analytics
from . import employee_client_assessments
from .text_utils import repair_text

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
            # Connection is stale РІР‚вЂќ discard and retry with a fresh one.
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


def _as_optional_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _resolved_rating_operator_join(ds_alias: str = "ds") -> str:
    return f"""
        LEFT JOIN LATERAL (
            SELECT dos.operator_name
            FROM dialog_operator_stats dos
            WHERE (
                {ds_alias}.appeal_id IS NOT NULL AND dos.appeal_id = {ds_alias}.appeal_id
            ) OR (
                {ds_alias}.appeal_id IS NULL
                AND dos.appeal_id IS NULL
                AND dos.dialog_id = {ds_alias}.dialog_id
            )
            ORDER BY dos.messages_sent DESC NULLS LAST,
                     dos.response_count DESC NULLS LAST,
                     dos.operator_name ASC
            LIMIT 1
        ) resolved_operator ON TRUE
    """


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

TABLE_STATUS_CORE = "core"
TABLE_STATUS_LINK = "link"
TABLE_STATUS_DICTIONARY = "dictionary"
TABLE_STATUS_INTEGRATION = "integration"
TABLE_STATUS_ANALYTICS = "analytics"
TABLE_STATUS_ARCHIVE = "archive"
TABLE_STATUS_CANDIDATE_FOR_REMOVAL = "candidate_for_removal"

BACKEND_SCHEMA_TABLES: tuple[str, ...] = (
    "chats",
    "chat_dialogs",
    "messages",
    "messages_archive",
    "users",
    "sessions",
    "user_sections",
    "user_bins",
    "favorites",
    "dialog_reads",
    "notifications",
    "outbox_onec",
    "media_files",
    "message_attachments",
    "dialog_stats",
    "dialog_operator_stats",
    "operator_csat_ratings",
    "dialog_feedback_ratings",
    "stat_questions",
    "survey_templates",
    "survey_questions",
    "survey_sessions",
    "survey_session_operators",
    "survey_answers",
    "employee_client_assessments",
    "organizations_without_contracts",
    "all_bins",
    "client_bins",
    "appeals",
    "reply_templates",
)

# Central catalog for schema governance. It lets us keep the "core vs analytics"
# boundary explicit while preserving backward-compatible tables and fields.
BACKEND_SCHEMA_TABLE_STATUS: dict[str, str] = {
    "chats": TABLE_STATUS_CORE,
    "chat_dialogs": TABLE_STATUS_CORE,
    "messages": TABLE_STATUS_CORE,
    "appeals": TABLE_STATUS_CORE,
    "media_files": TABLE_STATUS_CORE,
    "message_attachments": TABLE_STATUS_CORE,
    "users": TABLE_STATUS_CORE,
    "sessions": TABLE_STATUS_CORE,
    "user_sections": TABLE_STATUS_LINK,
    "user_bins": TABLE_STATUS_LINK,
    "favorites": TABLE_STATUS_LINK,
    "dialog_reads": TABLE_STATUS_LINK,
    "notifications": TABLE_STATUS_LINK,
    "survey_templates": TABLE_STATUS_CORE,
    "survey_questions": TABLE_STATUS_CORE,
    "survey_sessions": TABLE_STATUS_CORE,
    "survey_answers": TABLE_STATUS_CORE,
    "employee_client_assessments": TABLE_STATUS_CORE,
    "operator_csat_ratings": TABLE_STATUS_CORE,
    "dialog_feedback_ratings": TABLE_STATUS_CORE,
    "organizations_without_contracts": TABLE_STATUS_DICTIONARY,
    "client_bins": TABLE_STATUS_LINK,
    "reply_templates": TABLE_STATUS_DICTIONARY,
    "outbox_onec": TABLE_STATUS_INTEGRATION,
    "dialog_stats": TABLE_STATUS_ANALYTICS,
    "dialog_operator_stats": TABLE_STATUS_ANALYTICS,
    "stat_questions": TABLE_STATUS_ANALYTICS,
    "messages_archive": TABLE_STATUS_ARCHIVE,
    "all_bins": TABLE_STATUS_CANDIDATE_FOR_REMOVAL,
}

FIELD_POLICY_SOURCE_OF_TRUTH = "source_of_truth"
FIELD_POLICY_SNAPSHOT_ONLY = "snapshot_only"
FIELD_POLICY_DEPRECATED = "deprecated"

BACKEND_SCHEMA_FIELD_POLICY: dict[str, dict[str, str]] = {
    "employee_client_assessments": {
        "dialog_id": FIELD_POLICY_SOURCE_OF_TRUTH,
        "appeal_id": FIELD_POLICY_SOURCE_OF_TRUTH,
        "assigned_user_id": FIELD_POLICY_SOURCE_OF_TRUTH,
        "client_name": FIELD_POLICY_SNAPSHOT_ONLY,
        "client_bin": FIELD_POLICY_SNAPSHOT_ONLY,
        "assigned_user_name": FIELD_POLICY_SNAPSHOT_ONLY,
        "duplicate_requests_score": FIELD_POLICY_DEPRECATED,
    },
    "survey_answers": {
        "question_id": FIELD_POLICY_SOURCE_OF_TRUTH,
        "question_type": FIELD_POLICY_SNAPSHOT_ONLY,
        "topic": FIELD_POLICY_SNAPSHOT_ONLY,
    },
    "survey_session_operators": {
        "session_id": FIELD_POLICY_SOURCE_OF_TRUTH,
        "operator_stat_id": FIELD_POLICY_SOURCE_OF_TRUTH,
        "operator_name": FIELD_POLICY_SNAPSHOT_ONLY,
    },
    "operator_csat_ratings": {
        "operator_stat_id": FIELD_POLICY_SOURCE_OF_TRUTH,
        "operator_name": FIELD_POLICY_SNAPSHOT_ONLY,
    },
    "dialog_feedback_ratings": {
        "dialog_id": FIELD_POLICY_SOURCE_OF_TRUTH,
        "appeal_id": FIELD_POLICY_SOURCE_OF_TRUTH,
        "rating_kind": FIELD_POLICY_SOURCE_OF_TRUTH,
        "rated_object_id": FIELD_POLICY_SOURCE_OF_TRUTH,
        "rated_object_name": FIELD_POLICY_SNAPSHOT_ONLY,
        "rater_name": FIELD_POLICY_SNAPSHOT_ONLY,
    },
    "dialog_stats": {
        "dialog_id": FIELD_POLICY_SOURCE_OF_TRUTH,
        "chat_id": FIELD_POLICY_SOURCE_OF_TRUTH,
        "bin": FIELD_POLICY_SNAPSHOT_ONLY,
        "section": FIELD_POLICY_SNAPSHOT_ONLY,
    },
}


DIALOG_FEEDBACK_KIND_CLIENT = "client"
DIALOG_FEEDBACK_KIND_AI = "ai"
DIALOG_FEEDBACK_KINDS: tuple[str, ...] = (
    DIALOG_FEEDBACK_KIND_CLIENT,
    DIALOG_FEEDBACK_KIND_AI,
)

RATING_RATER_TYPE_CLIENT = "client"
RATING_RATER_TYPE_EMPLOYEE = "employee"
RATING_RATER_TYPE_MANAGER = "manager"
RATING_RATER_TYPE_SYSTEM = "system"
RATING_RATER_TYPE_AI_MODULE = "ai_module"
RATING_RATER_TYPES: tuple[str, ...] = (
    RATING_RATER_TYPE_CLIENT,
    RATING_RATER_TYPE_EMPLOYEE,
    RATING_RATER_TYPE_MANAGER,
    RATING_RATER_TYPE_SYSTEM,
    RATING_RATER_TYPE_AI_MODULE,
)

RATING_OBJECT_TYPE_EMPLOYEE = "employee"
RATING_OBJECT_TYPE_CLIENT = "client"
RATING_OBJECT_TYPE_AI = "ai"
RATING_OBJECT_TYPE_APPEAL = "appeal"
RATING_OBJECT_TYPE_DEPARTMENT = "department"
RATING_OBJECT_TYPES: tuple[str, ...] = (
    RATING_OBJECT_TYPE_EMPLOYEE,
    RATING_OBJECT_TYPE_CLIENT,
    RATING_OBJECT_TYPE_AI,
    RATING_OBJECT_TYPE_APPEAL,
    RATING_OBJECT_TYPE_DEPARTMENT,
)

RATING_CHANNEL_TELEGRAM_BOT = "telegram_bot"
RATING_CHANNEL_ONEC_API = "onec_api"
RATING_CHANNEL_WEBAPP = "webapp"
RATING_CHANNEL_SYSTEM = "system"
RATING_CHANNELS: tuple[str, ...] = (
    RATING_CHANNEL_TELEGRAM_BOT,
    RATING_CHANNEL_ONEC_API,
    RATING_CHANNEL_WEBAPP,
    RATING_CHANNEL_SYSTEM,
)

SURVEY_ANALYTICS_ANSWERS_PREVIEW_LIMIT = 1000
SURVEY_ANALYTICS_FETCH_BATCH_SIZE = 500


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
            dialog_id BIGINT REFERENCES chat_dialogs(id) ON DELETE SET NULL,
            quick_replies TEXT
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
        CREATE TABLE IF NOT EXISTS media_files (
            id BIGSERIAL PRIMARY KEY,
            storage_provider TEXT NOT NULL,
            bucket TEXT NOT NULL,
            object_key TEXT NOT NULL,
            sha256 TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            size_bytes BIGINT NOT NULL,
            original_name TEXT NOT NULL,
            width INTEGER,
            height INTEGER,
            duration_sec REAL,
            created_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS message_attachments (
            id BIGSERIAL PRIMARY KEY,
            message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
            media_file_id BIGINT NOT NULL REFERENCES media_files(id) ON DELETE RESTRICT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            kind TEXT NOT NULL,
            caption TEXT
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
        CREATE UNIQUE INDEX IF NOT EXISTS idx_media_files_object
        ON media_files(storage_provider, bucket, object_key)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_media_files_fingerprint
        ON media_files(sha256, size_bytes, mime_type)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_message_attachments_message_sort
        ON message_attachments(message_id, sort_order, id)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_message_attachments_media_file
        ON message_attachments(media_file_id)
        """,
        """
        CREATE TABLE IF NOT EXISTS dialog_stats (
            id BIGSERIAL PRIMARY KEY,
            dialog_id BIGINT NOT NULL,
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
            csat_rating INTEGER,
            ai_csat_rating INTEGER,
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
            appeal_id BIGINT,
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
        CREATE TABLE IF NOT EXISTS operator_csat_ratings (
            id BIGSERIAL PRIMARY KEY,
            dialog_id BIGINT NOT NULL,
            appeal_id BIGINT,
            operator_stat_id BIGINT REFERENCES dialog_operator_stats(id) ON DELETE SET NULL,
            operator_name TEXT NOT NULL,
            rater_type TEXT NOT NULL DEFAULT 'client',
            rater_chat_id BIGINT,
            rater_external_chat_id TEXT,
            rater_name TEXT,
            rated_object_type TEXT NOT NULL DEFAULT 'employee',
            rated_object_id TEXT,
            rated_object_name TEXT,
            channel TEXT NOT NULL DEFAULT 'telegram_bot',
            ai_involved BOOLEAN NOT NULL DEFAULT FALSE,
            comment TEXT DEFAULT '',
            low_score_reason TEXT,
            rating INTEGER NOT NULL,
            created_at TEXT NOT NULL
        )
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_operator_csat_dialog
        ON operator_csat_ratings(dialog_id)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_operator_csat_appeal
        ON operator_csat_ratings(appeal_id)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_operator_csat_operator
        ON operator_csat_ratings(operator_name)
        """,
        """
        CREATE TABLE IF NOT EXISTS dialog_feedback_ratings (
            id BIGSERIAL PRIMARY KEY,
            dialog_id BIGINT NOT NULL REFERENCES chat_dialogs(id) ON DELETE CASCADE,
            appeal_id BIGINT REFERENCES appeals(id) ON DELETE SET NULL,
            rating_kind TEXT NOT NULL,
            rater_type TEXT NOT NULL DEFAULT 'client',
            rater_chat_id BIGINT,
            rater_external_chat_id TEXT,
            rater_name TEXT,
            rated_object_type TEXT NOT NULL DEFAULT 'appeal',
            rated_object_id TEXT,
            rated_object_name TEXT,
            channel TEXT NOT NULL DEFAULT 'telegram_bot',
            ai_involved BOOLEAN NOT NULL DEFAULT FALSE,
            comment TEXT DEFAULT '',
            low_score_reason TEXT,
            rating INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_dialog_feedback_ratings_dialog_kind
        ON dialog_feedback_ratings(dialog_id, rating_kind, updated_at DESC)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_dialog_feedback_ratings_appeal_kind
        ON dialog_feedback_ratings(appeal_id, rating_kind)
        """,
        """
        CREATE TABLE IF NOT EXISTS stat_questions (
            id BIGSERIAL PRIMARY KEY,
            dialog_id BIGINT,
            appeal_id BIGINT,
            text TEXT NOT NULL,
            created_at TEXT NOT NULL,
            section TEXT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS survey_templates (
            id BIGSERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            audience TEXT NOT NULL DEFAULT 'client',
            status TEXT NOT NULL DEFAULT 'draft',
            trigger_type TEXT NOT NULL DEFAULT 'periodic',
            periodic_interval TEXT,
            scheduled_at TEXT,
            launch_rules TEXT NOT NULL DEFAULT '[]',
            is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
            created_by BIGINT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS survey_questions (
            id BIGSERIAL PRIMARY KEY,
            template_id BIGINT NOT NULL REFERENCES survey_templates(id) ON DELETE CASCADE,
            sort_order INTEGER NOT NULL DEFAULT 0,
            question_type TEXT NOT NULL,
            text TEXT NOT NULL,
            topic TEXT,
            required BOOLEAN NOT NULL DEFAULT TRUE,
            anonymity_mode TEXT NOT NULL DEFAULT 'inherit',
            config TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS survey_sessions (
            id BIGSERIAL PRIMARY KEY,
            template_id BIGINT NOT NULL REFERENCES survey_templates(id) ON DELETE CASCADE,
            chat_id BIGINT NOT NULL,
            dialog_id BIGINT,
            appeal_id BIGINT,
            bin TEXT,
            status TEXT NOT NULL DEFAULT 'started',
            trigger_source TEXT NOT NULL,
            current_question_id BIGINT,
            is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            updated_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS survey_session_operators (
            id BIGSERIAL PRIMARY KEY,
            session_id BIGINT NOT NULL REFERENCES survey_sessions(id) ON DELETE CASCADE,
            operator_name TEXT NOT NULL,
            operator_stat_id BIGINT,
            created_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS survey_answers (
            id BIGSERIAL PRIMARY KEY,
            session_id BIGINT NOT NULL REFERENCES survey_sessions(id) ON DELETE CASCADE,
            question_id BIGINT NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
            question_type TEXT NOT NULL,
            topic TEXT,
            numeric_score REAL,
            raw_text TEXT NOT NULL DEFAULT '',
            selected_options TEXT NOT NULL DEFAULT '[]',
            selected_employee_name TEXT,
            effective_is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS employee_client_assessments (
            id BIGSERIAL PRIMARY KEY,
            dialog_id BIGINT NOT NULL REFERENCES chat_dialogs(id) ON DELETE CASCADE,
            appeal_id BIGINT,
            chat_id BIGINT NOT NULL,
            client_id BIGINT,
            client_bin TEXT,
            client_name TEXT,
            assigned_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            assigned_user_name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            task_opened_at TEXT,
            task_closed_at TEXT,
            ai_assisted BOOLEAN NOT NULL DEFAULT FALSE,
            client_feedback_delay_hours REAL,
            question_clarity_score INTEGER,
            data_completeness_score INTEGER,
            client_response_speed_score INTEGER,
            business_communication_score INTEGER,
            client_readiness_score INTEGER,
            duplicate_requests_score INTEGER,
            overall_score REAL,
            interaction_quality_index REAL,
            low_score_reason TEXT,
            internal_comment TEXT DEFAULT '',
            interaction_status TEXT,
            request_repeat_status TEXT DEFAULT 'not_repeated',
            interaction_flag TEXT,
            repeated_request BOOLEAN NOT NULL DEFAULT FALSE,
            first_contact BOOLEAN NOT NULL DEFAULT FALSE,
            client_data_overdue BOOLEAN NOT NULL DEFAULT FALSE,
            hindered_by_client BOOLEAN NOT NULL DEFAULT FALSE,
            without_clarifications BOOLEAN NOT NULL DEFAULT FALSE,
            first_time_full_data BOOLEAN NOT NULL DEFAULT FALSE,
            submitted_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS organizations_without_contracts (
            id BIGSERIAL PRIMARY KEY,
            customer_bin TEXT NOT NULL UNIQUE,
            customer_legal_address TEXT,
            customer_bank_name_ru TEXT,
            customer_name_ru TEXT,
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
        """
        CREATE TABLE IF NOT EXISTS reply_templates (
            id BIGSERIAL PRIMARY KEY,
            title TEXT NOT NULL,
            text TEXT NOT NULL,
            section TEXT,
            sort_order INTEGER DEFAULT 0,
            created_by BIGINT,
            created_at TEXT NOT NULL
        )
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
    _ensure_column("messages", "quick_replies", "TEXT")
    _ensure_column("chat_dialogs", "bin", "TEXT")
    _ensure_column("chat_dialogs", "started_at", "TEXT")
    _ensure_column("chat_dialogs", "ended_at", "TEXT")
    _ensure_column("chat_dialogs", "last_message_at", "TEXT")
    _ensure_column("chat_dialogs", "operator_mode", "INTEGER DEFAULT 0")
    _ensure_column("chat_dialogs", "section", "TEXT")
    _ensure_column("chat_dialogs", "purged_at", "TEXT")
    _ensure_column("users", "job_title", "TEXT")
    _ensure_column("users", "phone", "TEXT")
    _ensure_column("users", "bio", "TEXT")
    _ensure_column("users", "login", "TEXT")
    _ensure_column("users", "role", "TEXT")
    _ensure_column("users", "is_approved", "INTEGER DEFAULT 1")
    _ensure_column("user_bins", "expires_at", "TEXT")
    _ensure_column("user_bins", "assigned_by", "BIGINT")
    _ensure_column("organizations_without_contracts", "customer_name_ru", "TEXT")

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
    _ensure_column("dialog_stats", "csat_rating", "INTEGER")
    _ensure_column("dialog_stats", "ai_csat_rating", "INTEGER")
    _ensure_column("dialog_operator_stats", "appeal_id", "BIGINT")
    _ensure_column("operator_csat_ratings", "rater_type", f"TEXT DEFAULT {_quote_literal(RATING_RATER_TYPE_CLIENT)}")
    _ensure_column("operator_csat_ratings", "rater_chat_id", "BIGINT")
    _ensure_column("operator_csat_ratings", "rater_external_chat_id", "TEXT")
    _ensure_column("operator_csat_ratings", "rater_name", "TEXT")
    _ensure_column("operator_csat_ratings", "rated_object_type", f"TEXT DEFAULT {_quote_literal(RATING_OBJECT_TYPE_EMPLOYEE)}")
    _ensure_column("operator_csat_ratings", "rated_object_id", "TEXT")
    _ensure_column("operator_csat_ratings", "rated_object_name", "TEXT")
    _ensure_column("operator_csat_ratings", "channel", f"TEXT DEFAULT {_quote_literal(RATING_CHANNEL_TELEGRAM_BOT)}")
    _ensure_column("operator_csat_ratings", "ai_involved", "BOOLEAN DEFAULT FALSE")
    _ensure_column("operator_csat_ratings", "comment", "TEXT DEFAULT ''")
    _ensure_column("operator_csat_ratings", "low_score_reason", "TEXT")
    _ensure_column("dialog_feedback_ratings", "rater_type", f"TEXT DEFAULT {_quote_literal(RATING_RATER_TYPE_CLIENT)}")
    _ensure_column("dialog_feedback_ratings", "rater_chat_id", "BIGINT")
    _ensure_column("dialog_feedback_ratings", "rater_external_chat_id", "TEXT")
    _ensure_column("dialog_feedback_ratings", "rater_name", "TEXT")
    _ensure_column("dialog_feedback_ratings", "rated_object_type", f"TEXT DEFAULT {_quote_literal(RATING_OBJECT_TYPE_APPEAL)}")
    _ensure_column("dialog_feedback_ratings", "rated_object_id", "TEXT")
    _ensure_column("dialog_feedback_ratings", "rated_object_name", "TEXT")
    _ensure_column("dialog_feedback_ratings", "channel", f"TEXT DEFAULT {_quote_literal(RATING_CHANNEL_TELEGRAM_BOT)}")
    _ensure_column("dialog_feedback_ratings", "ai_involved", "BOOLEAN DEFAULT FALSE")
    _ensure_column("dialog_feedback_ratings", "comment", "TEXT DEFAULT ''")
    _ensure_column("dialog_feedback_ratings", "low_score_reason", "TEXT")
    _ensure_column("stat_questions", "appeal_id", "BIGINT")

    # Survey migrations: CREATE TABLE IF NOT EXISTS does not update legacy/partial tables.
    _ensure_column("survey_templates", "title", "TEXT")
    _ensure_column("survey_templates", "description", "TEXT DEFAULT ''")
    _ensure_column("survey_templates", "audience", "TEXT DEFAULT 'client'")
    _ensure_column("survey_templates", "status", "TEXT DEFAULT 'draft'")
    _ensure_column("survey_templates", "trigger_type", "TEXT DEFAULT 'after_employee_csat'")
    _ensure_column("survey_templates", "periodic_interval", "TEXT")
    _ensure_column("survey_templates", "scheduled_at", "TEXT")
    _ensure_column("survey_templates", "launch_rules", "TEXT DEFAULT '[]'")
    _ensure_column("survey_templates", "is_anonymous", "BOOLEAN DEFAULT FALSE")
    _ensure_column("survey_templates", "created_by", "BIGINT")
    _ensure_column("survey_templates", "created_at", "TEXT")
    _ensure_column("survey_templates", "updated_at", "TEXT")
    _ensure_column("survey_questions", "template_id", "BIGINT")
    _ensure_column("survey_questions", "sort_order", "INTEGER DEFAULT 0")
    _ensure_column("survey_questions", "question_type", "TEXT")
    _ensure_column("survey_questions", "text", "TEXT")
    _ensure_column("survey_questions", "topic", "TEXT")
    _ensure_column("survey_questions", "required", "BOOLEAN DEFAULT TRUE")
    _ensure_column("survey_questions", "anonymity_mode", "TEXT DEFAULT 'inherit'")
    _ensure_column("survey_questions", "config", "TEXT DEFAULT '{}'")
    _ensure_column("survey_questions", "created_at", "TEXT")
    _ensure_column("survey_questions", "updated_at", "TEXT")
    _ensure_column("survey_sessions", "template_id", "BIGINT")
    _ensure_column("survey_sessions", "chat_id", "BIGINT")
    _ensure_column("survey_sessions", "dialog_id", "BIGINT")
    _ensure_column("survey_sessions", "appeal_id", "BIGINT")
    _ensure_column("survey_sessions", "bin", "TEXT")
    _ensure_column("survey_sessions", "status", "TEXT DEFAULT 'started'")
    _ensure_column("survey_sessions", "trigger_source", "TEXT")
    _ensure_column("survey_sessions", "current_question_id", "BIGINT")
    _ensure_column("survey_sessions", "is_anonymous", "BOOLEAN DEFAULT FALSE")
    _ensure_column("survey_sessions", "started_at", "TEXT")
    _ensure_column("survey_sessions", "completed_at", "TEXT")
    _ensure_column("survey_sessions", "updated_at", "TEXT")
    _ensure_column("survey_session_operators", "session_id", "BIGINT")
    _ensure_column("survey_session_operators", "operator_name", "TEXT")
    _ensure_column("survey_session_operators", "operator_stat_id", "BIGINT")
    _ensure_column("survey_session_operators", "created_at", "TEXT")
    _ensure_column("survey_answers", "session_id", "BIGINT")
    _ensure_column("survey_answers", "question_id", "BIGINT")
    _ensure_column("survey_answers", "question_type", "TEXT")
    _ensure_column("survey_answers", "topic", "TEXT")
    _ensure_column("survey_answers", "numeric_score", "REAL")
    _ensure_column("survey_answers", "raw_text", "TEXT DEFAULT ''")
    _ensure_column("survey_answers", "selected_options", "TEXT DEFAULT '[]'")
    _ensure_column("survey_answers", "selected_employee_name", "TEXT")
    _ensure_column("survey_answers", "effective_is_anonymous", "BOOLEAN DEFAULT FALSE")
    _ensure_column("survey_answers", "created_at", "TEXT")
    _ensure_column("employee_client_assessments", "dialog_id", "BIGINT")
    _ensure_column("employee_client_assessments", "appeal_id", "BIGINT")
    _ensure_column("employee_client_assessments", "chat_id", "BIGINT")
    _ensure_column("employee_client_assessments", "client_id", "BIGINT")
    _ensure_column("employee_client_assessments", "client_bin", "TEXT")
    _ensure_column("employee_client_assessments", "client_name", "TEXT")
    _ensure_column("employee_client_assessments", "assigned_user_id", "BIGINT")
    _ensure_column("employee_client_assessments", "assigned_user_name", "TEXT")
    _ensure_column("employee_client_assessments", "status", "TEXT DEFAULT 'pending'")
    _ensure_column("employee_client_assessments", "task_opened_at", "TEXT")
    _ensure_column("employee_client_assessments", "task_closed_at", "TEXT")
    _ensure_column("employee_client_assessments", "ai_assisted", "BOOLEAN DEFAULT FALSE")
    _ensure_column("employee_client_assessments", "client_feedback_delay_hours", "REAL")
    _ensure_column("employee_client_assessments", "question_clarity_score", "INTEGER")
    _ensure_column("employee_client_assessments", "data_completeness_score", "INTEGER")
    _ensure_column("employee_client_assessments", "client_response_speed_score", "INTEGER")
    _ensure_column("employee_client_assessments", "business_communication_score", "INTEGER")
    _ensure_column("employee_client_assessments", "client_readiness_score", "INTEGER")
    _ensure_column("employee_client_assessments", "duplicate_requests_score", "INTEGER")
    _ensure_column("employee_client_assessments", "overall_score", "REAL")
    _ensure_column("employee_client_assessments", "interaction_quality_index", "REAL")
    _ensure_column("employee_client_assessments", "low_score_reason", "TEXT")
    _ensure_column("employee_client_assessments", "internal_comment", "TEXT DEFAULT ''")
    _ensure_column("employee_client_assessments", "interaction_status", "TEXT")
    _ensure_column("employee_client_assessments", "request_repeat_status", "TEXT DEFAULT 'not_repeated'")
    _ensure_column("employee_client_assessments", "interaction_flag", "TEXT")
    _ensure_column("employee_client_assessments", "repeated_request", "BOOLEAN DEFAULT FALSE")
    _ensure_column("employee_client_assessments", "first_contact", "BOOLEAN DEFAULT FALSE")
    _ensure_column("employee_client_assessments", "client_data_overdue", "BOOLEAN DEFAULT FALSE")
    _ensure_column("employee_client_assessments", "hindered_by_client", "BOOLEAN DEFAULT FALSE")
    _ensure_column("employee_client_assessments", "without_clarifications", "BOOLEAN DEFAULT FALSE")
    _ensure_column("employee_client_assessments", "first_time_full_data", "BOOLEAN DEFAULT FALSE")
    _ensure_column("employee_client_assessments", "submitted_at", "TEXT")
    _ensure_column("employee_client_assessments", "created_at", "TEXT")
    _ensure_column("employee_client_assessments", "updated_at", "TEXT")

    with _lock:
        template_rows = execute(
            """
            SELECT id, trigger_type, periodic_interval, scheduled_at, launch_rules
            FROM survey_templates
            """
        ).fetchall()
        for row in template_rows:
            raw_launch_rules = row.get("launch_rules")
            if raw_launch_rules in (None, ""):
                parsed_launch_rules = []
            elif isinstance(raw_launch_rules, (dict, list)):
                parsed_launch_rules = raw_launch_rules
            else:
                try:
                    parsed_launch_rules = json.loads(str(raw_launch_rules))
                except (TypeError, ValueError, json.JSONDecodeError):
                    parsed_launch_rules = []
            launch_rules = customer_surveys.normalize_launch_rules(
                parsed_launch_rules,
                legacy_trigger_type=row.get("trigger_type"),
                legacy_periodic_interval=row.get("periodic_interval"),
                legacy_scheduled_at=row.get("scheduled_at"),
            )
            legacy_trigger, legacy_interval, legacy_date = customer_surveys.derive_legacy_trigger_fields(launch_rules)
            execute(
                """
                UPDATE survey_templates
                SET launch_rules = %s,
                    trigger_type = %s,
                    periodic_interval = %s,
                    scheduled_at = %s
                WHERE id = %s
                """,
                (
                    json.dumps(launch_rules, ensure_ascii=False),
                    legacy_trigger,
                    legacy_interval,
                    legacy_date,
                    int(row["id"]),
                ),
            )

        execute(
            """
            UPDATE survey_templates
            SET audience = %s
            WHERE audience IS NULL OR TRIM(audience) = ''
            """,
            (customer_surveys.SURVEY_AUDIENCE_CLIENT,),
        )

        execute(
            """
            UPDATE survey_questions
            SET anonymity_mode = %s
            WHERE anonymity_mode IS NULL OR TRIM(anonymity_mode) = ''
            """,
            (customer_surveys.ANONYMITY_INHERIT,),
        )

        answer_rows = execute(
            """
            SELECT sa.id, ss.is_anonymous, sq.anonymity_mode
            FROM survey_answers sa
            JOIN survey_sessions ss ON ss.id = sa.session_id
            JOIN survey_questions sq ON sq.id = sa.question_id
            WHERE sa.effective_is_anonymous IS NULL
               OR sa.effective_is_anonymous = FALSE
            """
        ).fetchall()
        for row in answer_rows:
            effective_is_anonymous = customer_surveys.effective_question_anonymity(
                {"anonymity_mode": row.get("anonymity_mode")},
                template_is_anonymous=bool(row.get("is_anonymous")),
            )
            execute(
                "UPDATE survey_answers SET effective_is_anonymous = %s WHERE id = %s",
                (effective_is_anonymous, int(row["id"])),
            )

        execute(
            """
            UPDATE employee_client_assessments
            SET request_repeat_status = CASE
                    WHEN request_repeat_status IS NOT NULL AND TRIM(request_repeat_status) <> '' THEN request_repeat_status
                    WHEN repeated_request THEN %s
                    ELSE %s
                END,
                first_contact = CASE
                    WHEN request_repeat_status = %s THEN TRUE
                    ELSE COALESCE(first_contact, FALSE)
                END
            """,
            (
                employee_client_assessments.REQUEST_REPEAT_REPEATED_SAME_ISSUE,
                employee_client_assessments.REQUEST_REPEAT_NOT_REPEATED,
                employee_client_assessments.REQUEST_REPEAT_FIRST_CONTACT,
            ),
        )

    employee_client_assessments.backfill_historical_assessments()

    with _lock:
        # Best-effort backfill: tie survey operator snapshots to the canonical
        # operator stats row when we can resolve it by appeal/dialog + name.
        execute(
            """
            UPDATE survey_session_operators sso
            SET operator_stat_id = resolved.id
            FROM (
                SELECT
                    sso_inner.id AS survey_session_operator_id,
                    MIN(dos.id) AS id
                FROM survey_session_operators sso_inner
                JOIN survey_sessions ss ON ss.id = sso_inner.session_id
                JOIN dialog_operator_stats dos
                  ON LOWER(TRIM(dos.operator_name)) = LOWER(TRIM(sso_inner.operator_name))
                 AND (
                        (ss.appeal_id IS NOT NULL AND dos.appeal_id = ss.appeal_id)
                     OR (ss.appeal_id IS NULL AND dos.appeal_id IS NULL AND dos.dialog_id = ss.dialog_id)
                 )
                WHERE sso_inner.operator_stat_id IS NULL
                GROUP BY sso_inner.id
            ) AS resolved
            WHERE sso.id = resolved.survey_session_operator_id
            """
        )

    # Backward-compatible schema tightening: add explicit links by id for legacy
    # tables and partial installations without forcing a destructive migration.
    _ensure_foreign_key(
        "messages",
        "dialog_id",
        "chat_dialogs",
        "id",
        constraint_name="fk_messages_dialog_id_chat_dialogs",
        on_delete="SET NULL",
    )
    _ensure_foreign_key(
        "user_bins",
        "assigned_by",
        "users",
        "id",
        constraint_name="fk_user_bins_assigned_by_users",
        on_delete="SET NULL",
    )
    _ensure_foreign_key(
        "outbox_onec",
        "chat_id",
        "chats",
        "chat_id",
        constraint_name="fk_outbox_onec_chat_id_chats",
        on_delete="CASCADE",
    )
    _ensure_foreign_key(
        "outbox_onec",
        "message_id",
        "messages",
        "id",
        constraint_name="fk_outbox_onec_message_id_messages",
        on_delete="SET NULL",
    )
    _ensure_foreign_key(
        "dialog_stats",
        "dialog_id",
        "chat_dialogs",
        "id",
        constraint_name="fk_dialog_stats_dialog_id_chat_dialogs",
        on_delete="CASCADE",
    )
    _ensure_foreign_key(
        "dialog_stats",
        "chat_id",
        "chats",
        "chat_id",
        constraint_name="fk_dialog_stats_chat_id_chats",
        on_delete="CASCADE",
    )
    _ensure_foreign_key(
        "dialog_stats",
        "appeal_id",
        "appeals",
        "id",
        constraint_name="fk_dialog_stats_appeal_id_appeals",
        on_delete="SET NULL",
    )
    _ensure_foreign_key(
        "dialog_operator_stats",
        "dialog_id",
        "chat_dialogs",
        "id",
        constraint_name="fk_dialog_operator_stats_dialog_id_chat_dialogs",
        on_delete="CASCADE",
    )
    _ensure_foreign_key(
        "dialog_operator_stats",
        "appeal_id",
        "appeals",
        "id",
        constraint_name="fk_dialog_operator_stats_appeal_id_appeals",
        on_delete="SET NULL",
    )
    _ensure_foreign_key(
        "operator_csat_ratings",
        "dialog_id",
        "chat_dialogs",
        "id",
        constraint_name="fk_operator_csat_ratings_dialog_id_chat_dialogs",
        on_delete="CASCADE",
    )
    _ensure_foreign_key(
        "operator_csat_ratings",
        "appeal_id",
        "appeals",
        "id",
        constraint_name="fk_operator_csat_ratings_appeal_id_appeals",
        on_delete="SET NULL",
    )
    _ensure_foreign_key(
        "dialog_feedback_ratings",
        "dialog_id",
        "chat_dialogs",
        "id",
        constraint_name="fk_dialog_feedback_ratings_dialog_id_chat_dialogs",
        on_delete="CASCADE",
    )
    _ensure_foreign_key(
        "dialog_feedback_ratings",
        "appeal_id",
        "appeals",
        "id",
        constraint_name="fk_dialog_feedback_ratings_appeal_id_appeals",
        on_delete="SET NULL",
    )
    _ensure_foreign_key(
        "stat_questions",
        "dialog_id",
        "chat_dialogs",
        "id",
        constraint_name="fk_stat_questions_dialog_id_chat_dialogs",
        on_delete="SET NULL",
    )
    _ensure_foreign_key(
        "stat_questions",
        "appeal_id",
        "appeals",
        "id",
        constraint_name="fk_stat_questions_appeal_id_appeals",
        on_delete="SET NULL",
    )
    _ensure_foreign_key(
        "survey_templates",
        "created_by",
        "users",
        "id",
        constraint_name="fk_survey_templates_created_by_users",
        on_delete="SET NULL",
    )
    _ensure_foreign_key(
        "survey_questions",
        "template_id",
        "survey_templates",
        "id",
        constraint_name="fk_survey_questions_template_id_survey_templates",
        on_delete="CASCADE",
    )
    _ensure_foreign_key(
        "survey_sessions",
        "template_id",
        "survey_templates",
        "id",
        constraint_name="fk_survey_sessions_template_id_survey_templates",
        on_delete="CASCADE",
    )
    _ensure_foreign_key(
        "survey_sessions",
        "chat_id",
        "chats",
        "chat_id",
        constraint_name="fk_survey_sessions_chat_id_chats",
        on_delete="CASCADE",
    )
    _ensure_foreign_key(
        "survey_sessions",
        "dialog_id",
        "chat_dialogs",
        "id",
        constraint_name="fk_survey_sessions_dialog_id_chat_dialogs",
        on_delete="SET NULL",
    )
    _ensure_foreign_key(
        "survey_sessions",
        "appeal_id",
        "appeals",
        "id",
        constraint_name="fk_survey_sessions_appeal_id_appeals",
        on_delete="SET NULL",
    )
    _ensure_foreign_key(
        "survey_sessions",
        "current_question_id",
        "survey_questions",
        "id",
        constraint_name="fk_survey_sessions_current_question_id_survey_questions",
        on_delete="SET NULL",
    )
    _ensure_foreign_key(
        "survey_session_operators",
        "session_id",
        "survey_sessions",
        "id",
        constraint_name="fk_survey_session_operators_session_id_survey_sessions",
        on_delete="CASCADE",
    )
    _ensure_foreign_key(
        "survey_session_operators",
        "operator_stat_id",
        "dialog_operator_stats",
        "id",
        constraint_name="fk_survey_session_operators_operator_stat_id_dialog_operator_stats",
        on_delete="SET NULL",
    )
    _ensure_foreign_key(
        "survey_answers",
        "session_id",
        "survey_sessions",
        "id",
        constraint_name="fk_survey_answers_session_id_survey_sessions",
        on_delete="CASCADE",
    )
    _ensure_foreign_key(
        "survey_answers",
        "question_id",
        "survey_questions",
        "id",
        constraint_name="fk_survey_answers_question_id_survey_questions",
        on_delete="CASCADE",
    )
    _ensure_foreign_key(
        "employee_client_assessments",
        "dialog_id",
        "chat_dialogs",
        "id",
        constraint_name="fk_employee_client_assessments_dialog_id_chat_dialogs",
        on_delete="CASCADE",
    )
    _ensure_foreign_key(
        "employee_client_assessments",
        "appeal_id",
        "appeals",
        "id",
        constraint_name="fk_employee_client_assessments_appeal_id_appeals",
        on_delete="SET NULL",
    )
    _ensure_foreign_key(
        "employee_client_assessments",
        "chat_id",
        "chats",
        "chat_id",
        constraint_name="fk_employee_client_assessments_chat_id_chats",
        on_delete="CASCADE",
    )

    with _lock:
        execute(
            """
            CREATE INDEX IF NOT EXISTS idx_chat_dialogs_purged_state
            ON chat_dialogs(purged_at, ended_at, started_at)
            """
        )
    _ensure_foreign_key(
        "employee_client_assessments",
        "assigned_user_id",
        "users",
        "id",
        constraint_name="fk_employee_client_assessments_assigned_user_id_users",
        on_delete="CASCADE",
    )
    _ensure_foreign_key(
        "client_bins",
        "chat_id",
        "chats",
        "chat_id",
        constraint_name="fk_client_bins_chat_id_chats",
        on_delete="CASCADE",
    )
    _ensure_foreign_key(
        "appeals",
        "chat_id",
        "chats",
        "chat_id",
        constraint_name="fk_appeals_chat_id_chats",
        on_delete="CASCADE",
    )
    _ensure_foreign_key(
        "reply_templates",
        "created_by",
        "users",
        "id",
        constraint_name="fk_reply_templates_created_by_users",
        on_delete="SET NULL",
    )

    _ensure_check_constraint(
        "users",
        constraint_name="chk_users_role_known",
        expression=_build_nullable_enum_check("role", tuple(ALL_ROLES)),
    )
    _ensure_check_constraint(
        "dialog_stats",
        constraint_name="chk_dialog_stats_csat_rating_range",
        expression='"csat_rating" IS NULL OR "csat_rating" BETWEEN 1 AND 5',
    )
    _ensure_check_constraint(
        "dialog_stats",
        constraint_name="chk_dialog_stats_ai_csat_rating_range",
        expression='"ai_csat_rating" IS NULL OR "ai_csat_rating" BETWEEN 1 AND 5',
    )
    _ensure_check_constraint(
        "operator_csat_ratings",
        constraint_name="chk_operator_csat_ratings_rating_range",
        expression='"rating" BETWEEN 1 AND 5',
    )
    _ensure_check_constraint(
        "operator_csat_ratings",
        constraint_name="chk_operator_csat_ratings_rater_type_known",
        expression=_build_nullable_enum_check("rater_type", RATING_RATER_TYPES),
    )
    _ensure_check_constraint(
        "operator_csat_ratings",
        constraint_name="chk_operator_csat_ratings_rated_object_type_known",
        expression=_build_nullable_enum_check("rated_object_type", RATING_OBJECT_TYPES),
    )
    _ensure_check_constraint(
        "operator_csat_ratings",
        constraint_name="chk_operator_csat_ratings_channel_known",
        expression=_build_nullable_enum_check("channel", RATING_CHANNELS),
    )
    _ensure_check_constraint(
        "dialog_feedback_ratings",
        constraint_name="chk_dialog_feedback_ratings_rating_kind_known",
        expression=_build_nullable_enum_check("rating_kind", DIALOG_FEEDBACK_KINDS),
    )
    _ensure_check_constraint(
        "dialog_feedback_ratings",
        constraint_name="chk_dialog_feedback_ratings_rating_range",
        expression='"rating" BETWEEN 1 AND 5',
    )
    _ensure_check_constraint(
        "dialog_feedback_ratings",
        constraint_name="chk_dialog_feedback_ratings_rater_type_known",
        expression=_build_nullable_enum_check("rater_type", RATING_RATER_TYPES),
    )
    _ensure_check_constraint(
        "dialog_feedback_ratings",
        constraint_name="chk_dialog_feedback_ratings_rated_object_type_known",
        expression=_build_nullable_enum_check("rated_object_type", RATING_OBJECT_TYPES),
    )
    _ensure_check_constraint(
        "dialog_feedback_ratings",
        constraint_name="chk_dialog_feedback_ratings_channel_known",
        expression=_build_nullable_enum_check("channel", RATING_CHANNELS),
    )
    _ensure_check_constraint(
        "survey_templates",
        constraint_name="chk_survey_templates_audience_known",
        expression=_build_nullable_enum_check("audience", tuple(sorted(customer_surveys.SURVEY_AUDIENCES))),
    )
    _ensure_check_constraint(
        "survey_templates",
        constraint_name="chk_survey_templates_status_known",
        expression=_build_nullable_enum_check(
            "status",
            (
                customer_surveys.SURVEY_STATUS_DRAFT,
                customer_surveys.SURVEY_STATUS_ACTIVE,
                customer_surveys.SURVEY_STATUS_ARCHIVED,
            ),
        ),
    )
    _ensure_check_constraint(
        "survey_questions",
        constraint_name="chk_survey_questions_question_type_known",
        expression=_build_nullable_enum_check("question_type", tuple(sorted(customer_surveys.QUESTION_TYPES))),
    )
    _ensure_check_constraint(
        "survey_questions",
        constraint_name="chk_survey_questions_anonymity_mode_known",
        expression=_build_nullable_enum_check(
            "anonymity_mode",
            tuple(sorted(customer_surveys.QUESTION_ANONYMITY_MODES)),
        ),
    )
    _ensure_check_constraint(
        "survey_sessions",
        constraint_name="chk_survey_sessions_status_known",
        expression=_build_nullable_enum_check(
            "status",
            (
                customer_surveys.SESSION_STATUS_STARTED,
                customer_surveys.SESSION_STATUS_CURRENT,
                customer_surveys.SESSION_STATUS_ANSWER_SAVED,
                customer_surveys.SESSION_STATUS_COMPLETED,
                customer_surveys.SESSION_STATUS_SKIPPED,
                customer_surveys.SESSION_STATUS_UNAVAILABLE,
            ),
        ),
    )
    _ensure_check_constraint(
        "employee_client_assessments",
        constraint_name="chk_employee_client_assessments_status_known",
        expression=_build_nullable_enum_check(
            "status",
            (
                employee_client_assessments.ASSESSMENT_STATUS_PENDING,
                employee_client_assessments.ASSESSMENT_STATUS_SUBMITTED,
            ),
        ),
    )
    _ensure_check_constraint(
        "employee_client_assessments",
        constraint_name="chk_employee_client_assessments_interaction_status_known",
        expression=_build_nullable_enum_check(
            "interaction_status",
            tuple(sorted(employee_client_assessments.INTERACTION_STATUSES)),
        ),
    )
    _ensure_check_constraint(
        "employee_client_assessments",
        constraint_name="chk_employee_client_assessments_interaction_flag_known",
        expression=_build_nullable_enum_check(
            "interaction_flag",
            tuple(sorted(employee_client_assessments.INTERACTION_FLAGS)),
        ),
    )
    _ensure_check_constraint(
        "employee_client_assessments",
        constraint_name="chk_employee_client_assessments_request_repeat_status_known",
        expression=_build_nullable_enum_check(
            "request_repeat_status",
            tuple(sorted(employee_client_assessments.REQUEST_REPEAT_STATUSES)),
        ),
    )
    _ensure_check_constraint(
        "employee_client_assessments",
        constraint_name="chk_employee_client_assessments_low_score_reason_known",
        expression=_build_nullable_enum_check(
            "low_score_reason",
            tuple(sorted(employee_client_assessments.LOW_SCORE_REASONS)),
        ),
    )

    with _lock:
        execute(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'survey_questions' AND column_name = 'survey_id'
                ) THEN
                    ALTER TABLE survey_questions ALTER COLUMN survey_id DROP NOT NULL;
                END IF;

                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'survey_answers' AND column_name = 'survey_id'
                ) THEN
                    ALTER TABLE survey_answers ALTER COLUMN survey_id DROP NOT NULL;
                END IF;
            END $$
            """
        )

    # Unique constraint on dialog_stats РІР‚вЂќ one row per appeal
    with _lock:
        execute(
            """
            DO $$
            DECLARE
                constraint_name TEXT;
            BEGIN
                SELECT tc.constraint_name
                INTO constraint_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.constraint_column_usage ccu
                  ON tc.constraint_name = ccu.constraint_name
                 AND tc.table_schema = ccu.table_schema
                WHERE tc.table_schema = 'public'
                  AND tc.table_name = 'dialog_stats'
                  AND tc.constraint_type = 'UNIQUE'
                  AND ccu.column_name = 'dialog_id'
                LIMIT 1;

                IF constraint_name IS NOT NULL THEN
                    EXECUTE format('ALTER TABLE dialog_stats DROP CONSTRAINT %%I', constraint_name);
                END IF;
            END $$
            """
        )
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
        execute(
            "CREATE INDEX IF NOT EXISTS idx_dialog_op_stats_appeal_id ON dialog_operator_stats (appeal_id)"
        )
        execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_csat_unique_appeal_operator ON operator_csat_ratings (appeal_id, operator_name) WHERE appeal_id IS NOT NULL"
        )
        execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_csat_unique_dialog_operator ON operator_csat_ratings (dialog_id, operator_name) WHERE appeal_id IS NULL"
        )
        execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_dialog_feedback_ratings_unique_appeal_kind ON dialog_feedback_ratings (appeal_id, rating_kind) WHERE appeal_id IS NOT NULL"
        )
        execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_dialog_feedback_ratings_unique_dialog_kind ON dialog_feedback_ratings (dialog_id, rating_kind) WHERE appeal_id IS NULL"
        )
        execute(
            "CREATE INDEX IF NOT EXISTS idx_stat_questions_appeal_id ON stat_questions (appeal_id)"
        )
        execute(
            "CREATE INDEX IF NOT EXISTS idx_survey_templates_status_audience_trigger ON survey_templates (status, audience, trigger_type)"
        )
        execute(
            "CREATE INDEX IF NOT EXISTS idx_survey_questions_template_order ON survey_questions (template_id, sort_order, id)"
        )
        execute(
            "CREATE INDEX IF NOT EXISTS idx_survey_sessions_chat_status ON survey_sessions (chat_id, status, updated_at)"
        )
        execute(
            "CREATE INDEX IF NOT EXISTS idx_survey_sessions_context ON survey_sessions (template_id, dialog_id, appeal_id)"
        )
        execute(
            "CREATE INDEX IF NOT EXISTS idx_survey_answers_session ON survey_answers (session_id, question_id)"
        )
        execute(
            "CREATE INDEX IF NOT EXISTS idx_survey_answers_topic_score ON survey_answers (topic, numeric_score)"
        )
        execute(
            "CREATE INDEX IF NOT EXISTS idx_survey_session_operators_name ON survey_session_operators (operator_name)"
        )
        execute(
            "CREATE INDEX IF NOT EXISTS idx_employee_client_assessments_pending ON employee_client_assessments (assigned_user_id, status, dialog_id)"
        )
        execute(
            "CREATE INDEX IF NOT EXISTS idx_employee_client_assessments_client ON employee_client_assessments (client_bin, chat_id, submitted_at)"
        )
        execute(
            "CREATE INDEX IF NOT EXISTS idx_employee_client_assessments_appeal ON employee_client_assessments (appeal_id)"
        )

    with _lock:
        execute(
            """
            WITH latest_dialog_feedback AS (
                SELECT dialog_id, appeal_id, csat_rating AS rating, created_at
                FROM (
                    SELECT
                        ds.dialog_id,
                        ds.appeal_id,
                        ds.csat_rating,
                        ds.created_at,
                        ROW_NUMBER() OVER (
                            PARTITION BY COALESCE(ds.appeal_id, -ds.dialog_id)
                            ORDER BY ds.created_at DESC, ds.id DESC
                        ) AS rn
                    FROM dialog_stats ds
                    WHERE ds.csat_rating IS NOT NULL
                ) ranked
                WHERE rn = 1
            )
            INSERT INTO dialog_feedback_ratings
                (dialog_id, appeal_id, rating_kind, rating, created_at, updated_at)
            SELECT
                ldf.dialog_id,
                ldf.appeal_id,
                %s,
                ldf.rating,
                ldf.created_at,
                ldf.created_at
            FROM latest_dialog_feedback ldf
            WHERE NOT EXISTS (
                SELECT 1
                FROM dialog_feedback_ratings dfr
                WHERE dfr.rating_kind = %s
                  AND (
                        (ldf.appeal_id IS NOT NULL AND dfr.appeal_id = ldf.appeal_id)
                     OR (ldf.appeal_id IS NULL AND dfr.appeal_id IS NULL AND dfr.dialog_id = ldf.dialog_id)
                  )
            )
            """,
            (DIALOG_FEEDBACK_KIND_CLIENT, DIALOG_FEEDBACK_KIND_CLIENT),
        )
        execute(
            """
            WITH latest_ai_feedback AS (
                SELECT dialog_id, appeal_id, ai_csat_rating AS rating, created_at
                FROM (
                    SELECT
                        ds.dialog_id,
                        ds.appeal_id,
                        ds.ai_csat_rating,
                        ds.created_at,
                        ROW_NUMBER() OVER (
                            PARTITION BY COALESCE(ds.appeal_id, -ds.dialog_id)
                            ORDER BY ds.created_at DESC, ds.id DESC
                        ) AS rn
                    FROM dialog_stats ds
                    WHERE ds.ai_csat_rating IS NOT NULL
                ) ranked
                WHERE rn = 1
            )
            INSERT INTO dialog_feedback_ratings
                (dialog_id, appeal_id, rating_kind, rating, created_at, updated_at)
            SELECT
                laf.dialog_id,
                laf.appeal_id,
                %s,
                laf.rating,
                laf.created_at,
                laf.created_at
            FROM latest_ai_feedback laf
            WHERE NOT EXISTS (
                SELECT 1
                FROM dialog_feedback_ratings dfr
                WHERE dfr.rating_kind = %s
                  AND (
                        (laf.appeal_id IS NOT NULL AND dfr.appeal_id = laf.appeal_id)
                     OR (laf.appeal_id IS NULL AND dfr.appeal_id IS NULL AND dfr.dialog_id = laf.dialog_id)
                  )
            )
            """,
            (DIALOG_FEEDBACK_KIND_AI, DIALOG_FEEDBACK_KIND_AI),
        )
        execute(
            """
            UPDATE dialog_feedback_ratings dfr
            SET rater_type = COALESCE(NULLIF(TRIM(dfr.rater_type), ''), %s),
                rater_chat_id = COALESCE(dfr.rater_chat_id, cd.chat_id),
                rater_external_chat_id = COALESCE(NULLIF(TRIM(dfr.rater_external_chat_id), ''), c.external_chat_id),
                rater_name = COALESCE(
                    NULLIF(TRIM(dfr.rater_name), ''),
                    NULLIF(TRIM(c.title), ''),
                    NULLIF(TRIM(c.username), ''),
                    NULLIF(TRIM(c.external_chat_id), '')
                ),
                rated_object_type = COALESCE(
                    NULLIF(TRIM(dfr.rated_object_type), ''),
                    CASE WHEN dfr.rating_kind = %s THEN %s ELSE %s END
                ),
                rated_object_id = COALESCE(
                    NULLIF(TRIM(dfr.rated_object_id), ''),
                    CASE WHEN dfr.rating_kind = %s THEN 'ai' ELSE COALESCE(dfr.appeal_id::text, dfr.dialog_id::text) END
                ),
                rated_object_name = COALESCE(
                    NULLIF(TRIM(dfr.rated_object_name), ''),
                    CASE WHEN dfr.rating_kind = %s THEN 'AI' ELSE NULL END
                ),
                channel = COALESCE(NULLIF(TRIM(dfr.channel), ''), %s),
                ai_involved = COALESCE(dfr.ai_involved, FALSE) OR dfr.rating_kind = %s
            FROM chat_dialogs cd
            LEFT JOIN chats c ON c.chat_id = cd.chat_id
            WHERE cd.id = dfr.dialog_id
            """,
            (
                RATING_RATER_TYPE_CLIENT,
                DIALOG_FEEDBACK_KIND_AI,
                RATING_OBJECT_TYPE_AI,
                RATING_OBJECT_TYPE_APPEAL,
                DIALOG_FEEDBACK_KIND_AI,
                DIALOG_FEEDBACK_KIND_AI,
                RATING_CHANNEL_SYSTEM,
                DIALOG_FEEDBACK_KIND_AI,
            ),
        )
        execute(
            """
            UPDATE operator_csat_ratings ocr
            SET rater_type = COALESCE(NULLIF(TRIM(ocr.rater_type), ''), %s),
                rater_chat_id = COALESCE(ocr.rater_chat_id, cd.chat_id),
                rater_external_chat_id = COALESCE(NULLIF(TRIM(ocr.rater_external_chat_id), ''), c.external_chat_id),
                rater_name = COALESCE(
                    NULLIF(TRIM(ocr.rater_name), ''),
                    NULLIF(TRIM(c.title), ''),
                    NULLIF(TRIM(c.username), ''),
                    NULLIF(TRIM(c.external_chat_id), '')
                ),
                rated_object_type = COALESCE(NULLIF(TRIM(ocr.rated_object_type), ''), %s),
                rated_object_id = COALESCE(
                    NULLIF(TRIM(ocr.rated_object_id), ''),
                    COALESCE(ocr.operator_stat_id::text, NULLIF(TRIM(ocr.operator_name), ''))
                ),
                rated_object_name = COALESCE(NULLIF(TRIM(ocr.rated_object_name), ''), NULLIF(TRIM(ocr.operator_name), '')),
                channel = COALESCE(NULLIF(TRIM(ocr.channel), ''), %s)
            FROM chat_dialogs cd
            LEFT JOIN chats c ON c.chat_id = cd.chat_id
            WHERE cd.id = ocr.dialog_id
            """,
            (
                RATING_RATER_TYPE_CLIENT,
                RATING_OBJECT_TYPE_EMPLOYEE,
                RATING_CHANNEL_SYSTEM,
            ),
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

    # Seed default reply templates (only if the table is empty)
    with _lock:
        count = execute("SELECT COUNT(*) AS cnt FROM reply_templates").fetchone()
        if count and int(count["cnt"]) == 0:
            now = datetime.now(timezone.utc).isoformat()
            raw_default_templates = [
                ("Р СџРЎР‚Р С‘Р Р†Р ВµРЎвЂљРЎРѓРЎвЂљР Р†Р С‘Р Вµ", "Р вЂ”Р Т‘РЎР‚Р В°Р Р†РЎРѓРЎвЂљР Р†РЎС“Р в„–РЎвЂљР Вµ! Р В§Р ВµР С Р СР С•Р С–РЎС“ Р С—Р С•Р СР С•РЎвЂЎРЎРЉ?", 0),
                ("Р Р€РЎвЂљР С•РЎвЂЎР Р…Р ВµР Р…Р С‘Р Вµ", "Р Р€РЎвЂљР С•РЎвЂЎР Р…Р С‘РЎвЂљР Вµ, Р С—Р С•Р В¶Р В°Р В»РЎС“Р в„–РЎРѓРЎвЂљР В°, Р Р†Р В°РЎв‚¬ Р Р†Р С•Р С—РЎР‚Р С•РЎРѓ Р С—Р С•Р Т‘РЎР‚Р С•Р В±Р Р…Р ВµР Вµ.", 1),
                ("Р С›Р В¶Р С‘Р Т‘Р В°Р Р…Р С‘Р Вµ", "Р СџР С•Р В¶Р В°Р В»РЎС“Р в„–РЎРѓРЎвЂљР В°, Р С—Р С•Р Т‘Р С•Р В¶Р Т‘Р С‘РЎвЂљР Вµ, РЎРЏ РЎС“РЎвЂљР С•РЎвЂЎР Р…РЎР‹ Р С‘Р Р…РЎвЂћР С•РЎР‚Р СР В°РЎвЂ Р С‘РЎР‹.", 2),
                ("Р вЂР В»Р В°Р С–Р С•Р Т‘Р В°РЎР‚Р Р…Р С•РЎРѓРЎвЂљРЎРЉ", "Р РЋР С—Р В°РЎРѓР С‘Р В±Р С• Р В·Р В° Р С•Р В±РЎР‚Р В°РЎвЂ°Р ВµР Р…Р С‘Р Вµ! Р вЂўРЎРѓР В»Р С‘ Р В±РЎС“Р Т‘РЎС“РЎвЂљ Р ВµРЎвЂ°РЎвЂ Р Р†Р С•Р С—РЎР‚Р С•РЎРѓРЎвЂ№ РІР‚вЂќ Р С—Р С‘РЎв‚¬Р С‘РЎвЂљР Вµ.", 3),
                ("Р СџР ВµРЎР‚Р ВµР Р†Р С•Р Т‘ Р Р…Р В° РЎРѓР С—Р ВµРЎвЂ Р С‘Р В°Р В»Р С‘РЎРѓРЎвЂљР В°", "Р СџР ВµРЎР‚Р ВµР Р†Р С•Р В¶РЎС“ Р Р†Р В°РЎв‚¬ Р Р†Р С•Р С—РЎР‚Р С•РЎРѓ Р Р…Р В° Р С—РЎР‚Р С•РЎвЂћР С‘Р В»РЎРЉР Р…Р С•Р С–Р С• РЎРѓР С—Р ВµРЎвЂ Р С‘Р В°Р В»Р С‘РЎРѓРЎвЂљР В°. Р С›Р В¶Р С‘Р Т‘Р В°Р в„–РЎвЂљР Вµ, Р С—Р С•Р В¶Р В°Р В»РЎС“Р в„–РЎРѓРЎвЂљР В°.", 4),
            ]
            default_templates = [
                (repair_text(title) or title, repair_text(text) or text, sort_order)
                for title, text, sort_order in raw_default_templates
            ]
            for title, text, sort_order in default_templates:
                execute(
                    """
                    INSERT INTO reply_templates (title, text, sort_order, created_at)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (title, text, sort_order, now),
                )

    with _lock:
        now = datetime.now(timezone.utc).isoformat()
        default_questions = customer_surveys.default_after_csat_questions()
        template_row = execute(
            """
            SELECT st.id, st.title, st.trigger_type, COUNT(DISTINCT sq.id) AS question_count,
                   COUNT(DISTINCT ss.id) AS session_count
            FROM survey_templates st
            LEFT JOIN survey_questions sq ON sq.template_id = st.id
            LEFT JOIN survey_sessions ss ON ss.template_id = st.id
            WHERE st.audience = %s
              AND st.status = %s
              AND (st.trigger_type = %s OR st.title = %s)
            GROUP BY st.id, st.title, st.trigger_type
            ORDER BY CASE WHEN st.title = %s THEN 0 ELSE 1 END,
                     COUNT(DISTINCT sq.id) DESC, st.updated_at DESC, st.id DESC
            LIMIT 1
            """,
            (
                customer_surveys.SURVEY_AUDIENCE_CLIENT,
                customer_surveys.SURVEY_STATUS_ACTIVE,
                customer_surveys.SURVEY_TRIGGER_PERIODIC,
                customer_surveys.DEFAULT_AFTER_CSAT_TITLE,
                customer_surveys.DEFAULT_AFTER_CSAT_TITLE,
            ),
        ).fetchone()

        template_id: int | None = None
        should_insert_questions = False
        if template_row is None:
            template = execute(
                """
                INSERT INTO survey_templates (
                    title, description, audience, status, trigger_type, periodic_interval,
                    scheduled_at, launch_rules, is_anonymous, created_by, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    customer_surveys.DEFAULT_AFTER_CSAT_TITLE,
                    customer_surveys.DEFAULT_AFTER_CSAT_DESCRIPTION,
                    customer_surveys.SURVEY_AUDIENCE_CLIENT,
                    customer_surveys.SURVEY_STATUS_ACTIVE,
                    customer_surveys.SURVEY_TRIGGER_AFTER_EMPLOYEE_CSAT,
                    None,
                    None,
                    json.dumps([{"type": customer_surveys.SURVEY_TRIGGER_AFTER_EMPLOYEE_CSAT, "dates": []}], ensure_ascii=False),
                    False,
                    None,
                    now,
                    now,
                ),
            ).fetchone()
            if template:
                template_id = int(template["id"])
                should_insert_questions = True
        else:
            existing_questions = execute(
                """
                SELECT sort_order, question_type, text, required
                FROM survey_questions
                WHERE template_id = %s
                ORDER BY sort_order ASC, id ASC
                """,
                (int(template_row["id"]),),
            ).fetchall()
            question_count = int(template_row["question_count"] or 0)
            session_count = int(template_row["session_count"] or 0)
            is_periodic_seed = template_row.get("trigger_type") == customer_surveys.SURVEY_TRIGGER_PERIODIC
            is_default_seed = is_periodic_seed or template_row.get("title") == customer_surveys.DEFAULT_AFTER_CSAT_TITLE
            broken_text = "???" in str(template_row.get("title") or "")
            needs_question_refresh = customer_surveys.default_after_csat_questions_need_refresh(existing_questions)
            if is_default_seed and (question_count < len(default_questions) or broken_text or needs_question_refresh):
                if session_count == 0:
                    template_id = int(template_row["id"])
                    execute("DELETE FROM survey_questions WHERE template_id = %s", (template_id,))
                    execute(
                        """
                        UPDATE survey_templates
                        SET title = %s, description = %s, audience = %s, status = %s, is_anonymous = %s, updated_at = %s
                        WHERE id = %s
                        """,
                        (
                            customer_surveys.DEFAULT_AFTER_CSAT_TITLE,
                            customer_surveys.DEFAULT_AFTER_CSAT_DESCRIPTION,
                            customer_surveys.SURVEY_AUDIENCE_CLIENT,
                            customer_surveys.SURVEY_STATUS_ACTIVE,
                            False,
                            now,
                            template_id,
                        ),
                    )
                    should_insert_questions = True
                else:
                    template_id = int(template_row["id"])
                    execute(
                        """
                        UPDATE survey_templates
                        SET title = %s, description = %s, audience = %s, status = %s, is_anonymous = %s, updated_at = %s
                        WHERE id = %s
                        """,
                        (
                            customer_surveys.DEFAULT_AFTER_CSAT_TITLE,
                            customer_surveys.DEFAULT_AFTER_CSAT_DESCRIPTION,
                            customer_surveys.SURVEY_AUDIENCE_CLIENT,
                            customer_surveys.SURVEY_STATUS_ACTIVE,
                            False,
                            now,
                            template_id,
                        ),
                    )
                    for index, question in enumerate(default_questions, start=1):
                        cursor = execute(
                            """
                            UPDATE survey_questions
                            SET question_type = %s,
                                text = %s,
                                topic = %s,
                                required = %s,
                                anonymity_mode = %s,
                                config = %s,
                                updated_at = %s
                            WHERE template_id = %s AND sort_order = %s
                            """,
                            (
                                question["question_type"],
                                question["text"],
                                question.get("topic"),
                                bool(question.get("required", True)),
                                customer_surveys.normalize_question_anonymity_mode(question.get("anonymity_mode")),
                                json.dumps(question.get("config") or {}, ensure_ascii=False),
                                now,
                                template_id,
                                index,
                            ),
                        )
                        if cursor.rowcount == 0:
                            execute(
                                """
                                INSERT INTO survey_questions (
                                    template_id, sort_order, question_type, text, topic,
                                    required, anonymity_mode, config, created_at, updated_at
                                )
                                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                                """,
                                (
                                    template_id,
                                    index,
                                    question["question_type"],
                                    question["text"],
                                    question.get("topic"),
                                    bool(question.get("required", True)),
                                    customer_surveys.normalize_question_anonymity_mode(question.get("anonymity_mode")),
                                    json.dumps(question.get("config") or {}, ensure_ascii=False),
                                    now,
                                    now,
                                ),
                            )

        if template_id is not None and should_insert_questions:
            for index, question in enumerate(default_questions, start=1):
                execute(
                    """
                    INSERT INTO survey_questions (
                        template_id, sort_order, question_type, text, topic,
                        required, anonymity_mode, config, created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        template_id,
                        index,
                        question["question_type"],
                        question["text"],
                        question.get("topic"),
                        bool(question.get("required", True)),
                        customer_surveys.normalize_question_anonymity_mode(question.get("anonymity_mode")),
                        json.dumps(question.get("config") or {}, ensure_ascii=False),
                        now,
                        now,
                    ),
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
        "media_files",
        "message_attachments",
        "messages_archive",
        "notifications",
        "outbox_onec",
        "dialog_stats",
        "dialog_operator_stats",
        "operator_csat_ratings",
        "dialog_feedback_ratings",
        "stat_questions",
        "survey_templates",
        "survey_questions",
        "survey_sessions",
        "survey_session_operators",
        "survey_answers",
        "employee_client_assessments",
        "organizations_without_contracts",
        "all_bins",
        "client_bins",
        "appeals",
        "reply_templates",
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


def _constraint_exists(table: str, constraint_name: str) -> bool:
    cursor = execute(
        """
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = %s
          AND constraint_name = %s
        """,
        (table, constraint_name),
    )
    return cursor.fetchone() is not None


def _foreign_key_exists(
    table: str,
    column: str,
    referenced_table: str,
    referenced_column: str,
) -> bool:
    cursor = execute(
        """
        SELECT 1
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        JOIN information_schema.referential_constraints rc
          ON tc.constraint_name = rc.constraint_name
         AND tc.table_schema = rc.constraint_schema
        JOIN information_schema.constraint_column_usage ccu
          ON rc.unique_constraint_name = ccu.constraint_name
         AND rc.unique_constraint_schema = ccu.constraint_schema
        WHERE tc.table_schema = 'public'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = %s
          AND kcu.column_name = %s
          AND ccu.table_name = %s
          AND ccu.column_name = %s
        LIMIT 1
        """,
        (table, column, referenced_table, referenced_column),
    )
    return cursor.fetchone() is not None


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _quote_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _ensure_foreign_key(
    table: str,
    column: str,
    referenced_table: str,
    referenced_column: str,
    *,
    constraint_name: str,
    on_delete: str | None = None,
    not_valid: bool = True,
) -> None:
    if _constraint_exists(table, constraint_name) or _foreign_key_exists(
        table,
        column,
        referenced_table,
        referenced_column,
    ):
        return

    delete_clause = f" ON DELETE {on_delete}" if on_delete else ""
    not_valid_clause = " NOT VALID" if not_valid else ""
    query = (
        f"ALTER TABLE {_quote_identifier(table)} "
        f"ADD CONSTRAINT {_quote_identifier(constraint_name)} "
        f"FOREIGN KEY ({_quote_identifier(column)}) "
        f"REFERENCES {_quote_identifier(referenced_table)} ({_quote_identifier(referenced_column)})"
        f"{delete_clause}{not_valid_clause}"
    )

    with _lock:
        if _constraint_exists(table, constraint_name) or _foreign_key_exists(
            table,
            column,
            referenced_table,
            referenced_column,
        ):
            return
        execute(query)


def _ensure_check_constraint(
    table: str,
    *,
    constraint_name: str,
    expression: str,
    not_valid: bool = True,
) -> None:
    not_valid_clause = " NOT VALID" if not_valid else ""
    drop_query = (
        f"ALTER TABLE {_quote_identifier(table)} "
        f"DROP CONSTRAINT IF EXISTS {_quote_identifier(constraint_name)}"
    )
    query = (
        f"ALTER TABLE {_quote_identifier(table)} "
        f"ADD CONSTRAINT {_quote_identifier(constraint_name)} "
        f"CHECK ({expression}){not_valid_clause}"
    )

    with _lock:
        if _constraint_exists(table, constraint_name):
            execute(drop_query)
        execute(query)


def _build_nullable_enum_check(column: str, allowed_values: Sequence[str]) -> str:
    values = ", ".join(_quote_literal(value) for value in allowed_values)
    return f"{_quote_identifier(column)} IS NULL OR {_quote_identifier(column)} IN ({values})"


def _ensure_column(table: str, column: str, definition: str) -> None:
    if _column_exists(table, column):
        return

    with _lock:
        if _column_exists(table, column):
            return
        # Build raw SQL string РІР‚вЂќ execute() handles connection pooling
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
    admin_label = "Администратор"
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
                (ROLE_ADMIN, password_hash, "Р С’Р Т‘Р СР С‘Р Р…Р С‘РЎРѓРЎвЂљРЎР‚Р В°РЎвЂљР С•РЎР‚", "admin@example.com", row["id"]),
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
            "Р С’Р Т‘Р СР С‘Р Р…Р С‘РЎРѓРЎвЂљРЎР‚Р В°РЎвЂљР С•РЎР‚",
            password_hash,
            now,
            "Р С’Р Т‘Р СР С‘Р Р…Р С‘РЎРѓРЎвЂљРЎР‚Р В°РЎвЂљР С•РЎР‚",
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
    quick_replies: list[dict[str, Any]]

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
            quick_replies=_json_loads(row.get("quick_replies"), []),
        )


def _row_to_media_file(row: Mapping[str, Any] | None) -> Dict[str, Any] | None:
    if row is None:
        return None
    return {
        "id": int(row["id"]),
        "storage_provider": str(row["storage_provider"]),
        "bucket": str(row["bucket"]),
        "object_key": str(row["object_key"]),
        "sha256": str(row["sha256"]),
        "mime_type": str(row["mime_type"]),
        "size_bytes": int(row["size_bytes"]),
        "original_name": str(row["original_name"]),
        "width": int(row["width"]) if row.get("width") is not None else None,
        "height": int(row["height"]) if row.get("height") is not None else None,
        "duration_sec": float(row["duration_sec"]) if row.get("duration_sec") is not None else None,
        "created_at": str(row["created_at"]),
    }


def _normalize_media_kind(mime_type: str) -> str:
    return "video" if str(mime_type).startswith("video/") else "image"


def create_media_file(
    *,
    storage_provider: str,
    bucket: str,
    object_key: str,
    sha256: str,
    mime_type: str,
    size_bytes: int,
    original_name: str,
    width: int | None = None,
    height: int | None = None,
    duration_sec: float | None = None,
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        cursor = execute(
            """
            INSERT INTO media_files (
                storage_provider, bucket, object_key, sha256, mime_type,
                size_bytes, original_name, width, height, duration_sec, created_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, storage_provider, bucket, object_key, sha256, mime_type, size_bytes, original_name, width, height, duration_sec, created_at
            """,
            (
                storage_provider,
                bucket,
                object_key,
                sha256,
                mime_type,
                int(size_bytes),
                original_name,
                width,
                height,
                duration_sec,
                now,
            ),
        )
        row = cursor.fetchone()
    media_file = _row_to_media_file(row)
    if media_file is None:
        raise RuntimeError("Failed to persist media file")
    return media_file


def find_media_file_by_fingerprint(sha256: str, size_bytes: int, mime_type: str) -> Dict[str, Any] | None:
    with _lock:
        row = execute(
            """
            SELECT id, storage_provider, bucket, object_key, sha256, mime_type, size_bytes, original_name, width, height, duration_sec, created_at
            FROM media_files
            WHERE sha256 = %s AND size_bytes = %s AND mime_type = %s
            ORDER BY id ASC
            LIMIT 1
            """,
            (sha256, int(size_bytes), mime_type),
        ).fetchone()
    return _row_to_media_file(row)


def get_media_file(media_id: int) -> Dict[str, Any] | None:
    with _lock:
        row = execute(
            """
            SELECT id, storage_provider, bucket, object_key, sha256, mime_type, size_bytes, original_name, width, height, duration_sec, created_at
            FROM media_files
            WHERE id = %s
            """,
            (media_id,),
        ).fetchone()
    return _row_to_media_file(row)


def list_media_files(media_ids: Sequence[int]) -> List[Dict[str, Any]]:
    normalized_ids = [int(media_id) for media_id in media_ids]
    if not normalized_ids:
        return []
    placeholders = ",".join("%s" for _ in normalized_ids)
    with _lock:
        rows = execute(
            f"""
            SELECT id, storage_provider, bucket, object_key, sha256, mime_type, size_bytes, original_name, width, height, duration_sec, created_at
            FROM media_files
            WHERE id IN ({placeholders})
            ORDER BY id ASC
            """,
            normalized_ids,
        ).fetchall()
    result: List[Dict[str, Any]] = []
    for row in rows:
        media_file = _row_to_media_file(row)
        if media_file is not None:
            result.append(media_file)
    return result


def attach_media_to_message(
    message_id: int,
    media_file_ids: Sequence[int],
    captions: Mapping[int, str | None] | None = None,
) -> None:
    normalized_ids: List[int] = []
    seen: set[int] = set()
    for media_file_id in media_file_ids:
        normalized_id = int(media_file_id)
        if normalized_id <= 0 or normalized_id in seen:
            continue
        normalized_ids.append(normalized_id)
        seen.add(normalized_id)
    if not normalized_ids:
        return

    existing = {item["id"]: item for item in list_media_files(normalized_ids)}
    if len(existing) != len(normalized_ids):
        missing = [str(media_id) for media_id in normalized_ids if media_id not in existing]
        raise ValueError(f"Unknown attachment ids: {', '.join(missing)}")

    caption_map = captions or {}
    with _lock:
        for sort_order, media_file_id in enumerate(normalized_ids):
            media_file = existing[media_file_id]
            execute(
                """
                INSERT INTO message_attachments (message_id, media_file_id, sort_order, kind, caption)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    int(message_id),
                    media_file_id,
                    sort_order,
                    _normalize_media_kind(str(media_file["mime_type"])),
                    caption_map.get(media_file_id),
                ),
                )


def _delete_orphaned_media_files(media_file_ids: Iterable[int] | None = None) -> None:
    normalized_ids = sorted(
        {
            int(media_file_id)
            for media_file_id in (media_file_ids or [])
            if media_file_id is not None and int(media_file_id) > 0
        }
    )
    if normalized_ids:
        placeholders = ",".join("%s" for _ in normalized_ids)
        execute(
            f"""
            DELETE FROM media_files mf
            WHERE mf.id IN ({placeholders})
              AND NOT EXISTS (
                  SELECT 1
                  FROM message_attachments ma
                  WHERE ma.media_file_id = mf.id
              )
            """,
            normalized_ids,
        )
        return

    execute(
        """
        DELETE FROM media_files mf
        WHERE NOT EXISTS (
            SELECT 1
            FROM message_attachments ma
            WHERE ma.media_file_id = mf.id
        )
        """
    )


def get_message_attachments_map(message_ids: Sequence[int]) -> Dict[int, List[Dict[str, Any]]]:
    normalized_ids = [int(message_id) for message_id in message_ids]
    result: Dict[int, List[Dict[str, Any]]] = {message_id: [] for message_id in normalized_ids}
    if not normalized_ids:
        return result
    placeholders = ",".join("%s" for _ in normalized_ids)
    with _lock:
        rows = execute(
            f"""
            SELECT
                ma.id AS attachment_id,
                ma.message_id,
                ma.media_file_id,
                ma.sort_order,
                ma.kind,
                ma.caption,
                mf.mime_type,
                mf.size_bytes,
                mf.original_name,
                mf.width,
                mf.height,
                mf.duration_sec,
                mf.storage_provider,
                mf.bucket,
                mf.object_key,
                mf.sha256,
                mf.created_at
            FROM message_attachments ma
            JOIN media_files mf ON mf.id = ma.media_file_id
            WHERE ma.message_id IN ({placeholders})
            ORDER BY ma.message_id ASC, ma.sort_order ASC, ma.id ASC
            """,
            normalized_ids,
        ).fetchall()
    for row in rows:
        message_id = int(row["message_id"])
        result.setdefault(message_id, []).append(
            {
                "id": int(row["attachment_id"]),
                "media_id": int(row["media_file_id"]),
                "sort_order": int(row["sort_order"]),
                "kind": str(row["kind"]),
                "caption": row.get("caption"),
                "mime_type": str(row["mime_type"]),
                "size_bytes": int(row["size_bytes"]),
                "original_name": str(row["original_name"]),
                "width": int(row["width"]) if row.get("width") is not None else None,
                "height": int(row["height"]) if row.get("height") is not None else None,
                "duration_sec": float(row["duration_sec"]) if row.get("duration_sec") is not None else None,
                "storage_provider": str(row["storage_provider"]),
                "bucket": str(row["bucket"]),
                "object_key": str(row["object_key"]),
                "sha256": str(row["sha256"]),
                "created_at": str(row["created_at"]),
            }
        )
    return result


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
    attachment_ids: Sequence[int] | None = None,
    quick_replies: Sequence[Mapping[str, Any]] | None = None,
) -> int:
    normalized_text = text if text is not None else ""
    normalized_attachment_ids = [int(item) for item in (attachment_ids or []) if int(item) > 0]
    normalized_quick_replies = [
        dict(item) for item in (quick_replies or []) if isinstance(item, Mapping)
    ]
    if not normalized_text.strip() and not normalized_attachment_ids:
        raise ValueError("Message must contain text or attachments")

    now = datetime.now(timezone.utc).isoformat()
    resolved_dialog_id = dialog_id
    if resolved_dialog_id is None:
        active_dialog = get_active_chat_dialog(chat_id)
        if active_dialog:
            resolved_dialog_id = active_dialog["id"]

    with _lock:
        cursor = execute(
            """
            INSERT INTO messages (
                chat_id, direction, text, message_id, author, created_at,
                section, dialog_id, quick_replies
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                chat_id, direction, normalized_text, message_id, author, now,
                section, resolved_dialog_id,
                json.dumps(normalized_quick_replies, ensure_ascii=False) if normalized_quick_replies else None,
            ),
        )
        inserted_row = cursor.fetchone()
        if inserted_row is None:
            raise RuntimeError("Failed to persist message")
        inserted_id = int(inserted_row["id"])
        if normalized_attachment_ids:
            attach_media_to_message(inserted_id, normalized_attachment_ids)
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
        "text": "Р С™Р В»Р С‘Р ВµР Р…РЎвЂљ Р В·Р В°Р С—РЎР‚Р С•РЎРѓР С‘Р В» Р С•Р С—Р ВµРЎР‚Р В°РЎвЂљР С•РЎР‚Р В°.",
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
              AND purged_at IS NULL
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
            SELECT id, chat_id, bin, section, started_at, ended_at, last_message_at, operator_mode
            FROM chat_dialogs
            WHERE id = %s
              AND purged_at IS NULL
            """,
            (dialog_id,),
        ).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "chat_id": row["chat_id"],
        "bin": row["bin"],
        "section": row["section"],
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
            SELECT id, chat_id, bin, section, started_at, ended_at, last_message_at, operator_mode
            FROM chat_dialogs
            WHERE chat_id = %s AND ended_at IS NULL AND purged_at IS NULL
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
        "section": row["section"],
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


def get_latest_closed_chat_dialog_id(chat_id: int) -> int | None:
    with _lock:
        row = execute(
            """
            SELECT id
            FROM chat_dialogs
            WHERE chat_id = %s
              AND ended_at IS NOT NULL
              AND purged_at IS NULL
            ORDER BY ended_at DESC, started_at DESC
            LIMIT 1
            """,
            (chat_id,),
        ).fetchone()
    return int(row["id"]) if row else None


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
            WHERE chat_id = %s AND ended_at IS NOT NULL AND purged_at IS NULL
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
            "UPDATE chat_dialogs SET ended_at = NULL, operator_mode = 0, last_message_at = %s WHERE id = %s",
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
            "SELECT id, chat_id, bin FROM chat_dialogs WHERE id = %s AND purged_at IS NULL",
            (dialog_id,),
        ).fetchone()
        if dialog_row is None:
            return None
        if chat_id is not None and dialog_row["chat_id"] != chat_id:
            return None
        chat_id_value = dialog_row["chat_id"]
        execute(
            "UPDATE chat_dialogs SET ended_at = %s WHERE chat_id = %s AND ended_at IS NULL AND purged_at IS NULL AND id != %s",
            (now, chat_id_value, dialog_id),
        )
        execute(
            "UPDATE chat_dialogs SET ended_at = NULL, operator_mode = 0, last_message_at = COALESCE(last_message_at, started_at) WHERE id = %s",
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
            WHERE id = %s AND purged_at IS NULL
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
    """Р вЂ”Р В°Р С”РЎР‚РЎвЂ№Р Р†Р В°Р ВµРЎвЂљ РЎС“Р С”Р В°Р В·Р В°Р Р…Р Р…РЎвЂ№Р в„– Р Т‘Р С‘Р В°Р В»Р С•Р С–, Р В·Р В°Р С—Р С‘РЎРѓРЎвЂ№Р Р†Р В°Р ВµРЎвЂљ Р СР ВµРЎвЂљРЎР‚Р С‘Р С”Р С‘ Р Р† dialog_stats."""

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
            WHERE chat_id = %s AND ended_at IS NULL AND purged_at IS NULL
            ORDER BY started_at DESC
            LIMIT 1
            """,
            (chat_id,),
        ).fetchone()
        if active:
            closed_dialog_id = int(active["id"])
            execute(
                "UPDATE chat_dialogs SET ended_at = %s, operator_mode = 0, last_message_at = COALESCE(last_message_at, %s) WHERE id = %s",
                (now, now, closed_dialog_id),
            )
    if closed_dialog_id is not None:
        close_appeal(closed_dialog_id, "client")
        snapshot_dialog_metrics(closed_dialog_id)


# РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚ Appeals (Р С•Р В±РЎР‚Р В°РЎвЂ°Р ВµР Р…Р С‘РЎРЏ) РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚РІвЂќР‚


def create_appeal(
    dialog_id: int, chat_id: int, section: str | None = None
) -> int:
    """Create a new appeal (Р С•Р В±РЎР‚Р В°РЎвЂ°Р ВµР Р…Р С‘Р Вµ) within a dialog."""
    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        if section is not None:
            execute(
                "UPDATE chat_dialogs SET section = %s, operator_mode = 0 WHERE id = %s",
                (section, dialog_id),
            )
        else:
            execute(
                "UPDATE chat_dialogs SET operator_mode = 0 WHERE id = %s",
                (dialog_id,),
            )
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


def _get_rating_snapshot_context(
    dialog_id: int,
    appeal_id: int | None = None,
) -> Dict[str, object]:
    with _lock:
        if appeal_id is not None:
            row = execute(
                """
                SELECT
                    cd.chat_id,
                    c.external_chat_id,
                    COALESCE(
                        NULLIF(TRIM(c.title), ''),
                        NULLIF(TRIM(c.username), ''),
                        NULLIF(TRIM(c.external_chat_id), '')
                    ) AS rater_name,
                    COALESCE(ds.is_ai_closed, FALSE) AS is_ai_closed,
                    COALESCE(ds.ai_messages_count, 0) AS ai_messages_count
                FROM chat_dialogs cd
                LEFT JOIN chats c ON c.chat_id = cd.chat_id
                LEFT JOIN dialog_stats ds ON ds.appeal_id = %s
                WHERE cd.id = %s
                LIMIT 1
                """,
                (appeal_id, dialog_id),
            ).fetchone()
        else:
            row = execute(
                """
                SELECT
                    cd.chat_id,
                    c.external_chat_id,
                    COALESCE(
                        NULLIF(TRIM(c.title), ''),
                        NULLIF(TRIM(c.username), ''),
                        NULLIF(TRIM(c.external_chat_id), '')
                    ) AS rater_name,
                    COALESCE(ds.is_ai_closed, FALSE) AS is_ai_closed,
                    COALESCE(ds.ai_messages_count, 0) AS ai_messages_count
                FROM chat_dialogs cd
                LEFT JOIN chats c ON c.chat_id = cd.chat_id
                LEFT JOIN LATERAL (
                    SELECT is_ai_closed, ai_messages_count
                    FROM dialog_stats
                    WHERE dialog_id = %s
                    ORDER BY created_at DESC, id DESC
                    LIMIT 1
                ) ds ON TRUE
                WHERE cd.id = %s
                LIMIT 1
                """,
                (dialog_id, dialog_id),
            ).fetchone()

    if row is None:
        return {
            "chat_id": None,
            "external_chat_id": None,
            "rater_name": None,
            "ai_involved": False,
        }

    return {
        "chat_id": int(row["chat_id"]) if row.get("chat_id") is not None else None,
        "external_chat_id": row.get("external_chat_id"),
        "rater_name": row.get("rater_name"),
        "ai_involved": bool(row.get("is_ai_closed")) or int(row.get("ai_messages_count") or 0) > 0,
    }


def _mirror_dialog_feedback_rating_to_stats(
    *, dialog_id: int, rating: int, rating_kind: str, appeal_id: int | None = None
) -> bool:
    column = "ai_csat_rating" if rating_kind == DIALOG_FEEDBACK_KIND_AI else "csat_rating"
    with _lock:
        if appeal_id is not None:
            cursor = execute(
                f"""
                UPDATE dialog_stats
                SET {column} = %s
                WHERE appeal_id = %s
                """,
                (rating, appeal_id),
            )
        else:
            cursor = execute(
                f"""
                UPDATE dialog_stats
                SET {column} = %s
                WHERE dialog_id = %s
                  AND created_at = (
                      SELECT MAX(created_at) FROM dialog_stats WHERE dialog_id = %s
                  )
                """,
                (rating, dialog_id, dialog_id),
            )
    return cursor.rowcount > 0


def _upsert_dialog_feedback_rating(
    *,
    dialog_id: int,
    rating: int,
    rating_kind: str,
    appeal_id: int | None = None,
    rater_type: str = RATING_RATER_TYPE_CLIENT,
    rater_chat_id: int | None = None,
    rater_external_chat_id: str | None = None,
    rater_name: str | None = None,
    rated_object_type: str | None = None,
    rated_object_id: str | None = None,
    rated_object_name: str | None = None,
    channel: str = RATING_CHANNEL_TELEGRAM_BOT,
    ai_involved: bool | None = None,
    comment: str | None = None,
    low_score_reason: str | None = None,
) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    snapshot = _get_rating_snapshot_context(dialog_id, appeal_id)
    resolved_rater_chat_id = int(rater_chat_id) if rater_chat_id is not None else (
        int(snapshot["chat_id"]) if snapshot.get("chat_id") is not None else None
    )
    resolved_rater_external_chat_id = (
        str(rater_external_chat_id).strip()
        if rater_external_chat_id not in (None, "")
        else (str(snapshot["external_chat_id"]) if snapshot.get("external_chat_id") else None)
    )
    resolved_rater_name = (
        str(rater_name).strip()
        if rater_name not in (None, "")
        else (str(snapshot["rater_name"]) if snapshot.get("rater_name") else None)
    )
    resolved_rated_object_type = rated_object_type or (
        RATING_OBJECT_TYPE_AI if rating_kind == DIALOG_FEEDBACK_KIND_AI else RATING_OBJECT_TYPE_APPEAL
    )
    resolved_rated_object_id = rated_object_id or (
        "ai" if rating_kind == DIALOG_FEEDBACK_KIND_AI else str(appeal_id or dialog_id)
    )
    resolved_rated_object_name = rated_object_name or (
        "AI" if rating_kind == DIALOG_FEEDBACK_KIND_AI else None
    )
    resolved_ai_involved = bool(
        ai_involved if ai_involved is not None else (
            bool(snapshot.get("ai_involved")) or rating_kind == DIALOG_FEEDBACK_KIND_AI
        )
    )
    normalized_comment = str(comment).strip() if comment not in (None, "") else ""
    normalized_low_score_reason = (
        str(low_score_reason).strip() if low_score_reason not in (None, "") else None
    )
    with _lock:
        if appeal_id is not None:
            updated = execute(
                """
                UPDATE dialog_feedback_ratings
                SET dialog_id = %s,
                    rater_type = %s,
                    rater_chat_id = %s,
                    rater_external_chat_id = %s,
                    rater_name = %s,
                    rated_object_type = %s,
                    rated_object_id = %s,
                    rated_object_name = %s,
                    channel = %s,
                    ai_involved = %s,
                    comment = %s,
                    low_score_reason = %s,
                    rating = %s,
                    updated_at = %s
                WHERE appeal_id = %s AND rating_kind = %s
                """,
                (
                    dialog_id,
                    rater_type,
                    resolved_rater_chat_id,
                    resolved_rater_external_chat_id,
                    resolved_rater_name,
                    resolved_rated_object_type,
                    resolved_rated_object_id,
                    resolved_rated_object_name,
                    channel,
                    resolved_ai_involved,
                    normalized_comment,
                    normalized_low_score_reason,
                    rating,
                    now,
                    appeal_id,
                    rating_kind,
                ),
            ).rowcount
        else:
            updated = execute(
                """
                UPDATE dialog_feedback_ratings
                SET rater_type = %s,
                    rater_chat_id = %s,
                    rater_external_chat_id = %s,
                    rater_name = %s,
                    rated_object_type = %s,
                    rated_object_id = %s,
                    rated_object_name = %s,
                    channel = %s,
                    ai_involved = %s,
                    comment = %s,
                    low_score_reason = %s,
                    rating = %s,
                    updated_at = %s
                WHERE dialog_id = %s AND appeal_id IS NULL AND rating_kind = %s
                """,
                (
                    rater_type,
                    resolved_rater_chat_id,
                    resolved_rater_external_chat_id,
                    resolved_rater_name,
                    resolved_rated_object_type,
                    resolved_rated_object_id,
                    resolved_rated_object_name,
                    channel,
                    resolved_ai_involved,
                    normalized_comment,
                    normalized_low_score_reason,
                    rating,
                    now,
                    dialog_id,
                    rating_kind,
                ),
            ).rowcount

        if not updated:
            execute(
                """
                INSERT INTO dialog_feedback_ratings
                    (
                        dialog_id,
                        appeal_id,
                        rating_kind,
                        rater_type,
                        rater_chat_id,
                        rater_external_chat_id,
                        rater_name,
                        rated_object_type,
                        rated_object_id,
                        rated_object_name,
                        channel,
                        ai_involved,
                        comment,
                        low_score_reason,
                        rating,
                        created_at,
                        updated_at
                    )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    dialog_id,
                    appeal_id,
                    rating_kind,
                    rater_type,
                    resolved_rater_chat_id,
                    resolved_rater_external_chat_id,
                    resolved_rater_name,
                    resolved_rated_object_type,
                    resolved_rated_object_id,
                    resolved_rated_object_name,
                    channel,
                    resolved_ai_involved,
                    normalized_comment,
                    normalized_low_score_reason,
                    rating,
                    now,
                    now,
                ),
            )

    mirrored = _mirror_dialog_feedback_rating_to_stats(
        dialog_id=dialog_id,
        appeal_id=appeal_id,
        rating=rating,
        rating_kind=rating_kind,
    )
    if not mirrored:
        logger.info(
            "Saved %s feedback rating %s for dialog %s without dialog_stats mirror",
            rating_kind,
            rating,
            dialog_id,
        )
    return True


def save_csat_rating(
    dialog_id: int,
    rating: int,
    appeal_id: int | None = None,
    *,
    rater_chat_id: int | None = None,
    rater_external_chat_id: str | None = None,
    rater_name: str | None = None,
    channel: str = RATING_CHANNEL_TELEGRAM_BOT,
    ai_involved: bool | None = None,
    comment: str | None = None,
    low_score_reason: str | None = None,
) -> bool:
    """Save a client CSAT rating (1-5) for a closed dialog/appeal."""
    if rating < 1 or rating > 5:
        logger.warning("Invalid CSAT rating %s for dialog %s", rating, dialog_id)
        return False
    saved = _upsert_dialog_feedback_rating(
        dialog_id=dialog_id,
        appeal_id=appeal_id,
        rating=rating,
        rating_kind=DIALOG_FEEDBACK_KIND_CLIENT,
        rater_chat_id=rater_chat_id,
        rater_external_chat_id=rater_external_chat_id,
        rater_name=rater_name,
        rated_object_type=RATING_OBJECT_TYPE_APPEAL,
        rated_object_id=str(appeal_id or dialog_id),
        channel=channel,
        ai_involved=ai_involved,
        comment=comment,
        low_score_reason=low_score_reason,
    )
    if saved:
        logger.info("Saved CSAT rating %s for dialog %s", rating, dialog_id)
    return saved



def _operator_target_from_row(row: Mapping[str, Any] | None) -> Optional[Dict[str, object]]:
    if row is None:
        return None
    return {
        "id": int(row["id"]),
        "dialog_id": int(row["dialog_id"]),
        "appeal_id": int(row["appeal_id"]) if row["appeal_id"] is not None else None,
        "operator_name": str(row["operator_name"]),
        "messages_sent": int(row["messages_sent"] or 0),
        "response_count": int(row["response_count"] or 0),
    }


def get_operator_rating_target(operator_stat_id: int) -> Optional[Dict[str, object]]:
    """Return one operator statistics row that can receive CSAT."""
    with _lock:
        row = execute(
            """
            SELECT id, dialog_id, appeal_id, operator_name, messages_sent, response_count
            FROM dialog_operator_stats
            WHERE id = %s
            LIMIT 1
            """,
            (operator_stat_id,),
        ).fetchone()
    target = _operator_target_from_row(row)
    if target and is_human_operator_name(str(target["operator_name"])):
        return target
    return None


def list_operator_rating_targets(
    dialog_id: int, appeal_id: int | None = None
) -> List[Dict[str, object]]:
    """Return unique human operators who answered in a dialog/appeal."""
    with _lock:
        if appeal_id is not None:
            rows = execute(
                """
                SELECT id, operator_name, messages_sent, response_count
                FROM dialog_operator_stats
                WHERE appeal_id = %s
                ORDER BY messages_sent DESC, response_count DESC, operator_name ASC
                """,
                (appeal_id,),
            ).fetchall()
        else:
            rows = execute(
                """
                SELECT id, operator_name, messages_sent, response_count
                FROM dialog_operator_stats
                WHERE dialog_id = %s AND appeal_id IS NULL
                ORDER BY messages_sent DESC, response_count DESC, operator_name ASC
                """,
                (dialog_id,),
            ).fetchall()
    return select_operator_rating_targets(rows or [])


def create_employee_client_assessments_for_dialog(
    dialog_id: int,
    *,
    appeal_id: int | None = None,
) -> List[Dict[str, object]]:
    """Create pending employee-to-client assessment rows for human operators."""
    targets = list_operator_rating_targets(int(dialog_id), appeal_id)
    if not targets:
        return []
    now = datetime.now(timezone.utc).isoformat()
    created: List[Dict[str, object]] = []
    with _lock:
        context = execute(
            """
            SELECT
                cd.chat_id,
                COALESCE(cd.bin, c.bin) AS client_bin,
                COALESCE(NULLIF(TRIM(c.title), ''), NULLIF(TRIM(c.external_chat_id), ''), cd.chat_id::text) AS client_name,
                COALESCE(ds.is_ai_closed, FALSE) OR COALESCE(ds.ai_messages_count, 0) > 0 AS ai_assisted
            FROM chat_dialogs cd
            JOIN chats c ON c.chat_id = cd.chat_id
            LEFT JOIN LATERAL (
                SELECT is_ai_closed, ai_messages_count
                FROM dialog_stats
                WHERE dialog_id = cd.id
                  AND (%s IS NULL OR appeal_id = %s)
                ORDER BY created_at DESC, id DESC
                LIMIT 1
            ) ds ON TRUE
            WHERE cd.id = %s
            LIMIT 1
            """,
            (appeal_id, appeal_id, int(dialog_id)),
        ).fetchone()
        if context is None:
            return []
        for target in targets:
            operator_name = str(target.get("operator_name") or "").strip()
            if not operator_name:
                continue
            user = execute(
                """
                SELECT id, name
                FROM users
                WHERE LOWER(name) = LOWER(%s)
                   OR LOWER(login) = LOWER(%s)
                   OR LOWER(email) = LOWER(%s)
                ORDER BY id ASC
                LIMIT 1
                """,
                (operator_name, operator_name, operator_name),
            ).fetchone()
            if user is None:
                continue
            existing = execute(
                """
                SELECT id, assigned_user_id, assigned_user_name, status, created_at
                FROM employee_client_assessments
                WHERE dialog_id = %s
                  AND assigned_user_id = %s
                  AND (%s IS NULL OR appeal_id = %s)
                ORDER BY id DESC
                LIMIT 1
                """,
                (int(dialog_id), int(user["id"]), appeal_id, appeal_id),
            ).fetchone()
            if existing is not None:
                created.append(dict(existing))
                continue
            row = execute(
                """
                INSERT INTO employee_client_assessments (
                    dialog_id, appeal_id, chat_id, client_bin, client_name,
                    assigned_user_id, assigned_user_name, status,
                    task_opened_at, task_closed_at, ai_assisted,
                    created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, assigned_user_id, assigned_user_name, status, created_at
                """,
                (
                    int(dialog_id),
                    int(appeal_id) if appeal_id is not None else None,
                    int(context["chat_id"]),
                    context.get("client_bin"),
                    context.get("client_name"),
                    int(user["id"]),
                    user["name"],
                    employee_client_assessments.ASSESSMENT_STATUS_PENDING,
                    now,
                    now,
                    bool(context.get("ai_assisted")),
                    now,
                    now,
                ),
            ).fetchone()
            if row is not None:
                created.append(dict(row))
    return created


def get_operator_csat_for_operator(
    *, dialog_id: int, operator_name: str, appeal_id: int | None = None
) -> Optional[int]:
    """Return employee-specific CSAT for a dialog/appeal/operator, if present."""
    with _lock:
        if appeal_id is not None:
            row = execute(
                """
                SELECT rating
                FROM operator_csat_ratings
                WHERE appeal_id = %s AND operator_name = %s
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (appeal_id, operator_name),
            ).fetchone()
        else:
            row = execute(
                """
                SELECT rating
                FROM operator_csat_ratings
                WHERE dialog_id = %s AND appeal_id IS NULL AND operator_name = %s
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (dialog_id, operator_name),
            ).fetchone()
    return int(row["rating"]) if row else None


def get_operator_csat_for_target(operator_stat_id: int) -> Optional[int]:
    """Return employee-specific CSAT for a dialog_operator_stats row."""
    target = get_operator_rating_target(operator_stat_id)
    if not target:
        return None
    return get_operator_csat_for_operator(
        dialog_id=int(target["dialog_id"]),
        appeal_id=int(target["appeal_id"]) if target["appeal_id"] is not None else None,
        operator_name=str(target["operator_name"]),
    )


def _upsert_operator_csat_rating(target: Mapping[str, object], rating: int) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    dialog_id = int(target["dialog_id"])
    appeal_id = int(target["appeal_id"]) if target["appeal_id"] is not None else None
    operator_name = str(target["operator_name"])
    operator_stat_id = int(target["id"])
    snapshot = _get_rating_snapshot_context(dialog_id, appeal_id)
    resolved_rater_chat_id = int(target["rater_chat_id"]) if target.get("rater_chat_id") is not None else (
        int(snapshot["chat_id"]) if snapshot.get("chat_id") is not None else None
    )
    resolved_rater_external_chat_id = (
        str(target["rater_external_chat_id"]).strip()
        if target.get("rater_external_chat_id") not in (None, "")
        else (str(snapshot["external_chat_id"]) if snapshot.get("external_chat_id") else None)
    )
    resolved_rater_name = (
        str(target["rater_name"]).strip()
        if target.get("rater_name") not in (None, "")
        else (str(snapshot["rater_name"]) if snapshot.get("rater_name") else None)
    )
    resolved_channel = str(target.get("channel") or RATING_CHANNEL_TELEGRAM_BOT)
    resolved_rater_type = str(target.get("rater_type") or RATING_RATER_TYPE_CLIENT)
    resolved_ai_involved = bool(
        target["ai_involved"] if target.get("ai_involved") is not None else snapshot.get("ai_involved")
    )
    normalized_comment = str(target.get("comment") or "").strip()
    normalized_low_score_reason = (
        str(target["low_score_reason"]).strip()
        if target.get("low_score_reason") not in (None, "")
        else None
    )

    with _lock:
        if appeal_id is not None:
            updated = execute(
                """
                UPDATE operator_csat_ratings
                SET operator_stat_id = %s,
                    operator_name = %s,
                    rater_type = %s,
                    rater_chat_id = %s,
                    rater_external_chat_id = %s,
                    rater_name = %s,
                    rated_object_type = %s,
                    rated_object_id = %s,
                    rated_object_name = %s,
                    channel = %s,
                    ai_involved = %s,
                    comment = %s,
                    low_score_reason = %s,
                    rating = %s,
                    created_at = %s
                WHERE appeal_id = %s AND operator_name = %s
                """,
                (
                    operator_stat_id,
                    operator_name,
                    resolved_rater_type,
                    resolved_rater_chat_id,
                    resolved_rater_external_chat_id,
                    resolved_rater_name,
                    RATING_OBJECT_TYPE_EMPLOYEE,
                    str(operator_stat_id),
                    operator_name,
                    resolved_channel,
                    resolved_ai_involved,
                    normalized_comment,
                    normalized_low_score_reason,
                    rating,
                    now,
                    appeal_id,
                    operator_name,
                ),
            ).rowcount
        else:
            updated = execute(
                """
                UPDATE operator_csat_ratings
                SET operator_stat_id = %s,
                    operator_name = %s,
                    rater_type = %s,
                    rater_chat_id = %s,
                    rater_external_chat_id = %s,
                    rater_name = %s,
                    rated_object_type = %s,
                    rated_object_id = %s,
                    rated_object_name = %s,
                    channel = %s,
                    ai_involved = %s,
                    comment = %s,
                    low_score_reason = %s,
                    rating = %s,
                    created_at = %s
                WHERE dialog_id = %s AND appeal_id IS NULL AND operator_name = %s
                """,
                (
                    operator_stat_id,
                    operator_name,
                    resolved_rater_type,
                    resolved_rater_chat_id,
                    resolved_rater_external_chat_id,
                    resolved_rater_name,
                    RATING_OBJECT_TYPE_EMPLOYEE,
                    str(operator_stat_id),
                    operator_name,
                    resolved_channel,
                    resolved_ai_involved,
                    normalized_comment,
                    normalized_low_score_reason,
                    rating,
                    now,
                    dialog_id,
                    operator_name,
                ),
            ).rowcount

        if updated:
            return True

        execute(
            """
            INSERT INTO operator_csat_ratings
                (
                    dialog_id,
                    appeal_id,
                    operator_stat_id,
                    operator_name,
                    rater_type,
                    rater_chat_id,
                    rater_external_chat_id,
                    rater_name,
                    rated_object_type,
                    rated_object_id,
                    rated_object_name,
                    channel,
                    ai_involved,
                    comment,
                    low_score_reason,
                    rating,
                    created_at
                )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                dialog_id,
                appeal_id,
                operator_stat_id,
                operator_name,
                resolved_rater_type,
                resolved_rater_chat_id,
                resolved_rater_external_chat_id,
                resolved_rater_name,
                RATING_OBJECT_TYPE_EMPLOYEE,
                str(operator_stat_id),
                operator_name,
                resolved_channel,
                resolved_ai_involved,
                normalized_comment,
                normalized_low_score_reason,
                rating,
                now,
            ),
        )
    return True


def _save_legacy_csat_when_single_operator(
    *,
    dialog_id: int,
    appeal_id: int | None,
    rating: int,
    rater_chat_id: int | None = None,
    rater_external_chat_id: str | None = None,
    rater_name: str | None = None,
    channel: str = RATING_CHANNEL_TELEGRAM_BOT,
    ai_involved: bool | None = None,
) -> None:
    targets = list_operator_rating_targets(dialog_id, appeal_id)
    if len(targets) == 1:
        save_csat_rating(
            dialog_id,
            rating,
            appeal_id=appeal_id,
            rater_chat_id=rater_chat_id,
            rater_external_chat_id=rater_external_chat_id,
            rater_name=rater_name,
            channel=channel,
            ai_involved=ai_involved,
        )


def save_operator_csat_rating(
    operator_stat_id: int,
    rating: int,
    *,
    rater_chat_id: int | None = None,
    rater_external_chat_id: str | None = None,
    rater_name: str | None = None,
    channel: str = RATING_CHANNEL_TELEGRAM_BOT,
    ai_involved: bool | None = None,
    comment: str | None = None,
    low_score_reason: str | None = None,
) -> bool:
    """Save CSAT rating for the employee represented by dialog_operator_stats."""
    if rating < 1 or rating > 5:
        logger.warning("Invalid operator CSAT rating %s for stat %s", rating, operator_stat_id)
        return False

    target = get_operator_rating_target(operator_stat_id)
    if not target:
        logger.warning("No dialog_operator_stats row found for operator CSAT target %s", operator_stat_id)
        return False

    saved = _upsert_operator_csat_rating(
        {
            **target,
            "rater_chat_id": rater_chat_id,
            "rater_external_chat_id": rater_external_chat_id,
            "rater_name": rater_name,
            "channel": channel,
            "ai_involved": ai_involved,
            "comment": comment,
            "low_score_reason": low_score_reason,
        },
        rating,
    )
    if saved:
        _save_legacy_csat_when_single_operator(
            dialog_id=int(target["dialog_id"]),
            appeal_id=int(target["appeal_id"]) if target["appeal_id"] is not None else None,
            rating=rating,
            rater_chat_id=rater_chat_id,
            rater_external_chat_id=rater_external_chat_id,
            rater_name=rater_name,
            channel=channel,
            ai_involved=ai_involved,
        )
    return saved


def save_operator_csat_rating_by_name(
    *,
    dialog_id: int,
    operator_name: str,
    rating: int,
    appeal_id: int | None = None,
    rater_chat_id: int | None = None,
    rater_external_chat_id: str | None = None,
    rater_name: str | None = None,
    channel: str = RATING_CHANNEL_TELEGRAM_BOT,
    ai_involved: bool | None = None,
    comment: str | None = None,
    low_score_reason: str | None = None,
) -> bool:
    """Save employee-specific CSAT using dialog/appeal and operator name."""
    if not is_human_operator_name(operator_name):
        return False
    targets = list_operator_rating_targets(dialog_id, appeal_id)
    for target in targets:
        if str(target["operator_name"]).strip().lower() == operator_name.strip().lower():
            return save_operator_csat_rating(
                int(target["id"]),
                rating,
                rater_chat_id=rater_chat_id,
                rater_external_chat_id=rater_external_chat_id,
                rater_name=rater_name,
                channel=channel,
                ai_involved=ai_involved,
                comment=comment,
                low_score_reason=low_score_reason,
            )
    return False


def get_bin_interacted_employees(bin_value: str) -> List[Dict[str, object]]:
    """Return employees who interacted with dialogs for a BIN."""
    normalized_bin = (bin_value or "").strip()
    if not normalized_bin:
        return []

    with _lock:
        rows = execute(
            """
            SELECT
                interactions.operator_name,
                COUNT(DISTINCT interactions.interaction_key) AS interactions,
                MAX(interactions.last_interaction_at) AS last_interaction_at
            FROM (
                SELECT
                    dos.operator_name,
                    CONCAT('appeal:', a.id::text) AS interaction_key,
                    COALESCE(a.ended_at, a.started_at, dos.started_at) AS last_interaction_at
                FROM chat_dialogs cd
                JOIN appeals a ON a.dialog_id = cd.id
                JOIN dialog_operator_stats dos ON dos.appeal_id = a.id
                WHERE cd.bin = %s

                UNION ALL

                SELECT
                    dos.operator_name,
                    CONCAT('dialog:', cd.id::text) AS interaction_key,
                    COALESCE(cd.ended_at, cd.last_message_at, cd.started_at, dos.started_at) AS last_interaction_at
                FROM chat_dialogs cd
                JOIN dialog_operator_stats dos
                  ON dos.dialog_id = cd.id
                 AND dos.appeal_id IS NULL
                WHERE cd.bin = %s
            ) AS interactions
            WHERE interactions.operator_name IS NOT NULL
              AND TRIM(interactions.operator_name) <> ''
            GROUP BY interactions.operator_name
            ORDER BY last_interaction_at DESC NULLS LAST, interactions.operator_name ASC
            """,
            (normalized_bin, normalized_bin),
        ).fetchall()

    employees: List[Dict[str, object]] = []
    for row in rows or []:
        operator_name = str(row["operator_name"] or "").strip()
        if not is_human_operator_name(operator_name):
            continue
        employees.append(
            {
                "operator_name": operator_name,
                "interactions": int(row["interactions"] or 0),
                "last_interaction_at": row["last_interaction_at"],
            }
        )
    return employees

def save_ai_csat_rating(
    dialog_id: int,
    rating: int,
    appeal_id: int | None = None,
    *,
    rater_chat_id: int | None = None,
    rater_external_chat_id: str | None = None,
    rater_name: str | None = None,
    channel: str = RATING_CHANNEL_TELEGRAM_BOT,
    ai_involved: bool | None = None,
    comment: str | None = None,
    low_score_reason: str | None = None,
) -> bool:
    """Save AI CSAT rating (1-5) for a closed dialog/appeal."""
    if rating < 1 or rating > 5:
        logger.warning("Invalid AI CSAT rating %s for dialog %s", rating, dialog_id)
        return False
    saved = _upsert_dialog_feedback_rating(
        dialog_id=dialog_id,
        appeal_id=appeal_id,
        rating=rating,
        rating_kind=DIALOG_FEEDBACK_KIND_AI,
        rater_chat_id=rater_chat_id,
        rater_external_chat_id=rater_external_chat_id,
        rater_name=rater_name,
        rated_object_type=RATING_OBJECT_TYPE_AI,
        rated_object_id="ai",
        rated_object_name="AI",
        channel=channel,
        ai_involved=True if ai_involved is None else ai_involved,
        comment=comment,
        low_score_reason=low_score_reason,
    )
    if saved:
        logger.info("Saved AI CSAT rating %s for dialog %s", rating, dialog_id)
    return saved


def _get_dialog_feedback_rating(
    *, rating_kind: str, dialog_id: int | None = None, appeal_id: int | None = None
) -> Optional[int]:
    if appeal_id is not None:
        with _lock:
            row = execute(
                """
                SELECT rating
                FROM dialog_feedback_ratings
                WHERE appeal_id = %s AND rating_kind = %s
                ORDER BY updated_at DESC, created_at DESC, id DESC
                LIMIT 1
                """,
                (appeal_id, rating_kind),
            ).fetchone()
        if row and row["rating"] is not None:
            return int(row["rating"])
        return None

    if dialog_id is not None:
        with _lock:
            row = execute(
                """
                SELECT rating
                FROM dialog_feedback_ratings
                WHERE dialog_id = %s AND appeal_id IS NULL AND rating_kind = %s
                ORDER BY updated_at DESC, created_at DESC, id DESC
                LIMIT 1
                """,
                (dialog_id, rating_kind),
            ).fetchone()
        if row and row["rating"] is not None:
            return int(row["rating"])
    return None


def get_csat_for_dialog(dialog_id: int) -> Optional[int]:
    """Return the CSAT rating for a dialog, or None if not rated."""
    rating = _get_dialog_feedback_rating(
        dialog_id=dialog_id,
        rating_kind=DIALOG_FEEDBACK_KIND_CLIENT,
    )
    if rating is not None:
        return rating
    with _lock:
        row = execute(
            "SELECT csat_rating FROM dialog_stats WHERE dialog_id = %s ORDER BY created_at DESC LIMIT 1",
            (dialog_id,),
        ).fetchone()
    if row and row["csat_rating"] is not None:
        return int(row["csat_rating"])
    return None


def get_ai_csat_for_dialog(dialog_id: int) -> Optional[int]:
    """Return the AI CSAT rating for a dialog, or None if not rated."""
    rating = _get_dialog_feedback_rating(
        dialog_id=dialog_id,
        rating_kind=DIALOG_FEEDBACK_KIND_AI,
    )
    if rating is not None:
        return rating
    with _lock:
        row = execute(
            "SELECT ai_csat_rating FROM dialog_stats WHERE dialog_id = %s ORDER BY created_at DESC LIMIT 1",
            (dialog_id,),
        ).fetchone()
    if row and row["ai_csat_rating"] is not None:
        return int(row["ai_csat_rating"])
    return None


def get_csat_for_appeal(appeal_id: int) -> Optional[int]:
    """Return the CSAT rating for a specific appeal, or None if not rated."""
    rating = _get_dialog_feedback_rating(
        appeal_id=appeal_id,
        rating_kind=DIALOG_FEEDBACK_KIND_CLIENT,
    )
    if rating is not None:
        return rating
    with _lock:
        row = execute(
            "SELECT csat_rating FROM dialog_stats WHERE appeal_id = %s LIMIT 1",
            (appeal_id,),
        ).fetchone()
    if row and row["csat_rating"] is not None:
        return int(row["csat_rating"])
    return None


def get_ai_csat_for_appeal(appeal_id: int) -> Optional[int]:
    """Return AI CSAT rating for a specific appeal, or None if not rated."""
    rating = _get_dialog_feedback_rating(
        appeal_id=appeal_id,
        rating_kind=DIALOG_FEEDBACK_KIND_AI,
    )
    if rating is not None:
        return rating
    with _lock:
        row = execute(
            "SELECT ai_csat_rating FROM dialog_stats WHERE appeal_id = %s LIMIT 1",
            (appeal_id,),
        ).fetchone()
    if row and row["ai_csat_rating"] is not None:
        return int(row["ai_csat_rating"])
    return None


def get_latest_closed_appeal_id(dialog_id: int) -> Optional[int]:
    """Return latest closed appeal id for a dialog, or None."""
    with _lock:
        row = execute(
            """
            SELECT id
            FROM appeals
            WHERE dialog_id = %s AND ended_at IS NOT NULL
            ORDER BY ended_at DESC
            LIMIT 1
            """,
            (dialog_id,),
        ).fetchone()
    return int(row["id"]) if row else None


def get_dialog_id_for_appeal(appeal_id: int) -> Optional[int]:
    """Return dialog_id for given appeal id, or None."""
    with _lock:
        row = execute(
            "SELECT dialog_id FROM appeals WHERE id = %s LIMIT 1",
            (appeal_id,),
        ).fetchone()
    return int(row["dialog_id"]) if row and row["dialog_id"] is not None else None


def get_latest_dialog_stats(dialog_id: int) -> Optional[Dict[str, object]]:
    """Return latest dialog_stats row for a dialog."""
    with _lock:
        row = execute(
            """
            SELECT id, dialog_id, appeal_id, is_ai_closed, csat_rating, ai_csat_rating, created_at
            FROM dialog_stats
            WHERE dialog_id = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (dialog_id,),
        ).fetchone()
    if row is None:
        return None
    appeal_id = int(row["appeal_id"]) if row["appeal_id"] is not None else None
    client_rating = (
        get_csat_for_appeal(appeal_id) if appeal_id is not None else get_csat_for_dialog(dialog_id)
    )
    ai_rating = (
        get_ai_csat_for_appeal(appeal_id) if appeal_id is not None else get_ai_csat_for_dialog(dialog_id)
    )
    return {
        "id": int(row["id"]),
        "dialog_id": int(row["dialog_id"]),
        "appeal_id": appeal_id,
        "is_ai_closed": bool(row["is_ai_closed"]),
        "csat_rating": client_rating if client_rating is not None else (int(row["csat_rating"]) if row["csat_rating"] is not None else None),
        "ai_csat_rating": ai_rating if ai_rating is not None else (int(row["ai_csat_rating"]) if row["ai_csat_rating"] is not None else None),
        "created_at": row["created_at"],
    }


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
    """Р вЂ™РЎвЂ№РЎвЂЎР С‘РЎРѓР В»РЎРЏР ВµРЎвЂљ Р С‘ РЎРѓР С•РЎвЂ¦РЎР‚Р В°Р Р…РЎРЏР ВµРЎвЂљ Р СР ВµРЎвЂљРЎР‚Р С‘Р С”Р С‘ Р С•Р В±РЎР‚Р В°РЎвЂ°Р ВµР Р…Р С‘РЎРЏ Р Р† dialog_stats.

    Р СњР В°РЎвЂ¦Р С•Р Т‘Р С‘РЎвЂљ Р С—Р С•РЎРѓР В»Р ВµР Т‘Р Р…Р ВµР Вµ Р В·Р В°Р С”РЎР‚РЎвЂ№РЎвЂљР С•Р Вµ Р С•Р В±РЎР‚Р В°РЎвЂ°Р ВµР Р…Р С‘Р Вµ (appeal) Р Т‘Р В»РЎРЏ Р Т‘Р С‘Р В°Р В»Р С•Р С–Р В° Р С‘ РЎРѓРЎвЂЎР С‘РЎвЂљР В°Р ВµРЎвЂљ
    Р СР ВµРЎвЂљРЎР‚Р С‘Р С”Р С‘ РЎвЂљР С•Р В»РЎРЉР С”Р С• Р С—Р С• РЎРѓР С•Р С•Р В±РЎвЂ°Р ВµР Р…Р С‘РЎРЏР С Р Р† РЎР‚Р В°Р СР С”Р В°РЎвЂ¦ РЎРЊРЎвЂљР С•Р С–Р С• Р С•Р В±РЎР‚Р В°РЎвЂ°Р ВµР Р…Р С‘РЎРЏ.
    """
    now = datetime.now(timezone.utc).isoformat()
    automation_set = {name.strip().lower() for name in AUTOMATION_AUTHOR_NAMES}

    with _lock:
        # РІвЂќР‚РІвЂќР‚ 0. Find the most recently closed appeal РІвЂќР‚РІвЂќР‚
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

        # РІвЂќР‚РІвЂќР‚ 1. Dialog metadata РІвЂќР‚РІвЂќР‚
        dialog = execute(
            """
            SELECT id, chat_id, bin, section, started_at, ended_at
            FROM chat_dialogs WHERE id = %s
            """,
            (dialog_id,),
        ).fetchone()
        if dialog is None:
            raise ValueError("Диалог не найден")
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

        # РІвЂќР‚РІвЂќР‚ 2. Messages scoped to this appeal's time range РІвЂќР‚РІвЂќР‚
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
            "[Р В·Р В°Р С—РЎР‚Р С•РЎРѓ Р С•Р С—Р ВµРЎР‚Р В°РЎвЂљР С•РЎР‚Р В°]",
            "[faq] РЎРѓР Р†РЎРЏР В·Р В°РЎвЂљРЎРЉРЎРѓРЎРЏ РЎРѓ Р С•Р С—Р ВµРЎР‚Р В°РЎвЂљР С•РЎР‚Р С•Р С",
            "Р С•Р С—Р ВµРЎР‚Р В°РЎвЂљР С•РЎР‚",
            "СЂСџвЂРЃРІР‚РЊСЂСџвЂ™С Р С•Р С—Р ВµРЎР‚Р В°РЎвЂљР С•РЎР‚",
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
                    # A human operator answered РІР‚вЂќ mark as operator-handled
                    operator_requested = True
                    operator_message_counts[author_raw] = (
                        operator_message_counts.get(author_raw, 0) + 1
                    )

        msg_total = msg_incoming + msg_outgoing
        is_ai_closed = (ended_at is not None) and (not operator_requested)

        # РІвЂќР‚РІвЂќР‚ 3. Response time analysis РІвЂќР‚РІвЂќР‚
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

        # РІвЂќР‚РІвЂќР‚ 4. Messages before first human operator reply (for transfer metric) РІвЂќР‚РІвЂќР‚
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

        # РІвЂќР‚РІвЂќР‚ 5. Check contract РІвЂќР‚РІвЂќР‚
        has_contract: Optional[bool] = None
        if dialog_bin:
            owc_row = execute(
                "SELECT 1 FROM organizations_without_contracts WHERE customer_bin = %s",
                (dialog_bin,),
            ).fetchone()
            has_contract = owc_row is None

        # РІвЂќР‚РІвЂќР‚ 6. Write dialog_stats (one row per appeal) РІвЂќР‚РІвЂќР‚
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
        if appeal_id is not None:
            execute("DELETE FROM dialog_operator_stats WHERE appeal_id = %s", (appeal_id,))
            execute("DELETE FROM stat_questions WHERE appeal_id = %s", (appeal_id,))
        else:
            execute("DELETE FROM dialog_operator_stats WHERE dialog_id = %s", (dialog_id,))
            execute("DELETE FROM stat_questions WHERE dialog_id = %s", (dialog_id,))

        # РІвЂќР‚РІвЂќР‚ 7. Write dialog_operator_stats РІвЂќР‚РІвЂќР‚
        for op_name, deltas in operator_response_deltas.items():
            avg_op = sum(deltas) / len(deltas) if deltas else None
            execute(
                """
                INSERT INTO dialog_operator_stats
                    (dialog_id, appeal_id, operator_name, messages_sent,
                     avg_response_seconds, response_count, started_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    dialog_id,
                    appeal_id,
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
                        (dialog_id, appeal_id, operator_name, messages_sent,
                         avg_response_seconds, response_count, started_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (dialog_id, appeal_id, op_name, msg_count, None, 0, started_at),
                )

        # РІвЂќР‚РІвЂќР‚ 8. Write stat_questions (incoming messages for question analytics) РІвЂќР‚РІвЂќР‚
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
                INSERT INTO stat_questions (dialog_id, appeal_id, text, created_at, section)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (dialog_id, appeal_id, text, msg_created, section),
            )


def cleanup_expired_dialogs(max_age_hours: int = 24) -> int:
    """Purge old dialog content while preserving analytics and ratings."""
    cutoff = (
        datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
    ).isoformat()

    with _lock:
        # Find dialogs closed before cutoff
        expired_rows = execute(
            """
            SELECT id, chat_id, bin FROM chat_dialogs
            WHERE ended_at IS NOT NULL
              AND ended_at < %s
              AND purged_at IS NULL
            """,
            (cutoff,),
        ).fetchall()

        if not expired_rows:
            return 0

        expired_ids = [int(row["id"]) for row in expired_rows]
        placeholders = ",".join("%s" for _ in expired_ids)
        purge_timestamp = datetime.now(timezone.utc).isoformat()
        media_rows = execute(
            f"""
            SELECT DISTINCT ma.media_file_id
            FROM message_attachments ma
            JOIN messages m ON m.id = ma.message_id
            WHERE m.dialog_id IN ({placeholders})
            """,
            expired_ids,
        ).fetchall()
        media_file_ids = [
            int(row["media_file_id"])
            for row in media_rows
            if row["media_file_id"] is not None
        ]

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
        _delete_orphaned_media_files(media_file_ids)

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

        # Keep dialog and appeal rows as immutable anchors for analytics.
        execute(
            f"""
            UPDATE chat_dialogs
            SET purged_at = COALESCE(purged_at, %s)
            WHERE id IN ({placeholders})
            """,
            (purge_timestamp, *expired_ids),
        )

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
        "  (",
        "    SELECT m.text",
        "    FROM messages m",
        "    WHERE m.chat_id = c.chat_id AND m.dialog_id = cd.id",
        "    ORDER BY m.created_at DESC, m.id DESC",
        "    LIMIT 1",
        "  ) AS last_message_text,",
        "  (",
        "    SELECT m.direction",
        "    FROM messages m",
        "    WHERE m.chat_id = c.chat_id AND m.dialog_id = cd.id",
        "    ORDER BY m.created_at DESC, m.id DESC",
        "    LIMIT 1",
        "  ) AS last_message_direction,",
        "  (",
        "    SELECT m.author",
        "    FROM messages m",
        "    WHERE m.chat_id = c.chat_id AND m.dialog_id = cd.id",
        "    ORDER BY m.created_at DESC, m.id DESC",
        "    LIMIT 1",
        "  ) AS last_message_author,",
        "  EXISTS(",
        "    SELECT 1",
        "    FROM messages m",
        "    JOIN message_attachments ma ON ma.message_id = m.id",
        "    WHERE m.chat_id = c.chat_id AND m.dialog_id = cd.id",
        "    ORDER BY m.created_at DESC, m.id DESC, ma.sort_order ASC, ma.id ASC",
        "    LIMIT 1",
        "  ) AS last_message_has_attachments,",
        "  (",
        "    SELECT ma.kind",
        "    FROM messages m",
        "    JOIN message_attachments ma ON ma.message_id = m.id",
        "    WHERE m.chat_id = c.chat_id AND m.dialog_id = cd.id",
        "    ORDER BY m.created_at DESC, m.id DESC, ma.sort_order ASC, ma.id ASC",
        "    LIMIT 1",
        "  ) AS last_message_attachment_kind,",
        "  f.user_id AS fav_user_id,",
        "  dr.last_read_at AS last_read_at,",
        "  COALESCE((",
        "    SELECT COUNT(*) FROM messages m",
        "    WHERE m.chat_id = c.chat_id",
        "      AND m.dialog_id = cd.id",
        "      AND m.direction = 'incoming'",
        "      AND (dr.last_read_at IS NULL OR m.created_at > dr.last_read_at)",
        "  ), 0) AS unread_count,",
        "  (",
        "    SELECT eca.id",
        "    FROM employee_client_assessments eca",
        "    WHERE eca.dialog_id = cd.id",
        "      AND eca.assigned_user_id = %s",
        "      AND eca.status = 'pending'",
        "    ORDER BY eca.created_at DESC, eca.id DESC",
        "    LIMIT 1",
        "  ) AS employee_assessment_id,",
        "  (",
        "    SELECT eca.created_at",
        "    FROM employee_client_assessments eca",
        "    WHERE eca.dialog_id = cd.id",
        "      AND eca.assigned_user_id = %s",
        "      AND eca.status = 'pending'",
        "    ORDER BY eca.created_at DESC, eca.id DESC",
        "    LIMIT 1",
        "  ) AS employee_assessment_created_at",
        "FROM chat_dialogs cd",
        "JOIN chats c ON c.chat_id = cd.chat_id",
        "LEFT JOIN favorites f ON f.dialog_id = cd.id AND f.user_id = %s",
        "LEFT JOIN dialog_reads dr ON dr.dialog_id = cd.id AND dr.user_id = %s",
    ]
    params: List[object] = [user_id, user_id, user_id, user_id]
    filters: List[str] = ["cd.purged_at IS NULL"]
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
                "last_message_text": row["last_message_text"],
                "last_message_direction": row["last_message_direction"],
                "last_message_author": row["last_message_author"],
                "last_message_has_attachments": bool(row["last_message_has_attachments"]),
                "last_message_attachment_kind": row["last_message_attachment_kind"],
                "employee_assessment_id": int(row["employee_assessment_id"]) if row["employee_assessment_id"] is not None else None,
                "employee_assessment_pending": row["employee_assessment_id"] is not None,
                "employee_assessment_created_at": row["employee_assessment_created_at"],
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
        "SELECT id, chat_id, direction, text, message_id, author, created_at, section, dialog_id, quick_replies",
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
    row_ids = [int(row["id"]) for row in rows]
    attachments_map = get_message_attachments_map(row_ids)
    messages = []
    for row in rows:
        message = asdict(Message.from_row(row))
        message["created_at"] = message["created_at"].isoformat()
        message["attachments"] = attachments_map.get(int(message["id"]), [])
        messages.append(message)
    return list(reversed(messages))


def set_chat_section(chat_id: int, section: str | None, dialog_id: int | None = None) -> None:
    """Р Р€РЎРѓРЎвЂљР В°Р Р…Р В°Р Р†Р В»Р С‘Р Р†Р В°Р ВµРЎвЂљ РЎР‚Р В°Р В·Р Т‘Р ВµР В» Р Т‘Р В»РЎРЏ Р В°Р С”РЎвЂљР С‘Р Р†Р Р…Р С•Р С–Р С• Р Т‘Р С‘Р В°Р В»Р С•Р С–Р В° (Р С—Р С• Р вЂР ВР Сњ), Р В° Р Р…Р Вµ Р Т‘Р В»РЎРЏ РЎвЂЎР В°РЎвЂљР В° РЎвЂ Р ВµР В»Р С‘Р С”Р С•Р С."""
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
            execute(
                """
                UPDATE appeals
                SET section = %s
                WHERE dialog_id = %s AND ended_at IS NULL
                """,
                (section, target_dialog_id),
            )
        # Р СћР В°Р С”Р В¶Р Вµ Р С•Р В±Р Р…Р С•Р Р†Р В»РЎРЏР ВµР С chats.section Р Т‘Р В»РЎРЏ Р С•Р В±РЎР‚Р В°РЎвЂљР Р…Р С•Р в„– РЎРѓР С•Р Р†Р СР ВµРЎРѓРЎвЂљР С‘Р СР С•РЎРѓРЎвЂљР С‘
        execute(
            "UPDATE chats SET section = %s WHERE chat_id = %s",
            (section, chat_id),
        )


def get_dialog_section(chat_id: int, dialog_id: int | None = None) -> str | None:
    """Р СџР С•Р В»РЎС“РЎвЂЎР С‘РЎвЂљРЎРЉ РЎР‚Р В°Р В·Р Т‘Р ВµР В» Р С‘Р В· Р В°Р С”РЎвЂљР С‘Р Р†Р Р…Р С•Р С–Р С• Р Т‘Р С‘Р В°Р В»Р С•Р С–Р В° (Р С—Р С• Р вЂР ВР Сњ)."""
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
                "UPDATE chat_dialogs SET ended_at = COALESCE(ended_at, %s) WHERE chat_id = %s AND ended_at IS NULL AND purged_at IS NULL",
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
            WHERE chat_id = %s AND ended_at IS NULL AND purged_at IS NULL
            ORDER BY started_at DESC LIMIT 1
            """,
            (chat_id,),
        ).fetchone()

        if active and active["bin"] == normalized:
            # Already have active dialog with this BIN РІР‚вЂќ ensure appeal exists
            dialog_id = int(active["id"])
            active_appeal = execute(
                "SELECT 1 FROM appeals WHERE dialog_id = %s AND ended_at IS NULL LIMIT 1",
                (dialog_id,),
            ).fetchone()
            execute(
                "UPDATE chat_dialogs SET operator_mode = 0, last_message_at = COALESCE(last_message_at, %s) WHERE id = %s",
                (now, dialog_id),
            )
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
                "UPDATE chat_dialogs SET ended_at = %s, operator_mode = 0, last_message_at = COALESCE(last_message_at, %s) WHERE id = %s",
                (now, now, old_dialog_id),
            )

        # Look for previously closed dialog with this BIN
        previous = execute(
            """
            SELECT id FROM chat_dialogs
            WHERE chat_id = %s AND bin = %s AND purged_at IS NULL
            ORDER BY started_at DESC LIMIT 1
            """,
            (chat_id, normalized),
        ).fetchone()

        is_resumed = False
        if previous:
            # Reactivate existing dialog
            dialog_id = int(previous["id"])
            execute(
                "UPDATE chat_dialogs SET ended_at = NULL, operator_mode = 0, last_message_at = %s WHERE id = %s",
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


def ensure_active_chat_dialog(
    chat_id: int,
    bin_value: str,
    section: str | None = None,
    *,
    return_state: bool = False,
) -> int | tuple[int, bool]:
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
            WHERE chat_id = %s AND ended_at IS NULL AND purged_at IS NULL
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
                    "UPDATE chat_dialogs SET section = %s, operator_mode = 0, last_message_at = COALESCE(last_message_at, %s) WHERE id = %s",
                    (section, now, dialog_id),
                )
            else:
                execute(
                    "UPDATE chat_dialogs SET operator_mode = 0, last_message_at = COALESCE(last_message_at, %s) WHERE id = %s",
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
            return (dialog_id, False) if return_state else dialog_id

        # Р вЂ”Р В°Р С”РЎР‚РЎвЂ№Р Р†Р В°Р ВµР С Р В°Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р Вµ Р Т‘Р С‘Р В°Р В»Р С•Р С–Р С‘ РЎРѓ Р Т‘РЎР‚РЎС“Р С–Р С‘Р С Р вЂР ВР Сњ, РЎвЂЎРЎвЂљР С•Р В±РЎвЂ№ Р С‘РЎРѓР С”Р В»РЎР‹РЎвЂЎР С‘РЎвЂљРЎРЉ Р Т‘РЎС“Р В±Р В»Р С‘Р С”Р В°РЎвЂљРЎвЂ№
        execute(
            "UPDATE chat_dialogs SET ended_at = COALESCE(ended_at, %s), last_message_at = COALESCE(last_message_at, %s) WHERE chat_id = %s AND ended_at IS NULL AND purged_at IS NULL",
            (now, now, chat_id),
        )

        # Р СџРЎР‚Р С•Р Р†Р ВµРЎР‚РЎРЏР ВµР С, РЎРѓРЎС“РЎвЂ°Р ВµРЎРѓРЎвЂљР Р†РЎС“Р ВµРЎвЂљ Р В»Р С‘ РЎР‚Р В°Р Р…Р ВµР Вµ РЎРѓР С•Р В·Р Т‘Р В°Р Р…Р Р…РЎвЂ№Р в„– Р Т‘Р С‘Р В°Р В»Р С•Р С– РЎРѓ РЎвЂљР ВµР С Р В¶Р Вµ Р вЂР ВР Сњ
        previous = execute(
            """
            SELECT id, ended_at
            FROM chat_dialogs
            WHERE chat_id = %s AND bin = %s AND purged_at IS NULL
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
                    "UPDATE chat_dialogs SET ended_at = NULL, section = %s, operator_mode = 0, last_message_at = COALESCE(last_message_at, %s) WHERE id = %s",
                    (section, now, dialog_id),
                )
            else:
                execute(
                    "UPDATE chat_dialogs SET ended_at = NULL, operator_mode = 0, last_message_at = COALESCE(last_message_at, %s) WHERE id = %s",
                    (now, dialog_id),
                )
            execute(
                "UPDATE chats SET bin = %s, section = NULL, updated_at = %s WHERE chat_id = %s",
                (normalized, now, chat_id),
            )
            # Create new appeal for reactivated dialog
            create_appeal(dialog_id, chat_id, section)
            return (dialog_id, True) if return_state else dialog_id

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
    return (dialog_id, False) if return_state else dialog_id


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


def get_chat_by_external_chat_id(external_chat_id: str) -> Optional[Dict[str, object]]:
    normalized = (external_chat_id or "").strip()
    if not normalized:
        return None
    with _lock:
        row = execute(
            """
            SELECT chat_id, title, username, type, updated_at, section, bin, external_chat_id
            FROM chats
            WHERE external_chat_id = %s
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (normalized,),
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
            raise ValueError("Р СџР С•Р В»РЎРЉР В·Р С•Р Р†Р В°РЎвЂљР ВµР В»РЎРЉ Р Р…Р Вµ Р Р…Р В°Р в„–Р Т‘Р ВµР Р…")


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
            "SELECT id FROM chat_dialogs WHERE id = %s AND purged_at IS NULL",
            (dialog_id,),
        ).fetchone()
        if dialog is None:
            raise ValueError("Р вЂќР С‘Р В°Р В»Р С•Р С– Р Р…Р Вµ Р Р…Р В°Р в„–Р Т‘Р ВµР Р…")
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
    """Р вЂ™Р С•Р В·Р Р†РЎР‚Р В°РЎвЂ°Р В°Р ВµРЎвЂљ РЎРѓР С—Р С‘РЎРѓР С•Р С” Р Р†РЎРѓР ВµРЎвЂ¦ Р вЂР ВР СњР С•Р Р† Р С‘Р В· РЎвЂљР В°Р В±Р В»Р С‘РЎвЂ РЎвЂ№ all_bins."""
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
    """Р вЂќР С•Р В±Р В°Р Р†Р В»РЎРЏР ВµРЎвЂљ Р вЂР ВР Сњ Р Р† РЎвЂљР В°Р В±Р В»Р С‘РЎвЂ РЎС“ all_bins."""
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
    """Р Р€Р Т‘Р В°Р В»РЎРЏР ВµРЎвЂљ Р вЂР ВР Сњ Р С‘Р В· all_bins Р С‘ РЎРѓР Р†РЎРЏР В·Р В°Р Р…Р Р…РЎвЂ№РЎвЂ¦ РЎвЂљР В°Р В±Р В»Р С‘РЎвЂ ."""
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
    """Р вЂќР С•Р В±Р В°Р Р†Р В»РЎРЏР ВµРЎвЂљ Р вЂР ВР Сњ Р Т‘Р В»РЎРЏ Р С”Р В»Р С‘Р ВµР Р…РЎвЂљР В° (chat_id) Р Р† client_bins."""
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
    """Р вЂ™Р С•Р В·Р Р†РЎР‚Р В°РЎвЂ°Р В°Р ВµРЎвЂљ РЎРѓР С—Р С‘РЎРѓР С•Р С” Р вЂР ВР СњР С•Р Р† Р С”Р В»Р С‘Р ВµР Р…РЎвЂљР В°."""
    with _lock:
        rows = execute(
            "SELECT bin FROM client_bins WHERE chat_id = %s ORDER BY created_at DESC",
            (chat_id,),
        ).fetchall()
    return [row["bin"] for row in rows]


def remove_client_bin(chat_id: int, bin_value: str) -> bool:
    """Р Р€Р Т‘Р В°Р В»РЎРЏР ВµРЎвЂљ Р вЂР ВР Сњ Р С”Р В»Р С‘Р ВµР Р…РЎвЂљР В°."""
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
    Р вЂ™Р С•Р В·Р Р†РЎР‚Р В°РЎвЂ°Р В°Р ВµРЎвЂљ РЎРѓР С—Р С‘РЎРѓР С•Р С” Р Р†РЎРѓР ВµРЎвЂ¦ Р вЂР ВР СњР С•Р Р†, Р С”Р С•РЎвЂљР С•РЎР‚РЎвЂ№Р Вµ Р Р…Р Вµ Р Р…Р В°Р В·Р Р…Р В°РЎвЂЎР ВµР Р…РЎвЂ№ Р Р…Р С‘ Р С•Р Т‘Р Р…Р С•Р СРЎС“ РЎРѓР С•РЎвЂљРЎР‚РЎС“Р Т‘Р Р…Р С‘Р С”РЎС“.
    Р вЂ™Р С”Р В»РЎР‹РЎвЂЎР В°Р ВµРЎвЂљ Р С—Р С•Р В»Р Вµ has_contract Р Т‘Р В»РЎРЏ Р С•РЎвЂљР С•Р В±РЎР‚Р В°Р В¶Р ВµР Р…Р С‘РЎРЏ РЎРѓРЎвЂљР В°РЎвЂљРЎС“РЎРѓР В° Р Т‘Р С•Р С–Р С•Р Р†Р С•РЎР‚Р В°.
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

        # Snapshot metrics for any active dialog before purging.
        active = get_active_chat_dialog(chat_id)
        if active:
            close_chat_dialog(int(active["id"]), closed_by="system")

        purge_timestamp = datetime.now(timezone.utc).isoformat()
        dialog_rows = execute(
            "SELECT id FROM chat_dialogs WHERE chat_id = %s AND purged_at IS NULL",
            (chat_id,),
        ).fetchall()
        dialog_ids = [int(row["id"]) for row in dialog_rows]
        media_rows = execute(
            """
            SELECT DISTINCT ma.media_file_id
            FROM message_attachments ma
            JOIN messages m ON m.id = ma.message_id
            WHERE m.chat_id = %s
            """,
            (chat_id,),
        ).fetchall()
        media_file_ids = [
            int(row["media_file_id"])
            for row in media_rows
            if row["media_file_id"] is not None
        ]
        message_rows = execute(
            "SELECT message_id FROM messages WHERE chat_id = %s",
            (chat_id,),
        ).fetchall()
        message_ids = [
            row["message_id"]
            for row in message_rows
            if row["message_id"] is not None
        ]
        if message_ids:
            placeholders = ",".join("%s" for _ in message_ids)
            execute(
                f"DELETE FROM outbox_onec WHERE message_id IN ({placeholders})",
                message_ids,
            )
        execute("DELETE FROM messages WHERE chat_id = %s", (chat_id,))
        _delete_orphaned_media_files(media_file_ids)
        if dialog_ids:
            placeholders = ",".join("%s" for _ in dialog_ids)
            execute(
                f"DELETE FROM favorites WHERE dialog_id IN ({placeholders})",
                dialog_ids,
            )
            execute(
                f"DELETE FROM dialog_reads WHERE dialog_id IN ({placeholders})",
                dialog_ids,
            )
            execute(
                f"""
                UPDATE chat_dialogs
                SET purged_at = COALESCE(purged_at, %s),
                    ended_at = COALESCE(ended_at, %s),
                    operator_mode = 0
                WHERE id IN ({placeholders})
                """,
                (purge_timestamp, purge_timestamp, *dialog_ids),
            )
        execute(
            """
            UPDATE chats
            SET bin = NULL, section = NULL, updated_at = %s
            WHERE chat_id = %s
            """,
            (purge_timestamp, chat_id),
        )


def delete_chat_dialog(dialog_id: int) -> None:
    with _lock:
        dialog_row = execute(
            "SELECT id, chat_id, bin, ended_at, purged_at FROM chat_dialogs WHERE id = %s",
            (dialog_id,),
        ).fetchone()
        if dialog_row is None:
            raise ValueError("Р вЂќР С‘Р В°Р В»Р С•Р С– Р Р…Р Вµ Р Р…Р В°Р в„–Р Т‘Р ВµР Р…")
        if dialog_row["purged_at"] is not None:
            return

        # Snapshot metrics if the dialog is still open.
        if dialog_row["ended_at"] is None:
            close_chat_dialog(dialog_id, closed_by="system")

        chat_id = dialog_row["chat_id"]
        purge_timestamp = datetime.now(timezone.utc).isoformat()
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
        media_rows = execute(
            """
            SELECT DISTINCT ma.media_file_id
            FROM message_attachments ma
            JOIN messages m ON m.id = ma.message_id
            WHERE m.dialog_id = %s
            """,
            (dialog_id,),
        ).fetchall()
        media_file_ids = [
            int(row["media_file_id"])
            for row in media_rows
            if row["media_file_id"] is not None
        ]
        # Р СљР ВµРЎвЂљРЎР‚Р С‘Р С”Р С‘ РЎС“Р В¶Р Вµ Р В·Р В°Р С—Р С‘РЎРѓР В°Р Р…РЎвЂ№ Р Р† dialog_stats Р С—РЎР‚Р С‘ Р В·Р В°Р С”РЎР‚РЎвЂ№РЎвЂљР С‘Р С‘ РІР‚вЂќ Р В°РЎР‚РЎвЂ¦Р С‘Р Р†Р В°РЎвЂ Р С‘РЎРЏ Р Р…Р Вµ Р Р…РЎС“Р В¶Р Р…Р В°
        execute("DELETE FROM messages WHERE dialog_id = %s", (dialog_id,))
        _delete_orphaned_media_files(media_file_ids)
        execute(
            "DELETE FROM favorites WHERE dialog_id = %s",
            (dialog_id,),
        )
        execute(
            "DELETE FROM dialog_reads WHERE dialog_id = %s",
            (dialog_id,),
        )
        execute(
            """
            UPDATE chat_dialogs
            SET purged_at = COALESCE(purged_at, %s),
                ended_at = COALESCE(ended_at, %s),
                operator_mode = 0
            WHERE id = %s
            """,
            (purge_timestamp, purge_timestamp, dialog_id),
        )
        latest = execute(
            """
            SELECT id, bin, started_at, last_message_at
            FROM chat_dialogs
            WHERE chat_id = %s
              AND purged_at IS NULL
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
        else:
            execute(
                "UPDATE chats SET bin = NULL, section = NULL, updated_at = %s WHERE chat_id = %s",
                (purge_timestamp, chat_id),
            )
        # NOTE: When no dialogs remain, keep existing bin in chats table
        # to allow client to create new dialog with same BIN


def _cleanup_orphaned_bins(bins: Iterable[str]) -> None:
    cleaned = {str(bin_value).strip() for bin_value in bins if bin_value and str(bin_value).strip()}
    if not cleaned:
        return
    placeholders = ",".join("%s" for _ in cleaned)
    existing_rows = execute(
        f"""
        SELECT DISTINCT bin FROM (
            SELECT bin FROM chat_dialogs WHERE bin IN ({placeholders})
            UNION
            SELECT bin FROM dialog_stats WHERE bin IN ({placeholders})
        ) as combined_bins
        """,
        (*cleaned, *cleaned),
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
        "email": repair_text(user["email"]) or user["email"],
        "name": repair_text(user["name"]) or user["name"],
        "created_at": user["created_at"],
        "job_title": repair_text(user.get("job_title", "")) or "",
        "phone": repair_text(user.get("phone", "")) or "",
        "bio": repair_text(user.get("bio", "")) or "",
        "login": repair_text(user.get("login", "")) or "",
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
    email_value = (repair_text(email) or email).strip()
    name_value = (repair_text(name) or name).strip()
    job_title_value = repair_text(job_title or "") or ""
    phone_value = repair_text(phone or "") or ""
    bio_value = repair_text(bio or "") or ""
    login_value = (repair_text(login or email_value) or (login or email_value)).strip()
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
                email_value,
                name_value,
                password_hash,
                now,
                job_title_value,
                phone_value,
                bio_value,
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
            "email": email_value,
            "name": name_value,
            "created_at": now,
            "job_title": job_title_value,
            "phone": phone_value,
            "bio": bio_value,
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
    name_value = repair_text(name) or name
    job_title_value = repair_text(job_title) or job_title
    phone_value = repair_text(phone) or phone
    bio_value = repair_text(bio) or bio
    email_value = repair_text(email or "") or (email or "")
    with _lock:
        try:
            execute(
                """
                UPDATE users
                SET name = %s, job_title = %s, phone = %s, bio = %s, email = %s
                WHERE id = %s
                """,
                (name_value, job_title_value, phone_value, bio_value, email_value, user_id),
            )
        except psycopg2.errors.UniqueViolation as exc:
            raise ValueError("Этот email уже используется") from exc
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
    {"id": "general", "title": "Р С›Р В±РЎвЂ°Р С‘Р Вµ Р Р†Р С•Р С—РЎР‚Р С•РЎРѓРЎвЂ№"},
    {"id": "finance", "title": "Р В¤Р С‘Р Р…Р В°Р Р…РЎРѓРЎвЂ№"},
    {"id": "support", "title": "Р СћР ВµРЎвЂ¦Р Р…Р С‘РЎвЂЎР ВµРЎРѓР С”Р В°РЎРЏ Р С—Р С•Р Т‘Р Т‘Р ВµРЎР‚Р В¶Р С”Р В°"},
    {"id": "hr", "title": "HR Р С‘ Р С”Р В°Р Т‘РЎР‚РЎвЂ№"},
]


SECTIONS = [
    {
        **section,
        "title": repair_text(section["title"]) or section["title"],
        "_normalized": True,
    }
    for section in SECTIONS
]

def get_section_by_title(title: str) -> Optional[dict]:
    global SECTIONS
    if SECTIONS and not SECTIONS[0].get("_normalized"):
        SECTIONS = [
            {
                **section,
                "title": repair_text(section["title"]) or section["title"],
                "_normalized": True,
            }
            for section in SECTIONS
        ]
    normalized = title.strip().lower()
    for section in SECTIONS:
        if str(section["title"]).lower() == normalized:
            return section
    return None


FAQ_ENTRIES: List[dict] = [
    {
        "section": "general",
        "question": "Р С™Р В°Р С” Р С—Р С•Р В»РЎС“РЎвЂЎР С‘РЎвЂљРЎРЉ Р Т‘Р С•РЎРѓРЎвЂљРЎС“Р С— Р С” Р С”Р С•Р Р…РЎРѓРЎС“Р В»РЎРЉРЎвЂљР В°РЎвЂ Р С‘РЎРЏР С Р С—Р С• 1Р РЋ%s",
        "answer": "Р С›РЎвЂљР С—РЎР‚Р В°Р Р†РЎРЉРЎвЂљР Вµ Р Р…Р В°Р С Р Р…Р С•Р СР ВµРЎР‚ Р Т‘Р С•Р С–Р С•Р Р†Р С•РЎР‚Р В° Р С‘Р В»Р С‘ Р вЂР ВР Сњ, Р С‘ Р С”Р С•Р Р…РЎРѓРЎС“Р В»РЎРЉРЎвЂљР В°Р Р…РЎвЂљ Р С•РЎвЂљР С”РЎР‚Р С•Р ВµРЎвЂљ Р Т‘Р С•РЎРѓРЎвЂљРЎС“Р С— Р С” РЎвЂЎР В°РЎвЂљРЎС“ Р С‘ Р Р†Р ВµР В±Р С‘Р Р…Р В°РЎР‚Р В°Р С Р С—Р С• 1Р РЋ.",
        "keywords": ["Р Т‘Р С•РЎРѓРЎвЂљРЎС“Р С—", "1РЎРѓ", "Р С”Р С•Р Р…РЎРѓРЎС“Р В»РЎРЉРЎвЂљР В°РЎвЂ "],
    },
    {
        "section": "general",
        "question": "Р РЋР С”Р С•Р В»РЎРЉР С”Р С• РЎРѓРЎвЂљР С•Р С‘РЎвЂљ РЎРѓР С•Р С—РЎР‚Р С•Р Р†Р С•Р В¶Р Т‘Р ВµР Р…Р С‘Р Вµ%s",
        "answer": "Р вЂР В°Р В·Р С•Р Р†РЎвЂ№Р в„– РЎвЂљР В°РЎР‚Р С‘РЎвЂћ Р Р†Р С”Р В»РЎР‹РЎвЂЎР В°Р ВµРЎвЂљ 10 Р С”Р С•Р Р…РЎРѓРЎС“Р В»РЎРЉРЎвЂљР В°РЎвЂ Р С‘Р в„– Р Р† Р СР ВµРЎРѓРЎРЏРЎвЂ . Р В Р В°РЎРѓРЎв‚¬Р С‘РЎР‚Р ВµР Р…Р Р…РЎвЂ№Р Вµ Р С—Р В°Р С”Р ВµРЎвЂљРЎвЂ№ РЎС“РЎвЂљР С•РЎвЂЎР Р…Р С‘РЎвЂљР Вµ РЎС“ Р С•Р С—Р ВµРЎР‚Р В°РЎвЂљР С•РЎР‚Р В°.",
        "keywords": ["РЎРѓРЎвЂљР С•Р С‘Р С", "РЎвЂљР В°РЎР‚Р С‘РЎвЂћ", "РЎвЂ Р ВµР Р…"],
    },
    {
        "section": "finance",
        "question": "Р С™Р В°Р С” Р Р†РЎвЂ№Р С–РЎР‚РЎС“Р В·Р С‘РЎвЂљРЎРЉ Р С•РЎвЂљРЎвЂЎРЎвЂРЎвЂљ Р С—Р С• Р СњР вЂќР РЋ Р Р† 1Р РЋ%s",
        "answer": "Р С›РЎвЂљР С”РЎР‚Р С•Р в„–РЎвЂљР Вµ РЎР‚Р В°Р В·Р Т‘Р ВµР В» 'Р С›РЎвЂљРЎвЂЎРЎвЂРЎвЂљР Р…Р С•РЎРѓРЎвЂљРЎРЉ', Р Р†РЎвЂ№Р В±Р ВµРЎР‚Р С‘РЎвЂљР Вµ Р С—Р ВµРЎР‚Р С‘Р С•Р Т‘ Р С‘ Р С‘РЎРѓР С—Р С•Р В»РЎРЉР В·РЎС“Р в„–РЎвЂљР Вµ Р С•РЎвЂљРЎвЂЎРЎвЂРЎвЂљ 'Р вЂќР ВµР С”Р В»Р В°РЎР‚Р В°РЎвЂ Р С‘РЎРЏ Р С—Р С• Р СњР вЂќР РЋ'.",
        "keywords": ["Р Р…Р Т‘РЎРѓ", "Р С•РЎвЂљРЎвЂЎР ВµРЎвЂљ", "Р Р†РЎвЂ№Р С–РЎР‚РЎС“Р В·"],
    },
    {
        "section": "finance",
        "question": "Р С™Р В°Р С” Р С‘РЎРѓР С—РЎР‚Р В°Р Р†Р С‘РЎвЂљРЎРЉ Р С•РЎв‚¬Р С‘Р В±Р С”РЎС“ Р С—РЎР‚Р С‘ Р С—РЎР‚Р С•Р Р†Р ВµР Т‘Р ВµР Р…Р С‘Р С‘ Р С—Р В»Р В°РЎвЂљР ВµР В¶Р В°%s",
        "answer": "Р СџРЎР‚Р С•Р Р†Р ВµРЎР‚РЎРЉРЎвЂљР Вµ РЎР‚Р ВµР С”Р Р†Р С‘Р В·Р С‘РЎвЂљРЎвЂ№ Р С—Р В»Р В°РЎвЂљР ВµР В¶Р В° Р С‘ Р С—Р ВµРЎР‚Р ВµР С—РЎР‚Р С•Р Р†Р ВµР Т‘Р С‘РЎвЂљР Вµ Р Т‘Р С•Р С”РЎС“Р СР ВµР Р…РЎвЂљ. Р вЂўРЎРѓР В»Р С‘ Р С•РЎв‚¬Р С‘Р В±Р С”Р В° РЎРѓР С•РЎвЂ¦РЎР‚Р В°Р Р…РЎРЏР ВµРЎвЂљРЎРѓРЎРЏ РІР‚вЂќ Р Р…Р В°Р С—Р С‘РЎв‚¬Р С‘РЎвЂљР Вµ Р С•Р С—Р ВµРЎР‚Р В°РЎвЂљР С•РЎР‚РЎС“.",
        "keywords": ["Р С•РЎв‚¬Р С‘Р В±", "Р С—Р В»Р В°РЎвЂљР ВµР В¶", "Р С—РЎР‚Р С•Р Р†Р ВµР Т‘Р ВµР Р…"],
    },
    {
        "section": "support",
        "question": "1Р РЋ Р Р…Р Вµ Р В·Р В°Р С—РЎС“РЎРѓР С”Р В°Р ВµРЎвЂљРЎРѓРЎРЏ Р С—Р С•РЎРѓР В»Р Вµ Р С•Р В±Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘РЎРЏ",
        "answer": "Р СџР ВµРЎР‚Р ВµР В·Р В°Р С–РЎР‚РЎС“Р В·Р С‘РЎвЂљР Вµ РЎР‚Р В°Р В±Р С•РЎвЂЎРЎС“РЎР‹ РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘РЎР‹ Р С‘ РЎС“Р В±Р ВµР Т‘Р С‘РЎвЂљР ВµРЎРѓРЎРЉ, РЎвЂЎРЎвЂљР С• Р В°Р С–Р ВµР Р…РЎвЂљ Р С•Р В±Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘РЎРЏ Р В·Р В°Р Р†Р ВµРЎР‚РЎв‚¬Р С‘Р В» РЎР‚Р В°Р В±Р С•РЎвЂљРЎС“. Р СџРЎР‚Р С‘ Р С—Р С•Р Р†РЎвЂљР С•РЎР‚Р Р…Р С•Р в„– Р С•РЎв‚¬Р С‘Р В±Р С”Р Вµ РЎРѓР Р†РЎРЏР В¶Р С‘РЎвЂљР ВµРЎРѓРЎРЉ РЎРѓ Р С•Р С—Р ВµРЎР‚Р В°РЎвЂљР С•РЎР‚Р С•Р С.",
        "keywords": ["Р Р…Р Вµ Р В·Р В°Р С—РЎС“РЎРѓР С”Р В°", "Р С•Р В±Р Р…Р С•Р Р†Р В»Р ВµР Р…", "Р С•РЎв‚¬Р С‘Р В±Р С”Р В°", "support"],
    },
    {
        "section": "support",
        "question": "Р С™Р В°Р С” Р С—Р С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎР С‘РЎвЂљРЎРЉ РЎС“Р Т‘Р В°Р В»РЎвЂР Р…Р Р…Р С•Р С–Р С• Р В±РЎС“РЎвЂ¦Р С–Р В°Р В»РЎвЂљР ВµРЎР‚Р В°%s",
        "answer": "Р вЂќР С•Р В±Р В°Р Р†РЎРЉРЎвЂљР Вµ Р ВµР С–Р С• Р Р† Р С–РЎР‚РЎС“Р С—Р С—РЎС“ Р Т‘Р С•РЎРѓРЎвЂљРЎС“Р С—Р В° Р С‘ Р С•РЎвЂљР С—РЎР‚Р В°Р Р†РЎРЉРЎвЂљР Вµ Р С—РЎР‚Р С‘Р С–Р В»Р В°РЎв‚¬Р ВµР Р…Р С‘Р Вµ Р С‘Р В· РЎР‚Р В°Р В·Р Т‘Р ВµР В»Р В° 'Р РЋР С•РЎвЂљРЎР‚РЎС“Р Т‘Р Р…Р С‘Р С”Р С‘'.",
        "keywords": ["РЎС“Р Т‘Р В°Р В»Р ВµР Р…", "Р В±РЎС“РЎвЂ¦Р С–Р В°Р В»РЎвЂљР ВµРЎР‚", "Р С—Р С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎ"],
    },
    {
        "section": "hr",
        "question": "Р С™Р В°Р С” Р Р†РЎвЂ№Р С–РЎР‚РЎС“Р В·Р С‘РЎвЂљРЎРЉ РЎвЂћР С•РЎР‚Р СРЎС“ Р Сћ-2%s",
        "answer": "Р СџР ВµРЎР‚Р ВµР в„–Р Т‘Р С‘РЎвЂљР Вµ Р Р† 'Р С™Р В°Р Т‘РЎР‚Р С•Р Р†РЎвЂ№Р в„– РЎС“РЎвЂЎРЎвЂРЎвЂљ' РІвЂ вЂ™ 'Р РЋР С•РЎвЂљРЎР‚РЎС“Р Т‘Р Р…Р С‘Р С”Р С‘' РІвЂ вЂ™ 'Р С™Р В°РЎР‚РЎвЂљР С•РЎвЂЎР С”Р В° РЎРѓР С•РЎвЂљРЎР‚РЎС“Р Т‘Р Р…Р С‘Р С”Р В°' Р С‘ Р Р…Р В°Р В¶Р СР С‘РЎвЂљР Вµ 'Р СџР ВµРЎвЂЎР В°РЎвЂљРЎРЉ РЎвЂћР С•РЎР‚Р СРЎвЂ№ Р Сћ-2'.",
        "keywords": ["РЎвЂљ-2", "РЎвЂћР С•РЎР‚Р СР В°", "Р С”Р В°Р Т‘РЎР‚Р С•Р Р†"],
    },
    {
        "section": "hr",
        "question": "Р С™Р В°Р С” Р С•РЎвЂћР С•РЎР‚Р СР С‘РЎвЂљРЎРЉ Р С•РЎвЂљР С—РЎС“РЎРѓР С” РЎРѓР С•РЎвЂљРЎР‚РЎС“Р Т‘Р Р…Р С‘Р С”РЎС“%s",
        "answer": "Р РЋР С•Р В·Р Т‘Р В°Р в„–РЎвЂљР Вµ Р Т‘Р С•Р С”РЎС“Р СР ВµР Р…РЎвЂљ 'Р С›РЎвЂљР С—РЎС“РЎРѓР С”' Р Р† РЎР‚Р В°Р В·Р Т‘Р ВµР В»Р Вµ 'Р С™Р В°Р Т‘РЎР‚Р С•Р Р†РЎвЂ№Р в„– РЎС“РЎвЂЎРЎвЂРЎвЂљ', РЎС“Р С”Р В°Р В¶Р С‘РЎвЂљР Вµ Р Т‘Р В°РЎвЂљРЎвЂ№ Р С‘ Р Р†Р С‘Р Т‘ Р С•РЎвЂљР С—РЎС“РЎРѓР С”Р В°, Р В·Р В°РЎвЂљР ВµР С Р С—РЎР‚Р С•Р Р†Р ВµР Т‘Р С‘РЎвЂљР Вµ Р Т‘Р С•Р С”РЎС“Р СР ВµР Р…РЎвЂљ.",
        "keywords": ["Р С•РЎвЂљР С—РЎС“РЎРѓР С”", "Р С•РЎвЂћР С•РЎР‚Р С"],
    },
]


def list_faq(section: str | None = None) -> List[dict]:
    global SECTIONS, FAQ_ENTRIES
    if SECTIONS and not SECTIONS[0].get("_normalized"):
        SECTIONS = [
            {
                **section,
                "title": repair_text(section["title"]) or section["title"],
                "_normalized": True,
            }
            for section in SECTIONS
        ]
    if FAQ_ENTRIES and not FAQ_ENTRIES[0].get("_normalized"):
        FAQ_ENTRIES = [
            {
                **entry,
                "question": repair_text(entry["question"]) or entry["question"],
                "answer": repair_text(entry["answer"]) or entry["answer"],
                "keywords": [repair_text(keyword) or keyword for keyword in entry["keywords"]],
                "_normalized": True,
            }
            for entry in FAQ_ENTRIES
        ]
    if section:
        return [entry for entry in FAQ_ENTRIES if entry["section"] == section]
    return list(FAQ_ENTRIES)


def find_faq_entry_by_keywords(text: str, section: str | None = None) -> Optional[dict]:
    """Р вЂ™Р С•Р В·Р Р†РЎР‚Р В°РЎвЂ°Р В°Р ВµРЎвЂљ FAQ Р В·Р В°Р С—Р С‘РЎРѓРЎРЉ, Р С”Р В»РЎР‹РЎвЂЎР ВµР Р†РЎвЂ№Р Вµ РЎРѓР В»Р С•Р Р†Р В° Р С”Р С•РЎвЂљР С•РЎР‚Р С•Р в„– Р Р†РЎРѓРЎвЂљРЎР‚Р ВµРЎвЂЎР В°РЎР‹РЎвЂљРЎРѓРЎРЏ Р Р† РЎвЂљР ВµР С”РЎРѓРЎвЂљР Вµ."""

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
            "csat_average": None,
            "csat_count": 0,
            "csat_distribution": [],
            "ai_csat_average": None,
            "ai_csat_count": 0,
            "ai_csat_distribution": [],
            "updated_at": now.isoformat(),
        }

    # РІвЂќР‚РІвЂќР‚ Operator filtering РІвЂќР‚РІвЂќР‚
    operator_assigned_bins: List[str] | None = None
    target_operator_names: List[str] = []
    operator_bin_filter_sql = ""
    operator_bin_filter_params: List[str] = []
    rating_operator_join_sql = _resolved_rating_operator_join("ds")

    if operator_id is not None:
        target = get_user_by_id(operator_id)
        if not target:
            return _empty_summary()
        for candidate in (target.get("name"), target.get("login")):
            normalized = str(candidate or "").strip()
            if normalized and normalized not in target_operator_names:
                target_operator_names.append(normalized)
        operator_assigned_bins = get_user_bins(operator_id)
        if not operator_assigned_bins:
            return _empty_summary()

        _bin_placeholders = ", ".join("%s" for _ in operator_assigned_bins)
        operator_bin_filter_sql = f" AND ds.bin IN ({_bin_placeholders})"
        operator_bin_filter_params = list(operator_assigned_bins)

    with _lock:
        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
        # 1. CLOSED DIALOGS РІР‚вЂќ from dialog_stats (pre-aggregated)
        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
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

        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
        # 1.5 CSAT METRICS (Separated for precise operator mapping)
        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
        csat_operator_filter_sql = ""
        csat_operator_filter_params: List[str] = []
        if target_operator_names:
            _operator_placeholders = ", ".join("%s" for _ in target_operator_names)
            csat_operator_filter_sql = (
                f" AND resolved_operator.operator_name IN ({_operator_placeholders})"
            )
            csat_operator_filter_params = list(target_operator_names)

        csat_row = execute(
            """
            SELECT
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ds.csat_rating) AS csat_median,
                COUNT(ds.csat_rating) AS csat_count,
                COALESCE(SUM(CASE WHEN ds.csat_rating = 1 THEN 1 ELSE 0 END), 0) AS csat_1,
                COALESCE(SUM(CASE WHEN ds.csat_rating = 2 THEN 1 ELSE 0 END), 0) AS csat_2,
                COALESCE(SUM(CASE WHEN ds.csat_rating = 3 THEN 1 ELSE 0 END), 0) AS csat_3,
                COALESCE(SUM(CASE WHEN ds.csat_rating = 4 THEN 1 ELSE 0 END), 0) AS csat_4,
                COALESCE(SUM(CASE WHEN ds.csat_rating = 5 THEN 1 ELSE 0 END), 0) AS csat_5
            FROM dialog_stats ds
            """
            + rating_operator_join_sql
            + """
            WHERE ds.started_at >= %s AND ds.started_at < %s
              AND COALESCE(ds.is_ai_closed, FALSE) = FALSE
              AND ds.csat_rating IS NOT NULL
              AND resolved_operator.operator_name IS NOT NULL
            """
            + operator_bin_filter_sql
            + csat_operator_filter_sql,
            (
                start_iso,
                end_exclusive_iso,
                *operator_bin_filter_params,
                *csat_operator_filter_params,
            ),
        ).fetchone()

        csat_average = (
            round(_as_optional_float(csat_row["csat_median"]), 2)
            if csat_row["csat_median"] is not None else None
        )
        csat_count = int(csat_row["csat_count"] or 0)
        csat_distribution = [
            {"rating": i, "count": int(csat_row[f"csat_{i}"] or 0)}
            for i in range(1, 6)
        ]

        operator_csat_filter_sql = ""
        operator_csat_filter_params: List[str] = []
        if target_operator_names:
            _operator_placeholders = ", ".join("%s" for _ in target_operator_names)
            operator_csat_filter_sql = f" AND ocr.operator_name IN ({_operator_placeholders})"
            operator_csat_filter_params = list(target_operator_names)

        operator_csat_row = execute(
            """
            SELECT
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ocr.rating) AS csat_median,
                COUNT(ocr.rating) AS csat_count,
                COALESCE(SUM(CASE WHEN ocr.rating = 1 THEN 1 ELSE 0 END), 0) AS csat_1,
                COALESCE(SUM(CASE WHEN ocr.rating = 2 THEN 1 ELSE 0 END), 0) AS csat_2,
                COALESCE(SUM(CASE WHEN ocr.rating = 3 THEN 1 ELSE 0 END), 0) AS csat_3,
                COALESCE(SUM(CASE WHEN ocr.rating = 4 THEN 1 ELSE 0 END), 0) AS csat_4,
                COALESCE(SUM(CASE WHEN ocr.rating = 5 THEN 1 ELSE 0 END), 0) AS csat_5
            FROM operator_csat_ratings ocr
            JOIN dialog_stats ds ON (
                (ocr.appeal_id IS NOT NULL AND ds.appeal_id = ocr.appeal_id)
                OR (
                    ocr.appeal_id IS NULL
                    AND ds.appeal_id IS NULL
                    AND ds.dialog_id = ocr.dialog_id
                )
            )
            WHERE ds.started_at >= %s AND ds.started_at < %s
              AND COALESCE(ds.is_ai_closed, FALSE) = FALSE
            """
            + operator_bin_filter_sql
            + operator_csat_filter_sql,
            (
                start_iso,
                end_exclusive_iso,
                *operator_bin_filter_params,
                *operator_csat_filter_params,
            ),
        ).fetchone()
        operator_csat_count = int(operator_csat_row["csat_count"] or 0)
        if operator_csat_count:
            csat_average = (
                round(_as_optional_float(operator_csat_row["csat_median"]), 2)
                if operator_csat_row["csat_median"] is not None else None
            )
            csat_count = operator_csat_count
            csat_distribution = [
                {"rating": i, "count": int(operator_csat_row[f"csat_{i}"] or 0)}
                for i in range(1, 6)
            ]
        ai_csat_row = execute(
            """
            SELECT
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ds.ai_csat_rating) AS ai_csat_median,
                COUNT(ds.ai_csat_rating) AS ai_csat_count,
                COALESCE(SUM(CASE WHEN ds.ai_csat_rating = 1 THEN 1 ELSE 0 END), 0) AS ai_csat_1,
                COALESCE(SUM(CASE WHEN ds.ai_csat_rating = 2 THEN 1 ELSE 0 END), 0) AS ai_csat_2,
                COALESCE(SUM(CASE WHEN ds.ai_csat_rating = 3 THEN 1 ELSE 0 END), 0) AS ai_csat_3,
                COALESCE(SUM(CASE WHEN ds.ai_csat_rating = 4 THEN 1 ELSE 0 END), 0) AS ai_csat_4,
                COALESCE(SUM(CASE WHEN ds.ai_csat_rating = 5 THEN 1 ELSE 0 END), 0) AS ai_csat_5
            FROM dialog_stats ds
            WHERE ds.started_at >= %s AND ds.started_at < %s
              AND COALESCE(ds.is_ai_closed, FALSE) = TRUE
            """
            + operator_bin_filter_sql,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchone()

        ai_csat_average = (
            round(_as_optional_float(ai_csat_row["ai_csat_median"]), 2)
            if ai_csat_row["ai_csat_median"] is not None else None
        )
        ai_csat_count = int(ai_csat_row["ai_csat_count"] or 0)
        ai_csat_distribution = [
            {"rating": i, "count": int(ai_csat_row[f"ai_csat_{i}"] or 0)}
            for i in range(1, 6)
        ]

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

        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
        # 2. OPEN DIALOGS РІР‚вЂќ live from chat_dialogs + messages
        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
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

        # РІвЂќР‚РІвЂќР‚ Combined totals РІвЂќР‚РІвЂќР‚
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

        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
        # 3. DERIVED METRICS
        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
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
            dos_bin_exists_filter = (
                " AND EXISTS ("
                " SELECT 1 FROM dialog_stats ds"
                " WHERE ds.bin IN (" + ", ".join("%s" for _ in operator_bin_filter_params) + ")"
                "   AND ("
                "       (dos.appeal_id IS NOT NULL AND ds.appeal_id = dos.appeal_id)"
                "       OR (dos.appeal_id IS NULL AND ds.dialog_id = dos.dialog_id)"
                "   )"
                " )"
            )
            rt_dialog_rows = execute(
                """
                SELECT dos.dialog_id, dos.operator_name AS author,
                       dos.avg_response_seconds / 60.0 AS response_time_minutes
                FROM dialog_operator_stats dos
                WHERE dos.started_at >= %s AND dos.started_at < %s
                  AND dos.avg_response_seconds IS NOT NULL
                """
                + dos_bin_exists_filter
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

        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
        # 4. SECTION BREAKDOWN
        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
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
            title = section_map.get(sec_id or "", sec_id or "Р вЂР ВµР В· РЎР‚Р В°Р В·Р Т‘Р ВµР В»Р В°")
            title = repair_text(title) or title
            percentage = (sec_dialogs / total_dialogs * 100.0) if total_dialogs else 0.0
            section_breakdown.append({
                "section": sec_id,
                "title": title,
                "dialogs": sec_dialogs,
                "percentage": percentage,
            })
        section_breakdown.sort(key=lambda s: s["dialogs"], reverse=True)

        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
        # 5. TOP QUESTIONS (from stat_questions)
        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
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
        if target_operator_names:
            _sq_operator_ph = ", ".join("%s" for _ in target_operator_names)
            sq_bin_filter += f"""
                AND EXISTS (
                    SELECT 1
                    FROM dialog_operator_stats dos2
                    WHERE dos2.operator_name IN ({_sq_operator_ph})
                      AND (
                          (sq.appeal_id IS NOT NULL AND dos2.appeal_id = sq.appeal_id)
                          OR
                          (sq.appeal_id IS NULL AND dos2.dialog_id = sq.dialog_id)
                      )
                )
            """
            sq_params.extend(target_operator_names)

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
                "title": section_map.get(sec_id or "", sec_id or "Р вЂР ВµР В· РЎР‚Р В°Р В·Р Т‘Р ВµР В»Р В°"),
                "title": repair_text(section_map.get(sec_id or "", sec_id or "Без раздела")) or "Без раздела",
                "questions": [
                    {"question": item["question"], "count": int(item["count"])}
                    for item in qs[:max(questions_limit, 0)]
                ],
            })

        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
        # 6. AGENT BREAKDOWN (from dialog_operator_stats)
        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
        agent_rows = execute(
            """
            SELECT dos.operator_name,
                   SUM(dos.messages_sent) AS message_count,
                   COUNT(DISTINCT dos.dialog_id) AS dialog_count,
                   SUM(dos.avg_response_seconds * dos.response_count) / NULLIF(SUM(dos.response_count), 0) AS avg_response_time
            FROM dialog_operator_stats dos
            JOIN dialog_stats ds ON (
                (dos.appeal_id IS NOT NULL AND ds.appeal_id = dos.appeal_id)
                OR (
                    dos.appeal_id IS NULL
                    AND ds.appeal_id IS NULL
                    AND ds.dialog_id = dos.dialog_id
                )
            )
            WHERE dos.started_at >= %s AND dos.started_at < %s
            """
            + operator_bin_filter_sql
            + """
            GROUP BY dos.operator_name
            ORDER BY dialog_count DESC
            """,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchall()

        agent_csat_rows = execute(
            """
            SELECT resolved_operator.operator_name,
                   PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ds.csat_rating) AS median_csat
            FROM dialog_stats ds
            """
            + rating_operator_join_sql
            + """
            WHERE ds.started_at >= %s AND ds.started_at < %s
              AND COALESCE(ds.is_ai_closed, FALSE) = FALSE
              AND ds.csat_rating IS NOT NULL
              AND resolved_operator.operator_name IS NOT NULL
            """
            + operator_bin_filter_sql
            + """
            GROUP BY resolved_operator.operator_name
            """,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchall()
        agent_csat_map = {
            str(row["operator_name"]): _as_optional_float(row["median_csat"])
            for row in agent_csat_rows
            if row.get("operator_name")
        }

        operator_agent_csat_rows = execute(
            """
            SELECT ocr.operator_name,
                   PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ocr.rating) AS median_csat
            FROM operator_csat_ratings ocr
            JOIN dialog_stats ds ON (
                (ocr.appeal_id IS NOT NULL AND ds.appeal_id = ocr.appeal_id)
                OR (
                    ocr.appeal_id IS NULL
                    AND ds.appeal_id IS NULL
                    AND ds.dialog_id = ocr.dialog_id
                )
            )
            WHERE ds.started_at >= %s AND ds.started_at < %s
              AND COALESCE(ds.is_ai_closed, FALSE) = FALSE
            """
            + operator_bin_filter_sql
            + """
            GROUP BY ocr.operator_name
            """,
            (start_iso, end_exclusive_iso, *operator_bin_filter_params),
        ).fetchall()
        for row in operator_agent_csat_rows:
            if row.get("operator_name"):
                agent_csat_map[str(row["operator_name"])] = _as_optional_float(row["median_csat"])
        agent_breakdown: List[dict] = []
        for row in agent_rows:
            agent_name = row["operator_name"] or "\u0411\u0435\u0437 \u0438\u043c\u0435\u043d\u0438"
            messages_sent = int(row["message_count"] or 0)
            dialogs_handled = int(row["dialog_count"] or 0)
            avg_msgs = messages_sent / dialogs_handled if dialogs_handled else 0.0
            avg_rt = (
                float(row["avg_response_time"]) / 60.0
                if row["avg_response_time"] is not None else None
            )
            avg_csat = agent_csat_map.get(str(agent_name))
            agent_breakdown.append({
                "name": agent_name,
                "messages": messages_sent,
                "dialogs": dialogs_handled,
                "avg_messages_per_dialog": avg_msgs,
                "avg_response_time_minutes": avg_rt,
                "last_activity": None,
                "avg_csat": avg_csat,
            })

        # 7. RECENT ACTIVITY (by day)
        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
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

        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
        # 8. RECURRING REQUESTS (self-join on dialog_stats by BIN)
        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
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

        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
        # 9. PEAK LOAD HEATMAP
        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
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

        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
        # 10. CONTRACT ANALYTICS (top BINs)
        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
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
            {"bin": row["bin"] or "Р СњР ВµР С‘Р В·Р Р†Р ВµРЎРѓРЎвЂљР Р…Р С•", "requests": int(row["dialog_count"])}
            for row in contract_rows if row["has_contract"] is False
        ]
        for item in top_bins_without_contract_raw:
            item["bin"] = repair_text(item["bin"]) or item["bin"]
        top_bins_without_contract_raw.sort(key=lambda x: x["requests"], reverse=True)
        top_bins_without_contract = top_bins_without_contract_raw[:10]

        top_bins_with_contract_raw = [
            {"bin": row["bin"] or "Р СњР ВµР С‘Р В·Р Р†Р ВµРЎРѓРЎвЂљР Р…Р С•", "requests": int(row["dialog_count"])}
            for row in contract_rows if row["has_contract"] is True
        ]
        for item in top_bins_with_contract_raw:
            item["bin"] = repair_text(item["bin"]) or item["bin"]
        top_bins_with_contract_raw.sort(key=lambda x: x["requests"], reverse=True)
        top_bins_with_contract = top_bins_with_contract_raw[:10]

        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
        # 11. DIALOG METRICS (for region map)
        # РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’РІвЂўС’
        dm_rows = execute(
            """
            SELECT ds.dialog_id,
                   ds.bin,
                   ds.is_ai_closed,
                   ds.avg_response_time_seconds,
                   ds.csat_rating,
                   ds.ai_csat_rating,
                   resolved_operator.operator_name,
                   COALESCE(
                       NULLIF(TRIM((
                           SELECT m.author
                           FROM messages m
                           WHERE m.dialog_id = ds.dialog_id
                             AND m.direction = 'incoming'
                             AND NULLIF(TRIM(COALESCE(m.author, '')), '') IS NOT NULL
                             AND (ds.started_at IS NULL OR m.created_at >= ds.started_at)
                             AND (ds.ended_at IS NULL OR m.created_at <= ds.ended_at)
                           ORDER BY m.created_at DESC
                           LIMIT 1
                       )), ''),
                       NULLIF(TRIM(c.title), ''),
                       NULLIF(TRIM(c.username), ''),
                       NULLIF(TRIM(c.external_chat_id), '')
                   ) AS rated_by
            FROM dialog_stats ds
            """
            + rating_operator_join_sql
            + """
            LEFT JOIN chats c ON c.chat_id = ds.chat_id
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
                "csat_rating": int(row["csat_rating"]) if row["csat_rating"] is not None else None,
                "ai_csat_rating": int(row["ai_csat_rating"]) if row["ai_csat_rating"] is not None else None,
                "rated_by": row["rated_by"],
                "operator_name": row["operator_name"],
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
                "csat_rating": None,
                "ai_csat_rating": None,
                "rated_by": None,
                "operator_name": None,
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
        "csat_average": csat_average,
        "csat_count": csat_count,
        "csat_distribution": csat_distribution,
        "ai_csat_average": ai_csat_average,
        "ai_csat_count": ai_csat_count,
        "ai_csat_distribution": ai_csat_distribution,
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
    """Р С™Р В»Р В°Р Т‘РЎвЂРЎвЂљ РЎРѓР С•Р С•Р В±РЎвЂ°Р ВµР Р…Р С‘Р Вµ Р С•Р С—Р ВµРЎР‚Р В°РЎвЂљР С•РЎР‚Р В° Р Р† outbox Р Т‘Р В»РЎРЏ 1Р РЋ."""
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
    """Р вЂ™Р С•Р В·Р Р†РЎР‚Р В°РЎвЂ°Р В°Р ВµРЎвЂљ pending-РЎРѓР С•Р С•Р В±РЎвЂ°Р ВµР Р…Р С‘РЎРЏ Р Т‘Р В»РЎРЏ РЎС“Р С”Р В°Р В·Р В°Р Р…Р Р…Р С•Р С–Р С• external_chat_id (Р Р† Р С—Р С•РЎР‚РЎРЏР Т‘Р С”Р Вµ FIFO)."""
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
    """Р СџР С•Р СР ВµРЎвЂЎР В°Р ВµРЎвЂљ РЎРЊР В»Р ВµР СР ВµР Р…РЎвЂљРЎвЂ№ Р С”Р В°Р С” Р Т‘Р С•РЎРѓРЎвЂљР В°Р Р†Р В»Р ВµР Р…Р Р…РЎвЂ№Р Вµ."""
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
    """Р СџР С•Р СР ВµРЎвЂЎР В°Р ВµРЎвЂљ РЎРЊР В»Р ВµР СР ВµР Р…РЎвЂљРЎвЂ№ Р С”Р В°Р С” 'failed' РЎРѓ РЎРѓР С•Р С•Р В±РЎвЂ°Р ВµР Р…Р С‘Р ВµР С Р С•Р В± Р С•РЎв‚¬Р С‘Р В±Р С”Р Вµ.
    Р С›Р В¶Р С‘Р Т‘Р В°Р ВµРЎвЂљРЎРѓРЎРЏ Р СР В°РЎРѓРЎРѓР С‘Р Р† РЎРѓР В»Р С•Р Р†Р В°РЎР‚Р ВµР в„– Р Р†Р С‘Р Т‘Р В°: {"id": 1, "error": "text"}.
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
    customer_name_ru: str | None = None,
) -> Dict[str, Any] | None:
    """Р вЂќР С•Р В±Р В°Р Р†Р В»РЎРЏР ВµРЎвЂљ Р С•РЎР‚Р С–Р В°Р Р…Р С‘Р В·Р В°РЎвЂ Р С‘РЎР‹ Р В±Р ВµР В· Р Т‘Р С•Р С–Р С•Р Р†Р С•РЎР‚Р В° Р Р† Р В±Р В°Р В·РЎС“."""
    normalized_bin = (customer_bin or "").strip()
    if not normalized_bin:
        return None

    now = datetime.now(timezone.utc).isoformat()
    # Use atomic upsert to avoid UniqueViolation race conditions
    # between concurrent requests for the same BIN.
    execute(
        """
        INSERT INTO organizations_without_contracts
            (customer_bin, customer_legal_address, customer_bank_name_ru, customer_name_ru, created_at)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (customer_bin) DO UPDATE
        SET customer_legal_address = COALESCE(EXCLUDED.customer_legal_address, organizations_without_contracts.customer_legal_address),
            customer_bank_name_ru = COALESCE(EXCLUDED.customer_bank_name_ru, organizations_without_contracts.customer_bank_name_ru),
            customer_name_ru = COALESCE(EXCLUDED.customer_name_ru, organizations_without_contracts.customer_name_ru)
        """,
        (normalized_bin, customer_legal_address, customer_bank_name_ru, customer_name_ru, now),
    )
    return {
        "customer_bin": normalized_bin,
        "customer_legal_address": customer_legal_address,
        "customer_bank_name_ru": customer_bank_name_ru,
        "customer_name_ru": customer_name_ru,
        "created_at": now,
    }


def list_organizations_without_contracts() -> List[Dict[str, Any]]:
    """Р вЂ™Р С•Р В·Р Р†РЎР‚Р В°РЎвЂ°Р В°Р ВµРЎвЂљ РЎРѓР С—Р С‘РЎРѓР С•Р С” Р С•РЎР‚Р С–Р В°Р Р…Р С‘Р В·Р В°РЎвЂ Р С‘Р в„– Р В±Р ВµР В· Р Т‘Р С•Р С–Р С•Р Р†Р С•РЎР‚Р С•Р Р†."""
    with _lock:
        rows = execute(
            """
            SELECT customer_bin, customer_legal_address, customer_bank_name_ru, customer_name_ru, created_at
            FROM organizations_without_contracts
            ORDER BY created_at DESC
            """
        ).fetchall()
    return [
        {
            "customer_bin": row["customer_bin"],
            "customer_legal_address": row["customer_legal_address"],
            "customer_bank_name_ru": row["customer_bank_name_ru"],
            "customer_name_ru": row["customer_name_ru"],
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def has_organization_without_contract(customer_bin: str) -> bool:
    """Р СџРЎР‚Р С•Р Р†Р ВµРЎР‚РЎРЏР ВµРЎвЂљ, Р ВµРЎРѓРЎвЂљРЎРЉ Р В»Р С‘ Р С•РЎР‚Р С–Р В°Р Р…Р С‘Р В·Р В°РЎвЂ Р С‘РЎРЏ Р Р† РЎРѓР С—Р С‘РЎРѓР С”Р Вµ Р В±Р ВµР В· Р Т‘Р С•Р С–Р С•Р Р†Р С•РЎР‚Р С•Р Р†."""
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
    """Р Р€Р Т‘Р В°Р В»РЎРЏР ВµРЎвЂљ Р С•РЎР‚Р С–Р В°Р Р…Р С‘Р В·Р В°РЎвЂ Р С‘РЎР‹ Р С‘Р В· РЎРѓР С—Р С‘РЎРѓР С”Р В° Р В±Р ВµР В· Р Т‘Р С•Р С–Р С•Р Р†Р С•РЎР‚Р С•Р Р†."""
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
    Р РЋР С‘Р Р…РЎвЂ¦РЎР‚Р С•Р Р…Р С‘Р В·Р С‘РЎР‚РЎС“Р ВµРЎвЂљ Р Р†РЎРѓР Вµ Р вЂР ВР СњРЎвЂ№ РЎРѓ Р С‘Р Р…РЎвЂћР С•РЎР‚Р СР В°РЎвЂ Р С‘Р ВµР в„– Р С• Р Т‘Р С•Р С–Р С•Р Р†Р С•РЎР‚Р В°РЎвЂ¦.
    Р вЂќР С•Р В±Р В°Р Р†Р В»РЎРЏР ВµРЎвЂљ Р вЂР ВР СњРЎвЂ№ Р В±Р ВµР В· Р Т‘Р С•Р С–Р С•Р Р†Р С•РЎР‚Р В° Р Р† organizations_without_contracts,
    РЎС“Р Т‘Р В°Р В»РЎРЏР ВµРЎвЂљ Р вЂР ВР СњРЎвЂ№ РЎРѓ Р Т‘Р С•Р С–Р С•Р Р†Р С•РЎР‚Р С•Р С Р С‘Р В· РЎРЊРЎвЂљР С•Р в„– РЎвЂљР В°Р В±Р В»Р С‘РЎвЂ РЎвЂ№.
    
    Returns:
        Р РЋРЎвЂљР В°РЎвЂљР С‘РЎРѓРЎвЂљР С‘Р С”Р В° РЎРѓР С‘Р Р…РЎвЂ¦РЎР‚Р С•Р Р…Р С‘Р В·Р В°РЎвЂ Р С‘Р С‘: added, removed, total
    """
    from . import contract_checker
    
    all_bins = list_bins()
    bins_with_contracts = contract_checker.get_all_customer_bins_with_contracts()
    
    added = 0
    removed = 0
    
    for bin_value in all_bins:
        if bin_value in bins_with_contracts:
            # Р Р€ Р вЂР ВР СњР В° Р ВµРЎРѓРЎвЂљРЎРЉ Р Т‘Р С•Р С–Р С•Р Р†Р С•РЎР‚ - РЎС“Р Т‘Р В°Р В»РЎРЏР ВµР С Р С‘Р В· Р В±Р ВµР В· Р Т‘Р С•Р С–Р С•Р Р†Р С•РЎР‚Р В° Р ВµРЎРѓР В»Р С‘ Р ВµРЎРѓРЎвЂљРЎРЉ
            if remove_organization_without_contract(bin_value):
                removed += 1
        else:
            # Р Р€ Р вЂР ВР СњР В° Р Р…Р ВµРЎвЂљ Р Т‘Р С•Р С–Р С•Р Р†Р С•РЎР‚Р В° - Р С—РЎР‚Р С•Р Р†Р ВµРЎР‚РЎРЏР ВµР С Р С‘ Р Т‘Р С•Р В±Р В°Р Р†Р В»РЎРЏР ВµР С Р Р† Р В±Р ВµР В· Р Т‘Р С•Р С–Р С•Р Р†Р С•РЎР‚Р В°
            if not has_organization_without_contract(bin_value):
                # Р СџР С•Р В»РЎС“РЎвЂЎР В°Р ВµР С Р С‘Р Р…РЎвЂћР С•РЎР‚Р СР В°РЎвЂ Р С‘РЎР‹ Р С•Р В± Р В°Р Т‘РЎР‚Р ВµРЎРѓР Вµ/Р В±Р В°Р Р…Р С”Р Вµ Р С‘Р В· Р С‘РЎРѓРЎвЂљР С•РЎР‚Р С‘РЎвЂЎР ВµРЎРѓР С”Р С‘РЎвЂ¦ Р Т‘Р В°Р Р…Р Р…РЎвЂ№РЎвЂ¦
                contract_data = contract_checker.check_customer_contracts(bin_value)
                add_organization_without_contract(
                    bin_value,
                    customer_legal_address=contract_data.get("customer_legal_address"),
                    customer_bank_name_ru=contract_data.get("customer_bank_name_ru"),
                    customer_name_ru=contract_data.get("customer_name_ru"),
                )
                added += 1
    
    return {
        "added": added,
        "removed": removed,
        "total_bins": len(all_bins),
        "bins_with_contracts": len(bins_with_contracts),
    }


# ============================================================================
# Reply Templates (Р РЃР В°Р В±Р В»Р С•Р Р…РЎвЂ№ Р В±РЎвЂ№РЎРѓРЎвЂљРЎР‚РЎвЂ№РЎвЂ¦ Р С•РЎвЂљР Р†Р ВµРЎвЂљР С•Р Р†)
# ============================================================================


def list_reply_templates(section: str | None = None) -> List[dict]:
    """Returns all reply templates, optionally filtered by section."""
    with _lock:
        if section:
            rows = execute(
                """
                SELECT id, title, text, section, sort_order, created_by, created_at
                FROM reply_templates
                WHERE section = %s OR section IS NULL
                ORDER BY sort_order ASC, id ASC
                """,
                (section,),
            ).fetchall()
        else:
            rows = execute(
                """
                SELECT id, title, text, section, sort_order, created_by, created_at
                FROM reply_templates
                ORDER BY sort_order ASC, id ASC
                """
            ).fetchall()
    return [
        {
            "id": int(row["id"]),
            "title": repair_text(row["title"]) or row["title"],
            "text": repair_text(row["text"]) or row["text"],
            "section": row["section"],
            "sort_order": int(row["sort_order"] or 0),
            "created_by": int(row["created_by"]) if row["created_by"] else None,
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def create_reply_template(
    *,
    title: str,
    text: str,
    section: str | None = None,
    sort_order: int = 0,
    created_by: int | None = None,
) -> dict:
    """Creates a new reply template and returns it."""
    now = datetime.now(timezone.utc).isoformat()
    title_value = repair_text(title) or title
    text_value = repair_text(text) or text
    with _lock:
        row = execute(
            """
            INSERT INTO reply_templates (title, text, section, sort_order, created_by, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, title, text, section, sort_order, created_by, created_at
            """,
            (title_value, text_value, section, sort_order, created_by, now),
        ).fetchone()
    if row is None:
        raise RuntimeError("Failed to create reply template")
    return {
        "id": int(row["id"]),
        "title": repair_text(row["title"]) or row["title"],
        "text": repair_text(row["text"]) or row["text"],
        "section": row["section"],
        "sort_order": int(row["sort_order"] or 0),
        "created_by": int(row["created_by"]) if row["created_by"] else None,
        "created_at": row["created_at"],
    }


def update_reply_template(
    template_id: int,
    *,
    title: str,
    text: str,
    section: str | None = None,
    sort_order: int = 0,
) -> dict:
    """Updates an existing reply template and returns it."""
    title_value = repair_text(title) or title
    text_value = repair_text(text) or text
    with _lock:
        row = execute(
            """
            UPDATE reply_templates
            SET title = %s, text = %s, section = %s, sort_order = %s
            WHERE id = %s
            RETURNING id, title, text, section, sort_order, created_by, created_at
            """,
            (title_value, text_value, section, sort_order, template_id),
        ).fetchone()
    if row is None:
        raise ValueError("Шаблон не найден")
    return {
        "id": int(row["id"]),
        "title": repair_text(row["title"]) or row["title"],
        "text": repair_text(row["text"]) or row["text"],
        "section": row["section"],
        "sort_order": int(row["sort_order"] or 0),
        "created_by": int(row["created_by"]) if row["created_by"] else None,
        "created_at": row["created_at"],
    }


def delete_reply_template(template_id: int) -> bool:
    """Deletes a reply template. Returns True if deleted, False if not found."""
    with _lock:
        cursor = execute(
            "DELETE FROM reply_templates WHERE id = %s",
            (template_id,),
        )
    return cursor.rowcount > 0













# ============================================================================
# Customer Surveys
# ============================================================================


def _json_dumps(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=False)


def _json_loads(value: Any, fallback: Any) -> Any:
    if value in (None, ""):
        return fallback
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(str(value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback


def _survey_question_from_row(row: Mapping[str, Any] | None) -> Dict[str, Any] | None:
    if row is None:
        return None
    return {
        "id": int(row["id"]),
        "template_id": int(row["template_id"]),
        "sort_order": int(row["sort_order"] or 0),
        "question_type": str(row["question_type"]),
        "text": str(row["text"]),
        "topic": row.get("topic"),
        "required": bool(row.get("required", True)),
        "anonymity_mode": customer_surveys.normalize_question_anonymity_mode(row.get("anonymity_mode")),
        "config": _json_loads(row.get("config"), {}),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _survey_template_from_row(row: Mapping[str, Any] | None, *, include_questions: bool = True) -> Dict[str, Any] | None:
    if row is None:
        return None
    launch_rules = customer_surveys.normalize_launch_rules(
        _json_loads(row.get("launch_rules"), []),
        legacy_trigger_type=row.get("trigger_type"),
        legacy_periodic_interval=row.get("periodic_interval"),
        legacy_scheduled_at=row.get("scheduled_at"),
    )
    trigger_type, periodic_interval, scheduled_at = customer_surveys.derive_legacy_trigger_fields(launch_rules)
    template = {
        "id": int(row["id"]),
        "title": str(row["title"]),
        "description": row.get("description") or "",
        "audience": customer_surveys.normalize_survey_audience(row.get("audience")),
        "status": str(row.get("status") or customer_surveys.SURVEY_STATUS_DRAFT),
        "trigger_type": trigger_type,
        "periodic_interval": periodic_interval,
        "scheduled_at": scheduled_at,
        "launch_rules": launch_rules,
        "is_anonymous": bool(row.get("is_anonymous", False)),
        "created_by": int(row["created_by"]) if row.get("created_by") is not None else None,
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }
    if include_questions:
        template["questions"] = get_survey_questions(int(row["id"]))
    return template


def _survey_session_from_row(row: Mapping[str, Any] | None, *, include_children: bool = True) -> Dict[str, Any] | None:
    if row is None:
        return None
    session = {
        "id": int(row["id"]),
        "template_id": int(row["template_id"]),
        "chat_id": int(row["chat_id"]),
        "dialog_id": int(row["dialog_id"]) if row.get("dialog_id") is not None else None,
        "appeal_id": int(row["appeal_id"]) if row.get("appeal_id") is not None else None,
        "bin": row.get("bin"),
        "status": str(row.get("status") or customer_surveys.SESSION_STATUS_STARTED),
        "trigger_source": str(row.get("trigger_source") or customer_surveys.SURVEY_TRIGGER_MANUAL),
        "current_question_id": int(row["current_question_id"]) if row.get("current_question_id") is not None else None,
        "is_anonymous": bool(row.get("is_anonymous", False)),
        "started_at": row.get("started_at"),
        "completed_at": row.get("completed_at"),
        "updated_at": row.get("updated_at"),
    }
    if include_children:
        questions = get_survey_questions(session["template_id"])
        operators = get_survey_session_operators(session["id"])
        current_question = None
        current_index = 0
        for index, question in enumerate(questions):
            if question["id"] == session["current_question_id"]:
                current_question = question
                current_index = index
                break
        session.update({"questions": questions, "operators": operators, "current_question": current_question, "current_question_index": current_index, "questions_total": len(questions)})
    return session


def list_survey_templates(status: str | None = None, audience: str | None = None) -> List[Dict[str, Any]]:
    normalized_audience = customer_surveys.normalize_survey_audience(audience) if audience else None
    with _lock:
        if status and normalized_audience:
            rows = execute(
                """
                SELECT id, title, description, audience, status, trigger_type, periodic_interval,
                       scheduled_at, launch_rules, is_anonymous, created_by, created_at, updated_at
                FROM survey_templates
                WHERE status = %s AND audience = %s
                ORDER BY updated_at DESC, id DESC
                """,
                (status, normalized_audience),
            ).fetchall()
        elif status:
            rows = execute(
                """
                SELECT id, title, description, audience, status, trigger_type, periodic_interval,
                       scheduled_at, launch_rules, is_anonymous, created_by, created_at, updated_at
                FROM survey_templates
                WHERE status = %s
                ORDER BY updated_at DESC, id DESC
                """,
                (status,),
            ).fetchall()
        elif normalized_audience:
            rows = execute(
                """
                SELECT id, title, description, audience, status, trigger_type, periodic_interval,
                       scheduled_at, launch_rules, is_anonymous, created_by, created_at, updated_at
                FROM survey_templates
                WHERE audience = %s
                ORDER BY updated_at DESC, id DESC
                """,
                (normalized_audience,),
            ).fetchall()
        else:
            rows = execute(
                """
                SELECT id, title, description, audience, status, trigger_type, periodic_interval,
                       scheduled_at, launch_rules, is_anonymous, created_by, created_at, updated_at
                FROM survey_templates
                ORDER BY updated_at DESC, id DESC
                """
            ).fetchall()
    return [_survey_template_from_row(row) for row in rows]


def get_survey_template(template_id: int) -> Dict[str, Any] | None:
    with _lock:
        row = execute(
            """
            SELECT id, title, description, audience, status, trigger_type, periodic_interval,
                   scheduled_at, launch_rules, is_anonymous, created_by, created_at, updated_at
            FROM survey_templates
            WHERE id = %s
            """,
            (int(template_id),),
        ).fetchone()
    return _survey_template_from_row(row)

def _insert_survey_questions(template_id: int, questions: Sequence[Mapping[str, Any]], now: str) -> None:
    for index, question in enumerate(questions, start=1):
        question_type = customer_surveys.normalize_question_type(str(question.get("question_type") or ""))
        text = str(question.get("text") or "").strip()
        if not text:
            continue
        execute(
            """
            INSERT INTO survey_questions (
                template_id, sort_order, question_type, text, topic, required,
                anonymity_mode, config, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                int(template_id),
                int(question.get("sort_order") or index),
                question_type,
                text,
                question.get("topic"),
                bool(question.get("required", True)),
                customer_surveys.normalize_question_anonymity_mode(question.get("anonymity_mode")),
                _json_dumps(question.get("config") or {}),
                now,
                now,
            ),
        )




def _has_survey_sessions(template_id: int) -> bool:
    row = execute(
        "SELECT 1 FROM survey_sessions WHERE template_id = %s LIMIT 1",
        (int(template_id),),
    ).fetchone()
    return row is not None


def _normalized_survey_question_payload(question: Mapping[str, Any], fallback_order: int) -> Dict[str, Any]:
    question_type = customer_surveys.normalize_question_type(str(question.get("question_type") or ""))
    return {
        "sort_order": int(question.get("sort_order") or fallback_order),
        "question_type": question_type,
        "text": str(question.get("text") or "").strip(),
        "topic": question.get("topic") or None,
        "required": bool(question.get("required", True)),
        "anonymity_mode": customer_surveys.normalize_question_anonymity_mode(question.get("anonymity_mode")),
        "config": question.get("config") or {},
    }


def _normalize_survey_launch_rules(
    launch_rules: Sequence[Mapping[str, Any]] | None,
    trigger_type: str | None,
    periodic_interval: str | None,
    scheduled_at: str | None,
) -> tuple[list[dict[str, Any]], str, str | None, str | None]:
    normalized_rules = customer_surveys.normalize_launch_rules(
        launch_rules,
        legacy_trigger_type=trigger_type,
        legacy_periodic_interval=periodic_interval,
        legacy_scheduled_at=scheduled_at,
    )
    legacy_trigger, legacy_interval, legacy_date = customer_surveys.derive_legacy_trigger_fields(normalized_rules)
    return normalized_rules, legacy_trigger, legacy_interval, legacy_date


def _survey_questions_changed(template_id: int, questions: Sequence[Mapping[str, Any]] | None) -> bool:
    current = [
        _normalized_survey_question_payload(question, index)
        for index, question in enumerate(get_survey_questions(template_id), start=1)
    ]
    incoming = [
        _normalized_survey_question_payload(question, index)
        for index, question in enumerate(questions or [], start=1)
        if str(question.get("text") or "").strip()
    ]
    return current != incoming

def create_survey_template(
    *,
    title: str,
    description: str = "",
    audience: str = customer_surveys.SURVEY_AUDIENCE_CLIENT,
    status: str = customer_surveys.SURVEY_STATUS_DRAFT,
    launch_rules: Sequence[Mapping[str, Any]] | None = None,
    trigger_type: str = customer_surveys.SURVEY_TRIGGER_PERIODIC,
    periodic_interval: str | None = None,
    scheduled_at: str | None = None,
    is_anonymous: bool = False,
    questions: Sequence[Mapping[str, Any]] | None = None,
    created_by: int | None = None,
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    normalized_title = title.strip()
    normalized_audience = customer_surveys.normalize_survey_audience(audience)
    if not normalized_title:
        raise ValueError("Название опроса обязательно")
    launch_rules, trigger_type, periodic_interval, scheduled_at = _normalize_survey_launch_rules(
        launch_rules,
        trigger_type,
        periodic_interval,
        scheduled_at,
    )
    with _lock:
        row = execute(
            """
            INSERT INTO survey_templates (
                title, description, audience, status, trigger_type, periodic_interval,
                scheduled_at, launch_rules, is_anonymous, created_by, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                normalized_title,
                description or "",
                normalized_audience,
                status,
                trigger_type,
                periodic_interval,
                scheduled_at,
                json.dumps(launch_rules, ensure_ascii=False),
                bool(is_anonymous),
                created_by,
                now,
                now,
            ),
        ).fetchone()
        if row is None:
            raise RuntimeError("Failed to create survey template")
        template_id = int(row["id"])
        _insert_survey_questions(template_id, questions or [], now)
    return get_survey_template(template_id) or {}


def update_survey_template(
    template_id: int,
    *,
    title: str,
    description: str = "",
    audience: str = customer_surveys.SURVEY_AUDIENCE_CLIENT,
    status: str = customer_surveys.SURVEY_STATUS_DRAFT,
    launch_rules: Sequence[Mapping[str, Any]] | None = None,
    trigger_type: str = customer_surveys.SURVEY_TRIGGER_PERIODIC,
    periodic_interval: str | None = None,
    scheduled_at: str | None = None,
    is_anonymous: bool = False,
    questions: Sequence[Mapping[str, Any]] | None = None,
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    normalized_title = title.strip()
    normalized_audience = customer_surveys.normalize_survey_audience(audience)
    if not normalized_title:
        raise ValueError("Название опроса обязательно")
    launch_rules, trigger_type, periodic_interval, scheduled_at = _normalize_survey_launch_rules(
        launch_rules,
        trigger_type,
        periodic_interval,
        scheduled_at,
    )
    with _lock:
        has_sessions = _has_survey_sessions(int(template_id))
        if has_sessions and _survey_questions_changed(int(template_id), questions):
            raise ValueError("Нельзя менять вопросы шаблона после запуска. Создайте копию шаблона и измените её.")
        row = execute(
            """
            UPDATE survey_templates
            SET title = %s, description = %s, audience = %s, status = %s, trigger_type = %s,
                periodic_interval = %s, scheduled_at = %s, launch_rules = %s, is_anonymous = %s, updated_at = %s
            WHERE id = %s
            RETURNING id
            """,
            (
                normalized_title,
                description or "",
                normalized_audience,
                status,
                trigger_type,
                periodic_interval,
                scheduled_at,
                json.dumps(launch_rules, ensure_ascii=False),
                bool(is_anonymous),
                now,
                int(template_id),
            ),
        ).fetchone()
        if row is None:
            raise ValueError("Опрос не найден")
        if not has_sessions:
            execute("DELETE FROM survey_questions WHERE template_id = %s", (int(template_id),))
            _insert_survey_questions(int(template_id), questions or [], now)
    return get_survey_template(int(template_id)) or {}

def duplicate_survey_template(template_id: int, *, created_by: int | None = None) -> Dict[str, Any]:
    template = get_survey_template(template_id)
    if not template:
        raise ValueError("Опрос не найден")
    return create_survey_template(
        title=f"{template['title']} (Копия)",
        description=template.get("description") or "",
        audience=template.get("audience") or customer_surveys.SURVEY_AUDIENCE_CLIENT,
        status=customer_surveys.SURVEY_STATUS_DRAFT,
        launch_rules=template.get("launch_rules") or [],
        trigger_type=template.get("trigger_type") or customer_surveys.SURVEY_TRIGGER_PERIODIC,
        periodic_interval=template.get("periodic_interval"),
        scheduled_at=template.get("scheduled_at"),
        is_anonymous=bool(template.get("is_anonymous", False)),
        questions=template.get("questions") or [],
        created_by=created_by,
    )


def delete_survey_template(template_id: int) -> bool:
    with _lock:
        row = execute(
            "SELECT status FROM survey_templates WHERE id = %s",
            (int(template_id),),
        ).fetchone()
        if row is None or row.get("status") != customer_surveys.SURVEY_STATUS_DRAFT:
            return False
        if _has_survey_sessions(int(template_id)):
            return False
        cursor = execute("DELETE FROM survey_templates WHERE id = %s", (int(template_id),))
    return cursor.rowcount > 0


def list_active_survey_templates(
    trigger_type: str | None = None,
    *,
    audience: str | None = None,
) -> List[Dict[str, Any]]:
    normalized_audience = customer_surveys.normalize_survey_audience(audience) if audience else None
    with _lock:
        if trigger_type and normalized_audience:
            rows = execute(
                """
                SELECT id, title, description, audience, status, trigger_type, periodic_interval,
                       scheduled_at, launch_rules, is_anonymous, created_by, created_at, updated_at
                FROM survey_templates
                WHERE status = %s AND trigger_type = %s AND audience = %s
                ORDER BY updated_at DESC, id DESC
                """,
                (customer_surveys.SURVEY_STATUS_ACTIVE, trigger_type, normalized_audience),
            ).fetchall()
        elif trigger_type:
            rows = execute(
                """
                SELECT id, title, description, audience, status, trigger_type, periodic_interval,
                       scheduled_at, launch_rules, is_anonymous, created_by, created_at, updated_at
                FROM survey_templates
                WHERE status = %s AND trigger_type = %s
                ORDER BY updated_at DESC, id DESC
                """,
                (customer_surveys.SURVEY_STATUS_ACTIVE, trigger_type),
            ).fetchall()
        elif normalized_audience:
            rows = execute(
                """
                SELECT id, title, description, audience, status, trigger_type, periodic_interval,
                       scheduled_at, launch_rules, is_anonymous, created_by, created_at, updated_at
                FROM survey_templates
                WHERE status = %s AND audience = %s
                ORDER BY updated_at DESC, id DESC
                """,
                (customer_surveys.SURVEY_STATUS_ACTIVE, normalized_audience),
            ).fetchall()
        else:
            rows = execute(
                """
                SELECT id, title, description, audience, status, trigger_type, periodic_interval,
                       scheduled_at, launch_rules, is_anonymous, created_by, created_at, updated_at
                FROM survey_templates
                WHERE status = %s
                ORDER BY updated_at DESC, id DESC
                """,
                (customer_surveys.SURVEY_STATUS_ACTIVE,),
            ).fetchall()
    return [_survey_template_from_row(row) for row in rows]


def get_survey_questions(template_id: int) -> List[Dict[str, Any]]:
    with _lock:
        rows = execute(
            """
            SELECT id, template_id, sort_order, question_type, text, topic, required, anonymity_mode,
                   config, created_at, updated_at
            FROM survey_questions
            WHERE template_id = %s
            ORDER BY sort_order ASC, id ASC
            """,
            (int(template_id),),
        ).fetchall()
    return [question for row in rows if (question := _survey_question_from_row(row)) is not None]


def get_survey_question(question_id: int) -> Dict[str, Any] | None:
    with _lock:
        row = execute(
            """
            SELECT id, template_id, sort_order, question_type, text, topic, required, anonymity_mode,
                   config, created_at, updated_at
            FROM survey_questions
            WHERE id = %s
            """,
            (int(question_id),),
        ).fetchone()
    return _survey_question_from_row(row)

def get_survey_session_operators(session_id: int) -> List[Dict[str, Any]]:
    with _lock:
        rows = execute(
            """
            SELECT id, session_id, operator_name, operator_stat_id, created_at
            FROM survey_session_operators
            WHERE session_id = %s
            ORDER BY id ASC
            """,
            (int(session_id),),
        ).fetchall()
    return [
        {
            "id": int(row["id"]),
            "session_id": int(row["session_id"]),
            "operator_name": str(row["operator_name"]),
            "operator_stat_id": int(row["operator_stat_id"]) if row.get("operator_stat_id") is not None else None,
            "created_at": row.get("created_at"),
        }
        for row in rows
    ]


def operator_csats_complete(dialog_id: int, appeal_id: int | None = None) -> bool:
    targets = list_operator_rating_targets(int(dialog_id), appeal_id)
    if not targets:
        return False
    for target in targets:
        rating = get_operator_csat_for_operator(
            dialog_id=int(target["dialog_id"]),
            appeal_id=int(target["appeal_id"]) if target.get("appeal_id") is not None else None,
            operator_name=str(target["operator_name"]),
        )
        if rating is None:
            return False
    return True


def survey_session_exists(template_id: int, dialog_id: int | None, appeal_id: int | None = None, trigger_source: str | None = None) -> bool:
    with _lock:
        trigger_clause = " AND trigger_source = %s" if trigger_source else ""
        if appeal_id is not None:
            params: list[Any] = [int(template_id), int(appeal_id)]
            if trigger_source:
                params.append(trigger_source)
            row = execute(
                f"SELECT 1 FROM survey_sessions WHERE template_id = %s AND appeal_id = %s{trigger_clause} LIMIT 1",
                params,
            ).fetchone()
        elif dialog_id is not None:
            params = [int(template_id), int(dialog_id)]
            if trigger_source:
                params.append(trigger_source)
            row = execute(
                f"SELECT 1 FROM survey_sessions WHERE template_id = %s AND dialog_id = %s AND appeal_id IS NULL{trigger_clause} LIMIT 1",
                params,
            ).fetchone()
        else:
            return False
    return row is not None

def start_survey_session(
    *,
    template_id: int,
    chat_id: int,
    dialog_id: int | None,
    appeal_id: int | None = None,
    trigger_source: str = customer_surveys.SURVEY_TRIGGER_MANUAL,
) -> Dict[str, Any] | None:
    template = get_survey_template(int(template_id))
    if not template or template.get("status") != customer_surveys.SURVEY_STATUS_ACTIVE:
        return None
    questions = template.get("questions") or []
    periodic_trigger = trigger_source if str(trigger_source).startswith(f"{customer_surveys.SURVEY_TRIGGER_PERIODIC}:") else None
    if not questions or survey_session_exists(int(template_id), dialog_id, appeal_id, trigger_source=periodic_trigger):
        return None
    chat = get_chat(int(chat_id))
    dialog = get_chat_dialog(int(dialog_id)) if dialog_id is not None else None
    bin_value = (dialog or {}).get("bin") or (chat or {}).get("bin")
    now = datetime.now(timezone.utc).isoformat()
    first_question_id = int(questions[0]["id"])
    with _lock:
        row = execute(
            """
            INSERT INTO survey_sessions (
                template_id, chat_id, dialog_id, appeal_id, bin, status,
                trigger_source, current_question_id, is_anonymous,
                started_at, completed_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULL, %s)
            RETURNING id
            """,
            (
                int(template_id), int(chat_id), int(dialog_id) if dialog_id is not None else None,
                int(appeal_id) if appeal_id is not None else None, bin_value,
                customer_surveys.SESSION_STATUS_CURRENT, trigger_source, first_question_id,
                bool(template.get("is_anonymous", False)), now, now,
            ),
        ).fetchone()
        if row is None:
            return None
        session_id = int(row["id"])
        operators = list_operator_rating_targets(int(dialog_id), appeal_id) if dialog_id is not None else []
        if not operators and bin_value:
            operators = get_bin_interacted_employees(str(bin_value))
        seen: set[str] = set()
        for operator in operators:
            operator_name = str(operator.get("operator_name") or "").strip()
            if not operator_name or operator_name.lower() in seen:
                continue
            seen.add(operator_name.lower())
            execute(
                """
                INSERT INTO survey_session_operators (session_id, operator_name, operator_stat_id, created_at)
                VALUES (%s, %s, %s, %s)
                """,
                (session_id, operator_name, int(operator["id"]) if operator.get("id") is not None else None, now),
            )
    return get_survey_session(session_id)


def get_survey_session(session_id: int) -> Dict[str, Any] | None:
    with _lock:
        row = execute(
            """
            SELECT id, template_id, chat_id, dialog_id, appeal_id, bin, status,
                   trigger_source, current_question_id, is_anonymous,
                   started_at, completed_at, updated_at
            FROM survey_sessions
            WHERE id = %s
            """,
            (int(session_id),),
        ).fetchone()
    return _survey_session_from_row(row)


def get_active_survey_session(chat_id: int) -> Dict[str, Any] | None:
    with _lock:
        row = execute(
            """
            SELECT id, template_id, chat_id, dialog_id, appeal_id, bin, status,
                   trigger_source, current_question_id, is_anonymous,
                   started_at, completed_at, updated_at
            FROM survey_sessions
            WHERE chat_id = %s AND status IN (%s, %s, %s)
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
            """,
            (int(chat_id), customer_surveys.SESSION_STATUS_STARTED, customer_surveys.SESSION_STATUS_CURRENT, customer_surveys.SESSION_STATUS_ANSWER_SAVED),
        ).fetchone()
    return _survey_session_from_row(row)

def save_survey_answer(
    *,
    session_id: int,
    question: Mapping[str, Any],
    answer: customer_surveys.SurveyAnswerParseResult,
) -> Dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    session = get_survey_session(int(session_id))
    effective_is_anonymous = customer_surveys.effective_question_anonymity(
        question,
        template_is_anonymous=bool((session or {}).get("is_anonymous", False)),
    )
    with _lock:
        row = execute(
            """
            INSERT INTO survey_answers (
                session_id, question_id, question_type, topic, numeric_score,
                raw_text, selected_options, selected_employee_name, effective_is_anonymous, created_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, session_id, question_id, question_type, topic, numeric_score,
                      raw_text, selected_options, selected_employee_name, effective_is_anonymous, created_at
            """,
            (
                int(session_id), int(question["id"]), str(question["question_type"]), question.get("topic"),
                answer.numeric_score, answer.raw_text, json.dumps(answer.selected_options or [], ensure_ascii=False),
                answer.selected_employee_name, effective_is_anonymous, now,
            ),
        ).fetchone()
        execute(
            "UPDATE survey_sessions SET status = %s, updated_at = %s WHERE id = %s",
            (customer_surveys.SESSION_STATUS_ANSWER_SAVED, now, int(session_id)),
        )
    if row is None:
        raise RuntimeError("Failed to save survey answer")
    return {
        "id": int(row["id"]),
        "session_id": int(row["session_id"]),
        "question_id": int(row["question_id"]),
        "question_type": row["question_type"],
        "topic": row["topic"],
        "numeric_score": float(row["numeric_score"]) if row.get("numeric_score") is not None else None,
        "raw_text": row["raw_text"],
        "selected_options": _json_loads(row.get("selected_options"), []),
        "selected_employee_name": row.get("selected_employee_name"),
        "effective_is_anonymous": bool(row.get("effective_is_anonymous")),
        "created_at": row["created_at"],
    }


def advance_survey_session(session_id: int) -> Dict[str, Any] | None:
    session = get_survey_session(int(session_id))
    if not session:
        return None
    questions = session.get("questions") or []
    current_id = session.get("current_question_id")
    next_question_id: int | None = None
    for index, question in enumerate(questions):
        if question["id"] == current_id and index + 1 < len(questions):
            next_question_id = int(questions[index + 1]["id"])
            break
    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        if next_question_id is None:
            execute(
                """
                UPDATE survey_sessions
                SET status = %s, current_question_id = NULL, completed_at = %s, updated_at = %s
                WHERE id = %s
                """,
                (customer_surveys.SESSION_STATUS_COMPLETED, now, now, int(session_id)),
            )
            return None
        execute(
            """
            UPDATE survey_sessions
            SET status = %s, current_question_id = %s, updated_at = %s
            WHERE id = %s
            """,
            (customer_surveys.SESSION_STATUS_CURRENT, next_question_id, now, int(session_id)),
        )
    return get_survey_session(int(session_id))


def complete_survey_session(session_id: int) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with _lock:
        execute(
            """
            UPDATE survey_sessions
            SET status = %s, current_question_id = NULL, completed_at = COALESCE(completed_at, %s), updated_at = %s
            WHERE id = %s
            """,
            (customer_surveys.SESSION_STATUS_COMPLETED, now, now, int(session_id)),
        )


def resolve_survey_manual_targets(
    *,
    bin_values: Sequence[str] | None = None,
    dialog_ids: Sequence[int] | None = None,
    limit: int = 200,
    only_closed: bool = False,
) -> List[Dict[str, Any]]:
    targets: Dict[tuple[int, int | None], Dict[str, Any]] = {}
    with _lock:
        if dialog_ids:
            ids = [int(value) for value in dialog_ids if int(value) > 0]
            if ids:
                placeholders = ",".join("%s" for _ in ids)
                closed_clause = " AND cd.ended_at IS NOT NULL AND TRIM(cd.ended_at) <> ''" if only_closed else ""
                rows = execute(
                    f"""
                    SELECT cd.id AS dialog_id, cd.chat_id, cd.bin, a.id AS appeal_id
                    FROM chat_dialogs cd
                    LEFT JOIN LATERAL (
                        SELECT id FROM appeals a WHERE a.dialog_id = cd.id
                        ORDER BY COALESCE(a.ended_at, a.started_at) DESC, a.id DESC LIMIT 1
                    ) a ON TRUE
                    WHERE cd.id IN ({placeholders}){closed_clause}
                    """,
                    ids,
                ).fetchall()
                for row in rows:
                    targets[(int(row["chat_id"]), int(row["dialog_id"]))] = {
                        "chat_id": int(row["chat_id"]), "dialog_id": int(row["dialog_id"]),
                        "appeal_id": int(row["appeal_id"]) if row.get("appeal_id") is not None else None,
                        "bin": row.get("bin"),
                    }
        bins = sorted({str(value).strip() for value in (bin_values or []) if str(value).strip()})
        if bins:
            placeholders = ",".join("%s" for _ in bins)
            closed_clause = " AND cd.ended_at IS NOT NULL AND TRIM(cd.ended_at) <> ''" if only_closed else ""
            rows = execute(
                f"""
                SELECT DISTINCT ON (cd.bin) cd.id AS dialog_id, cd.chat_id, cd.bin, a.id AS appeal_id
                FROM chat_dialogs cd
                LEFT JOIN LATERAL (
                    SELECT id FROM appeals a WHERE a.dialog_id = cd.id
                    ORDER BY COALESCE(a.ended_at, a.started_at) DESC, a.id DESC LIMIT 1
                ) a ON TRUE
                WHERE cd.bin IN ({placeholders}){closed_clause}
                ORDER BY cd.bin ASC, cd.last_message_at DESC NULLS LAST, cd.id DESC
                """,
                bins,
            ).fetchall()
        elif not dialog_ids:
            closed_clause = " AND cd.ended_at IS NOT NULL AND TRIM(cd.ended_at) <> ''" if only_closed else ""
            rows = execute(
                """
                SELECT DISTINCT ON (cd.chat_id, cd.bin) cd.id AS dialog_id, cd.chat_id, cd.bin, a.id AS appeal_id
                FROM chat_dialogs cd
                LEFT JOIN LATERAL (
                    SELECT id FROM appeals a WHERE a.dialog_id = cd.id
                    ORDER BY COALESCE(a.ended_at, a.started_at) DESC, a.id DESC LIMIT 1
                ) a ON TRUE
                WHERE cd.bin IS NOT NULL AND TRIM(cd.bin) <> ''{closed_clause}
                ORDER BY cd.chat_id ASC, cd.bin ASC, cd.last_message_at DESC NULLS LAST, cd.id DESC
                LIMIT %s
                """.format(closed_clause=closed_clause),
                (int(limit),),
            ).fetchall()
        else:
            rows = []
        for row in rows:
            targets[(int(row["chat_id"]), int(row["dialog_id"]))] = {
                "chat_id": int(row["chat_id"]), "dialog_id": int(row["dialog_id"]),
                "appeal_id": int(row["appeal_id"]) if row.get("appeal_id") is not None else None,
                "bin": row.get("bin"),
            }
    return list(targets.values())


def list_survey_sessions(limit: int = 100) -> List[Dict[str, Any]]:
    with _lock:
        rows = execute(
            """
            SELECT id, template_id, chat_id, dialog_id, appeal_id, bin, status,
                   trigger_source, current_question_id, is_anonymous,
                   started_at, completed_at, updated_at
            FROM survey_sessions
            ORDER BY updated_at DESC, id DESC
            LIMIT %s
            """,
            (int(limit),),
        ).fetchall()
    return [_survey_session_from_row(row, include_children=False) for row in rows]


def _current_survey_question_keys_for_analytics(
    *,
    audience: str,
    template_id: int | None = None,
) -> set[tuple[str, str, str]]:
    if template_id:
        rows = execute(
            """
            SELECT id AS question_id, text AS question_text, question_type, topic
            FROM survey_questions
            WHERE template_id = %s
            """,
            (int(template_id),),
        ).fetchall()
    else:
        rows = execute(
            """
            SELECT sq.id AS question_id, sq.text AS question_text, sq.question_type, sq.topic
            FROM survey_questions sq
            JOIN survey_templates st ON st.id = sq.template_id
            WHERE st.audience = %s
              AND st.status = %s
            """,
            (audience, customer_surveys.SURVEY_STATUS_ACTIVE),
        ).fetchall()
    return {survey_analytics.question_group_key(row) for row in rows or []}


def get_survey_analytics(
    *,
    audience: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    operator_name: str | None = None,
    bin_value: str | None = None,
    region: str | None = None,
    topic: str | None = None,
    template_id: int | None = None,
    section: str | None = None,
) -> Dict[str, Any]:
    normalized_audience = customer_surveys.normalize_survey_audience(audience)
    where = ["ss.status = %s", "st.audience = %s"]
    params: List[Any] = ["completed", normalized_audience]
    if start_date:
        where.append("sa.created_at >= %s")
        params.append(start_date.isoformat())
    if end_date:
        where.append("sa.created_at < %s")
        params.append((end_date + timedelta(days=1)).isoformat())
    if operator_name:
        where.append(
            """
            EXISTS (
                SELECT 1
                FROM survey_session_operators sso2
                LEFT JOIN dialog_operator_stats dos2 ON dos2.id = sso2.operator_stat_id
                WHERE sso2.session_id = ss.id
                  AND COALESCE(dos2.operator_name, sso2.operator_name) = %s
            )
            """
        )
        params.append(operator_name)
    if bin_value:
        where.append("ss.bin = %s")
        params.append(bin_value)
    if region:
        where.append("COALESCE(owc.customer_legal_address, '') ILIKE %s")
        params.append(f"%{region}%")
    if topic:
        where.append("sa.topic = %s")
        params.append(topic)
    if template_id:
        where.append("ss.template_id = %s")
        params.append(int(template_id))
    if section:
        where.append("COALESCE(a.section, cd.section, c.section) = %s")
        params.append(section)

    sql_query = f"""
        SELECT
            sa.id, sa.session_id, sa.question_id, sa.question_type, sa.topic,
            sa.numeric_score, sa.raw_text, sa.selected_options,
            sa.selected_employee_name, sa.effective_is_anonymous, sa.created_at,
            sq.text AS question_text, sq.sort_order AS question_sort_order, sq.config AS question_config,
            st.id AS template_id, st.title AS template_title,
            ss.chat_id, ss.dialog_id, ss.appeal_id, ss.bin, ss.is_anonymous,
            ss.trigger_source, ss.status AS session_status,
            COALESCE(a.section, cd.section, c.section) AS dialog_section,
            c.title AS chat_title,
            owc.customer_name_ru,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT COALESCE(dos.operator_name, sso.operator_name)), NULL) AS operators
        FROM survey_answers sa
        JOIN survey_sessions ss ON ss.id = sa.session_id
        JOIN survey_questions sq ON sq.id = sa.question_id
        JOIN survey_templates st ON st.id = ss.template_id
        LEFT JOIN appeals a ON a.id = ss.appeal_id
        LEFT JOIN chat_dialogs cd ON cd.id = ss.dialog_id
        LEFT JOIN chats c ON c.chat_id = ss.chat_id
        LEFT JOIN organizations_without_contracts owc ON owc.customer_bin = ss.bin
        LEFT JOIN survey_session_operators sso ON sso.session_id = ss.id
        LEFT JOIN dialog_operator_stats dos ON dos.id = sso.operator_stat_id
        WHERE {' AND '.join(where)}
        GROUP BY
            sa.id,
            sq.text,
            sq.sort_order,
            sq.config,
            st.id,
            st.title,
            ss.id,
            a.section,
            cd.section,
            c.section,
            c.title,
            owc.customer_name_ru
        ORDER BY sa.created_at DESC, sa.id DESC
    """
    client_requests: Dict[str, int] = {}
    training_labels: Dict[str, int] = {}
    employee_remarks: Dict[str, int] = {}
    answers: List[Dict[str, Any]] = []
    answers_total_count = 0
    completed_session_ids: set[int] = set()
    score_rows: List[Dict[str, Any]] = []
    question_rows: List[Dict[str, Any]] = []

    with _lock:
        allowed_question_keys = _current_survey_question_keys_for_analytics(
            audience=normalized_audience,
            template_id=template_id,
        )
        cursor = execute(sql_query, params)
        while True:
            rows = cursor.fetchmany(SURVEY_ANALYTICS_FETCH_BATCH_SIZE)
            if not rows:
                break
            for row in rows:
                if survey_analytics.is_completed_session_status(row.get("session_status")):
                    completed_session_ids.add(int(row["session_id"]))
                score = float(row["numeric_score"]) if row.get("numeric_score") is not None else None
                if score is not None:
                    score_rows.append(
                        {
                            "session_id": int(row["session_id"]),
                            "session_status": row.get("session_status"),
                            "numeric_score": score,
                            "created_at": row.get("created_at"),
                        }
                    )
                config = _json_loads(row.get("question_config"), {})
                options = customer_surveys.normalize_options(config if isinstance(config, Mapping) else {})
                by_id = {str(option["id"]): str(option["label"]) for option in options}
                selected_options = _json_loads(row.get("selected_options"), [])
                question_rows.append(
                    {
                        "question_id": int(row["question_id"]),
                        "question_text": row["question_text"],
                        "question_type": row["question_type"],
                        "topic": row["topic"],
                        "sort_order": int(row.get("question_sort_order") or 0),
                        "numeric_score": score,
                        "raw_text": row.get("raw_text"),
                        "selected_options": selected_options if isinstance(selected_options, list) else [],
                        "selected_employee_name": row.get("selected_employee_name"),
                        "option_labels_by_id": by_id,
                    }
                )
                topic_key = str(row.get("topic") or "")
                raw_text = str(row.get("raw_text") or "").strip()
                if topic_key == "support_improvements" and raw_text:
                    client_requests[raw_text] = client_requests.get(raw_text, 0) + 1
                if isinstance(selected_options, list):
                    for option_id in selected_options:
                        label = by_id.get(str(option_id), str(option_id))
                        if topic_key in {"seminars", "webinars", "instructions"} or str(option_id) in {"seminars", "webinars", "instructions", "videos"}:
                            training_labels[label] = training_labels.get(label, 0) + 1
                        elif label:
                            client_requests[label] = client_requests.get(label, 0) + 1
                if row.get("selected_employee_name"):
                    name = str(row["selected_employee_name"])
                    employee_remarks[name] = employee_remarks.get(name, 0) + 1

                answers_total_count += 1
                if len(answers) >= SURVEY_ANALYTICS_ANSWERS_PREVIEW_LIMIT:
                    continue

                anonymous = bool(row.get("effective_is_anonymous", row.get("is_anonymous", False)))
                answers.append(
                    {
                        "id": int(row["id"]),
                        "session_id": int(row["session_id"]),
                        "template_id": int(row["template_id"]),
                        "template_title": row["template_title"],
                        "question_id": int(row["question_id"]),
                        "question_text": row["question_text"],
                        "question_type": row["question_type"],
                        "topic": row["topic"],
                        "numeric_score": score,
                        "raw_text": row["raw_text"],
                        "selected_options": selected_options if isinstance(selected_options, list) else [],
                        "selected_employee_name": row.get("selected_employee_name"),
                        "created_at": row["created_at"],
                        "chat_id": None if anonymous else int(row["chat_id"]),
                        "dialog_id": None if anonymous else (int(row["dialog_id"]) if row.get("dialog_id") is not None else None),
                        "appeal_id": None if anonymous else (int(row["appeal_id"]) if row.get("appeal_id") is not None else None),
                        "bin": None if anonymous else row.get("bin"),
                        "organization": None if anonymous else row.get("customer_name_ru"),
                        "chat_title": None if anonymous else row.get("chat_title"),
                        "operators": list(row.get("operators") or []),
                        "is_anonymous": anonymous,
                        "section": row.get("dialog_section"),
                    }
                )

    def top_items(source: Dict[str, int], limit: int = 10) -> List[Dict[str, Any]]:
        return [{"label": label, "count": count} for label, count in sorted(source.items(), key=lambda item: (-item[1], item[0]))[:limit]]

    score_summary = survey_analytics.summarize_completed_survey_scores(score_rows)

    return {
        "average_score": score_summary["average_score"],
        "completed_survey_count": len(completed_session_ids),
        "answer_count": answers_total_count,
        "score_count": score_summary["score_count"],
        "positive_count": score_summary["positive_count"],
        "neutral_count": score_summary["neutral_count"],
        "negative_count": score_summary["negative_count"],
        "positive_share": score_summary["positive_share"],
        "neutral_share": score_summary["neutral_share"],
        "negative_share": score_summary["negative_share"],
        "top_client_requests": top_items(client_requests),
        "top_training_wishes": top_items(training_labels),
        "employee_remarks": top_items(employee_remarks),
        "question_analytics": survey_analytics.summarize_question_analytics(
            question_rows,
            allowed_question_keys=allowed_question_keys,
        ),
        "monthly_satisfaction": score_summary["monthly_satisfaction"],
        "answers": answers,
        "answers_total_count": answers_total_count,
        "answers_preview_limited": answers_total_count > len(answers),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _repair_optional_text(value: Any) -> str | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    if not text:
        return None
    return repair_text(text)


def _safe_int(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _safe_float(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _normalize_lookup_value(value: str | None) -> str:
    return (value or "").strip().lower()


def _casefold_contains(value: str | None, expected: str | None) -> bool:
    if not expected:
        return True
    return _normalize_lookup_value(expected) in _normalize_lookup_value(value)


def _month_bucket(value: str | None) -> str | None:
    parsed = _parse_datetime(value)
    if parsed is None:
        return None
    return parsed.strftime("%Y-%m")


def _make_rating_record(
    *,
    rating_id: int,
    source_table: str,
    source_kind: str,
    appeal_id: int | None,
    dialog_id: int | None,
    chat_id: int | None,
    client_id: int | None,
    client_bin: str | None,
    client_name: str | None,
    organization: str | None,
    section: str | None,
    region: str | None,
    rater_type: str,
    rater_id: str | None,
    rater_name: str | None,
    rated_object_type: str,
    rated_object_id: str | None,
    rated_object_name: str | None,
    employee_id: int | None,
    employee_name: str | None,
    rating_channel: str | None,
    ai_involved: bool,
    final_score: float | None,
    comment: str | None,
    low_score_reason: str | None,
    parameter_details: Mapping[str, Any],
    created_at: str,
    status: str,
    scenario: str | None = None,
) -> Dict[str, Any]:
    return {
        "rating_id": rating_id,
        "source_table": source_table,
        "source_kind": source_kind,
        "appeal_id": appeal_id,
        "dialog_id": dialog_id,
        "chat_id": chat_id,
        "client_id": client_id,
        "client_bin": client_bin,
        "client_name": client_name,
        "organization": organization,
        "section": section,
        "region": region,
        "rater_type": rater_type,
        "rater_id": rater_id,
        "rater_name": rater_name,
        "rated_object_type": rated_object_type,
        "rated_object_id": rated_object_id,
        "rated_object_name": rated_object_name,
        "employee_id": employee_id,
        "employee_name": employee_name,
        "rating_channel": rating_channel,
        "ai_involved": bool(ai_involved),
        "final_score": final_score,
        "comment": comment,
        "low_score_reason": low_score_reason,
        "parameter_details": dict(parameter_details),
        "created_at": created_at,
        "status": status,
        "scenario": scenario,
    }


def _load_operator_csat_ledger_rows() -> List[Dict[str, Any]]:
    with _lock:
        rows = execute(
            """
            SELECT
                ocr.id,
                ocr.dialog_id,
                ocr.appeal_id,
                cd.chat_id,
                COALESCE(ocr.rater_chat_id, cd.chat_id) AS client_id,
                COALESCE(NULLIF(TRIM(cd.bin), ''), NULLIF(TRIM(c.bin), '')) AS client_bin,
                COALESCE(NULLIF(TRIM(ocr.rater_name), ''), NULLIF(TRIM(c.title), '')) AS client_name,
                owc.customer_name_ru AS organization,
                owc.customer_legal_address AS region,
                COALESCE(a.section, cd.section, c.section, ds.section) AS section,
                ocr.rater_type,
                ocr.rater_chat_id,
                ocr.rater_external_chat_id,
                ocr.rater_name,
                u.id AS employee_id,
                ocr.operator_name AS employee_name,
                ocr.rated_object_type,
                ocr.rated_object_id,
                ocr.rated_object_name,
                ocr.channel,
                (
                    COALESCE(ocr.ai_involved, FALSE)
                    OR COALESCE(ds.ai_messages_count, 0) > 0
                    OR COALESCE(ds.is_ai_closed, FALSE)
                ) AS ai_involved,
                ocr.rating,
                ocr.comment,
                ocr.low_score_reason,
                ocr.created_at
            FROM operator_csat_ratings ocr
            LEFT JOIN chat_dialogs cd ON cd.id = ocr.dialog_id
            LEFT JOIN chats c ON c.chat_id = cd.chat_id
            LEFT JOIN appeals a ON a.id = ocr.appeal_id
            LEFT JOIN organizations_without_contracts owc
              ON owc.customer_bin = COALESCE(NULLIF(TRIM(cd.bin), ''), NULLIF(TRIM(c.bin), ''))
            LEFT JOIN dialog_stats ds
              ON (
                (ocr.appeal_id IS NOT NULL AND ds.appeal_id = ocr.appeal_id)
                OR (ocr.appeal_id IS NULL AND ds.dialog_id = ocr.dialog_id AND ds.appeal_id IS NULL)
              )
            LEFT JOIN users u
              ON LOWER(TRIM(u.name)) = LOWER(TRIM(ocr.operator_name))
            ORDER BY ocr.created_at DESC, ocr.id DESC
            """
        ).fetchall()
    items: List[Dict[str, Any]] = []
    for row in rows or []:
        items.append(
            _make_rating_record(
                rating_id=int(row["id"]),
                source_table="operator_csat_ratings",
                source_kind="client_to_employee",
                appeal_id=_safe_int(row.get("appeal_id")),
                dialog_id=_safe_int(row.get("dialog_id")),
                chat_id=_safe_int(row.get("chat_id")),
                client_id=_safe_int(row.get("client_id")),
                client_bin=_repair_optional_text(row.get("client_bin")),
                client_name=_repair_optional_text(row.get("client_name")),
                organization=_repair_optional_text(row.get("organization")),
                section=_repair_optional_text(row.get("section")),
                region=_repair_optional_text(row.get("region")),
                rater_type=str(row.get("rater_type") or RATING_RATER_TYPE_CLIENT),
                rater_id=(
                    str(_safe_int(row.get("rater_chat_id")))
                    if _safe_int(row.get("rater_chat_id")) is not None
                    else _repair_optional_text(row.get("rater_external_chat_id"))
                ),
                rater_name=_repair_optional_text(row.get("rater_name")) or _repair_optional_text(row.get("client_name")),
                rated_object_type=str(row.get("rated_object_type") or RATING_OBJECT_TYPE_EMPLOYEE),
                rated_object_id=_repair_optional_text(row.get("rated_object_id")) or (
                    str(_safe_int(row.get("employee_id"))) if _safe_int(row.get("employee_id")) is not None else None
                ),
                rated_object_name=_repair_optional_text(row.get("rated_object_name")) or _repair_optional_text(row.get("employee_name")),
                employee_id=_safe_int(row.get("employee_id")),
                employee_name=_repair_optional_text(row.get("employee_name")),
                rating_channel=_repair_optional_text(row.get("channel")),
                ai_involved=bool(row.get("ai_involved")),
                final_score=_safe_float(row.get("rating")),
                comment=_repair_optional_text(row.get("comment")),
                low_score_reason=_repair_optional_text(row.get("low_score_reason")),
                parameter_details={"rating": _safe_float(row.get("rating"))},
                created_at=str(row.get("created_at") or ""),
                status="recorded",
            )
        )
    return items


def _classify_ai_scenario(operator_names: Sequence[str] | None, ai_involved: bool) -> str:
    has_human_operator = any(is_human_operator_name(str(name or "")) for name in (operator_names or []))
    if ai_involved and has_human_operator:
        return "employee_with_ai"
    if ai_involved:
        return "ai_without_employee"
    return "human_without_ai"


def _load_dialog_feedback_ledger_rows() -> List[Dict[str, Any]]:
    with _lock:
        rows = execute(
            """
            SELECT
                dfr.id,
                dfr.dialog_id,
                dfr.appeal_id,
                dfr.rating_kind,
                cd.chat_id,
                COALESCE(dfr.rater_chat_id, cd.chat_id) AS client_id,
                COALESCE(NULLIF(TRIM(cd.bin), ''), NULLIF(TRIM(c.bin), '')) AS client_bin,
                COALESCE(NULLIF(TRIM(dfr.rater_name), ''), NULLIF(TRIM(c.title), '')) AS client_name,
                owc.customer_name_ru AS organization,
                owc.customer_legal_address AS region,
                COALESCE(a.section, cd.section, c.section, ds.section) AS section,
                dfr.rater_type,
                dfr.rater_chat_id,
                dfr.rater_external_chat_id,
                dfr.rater_name,
                dfr.rated_object_type,
                dfr.rated_object_id,
                dfr.rated_object_name,
                dfr.channel,
                (
                    COALESCE(dfr.ai_involved, FALSE)
                    OR COALESCE(ds.ai_messages_count, 0) > 0
                    OR COALESCE(ds.is_ai_closed, FALSE)
                ) AS ai_involved,
                dfr.rating,
                dfr.comment,
                dfr.low_score_reason,
                dfr.created_at,
                (
                    SELECT ARRAY_REMOVE(ARRAY_AGG(DISTINCT dos.operator_name), NULL)
                    FROM dialog_operator_stats dos
                    WHERE (
                        (dfr.appeal_id IS NOT NULL AND dos.appeal_id = dfr.appeal_id)
                        OR (dfr.appeal_id IS NULL AND dos.dialog_id = dfr.dialog_id AND dos.appeal_id IS NULL)
                    )
                ) AS operator_names
            FROM dialog_feedback_ratings dfr
            LEFT JOIN chat_dialogs cd ON cd.id = dfr.dialog_id
            LEFT JOIN chats c ON c.chat_id = cd.chat_id
            LEFT JOIN appeals a ON a.id = dfr.appeal_id
            LEFT JOIN organizations_without_contracts owc
              ON owc.customer_bin = COALESCE(NULLIF(TRIM(cd.bin), ''), NULLIF(TRIM(c.bin), ''))
            LEFT JOIN dialog_stats ds
              ON (
                (dfr.appeal_id IS NOT NULL AND ds.appeal_id = dfr.appeal_id)
                OR (dfr.appeal_id IS NULL AND ds.dialog_id = dfr.dialog_id AND ds.appeal_id IS NULL)
              )
            ORDER BY dfr.updated_at DESC, dfr.created_at DESC, dfr.id DESC
            """
        ).fetchall()
    items: List[Dict[str, Any]] = []
    for row in rows or []:
        rating_kind = str(row.get("rating_kind") or "")
        ai_involved = bool(row.get("ai_involved"))
        items.append(
            _make_rating_record(
                rating_id=int(row["id"]),
                source_table="dialog_feedback_ratings",
                source_kind="client_to_ai" if rating_kind == DIALOG_FEEDBACK_KIND_AI else "client_to_appeal",
                appeal_id=_safe_int(row.get("appeal_id")),
                dialog_id=_safe_int(row.get("dialog_id")),
                chat_id=_safe_int(row.get("chat_id")),
                client_id=_safe_int(row.get("client_id")),
                client_bin=_repair_optional_text(row.get("client_bin")),
                client_name=_repair_optional_text(row.get("client_name")),
                organization=_repair_optional_text(row.get("organization")),
                section=_repair_optional_text(row.get("section")),
                region=_repair_optional_text(row.get("region")),
                rater_type=str(row.get("rater_type") or RATING_RATER_TYPE_CLIENT),
                rater_id=(
                    str(_safe_int(row.get("rater_chat_id")))
                    if _safe_int(row.get("rater_chat_id")) is not None
                    else _repair_optional_text(row.get("rater_external_chat_id"))
                ),
                rater_name=_repair_optional_text(row.get("rater_name")) or _repair_optional_text(row.get("client_name")),
                rated_object_type=str(row.get("rated_object_type") or (RATING_OBJECT_TYPE_AI if rating_kind == DIALOG_FEEDBACK_KIND_AI else RATING_OBJECT_TYPE_APPEAL)),
                rated_object_id=_repair_optional_text(row.get("rated_object_id")),
                rated_object_name=_repair_optional_text(row.get("rated_object_name")),
                employee_id=None,
                employee_name=None,
                rating_channel=_repair_optional_text(row.get("channel")),
                ai_involved=ai_involved,
                final_score=_safe_float(row.get("rating")),
                comment=_repair_optional_text(row.get("comment")),
                low_score_reason=_repair_optional_text(row.get("low_score_reason")),
                parameter_details={"rating": _safe_float(row.get("rating"))},
                created_at=str(row.get("created_at") or ""),
                status="recorded",
                scenario=_classify_ai_scenario(row.get("operator_names") or [], ai_involved),
            )
        )
    return items


def _load_employee_client_assessment_ledger_rows() -> List[Dict[str, Any]]:
    with _lock:
        rows = execute(
            """
            SELECT
                eca.id,
                eca.dialog_id,
                eca.appeal_id,
                eca.chat_id,
                eca.client_id,
                eca.client_bin,
                eca.client_name,
                eca.assigned_user_id,
                eca.assigned_user_name,
                owc.customer_name_ru AS organization,
                owc.customer_legal_address AS region,
                COALESCE(a.section, cd.section, c.section) AS section,
                eca.ai_assisted,
                eca.question_clarity_score,
                eca.data_completeness_score,
                eca.client_response_speed_score,
                eca.business_communication_score,
                eca.client_readiness_score,
                eca.overall_score,
                eca.interaction_quality_index,
                eca.low_score_reason,
                eca.internal_comment,
                eca.interaction_status,
                eca.request_repeat_status,
                eca.interaction_flag,
                eca.repeated_request,
                eca.first_contact,
                eca.client_data_overdue,
                eca.hindered_by_client,
                eca.without_clarifications,
                eca.first_time_full_data,
                eca.client_feedback_delay_hours,
                eca.status,
                COALESCE(eca.submitted_at, eca.updated_at, eca.created_at) AS created_at
            FROM employee_client_assessments eca
            LEFT JOIN appeals a ON a.id = eca.appeal_id
            LEFT JOIN chat_dialogs cd ON cd.id = eca.dialog_id
            LEFT JOIN chats c ON c.chat_id = eca.chat_id
            LEFT JOIN organizations_without_contracts owc ON owc.customer_bin = eca.client_bin
            WHERE eca.status = %s
            ORDER BY COALESCE(eca.submitted_at, eca.updated_at, eca.created_at) DESC, eca.id DESC
            """,
            (employee_client_assessments.ASSESSMENT_STATUS_SUBMITTED,),
        ).fetchall()
    items: List[Dict[str, Any]] = []
    for row in rows or []:
        items.append(
            _make_rating_record(
                rating_id=int(row["id"]),
                source_table="employee_client_assessments",
                source_kind="employee_to_client",
                appeal_id=_safe_int(row.get("appeal_id")),
                dialog_id=_safe_int(row.get("dialog_id")),
                chat_id=_safe_int(row.get("chat_id")),
                client_id=_safe_int(row.get("client_id")) or _safe_int(row.get("chat_id")),
                client_bin=_repair_optional_text(row.get("client_bin")),
                client_name=_repair_optional_text(row.get("client_name")),
                organization=_repair_optional_text(row.get("organization")),
                section=_repair_optional_text(row.get("section")),
                region=_repair_optional_text(row.get("region")),
                rater_type=RATING_RATER_TYPE_EMPLOYEE,
                rater_id=str(_safe_int(row.get("assigned_user_id"))) if _safe_int(row.get("assigned_user_id")) is not None else None,
                rater_name=_repair_optional_text(row.get("assigned_user_name")),
                rated_object_type=RATING_OBJECT_TYPE_CLIENT,
                rated_object_id=(
                    str(_safe_int(row.get("client_id")))
                    if _safe_int(row.get("client_id")) is not None
                    else _repair_optional_text(row.get("client_bin"))
                ),
                rated_object_name=_repair_optional_text(row.get("client_name")),
                employee_id=_safe_int(row.get("assigned_user_id")),
                employee_name=_repair_optional_text(row.get("assigned_user_name")),
                rating_channel=RATING_CHANNEL_WEBAPP,
                ai_involved=bool(row.get("ai_assisted")),
                final_score=_safe_float(row.get("overall_score")),
                comment=_repair_optional_text(row.get("internal_comment")),
                low_score_reason=_repair_optional_text(row.get("low_score_reason")),
                parameter_details={
                    "question_clarity_score": _safe_int(row.get("question_clarity_score")),
                    "data_completeness_score": _safe_int(row.get("data_completeness_score")),
                    "client_response_speed_score": _safe_int(row.get("client_response_speed_score")),
                    "business_communication_score": _safe_int(row.get("business_communication_score")),
                    "client_readiness_score": _safe_int(row.get("client_readiness_score")),
                    "interaction_quality_index": _safe_float(row.get("interaction_quality_index")),
                    "interaction_status": row.get("interaction_status"),
                    "request_repeat_status": row.get("request_repeat_status"),
                    "interaction_flag": row.get("interaction_flag"),
                    "repeated_request": bool(row.get("repeated_request")),
                    "first_contact": bool(row.get("first_contact")),
                    "client_data_overdue": bool(row.get("client_data_overdue")),
                    "hindered_by_client": bool(row.get("hindered_by_client")),
                    "without_clarifications": bool(row.get("without_clarifications")),
                    "first_time_full_data": bool(row.get("first_time_full_data")),
                    "client_feedback_delay_hours": _safe_float(row.get("client_feedback_delay_hours")),
                },
                created_at=str(row.get("created_at") or ""),
                status=str(row.get("status") or employee_client_assessments.ASSESSMENT_STATUS_SUBMITTED),
            )
        )
    return items


def _load_all_rating_ledger_entries() -> List[Dict[str, Any]]:
    items = (
        _load_operator_csat_ledger_rows()
        + _load_dialog_feedback_ledger_rows()
        + _load_employee_client_assessment_ledger_rows()
    )
    items.sort(
        key=lambda item: (
            _parse_datetime(item.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
            int(item.get("rating_id") or 0),
        ),
        reverse=True,
    )
    return items


def _filter_rating_ledger_entries(
    entries: Sequence[Mapping[str, Any]],
    *,
    start_date: date | None = None,
    end_date: date | None = None,
    rater_type: str | None = None,
    rated_object_type: str | None = None,
    employee_id: int | None = None,
    employee_name: str | None = None,
    client_bin: str | None = None,
    client_id: int | None = None,
    section: str | None = None,
    region: str | None = None,
    organization: str | None = None,
    ai_involved: bool | None = None,
    channel: str | None = None,
) -> List[Dict[str, Any]]:
    filtered: List[Dict[str, Any]] = []
    normalized_rater = _normalize_lookup_value(rater_type)
    normalized_object = _normalize_lookup_value(rated_object_type)
    normalized_channel = _normalize_lookup_value(channel)
    normalized_client_bin = _normalize_lookup_value(client_bin)
    for entry in entries:
        created_at = _parse_datetime(str(entry.get("created_at") or ""))
        if start_date and (created_at is None or created_at.date() < start_date):
            continue
        if end_date and (created_at is None or created_at.date() > end_date):
            continue
        if normalized_rater and _normalize_lookup_value(str(entry.get("rater_type") or "")) != normalized_rater:
            continue
        if normalized_object and _normalize_lookup_value(str(entry.get("rated_object_type") or "")) != normalized_object:
            continue
        if employee_id is not None and _safe_int(entry.get("employee_id")) != int(employee_id):
            continue
        if employee_name:
            if not (
                _casefold_contains(entry.get("employee_name"), employee_name)
                or (
                    str(entry.get("rated_object_type") or "") == RATING_OBJECT_TYPE_EMPLOYEE
                    and _casefold_contains(entry.get("rated_object_name"), employee_name)
                )
                or (
                    str(entry.get("rater_type") or "") == RATING_RATER_TYPE_EMPLOYEE
                    and _casefold_contains(entry.get("rater_name"), employee_name)
                )
            ):
                continue
        if normalized_client_bin and _normalize_lookup_value(str(entry.get("client_bin") or "")) != normalized_client_bin:
            continue
        if client_id is not None and _safe_int(entry.get("client_id")) != int(client_id):
            continue
        if section and not _casefold_contains(entry.get("section"), section):
            continue
        if region and not _casefold_contains(entry.get("region"), region):
            continue
        if organization and not _casefold_contains(entry.get("organization"), organization):
            continue
        if ai_involved is not None and bool(entry.get("ai_involved")) != bool(ai_involved):
            continue
        if normalized_channel and _normalize_lookup_value(str(entry.get("rating_channel") or "")) != normalized_channel:
            continue
        filtered.append(dict(entry))
    return filtered


def get_rating_ledger(
    *,
    start_date: date | None = None,
    end_date: date | None = None,
    rater_type: str | None = None,
    rated_object_type: str | None = None,
    employee_id: int | None = None,
    employee_name: str | None = None,
    client_bin: str | None = None,
    client_id: int | None = None,
    section: str | None = None,
    region: str | None = None,
    organization: str | None = None,
    ai_involved: bool | None = None,
    channel: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> Dict[str, Any]:
    filtered = _filter_rating_ledger_entries(
        _load_all_rating_ledger_entries(),
        start_date=start_date,
        end_date=end_date,
        rater_type=rater_type,
        rated_object_type=rated_object_type,
        employee_id=employee_id,
        employee_name=employee_name,
        client_bin=client_bin,
        client_id=client_id,
        section=section,
        region=region,
        organization=organization,
        ai_involved=ai_involved,
        channel=channel,
    )
    safe_offset = max(0, int(offset))
    safe_limit = max(1, int(limit))
    return {
        "items": filtered[safe_offset:safe_offset + safe_limit],
        "total": len(filtered),
        "limit": safe_limit,
        "offset": safe_offset,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _summarize_scores(entries: Sequence[Mapping[str, Any]]) -> Dict[str, Any]:
    scores = [_safe_float(entry.get("final_score")) for entry in entries]
    filtered_scores = [score for score in scores if score is not None]
    count = len(filtered_scores)
    if count == 0:
        return {
            "average_score": None,
            "rating_count": 0,
            "high_score_share": 0.0,
            "low_score_share": 0.0,
        }
    return {
        "average_score": sum(filtered_scores) / count,
        "rating_count": count,
        "high_score_share": sum(1 for score in filtered_scores if score >= 4) / count,
        "low_score_share": sum(1 for score in filtered_scores if score <= 2) / count,
    }


def _load_submitted_employee_assessments() -> List[Dict[str, Any]]:
    with _lock:
        rows = execute(
            """
            SELECT
                id,
                dialog_id,
                appeal_id,
                assigned_user_id,
                assigned_user_name,
                task_opened_at,
                task_closed_at,
                ai_assisted,
                repeated_request,
                first_time_full_data,
                client_feedback_delay_hours,
                hindered_by_client,
                overall_score,
                interaction_quality_index
            FROM employee_client_assessments
            WHERE status = %s
            """,
            (employee_client_assessments.ASSESSMENT_STATUS_SUBMITTED,),
        ).fetchall()
    return [dict(row) for row in rows or []]


def get_employee_ratings_analytics() -> Dict[str, Any]:
    return get_employee_ratings_analytics_filtered()


def get_employee_ratings_analytics_filtered(
    *,
    employee_id: int | None = None,
    employee_name: str | None = None,
) -> Dict[str, Any]:
    ledger = _load_all_rating_ledger_entries()
    employee_ratings = [
        entry
        for entry in _filter_rating_ledger_entries(
            ledger,
            employee_id=employee_id,
            employee_name=employee_name,
        )
        if entry.get("source_kind") == "client_to_employee"
    ]
    assessments = _load_submitted_employee_assessments()
    if employee_id is not None:
        assessments = [row for row in assessments if _safe_int(row.get("assigned_user_id")) == int(employee_id)]
    elif employee_name:
        normalized_name = _normalize_lookup_value(employee_name)
        assessments = [
            row for row in assessments
            if _normalize_lookup_value(str(row.get("assigned_user_name") or "")) == normalized_name
        ]

    assessment_groups: Dict[str, Dict[str, Any]] = {}
    for row in assessments:
        employee_key = (
            f"id:{_safe_int(row.get('assigned_user_id'))}"
            if _safe_int(row.get("assigned_user_id")) is not None
            else f"name:{_normalize_lookup_value(str(row.get('assigned_user_name') or ''))}"
        )
        bucket = assessment_groups.setdefault(
            employee_key,
            {
                "employee_id": _safe_int(row.get("assigned_user_id")),
                "employee_name": _repair_optional_text(row.get("assigned_user_name")),
                "repeat_total": 0,
                "repeat_count": 0,
                "ai_total": 0,
                "ai_count": 0,
                "resolution_total": 0.0,
                "resolution_count": 0,
            },
        )
        bucket["repeat_total"] += 0 if bool(row.get("repeated_request")) else 1
        bucket["repeat_count"] += 1
        bucket["ai_total"] += 1 if bool(row.get("ai_assisted")) else 0
        bucket["ai_count"] += 1
        started_at = _parse_datetime(row.get("task_opened_at"))
        ended_at = _parse_datetime(row.get("task_closed_at"))
        if started_at is not None and ended_at is not None and ended_at >= started_at:
            bucket["resolution_total"] += (ended_at - started_at).total_seconds() / 60.0
            bucket["resolution_count"] += 1

    employee_groups: Dict[str, Dict[str, Any]] = {}
    monthly_scores: Dict[str, Dict[str, float]] = {}
    low_score_reasons: Dict[str, int] = {}
    ai_impact_buckets: Dict[str, Dict[str, float]] = {
        "with_ai": {"sum": 0.0, "count": 0.0},
        "without_ai": {"sum": 0.0, "count": 0.0},
    }

    for entry in employee_ratings:
        employee_key = (
            f"id:{_safe_int(entry.get('employee_id'))}"
            if _safe_int(entry.get("employee_id")) is not None
            else f"name:{_normalize_lookup_value(str(entry.get('employee_name') or entry.get('rated_object_name') or ''))}"
        )
        bucket = employee_groups.setdefault(
            employee_key,
            {
                "employee_id": _safe_int(entry.get("employee_id")),
                "employee_name": _repair_optional_text(entry.get("employee_name")) or _repair_optional_text(entry.get("rated_object_name")) or "Без имени",
                "score_sum": 0.0,
                "score_count": 0,
                "high_count": 0,
                "low_count": 0,
                "ai_score_total": 0,
                "ai_score_count": 0,
            },
        )
        score = _safe_float(entry.get("final_score"))
        if score is None:
            continue
        bucket["score_sum"] += score
        bucket["score_count"] += 1
        if score >= 4:
            bucket["high_count"] += 1
        if score <= 2:
            bucket["low_count"] += 1
        if bool(entry.get("ai_involved")):
            bucket["ai_score_total"] += 1
        bucket["ai_score_count"] += 1
        reason = _repair_optional_text(entry.get("low_score_reason"))
        if reason:
            low_score_reasons[reason] = low_score_reasons.get(reason, 0) + 1
        month = _month_bucket(str(entry.get("created_at") or ""))
        if month:
            month_bucket = monthly_scores.setdefault(month, {"sum": 0.0, "count": 0.0})
            month_bucket["sum"] += score
            month_bucket["count"] += 1
        ai_bucket = ai_impact_buckets["with_ai" if bool(entry.get("ai_involved")) else "without_ai"]
        ai_bucket["sum"] += score
        ai_bucket["count"] += 1

    rows: List[Dict[str, Any]] = []
    for key, bucket in employee_groups.items():
        score_count = int(bucket["score_count"])
        if score_count == 0:
            continue
        controls = assessment_groups.get(key, {})
        rows.append(
            {
                "employee_id": bucket["employee_id"],
                "employee_name": bucket["employee_name"],
                "average_score": round(bucket["score_sum"] / score_count, 2),
                "rated_appeals_count": score_count,
                "high_score_share": round(bucket["high_count"] / score_count, 4),
                "low_score_share": round(bucket["low_count"] / score_count, 4),
                "average_resolution_minutes": (
                    round(float(controls["resolution_total"]) / int(controls["resolution_count"]), 2)
                    if controls.get("resolution_count")
                    else None
                ),
                "without_repeat_share": (
                    round(float(controls["repeat_total"]) / int(controls["repeat_count"]), 4)
                    if controls.get("repeat_count")
                    else None
                ),
                "without_escalation_share": None,
                "ai_assisted_share": (
                    round(float(controls["ai_total"]) / int(controls["ai_count"]), 4)
                    if controls.get("ai_count")
                    else round(bucket["ai_score_total"] / max(bucket["ai_score_count"], 1), 4)
                ),
                "closure_correctness": None,
                "total_low_ratings": bucket["low_count"],
            }
        )
    rows.sort(key=lambda item: (-float(item["average_score"]), -int(item["rated_appeals_count"]), str(item["employee_name"])))

    summary_scores = _summarize_scores(employee_ratings)
    resolution_denominator = sum(int(group["resolution_count"]) for group in assessment_groups.values() if group.get("resolution_count"))
    repeat_denominator = sum(int(group["repeat_count"]) for group in assessment_groups.values() if group.get("repeat_count"))
    ai_denominator = sum(int(group["ai_count"]) for group in assessment_groups.values() if group.get("ai_count"))
    summary = {
        **summary_scores,
        "average_resolution_minutes": round(
            sum(float(group["resolution_total"]) for group in assessment_groups.values() if group.get("resolution_count")) / resolution_denominator,
            2,
        ) if resolution_denominator else None,
        "without_repeat_share": round(
            sum(float(group["repeat_total"]) for group in assessment_groups.values()) / repeat_denominator,
            4,
        ) if repeat_denominator else None,
        "without_escalation_share": None,
        "ai_assisted_share": round(
            sum(float(group["ai_total"]) for group in assessment_groups.values()) / ai_denominator,
            4,
        ) if ai_denominator else None,
        "closure_correctness": None,
        "not_available": ["without_escalation_share", "closure_correctness"],
    }

    return {
        "summary": summary,
        "rows": rows,
        "monthly_dynamics": [
            {
                "month": month,
                "average_score": round(values["sum"] / values["count"], 2),
                "rating_count": int(values["count"]),
            }
            for month, values in sorted(monthly_scores.items())
        ],
        "low_score_reasons": [
            {"label": label, "count": count}
            for label, count in sorted(low_score_reasons.items(), key=lambda item: (-item[1], item[0]))[:10]
        ],
        "ai_impact": [
            {
                "label": "С ИИ",
                "average_score": round(ai_impact_buckets["with_ai"]["sum"] / ai_impact_buckets["with_ai"]["count"], 2)
                if ai_impact_buckets["with_ai"]["count"]
                else None,
                "rating_count": int(ai_impact_buckets["with_ai"]["count"]),
            },
            {
                "label": "Без ИИ",
                "average_score": round(ai_impact_buckets["without_ai"]["sum"] / ai_impact_buckets["without_ai"]["count"], 2)
                if ai_impact_buckets["without_ai"]["count"]
                else None,
                "rating_count": int(ai_impact_buckets["without_ai"]["count"]),
            },
        ],
        "top_employees": rows[:5],
        "problem_employees": sorted(
            rows,
            key=lambda item: (-int(item["total_low_ratings"]), float(item["average_score"]), str(item["employee_name"])),
        )[:5],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def get_client_ratings_analytics() -> Dict[str, Any]:
    analytics = employee_client_assessments.get_employee_assessment_analytics()
    rows: List[Dict[str, Any]] = []
    for item in analytics.get("client_ratings", []):
        average_score = _safe_float(item.get("average_overall_score"))
        interaction_quality_index = _safe_float(item.get("average_interaction_quality_index"))
        repeated_request_share = _safe_float(item.get("repeated_request_share")) or 0.0
        hindered_count = int(item.get("hindered_count") or 0)
        first_time_full_data_share = _safe_float(item.get("first_time_full_data_share")) or 0.0
        recommendation = None
        if (average_score is not None and average_score < 3) or hindered_count >= 2:
            recommendation = "Требуется методическая поддержка"
        elif repeated_request_share >= 0.35 or first_time_full_data_share < 0.5:
            recommendation = "Рекомендуется обучение или вебинар"
        rows.append(
            {
                "client_bin": item.get("client_bin"),
                "client_name": item.get("client_name") or item.get("client_bin") or "Без названия",
                "completed_appeals_count": int(item.get("task_count") or 0),
                "average_score": average_score,
                "interaction_quality_index": interaction_quality_index,
                "full_data_first_time_share": first_time_full_data_share,
                "average_feedback_delay_hours": _safe_float(item.get("average_feedback_delay_hours")),
                "repeated_request_share": repeated_request_share,
                "hindered_count": hindered_count,
                "recommendation": recommendation,
            }
        )
    support_candidates = [row for row in rows if row.get("recommendation")]
    support_candidates.sort(
        key=lambda item: (
            item["average_score"] if item.get("average_score") is not None else 999.0,
            -int(item.get("hindered_count") or 0),
            str(item.get("client_name") or ""),
        )
    )
    return {
        "summary": {
            "average_score": analytics.get("average_overall_score"),
            "assessment_count": analytics.get("total_assessments", 0),
            "full_data_first_time_share": analytics.get("first_time_full_data_share", 0.0),
            "average_feedback_delay_hours": analytics.get("average_feedback_delay_hours"),
            "repeated_request_share": analytics.get("repeated_request_share", 0.0),
            "hindered_count": analytics.get("hindered_count", 0),
            "interaction_quality_index": analytics.get("average_interaction_quality_index"),
        },
        "rows": rows,
        "monthly_dynamics": [
            {
                "month": item.get("month"),
                "average_score": item.get("average_overall_score"),
                "interaction_quality_index": item.get("average_interaction_quality_index"),
                "count": item.get("count", 0),
            }
            for item in analytics.get("monthly_scores", [])
        ],
        "low_score_reasons": analytics.get("low_score_reasons", []),
        "interaction_statuses": analytics.get("interaction_statuses", []),
        "interaction_flags": analytics.get("interaction_flags", []),
        "request_repeat_statuses": analytics.get("request_repeat_statuses", []),
        "support_candidates": support_candidates[:10],
        "recent_assessments": analytics.get("recent_assessments", []),
        "updated_at": analytics.get("updated_at") or datetime.now(timezone.utc).isoformat(),
    }


def _load_dialog_stats_rows() -> List[Dict[str, Any]]:
    with _lock:
        rows = execute(
            """
            SELECT
                ds.dialog_id,
                ds.appeal_id,
                ds.chat_id,
                ds.bin,
                COALESCE(ds.section, a.section, cd.section, c.section) AS section,
                ds.ai_messages_count,
                ds.is_ai_closed,
                ds.operator_requested,
                ds.ai_csat_rating,
                COALESCE(ds.ended_at, ds.started_at, ds.created_at) AS analytics_at,
                (
                    SELECT ARRAY_REMOVE(ARRAY_AGG(DISTINCT dos.operator_name), NULL)
                    FROM dialog_operator_stats dos
                    WHERE (
                        (ds.appeal_id IS NOT NULL AND dos.appeal_id = ds.appeal_id)
                        OR (ds.appeal_id IS NULL AND dos.dialog_id = ds.dialog_id AND dos.appeal_id IS NULL)
                    )
                ) AS operator_names
            FROM dialog_stats ds
            LEFT JOIN appeals a ON a.id = ds.appeal_id
            LEFT JOIN chat_dialogs cd ON cd.id = ds.dialog_id
            LEFT JOIN chats c ON c.chat_id = ds.chat_id
            """
        ).fetchall()
    return [dict(row) for row in rows or []]


def get_ai_ratings_analytics() -> Dict[str, Any]:
    ledger = _load_all_rating_ledger_entries()
    ai_entries = [entry for entry in ledger if str(entry.get("rated_object_type") or "") == RATING_OBJECT_TYPE_AI]
    summary_scores = _summarize_scores(ai_entries)
    dialog_stats_rows = _load_dialog_stats_rows()

    total_cases = len(dialog_stats_rows)
    ai_cases = 0
    scenario_buckets: Dict[str, Dict[str, float]] = {
        "human_without_ai": {"cases": 0, "sum": 0.0, "rated": 0.0},
        "employee_with_ai": {"cases": 0, "sum": 0.0, "rated": 0.0},
        "ai_without_employee": {"cases": 0, "sum": 0.0, "rated": 0.0},
    }
    section_buckets: Dict[str, Dict[str, float]] = {}
    for row in dialog_stats_rows:
        ai_involved = bool(row.get("is_ai_closed")) or int(row.get("ai_messages_count") or 0) > 0
        if ai_involved:
            ai_cases += 1
        scenario = _classify_ai_scenario(row.get("operator_names") or [], ai_involved)
        scenario_bucket = scenario_buckets.setdefault(scenario, {"cases": 0, "sum": 0.0, "rated": 0.0})
        scenario_bucket["cases"] += 1
        rating = _safe_float(row.get("ai_csat_rating"))
        if rating is not None:
            scenario_bucket["sum"] += rating
            scenario_bucket["rated"] += 1
            section_key = _repair_optional_text(row.get("section")) or "Без категории"
            section_bucket = section_buckets.setdefault(section_key, {"sum": 0.0, "count": 0.0, "low": 0.0})
            section_bucket["sum"] += rating
            section_bucket["count"] += 1
            if rating <= 2:
                section_bucket["low"] += 1

    low_score_reasons: Dict[str, int] = {}
    monthly_scores: Dict[str, Dict[str, float]] = {}
    for entry in ai_entries:
        reason = _repair_optional_text(entry.get("low_score_reason"))
        if reason:
            low_score_reasons[reason] = low_score_reasons.get(reason, 0) + 1
        score = _safe_float(entry.get("final_score"))
        month = _month_bucket(str(entry.get("created_at") or ""))
        if score is not None and month:
            bucket = monthly_scores.setdefault(month, {"sum": 0.0, "count": 0.0})
            bucket["sum"] += score
            bucket["count"] += 1

    section_rows = [
        {
            "section": None if label == "Без категории" else label,
            "average_score": round(values["sum"] / values["count"], 2) if values["count"] else None,
            "rating_count": int(values["count"]),
            "low_score_share": round(values["low"] / values["count"], 4) if values["count"] else 0.0,
        }
        for label, values in sorted(section_buckets.items(), key=lambda item: (-item[1]["count"], item[0]))
    ]

    return {
        "summary": {
            **summary_scores,
            "ai_usage_share": round(ai_cases / total_cases, 4) if total_cases else None,
            "inaccurate_share": round(summary_scores["low_score_share"], 4),
            "manual_correction_share": None,
            "client_feedback_count": summary_scores["rating_count"],
            "employee_feedback_count": 0,
        },
        "rows": section_rows,
        "monthly_dynamics": [
            {
                "month": month,
                "average_score": round(values["sum"] / values["count"], 2),
                "rating_count": int(values["count"]),
            }
            for month, values in sorted(monthly_scores.items())
        ],
        "low_score_reasons": [
            {"label": label, "count": count}
            for label, count in sorted(low_score_reasons.items(), key=lambda item: (-item[1], item[0]))[:10]
        ],
        "scenario_comparison": [
            {
                "scenario": scenario,
                "label": {
                    "human_without_ai": "Человек без ИИ",
                    "employee_with_ai": "Сотрудник с подсказками ИИ",
                    "ai_without_employee": "ИИ без участия сотрудника",
                }[scenario],
                "cases_count": int(values["cases"]),
                "average_score": round(values["sum"] / values["rated"], 2) if values["rated"] else None,
            }
            for scenario, values in scenario_buckets.items()
        ],
        "top_useful_sections": sorted(
            section_rows,
            key=lambda item: (-(item["average_score"] or 0.0), -int(item["rating_count"]), str(item["section"] or "")),
        )[:5],
        "review_required_sections": sorted(
            section_rows,
            key=lambda item: (-float(item["low_score_share"]), item["average_score"] or 999.0, str(item["section"] or "")),
        )[:5],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def get_mutual_rating_matrix() -> Dict[str, Any]:
    ledger = _load_all_rating_ledger_entries()
    buckets: Dict[tuple[str, str], Dict[str, float]] = {}
    for entry in ledger:
        key = (str(entry.get("rater_type") or ""), str(entry.get("rated_object_type") or ""))
        bucket = buckets.setdefault(key, {"count": 0.0, "sum": 0.0, "rated": 0.0})
        bucket["count"] += 1
        score = _safe_float(entry.get("final_score"))
        if score is not None:
            bucket["sum"] += score
            bucket["rated"] += 1

    definitions = [
        ("client", "employee", "Клиент оценил сотрудника"),
        ("employee", "client", "Сотрудник оценил клиента"),
        ("client", "ai", "Клиент оценил ИИ"),
        ("employee", "ai", "Сотрудник оценил ИИ"),
        ("manager", "appeal", "Руководитель оценил корректность закрытия кейса"),
    ]
    cells = []
    for rater, rated, label in definitions:
        bucket = buckets.get((rater, rated))
        cells.append(
            {
                "code": f"{rater}_to_{rated}",
                "rater_type": rater,
                "rated_object_type": rated,
                "label": label,
                "count": int(bucket["count"]) if bucket else 0,
                "average_score": round(bucket["sum"] / bucket["rated"], 2) if bucket and bucket["rated"] else None,
                "status": "available" if bucket else "no_data",
            }
        )
    return {
        "cells": cells,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def get_ratings_summary() -> Dict[str, Any]:
    employee = get_employee_ratings_analytics()
    client = get_client_ratings_analytics()
    ai = get_ai_ratings_analytics()
    return {
        "employees": employee.get("summary", {}),
        "clients": client.get("summary", {}),
        "ai": ai.get("summary", {}),
        "missing_flows": [
            "manager_to_appeal",
            "employee_to_ai",
            "department_ratings",
            "manual_ai_correction_flag",
            "closure_correctness_flow",
        ],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

