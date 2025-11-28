import logging
import traceback
import ctypes
import os
import sys

from backend.main import main as backend_main


LOG_FILE = "backend_error.log"


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
        backend_main()
    except Exception:
        err_text = traceback.format_exc()

        # Пишем ошибку в лог
        logging.error("Fatal error:\n%s", err_text)

        # На всякий случай ещё раз явно допишем в файл
        try:
            with open(LOG_FILE, "a", encoding="utf-8") as f:
                f.write("\n===== FATAL ERROR =====\n")
                f.write(err_text)
        except Exception:
            pass

        # Показываем пользователю окно
        short_err = err_text[-1000:]  # чтобы не заспамить слишком длинным текстом
        full_log_path = os.path.abspath(LOG_FILE)
        message = (
            "Произошла критическая ошибка при запуске backend.\n\n"
            f"Лог-файл: {full_log_path}\n\n"
            f"{short_err}"
        )
        show_error_box(message)
