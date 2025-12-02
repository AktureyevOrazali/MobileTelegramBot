import ctypes
import logging
import os
import sys
import traceback
from pathlib import Path


def _log_path() -> Path:
    """Return a writable path for the error log next to the executable.

    When bundled with PyInstaller ``sys.executable`` points to the built
    ``backend_server.exe``; in source runs we fall back to the directory of
    this script. Using an absolute path avoids surprises with the current
    working directory when the one-file bundle unpacks to a temp folder.
    """

    if getattr(sys, "frozen", False):  # PyInstaller one-file/one-dir
        base_dir = Path(sys.executable).resolve().parent
    else:
        base_dir = Path(__file__).resolve().parent
    return base_dir / "backend_error.log"


LOG_FILE = _log_path()


def show_error_box(message: str):
    """
    Показать Windows MessageBox с текстом ошибки.
    """
    try:
        ctypes.windll.user32.MessageBoxW(
            0,
            message,
            "Backend error",
            0x10  # MB_ICONERROR
        )
    except Exception:
        # Если уж даже окно не удалось показать — просто молчим
        pass


if __name__ == "__main__":
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

    # Логируем и в файл, и в консоль
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(LOG_FILE, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )

    try:
        logging.info("Starting backend...")
        from backend.main import main as backend_main

        backend_main()
    except Exception:
        err_text = traceback.format_exc()

        # Пишем ошибку в лог
        logging.error("Fatal error:\n%s", err_text)

        # На всякий случай ещё раз явно допишем в файл
        try:
            with LOG_FILE.open("a", encoding="utf-8") as f:
                f.write("\n===== FATAL ERROR =====\n")
                f.write(err_text)
        except Exception:
            pass

        # Показываем пользователю окно
        short_err = err_text[-1000:]  # чтобы не заспамить слишком длинным текстом
        full_log_path = str(LOG_FILE.resolve())
        message = (
            "Произошла критическая ошибка при запуске backend.\n\n"
            f"Лог-файл: {full_log_path}\n\n"
            f"{short_err}"
        )
        show_error_box(message)