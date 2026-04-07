"""Backend package bootstrap."""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

# Load .env from the backend package or next to the bundled executable.
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
            load_dotenv(dotenv_path=path, override=True)
            break


_load_env()


def require_env(name: str, *, allow_blank: bool = False, default: Optional[str] = None) -> str:
    """Fetch a required environment variable with explicit error messaging.

    Args:
        name: Variable name to read.
        allow_blank: Whether an empty string is acceptable.
        default: Optional fallback. If provided and the variable is missing,
            the default will be used.

    Raises:
        RuntimeError: If the variable is missing (and no default is provided)
            or blank when blanks are not allowed.
    """

    value = os.getenv(name, default)
    if value is None:
        raise RuntimeError(f"Environment variable {name} is required")
    if value == "" and not allow_blank:
        raise RuntimeError(f"Environment variable {name} cannot be empty")
    return value