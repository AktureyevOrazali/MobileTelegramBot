import ctypes
import logging
import sys
import traceback
from pathlib import Path


LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
LOG_LEVEL = logging.INFO


def _log_path() -> Path:
    """Return a writable path for the log file next to the executable."""

    if getattr(sys, "frozen", False):  # PyInstaller one-file/one-dir
        base_dir = Path(sys.executable).resolve().parent
    else:
        base_dir = Path(__file__).resolve().parent
    return base_dir / "backend_error.log"


LOG_FILE = _log_path()


def show_error_box(message: str) -> None:
    """Show a Windows error message box or print to stderr on other OSes."""

    try:
        ctypes.windll.user32.MessageBoxW(
            0,
            message,
            "Backend error",
            0x10,  # MB_ICONERROR
        )
    except (AttributeError, OSError):
        print(f"[FATAL] {message}", file=sys.stderr)


def configure_logging() -> None:
    """Configure root logging for both file and stdout.

    The log file is recreated on every launch so each run has a clean log.
    """

    logging.basicConfig(
        level=LOG_LEVEL,
        format=LOG_FORMAT,
        handlers=[
            logging.FileHandler(LOG_FILE, mode="w", encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
        force=True,
    )


if __name__ == "__main__":
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    configure_logging()

    try:
        logging.info("Starting backend...")
        from backend.main import main as backend_main

        backend_main()
    except Exception:
        err_text = traceback.format_exc()
        logging.critical("Fatal error during backend startup:\n%s", err_text)

        short_err = err_text[-2000:]
        full_log_path = str(LOG_FILE.resolve())
        message = (
            "Произошла критическая ошибка при запуске backend.\n\n"
            f"Лог-файл: {full_log_path}\n\n"
            f"{short_err}"
        )
        show_error_box(message)
        raise
