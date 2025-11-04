"""Entry point launching both the Telegram bot and the HTTP API."""
from __future__ import annotations

import os
import signal
import threading
from typing import Optional

import uvicorn

from .api import app
from .telegram_bot import bot


class BotPollingThread(threading.Thread):
    def __init__(self) -> None:
        super().__init__(daemon=True)
        self._exception: Optional[BaseException] = None
        self._stopping = threading.Event()

    def run(self) -> None:  # pragma: no cover - long running thread
        try:
            # pyTelegramBotAPI: infinity_polling блокирующий, но умеет останавливаться через .stop_polling()
            bot.infinity_polling(skip_pending=True, timeout=20)
        except BaseException as exc:  # pylint: disable=broad-except
            self._exception = exc

    def stop(self) -> None:
        # Безопасно просим бота остановиться
        try:
            bot.stop_polling()
        except Exception:
            pass
        self._stopping.set()

    @property
    def exception(self) -> Optional[BaseException]:
        return self._exception


def main() -> None:
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))

    bot_thread = BotPollingThread()
    bot_thread.start()

    # Конфигурируем uvicorn как управляемый сервер, чтобы перехватывать сигналы и завершаться корректно
    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_level=os.getenv("LOG_LEVEL", "info"),
        workers=1,                      # при встроенном запуске оставляем 1 процесс
        loop="auto",
        lifespan="on",                  # чтобы fastapi lifespan-события отрабатывали
        proxy_headers=True,
        forwarded_allow_ips="*",
    )
    server = uvicorn.Server(config)

    # Флаги завершения по сигналам
    def _handle_exit_signal(*_: object) -> None:
        server.should_exit = True

    signal.signal(signal.SIGINT, _handle_exit_signal)
    signal.signal(signal.SIGTERM, _handle_exit_signal)

    try:
        server.run()
    finally:
        # Останов бота и ожидание потока
        try:
            bot_thread.stop()
        except Exception:
            pass
        bot_thread.join(timeout=10)

        # Если в потоке бота была ошибка — пробрасываем её наверх
        if bot_thread.exception:
            raise bot_thread.exception


if __name__ == "__main__":
    main()
