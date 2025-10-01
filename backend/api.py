"""FastAPI routes serving chat data for the mobile client."""
from __future__ import annotations

import os
from typing import List

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import database
from .telegram_bot import bot

API_TOKEN = os.getenv("MOBILE_API_TOKEN")


class ReplyRequest(BaseModel):
    chat_id: int
    text: str


def require_token(x_api_token: str | None = Header(default=None)) -> None:
    if API_TOKEN and x_api_token != API_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid API token")


app = FastAPI(title="Telegram Mobile Companion API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)


@app.get("/chats", response_model=List[dict])
def list_chats(_: None = Depends(require_token)):
    return database.list_chats()


@app.get("/chats/{chat_id}/messages", response_model=List[dict])
def get_chat_messages(chat_id: int, limit: int = 50, _: None = Depends(require_token)):
    return database.get_messages(chat_id, limit=limit)


@app.post("/messages/send")
def send_message(request: ReplyRequest, _: None = Depends(require_token)):
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Message text can not be empty")
    try:
        sent_message = bot.send_message(request.chat_id, request.text)
    except Exception as exc:  # pragma: no cover - depends on Telegram API
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    database.save_message(
        chat_id=request.chat_id,
        direction="outgoing",
        text=request.text,
        message_id=sent_message.message_id,
        author="bot",
        chat_title=sent_message.chat.title or sent_message.chat.username or str(sent_message.chat.id),
        username=sent_message.chat.username,
        chat_type=sent_message.chat.type,
    )
    return {"status": "ok", "message_id": sent_message.message_id}