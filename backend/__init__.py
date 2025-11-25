"""Backend package bootstrap."""
from __future__ import annotations

import sys
from pathlib import Path

from pathlib import Path        # ✅ нужно импортировать Path
from dotenv import load_dotenv

# Загружаем .env из текущей папки (backend/.env)
def _load_env() -> None:
    """Load environment variables for the backend.

    Prefers a .env file placed next to the running executable (useful for a
    PyInstaller-built .exe) and falls back to the package directory. The first
    existing file wins.
    """

    candidates = []

    # When running from source, this is backend/.env
    candidates.append(Path(__file__).with_name(".env"))

    # When packaged with PyInstaller, sys.executable points to the bundled exe
    candidates.append(Path(sys.executable).resolve().parent / ".env")

    for path in candidates:
        if path.exists():
            load_dotenv(dotenv_path=path)
            break


_load_env()
