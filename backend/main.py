"""Entry point launching both the Telegram bot and the HTTP API."""
from __future__ import annotations

import threading
from typing import Optional

import uvicorn

from .api import app
from .telegram_bot import bot


class BotPollingThread(threading.Thread):
    def __init__(self) -> None:
        super().__init__(daemon=True)
        self._exception: Optional[BaseException] = None

    def run(self) -> None:  # pragma: no cover - long running thread
        try:
            bot.infinity_polling(skip_pending=True)
        except BaseException as exc:  # pylint: disable=broad-except
            self._exception = exc

    @property
    def exception(self) -> Optional[BaseException]:
        return self._exception


def main() -> None:
    bot_thread = BotPollingThread()
    bot_thread.start()
    try:
        uvicorn.run(app, host="0.0.0.0", port=8000)
    finally:
        if bot_thread.exception:
            raise bot_thread.exception


if __name__ == "__main__":
    main()