"""Entry point launching both the Telegram bot and the HTTP API."""
from __future__ import annotations

import logging
import signal
import threading
from typing import Optional

import uvicorn
from requests import exceptions as requests_exceptions
from urllib3.exceptions import ReadTimeoutError

from . import require_env
from .api import app
from . import database
from .telegram_bot import bot
from .survey_service import start_periodic_surveys


logger = logging.getLogger(__name__)


class BotPollingThread(threading.Thread):
    def __init__(self) -> None:
        super().__init__(daemon=True)
        self._exception: Optional[BaseException] = None
        self._stopping = threading.Event()

    def run(self) -> None:  # pragma: no cover - long running thread
        while not self._stopping.is_set():
            try:
                try:
                    bot.delete_webhook(drop_pending_updates=False)
                except Exception:
                    logger.exception("Failed to delete Telegram webhook before polling")

                logger.info("Starting Telegram polling with callback_query updates enabled")
                bot.infinity_polling(
                    skip_pending=True,
                    timeout=20,
                    long_polling_timeout=20,
                    allowed_updates=["message", "callback_query"],
                )
            except (
                requests_exceptions.ReadTimeout,
                requests_exceptions.ConnectTimeout,
                requests_exceptions.ConnectionError,
                ReadTimeoutError,
            ) as exc:
                # Перехватываем сетевые таймауты, чтобы не падать и перезапускать polling
                logger.warning("Polling interrupted by network timeout, restarting: %s", exc)
                try:
                    bot.stop_polling()
                except Exception:
                    pass
                # Небольшая пауза, чтобы не попасть в бесконечный цикл при нестабильной сети
                self._stopping.wait(timeout=5)
                continue
            except BaseException as exc:  # pylint: disable=broad-except
                self._exception = exc
                break
            else:
                # infinity_polling завершилось без ошибок (например, при остановке)
                break

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




class SurveyDispatchThread(threading.Thread):
    """Periodically checks whether scheduled customer surveys should be sent."""

    INTERVAL_SECONDS = 3600

    def __init__(self) -> None:
        super().__init__(daemon=True)
        self._stopping = threading.Event()

    def run(self) -> None:
        logger.info("SurveyDispatchThread started (interval=%ds)", self.INTERVAL_SECONDS)
        while not self._stopping.is_set():
            try:
                result = start_periodic_surveys()
                if result.get("started_count"):
                    logger.info(
                        "SurveyDispatchThread: started %s scheduled survey session(s)",
                        result.get("started_count"),
                    )
            except Exception:
                logger.exception("SurveyDispatchThread: error during scheduled survey dispatch")
            self._stopping.wait(timeout=self.INTERVAL_SECONDS)
        logger.info("SurveyDispatchThread stopped")

    def stop(self) -> None:
        self._stopping.set()


class CleanupThread(threading.Thread):
    """Фоновый поток: каждый час удаляет закрытые диалоги старше 24 часов."""

    INTERVAL_SECONDS = 3600  # 1 hour

    def __init__(self) -> None:
        super().__init__(daemon=True)
        self._stopping = threading.Event()

    def run(self) -> None:
        logger.info("CleanupThread started (interval=%ds)", self.INTERVAL_SECONDS)
        while not self._stopping.is_set():
            try:
                removed = database.cleanup_expired_dialogs()
                if removed:
                    logger.info("CleanupThread: removed %d expired dialog(s)", removed)
            except Exception:
                logger.exception("CleanupThread: error during cleanup")
            self._stopping.wait(timeout=self.INTERVAL_SECONDS)
        logger.info("CleanupThread stopped")

    def stop(self) -> None:
        self._stopping.set()


def main() -> None:
    host = require_env("HOST")
    log_level = require_env("LOG_LEVEL")
    try:
        port = int(require_env("PORT"))
    except ValueError as exc:  # pragma: no cover - defensive
        raise RuntimeError("PORT must be an integer") from exc

    bot_thread = BotPollingThread()
    bot_thread.start()

    cleanup_thread = CleanupThread()
    cleanup_thread.start()

    survey_dispatch_thread = SurveyDispatchThread()
    survey_dispatch_thread.start()

    # Конфигурируем uvicorn как управляемый сервер, чтобы перехватывать сигналы и завершаться корректно
    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_level=log_level,
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

        # Останов фонового очистителя
        try:
            cleanup_thread.stop()
        except Exception:
            pass
        cleanup_thread.join(timeout=5)

        try:
            survey_dispatch_thread.stop()
        except Exception:
            pass
        survey_dispatch_thread.join(timeout=5)

        # Если в потоке бота была ошибка — пробрасываем её наверх
        if bot_thread.exception:
            raise bot_thread.exception


if __name__ == "__main__":
    main()
