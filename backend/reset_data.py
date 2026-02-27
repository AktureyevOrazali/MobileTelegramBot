"""One-time script to clear all test data from the database.

Run this AFTER deploying the new code with pre-aggregated metrics.
It will erase all messages, dialogs, archive data, and metric tables.
User accounts, sessions, and configuration data are preserved.

Usage:
    python -m backend.reset_data
"""
import sys
import os

# Ensure the backend package is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend import database

TABLES_TO_TRUNCATE = [
    "messages",
    "messages_archive",
    "appeals",
    "chat_dialogs",
    "dialog_stats",
    "dialog_operator_stats",
    "stat_questions",
    "favorites",
    "dialog_reads",
    "outbox_onec",
    "notifications",
    "chats",
    "client_bins",
    "organizations_without_contracts",
]


def main() -> None:
    print("=== DATA RESET ===")
    print(f"Will TRUNCATE: {', '.join(TABLES_TO_TRUNCATE)}")
    
    if len(sys.argv) > 1 and sys.argv[1] == "--force":
        confirm = "YES"
        print("Running in non-interactive mode (--force)")
    else:
        confirm = input("Type YES to confirm: ").strip()
        
    if confirm != "YES":
        print("Aborted.")
        return

    with database._lock:
        for table in TABLES_TO_TRUNCATE:
            database.execute(f"TRUNCATE TABLE {table} CASCADE")
            print(f"  [OK] {table}")

    print("\nAll test data cleared. Dashboard will start fresh.")


if __name__ == "__main__":
    main()
