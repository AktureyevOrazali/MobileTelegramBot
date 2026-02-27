"""Re-snapshot metrics for all closed dialogs that still have messages.

Run after deploying updated snapshot logic to fix missing operator stats.

Usage:
    python -m backend.resnap
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend import database


def main() -> None:
    with database._lock:
        rows = database.execute(
            """
            SELECT id FROM chat_dialogs
            WHERE ended_at IS NOT NULL
            """
        ).fetchall()

    if not rows:
        print("No closed dialogs found.")
        return

    print(f"Found {len(rows)} closed dialog(s). Re-snapshotting...")
    for row in rows:
        dialog_id = int(row["id"])
        try:
            database.snapshot_dialog_metrics(dialog_id)
            print(f"  ✓ Dialog {dialog_id}")
        except Exception as exc:
            print(f"  ✗ Dialog {dialog_id}: {exc}")

    print("Done.")


if __name__ == "__main__":
    main()
