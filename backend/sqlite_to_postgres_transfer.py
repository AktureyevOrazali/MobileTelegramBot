"""
Utility script to copy data from a SQLite database into PostgreSQL.

Features:
- Skips SQLite service tables such as ``sqlite_sequence`` by default.
- Optionally creates missing tables in PostgreSQL using the SQLite schema
  (via SQLAlchemy reflection) before copying data.
- Copies data in batches to avoid loading everything into memory at once.

Example usage:
    python backend/sqlite_to_postgres_transfer.py \
        --sqlite-path C:\\path\\to\\bot.db \
        --pg-user postgres --pg-password SayCheese228 \
        --pg-host localhost --pg-port 5432 --pg-db mobile_telegram_bot \
        --create-missing

On Windows use double backslashes for file paths or wrap the path in quotes.
"""
from __future__ import annotations

import argparse
import sys
from typing import Iterable, Sequence, Set
from urllib.parse import quote_plus

from sqlalchemy import (
    BigInteger,
    Integer,
    MetaData,
    Table,
    create_engine,
    insert,
    select,
    text,
)
from sqlalchemy.engine import URL
from sqlalchemy.exc import DataError, NoSuchTableError
from sqlalchemy.sql import func

DEFAULT_SKIP_TABLES: Set[str] = {"sqlite_sequence"}


class TransferError(RuntimeError):
    """Raised when the transfer cannot proceed because of missing tables."""


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Copy all tables from a SQLite database into PostgreSQL."
    )
    parser.add_argument(
        "--sqlite-path",
        required=True,
        help="Path to the SQLite database file (e.g. C:/data/db.sqlite3)",
    )
    parser.add_argument(
        "--pg-dsn",
        help=(
            "Full PostgreSQL DSN (e.g. postgresql+psycopg2://user:pass@host:5432/db). "
            "If omitted, individual connection parameters are used."
        ),
    )
    parser.add_argument("--pg-host", default="localhost", help="PostgreSQL host")
    parser.add_argument("--pg-port", default=5432, type=int, help="PostgreSQL port")
    parser.add_argument("--pg-user", default="postgres", help="PostgreSQL user")
    parser.add_argument(
        "--pg-password", default="", help="PostgreSQL password; wrap in quotes if needed"
    )
    parser.add_argument(
        "--pg-db",
        default="postgres",
        help="Target PostgreSQL database name",
    )
    parser.add_argument(
        "--skip",
        nargs="*",
        default=[],
        help="Additional tables to skip (space separated)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=1000,
        help="Number of rows to insert per batch",
    )
    parser.add_argument(
        "--create-missing",
        action="store_true",
        help="Create missing tables in PostgreSQL based on the SQLite schema",
    )
    parser.add_argument(
        "--coerce-integers-to-bigint",
        action="store_true",
        help=(
            "When creating missing tables, widen INTEGER columns to BIGINT to avoid "
            "overflow for large IDs."
        ),
    )
    parser.add_argument(
        "--auto-widen-on-overflow",
        action="store_true",
        help=(
            "If a PostgreSQL INTEGER column is too small for SQLite data, automatically "
            "ALTER it to BIGINT before inserting."
        ),
    )
    return parser.parse_args(argv)


def build_pg_url(args: argparse.Namespace) -> URL | str:
    if args.pg_dsn:
        return args.pg_dsn

    return URL.create(
        drivername="postgresql+psycopg2",
        username=args.pg_user,
        password=quote_plus(args.pg_password),
        host=args.pg_host,
        port=args.pg_port,
        database=args.pg_db,
    )


def copy_table_data(
    source_table: Table,
    target_table: Table,
    sqlite_conn,
    pg_conn,
    batch_size: int,
) -> None:
    """Copy rows from ``source_table`` into ``target_table`` in batches."""

    result = sqlite_conn.execute(select(source_table))
    rows = result.fetchmany(batch_size)
    while rows:
        try:
            pg_conn.execute(
                insert(target_table).values([dict(row._mapping) for row in rows])
            )
        except DataError as exc:  # psycopg2 NumericValueOutOfRange, etc.
            raise TransferError(
                "Data copy failed due to a PostgreSQL type/size constraint. "
                "Consider widening integer columns to BIGINT in the target table "
                "(or re-run with --create-missing --coerce-integers-to-bigint "
                "or --auto-widen-on-overflow)."
            ) from exc
        rows = result.fetchmany(batch_size)


def _check_integer_overflow(
    source_table: Table,
    target_table: Table,
    sqlite_conn,
    pg_conn,
    auto_widen_on_overflow: bool,
) -> None:
    """Ensure SQLite integer values fit into the PostgreSQL integer columns."""

    int4_min, int4_max = -2147483648, 2147483647

    for column in source_table.columns:
        target_column = target_table.columns.get(column.name)
        if target_column is None:
            # Let the insert error naturally if schemas diverge too much.
            continue

        if not isinstance(column.type, Integer) or isinstance(column.type, BigInteger):
            continue

        if not isinstance(target_column.type, Integer) or isinstance(
            target_column.type, BigInteger
        ):
            continue

        bounds = sqlite_conn.execute(
            select(func.min(column).label("min"), func.max(column).label("max"))
        ).one()

        if bounds.min is None and bounds.max is None:
            continue

        if (bounds.min is not None and bounds.min < int4_min) or (
            bounds.max is not None and bounds.max > int4_max
        ):
            _handle_overflow(
                source_table,
                target_table,
                column.name,
                bounds.min,
                bounds.max,
                pg_conn,
                auto_widen_on_overflow,
            )


def _quote_identifier(pg_conn, identifier: str) -> str:
    preparer = pg_conn.dialect.identifier_preparer
    return preparer.quote(identifier)


def _qualified_table_name(pg_conn, table: Table) -> str:
    preparer = pg_conn.dialect.identifier_preparer
    if table.schema:
        return f"{preparer.quote_schema(table.schema)}.{preparer.quote(table.name)}"
    return preparer.quote(table.name)


def _handle_overflow(
    source_table: Table,
    target_table: Table,
    column_name: str,
    min_val,
    max_val,
    pg_conn,
    auto_widen_on_overflow: bool,
) -> None:
    if auto_widen_on_overflow:
        table_sql = _qualified_table_name(pg_conn, target_table)
        column_sql = _quote_identifier(pg_conn, column_name)
        print(
            "Detected integer overflow risk: widening "
            f"{table_sql}.{column_sql} to BIGINT..."
        )
        try:
            pg_conn.execute(
                text(
                    f"ALTER TABLE {table_sql} ALTER COLUMN {column_sql} "
                    f"TYPE BIGINT USING {column_sql}::bigint"
                )
            )
            # Ensure in-memory metadata matches the widened type.
            target_table.columns[column_name].type = BigInteger()
            print(
                f"Finished widening {table_sql}.{column_sql} to BIGINT; continuing copy."
            )
            return
        except Exception as exc:  # pragma: no cover - best effort DDL
            raise TransferError(
                (
                    "Failed to widen column '{table}.{column}' to BIGINT automatically. "
                    "Adjust it manually and re-run the transfer."
                ).format(table=source_table.name, column=column_name)
            ) from exc

    raise TransferError(
        (
            "Table '{table}' has integer values outside PostgreSQL INTEGER range "
            "for column '{column}' (min={min_val}, max={max_val}). "
            "Alter the column to BIGINT in PostgreSQL or re-run with "
            "--create-missing --coerce-integers-to-bigint (or use --auto-widen-on-overflow)."
        ).format(
            table=source_table.name,
            column=column_name,
            min_val=min_val,
            max_val=max_val,
        )
    )


def _prepare_metadata(
    sqlite_metadata: MetaData,
    skip_tables: Set[str],
    coerce_integers_to_bigint: bool,
) -> MetaData:
    """Clone SQLite metadata, optionally widening INTEGER columns to BIGINT."""

    pg_metadata = MetaData()
    for table in sqlite_metadata.tables.values():
        if table.name in skip_tables:
            continue

        new_table = table.to_metadata(pg_metadata)
        if not coerce_integers_to_bigint:
            continue

        for column in new_table.columns:
            if isinstance(column.type, Integer) and not isinstance(
                column.type, BigInteger
            ):
                column.type = BigInteger()
    return pg_metadata


def transfer(
    sqlite_path: str,
    pg_url: URL | str,
    skip: Iterable[str],
    create_missing: bool,
    batch_size: int,
    coerce_integers_to_bigint: bool,
    auto_widen_on_overflow: bool,
) -> None:
    sqlite_engine = create_engine(f"sqlite:///{sqlite_path}")
    pg_engine = create_engine(pg_url)

    sqlite_metadata = MetaData()
    sqlite_metadata.reflect(bind=sqlite_engine)

    skip_tables = set(skip) | DEFAULT_SKIP_TABLES

    if create_missing:
        pg_metadata = _prepare_metadata(
            sqlite_metadata,
            skip_tables=skip_tables,
            coerce_integers_to_bigint=coerce_integers_to_bigint,
        )
        pg_metadata.create_all(pg_engine, checkfirst=True)

    with sqlite_engine.connect() as sqlite_conn:
        for table in sqlite_metadata.sorted_tables:
            if table.name in skip_tables:
                print(f"Skipping table '{table.name}'")
                continue

            with pg_engine.begin() as pg_conn:
                try:
                    target_table = Table(table.name, MetaData(), autoload_with=pg_engine)
                except NoSuchTableError as exc:
                    raise TransferError(
                        f"Table '{table.name}' does not exist in PostgreSQL. "
                        "Create it manually or re-run with --create-missing."
                    ) from exc

                print(f"Copying table '{table.name}'...")
                _check_integer_overflow(
                    table,
                    target_table,
                    sqlite_conn,
                    pg_conn,
                    auto_widen_on_overflow,
                )
                copy_table_data(table, target_table, sqlite_conn, pg_conn, batch_size)
                print(f"Finished table '{table.name}'.")


if __name__ == "__main__":
    args = parse_args(sys.argv[1:])
    pg_url = build_pg_url(args)

    try:
        transfer(
            sqlite_path=args.sqlite_path,
            pg_url=pg_url,
            skip=args.skip,
            create_missing=args.create_missing,
            batch_size=args.batch_size,
            coerce_integers_to_bigint=args.coerce_integers_to_bigint,
            auto_widen_on_overflow=args.auto_widen_on_overflow,
        )
    except TransferError as exc:
        print(exc)
        sys.exit(1)