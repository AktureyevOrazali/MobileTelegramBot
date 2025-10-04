"""Backend package bootstrap."""
from __future__ import annotations

from dotenv import load_dotenv

from pathlib import Path        # ✅ нужно импортировать Path
from dotenv import load_dotenv

# Загружаем .env из текущей папки (backend/.env)
load_dotenv(dotenv_path=Path(__file__).with_name(".env"))
