from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from .. import require_env
from .base import Base

DB_NAME = require_env("DB_NAME")
DB_USER = require_env("DB_USER")
DB_PASSWORD = require_env("DB_PASSWORD")
DB_HOST = require_env("DB_HOST")

try:
    DB_PORT = int(require_env("DB_PORT"))
except ValueError as exc:  # pragma: no cover - defensive
    raise RuntimeError("DB_PORT must be an integer") from exc

DATABASE_URL = (
    f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# ⬇️ ЕҢ МАҢЫЗДЫ ЖЕР
from . import models   # тек импорттаймыз

Base.metadata.create_all(bind=engine)

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()