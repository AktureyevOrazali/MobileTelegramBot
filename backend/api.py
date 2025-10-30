"""FastAPI routes serving chat data for the mobile client."""
from __future__ import annotations

import hashlib
import os
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import AliasChoices, BaseModel, EmailStr, Field

from . import database
from .telegram_bot import bot

API_TOKEN = os.getenv("MOBILE_API_TOKEN")
ONEC_INTEGRATION_TOKEN = os.getenv("ONEC_INTEGRATION_TOKEN")

ONEC_CHAT_ID_OFFSET = 9_000_000_000_000
ONEC_CHAT_ID_SPACE = 1_000_000_000_000

app = FastAPI(title="Telegram Mobile Companion API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

router = APIRouter()


ROLE_LABELS: Dict[str, str] = {
    database.ROLE_ADMIN: "Администратор",
    database.ROLE_MODERATOR: "Модератор",
    database.ROLE_VIEWER: "Пользователь",
}


class RegisterRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=5, max_length=100)


class LoginRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=150)
    password: str


class ReplyRequest(BaseModel):
    chat_id: int
    text: str
    dialog_id: int | None = None


class OneCIncomingMessageRequest(BaseModel):
    external_chat_id: str = Field(min_length=1, max_length=128)
    text: str = Field(min_length=1)
    bin: str = Field(min_length=3, max_length=32)
    author: str | None = Field(default=None, max_length=150)
    title: str | None = Field(default=None, max_length=150)
    section: str | None = Field(default=None, max_length=50)
    chat_id: int | None = None


class OneCMessageEntry(BaseModel):
    message_id: int | None = None
    chat_id: int
    dialog_id: int | None = None
    direction: str
    text: str
    author: str | None = None
    created_at: str
    section: str | None = None


class OneCMessagesResponse(BaseModel):
    status: str = Field(default="ok")
    external_chat_id: str
    chat_id: int
    dialog_id: int | None = None
    messages: List[OneCMessageEntry] = Field(default_factory=list)


class BinAssignmentResponse(BaseModel):
    bin: str
    assigned_at: str
    expires_at: str | None = None
    assigned_by: int | None = None


class UserResponse(BaseModel):
    id: int
    email: EmailStr
    login: str
    name: str
    created_at: str
    job_title: str = ""
    phone: str = ""
    bio: str = ""
    role: str
    sections: List[str] = Field(default_factory=list)
    bins: List[BinAssignmentResponse] = Field(default_factory=list)
    favorite_dialog_ids: List[int] = []


class AuthResponse(BaseModel):
    token: str
    user: UserResponse


class BinAssignmentRequest(BaseModel):
    bin: str = Field(min_length=1, max_length=100)
    expires_at: datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("expires_at", "expiresAt"),
        serialization_alias="expires_at",
    )


class RoleUpdateRequest(BaseModel):
    role: str = Field(min_length=3, max_length=20)


class SectionsUpdateRequest(BaseModel):
    sections: List[str] = Field(default_factory=list)


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=5, max_length=100)
    new_password: str = Field(min_length=5, max_length=100)


class PasswordResetRequest(BaseModel):
    new_password: str = Field(min_length=5, max_length=100)


class BinsUpdateRequest(BaseModel):
    bins: List[BinAssignmentRequest] = Field(default_factory=list)


class UnassignedBinResponse(BaseModel):
    bin: str
    open_dialogs: int


class MessageResponse(BaseModel):
    id: int
    message_id: int | None = None
    chat_id: int
    direction: str
    text: str
    author: str | None
    created_at: str
    section: str | None = None
    section_title: str | None = None
    dialog_id: int | None = None


class ChatResponse(BaseModel):
    chat_id: int
    dialog_id: int
    title: str
    username: str | None
    type: str
    updated_at: str
    dialog_started_at: str
    dialog_closed_at: str | None = None
    section: str | None = None
    section_title: str | None = None
    bin: str | None = None
    is_favorite: bool = False


class NotificationResponse(BaseModel):
    type: str = Field(default="message")
    chat_id: int | None = None
    chat_title: str | None = None
    text: str
    created_at: str
    section: str | None = None
    section_title: str | None = None
    bin: str | None = None
    dialog_id: int | None = None


class DashboardSectionStat(BaseModel):
    section: Optional[str] = None
    title: str
    dialogs: int
    percentage: float


class DashboardTopQuestion(BaseModel):
    question: str
    count: int


class DashboardSectionQuestions(BaseModel):
    section: Optional[str] = None
    title: str
    questions: List[DashboardTopQuestion]


class DashboardAgentStat(BaseModel):
    name: str
    dialogs: int
    messages: int
    avg_messages_per_dialog: float
    last_activity: Optional[str] = None


class DashboardActivityPoint(BaseModel):
    date: str
    dialogs: int
    incoming_messages: int


class DashboardSummaryResponse(BaseModel):
    total_dialogs: int
    open_dialogs: int
    closed_dialogs: int
    total_chats: int
    total_messages: int
    total_incoming_messages: int
    total_outgoing_messages: int
    average_messages_per_dialog: float
    avg_dialog_duration_minutes: float | None = None
    avg_response_time_minutes: float | None = None
    avg_response_time_seconds: float | None = None
    section_breakdown: List[DashboardSectionStat]
    top_questions: List[DashboardTopQuestion]
    questions_by_section: List[DashboardSectionQuestions]
    agent_breakdown: List[DashboardAgentStat]
    recent_activity: List[DashboardActivityPoint]
    updated_at: str


def require_api_token(x_api_token: str | None = Header(default=None, alias="X-Api-Token")) -> None:
    if API_TOKEN and x_api_token != API_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid API token")


def require_onec_token(
    x_integration_token: str | None = Header(default=None, alias="X-Integration-Token")
) -> None:
    if not ONEC_INTEGRATION_TOKEN:
        raise HTTPException(status_code=503, detail="1C integration token is not configured")
    if x_integration_token != ONEC_INTEGRATION_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid integration token")


def get_current_user(
    _: None = Depends(require_api_token),
    x_session_token: str | None = Header(default=None, alias="X-Session-Token"),
) -> Dict[str, object]:
    if not x_session_token:
        raise HTTPException(status_code=401, detail="Session token required")
    user = database.get_user_by_session(x_session_token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid session token")
    return _sanitize_user(user)


def require_admin(current_user: Dict[str, object] = Depends(get_current_user)) -> Dict[str, object]:
    if current_user["role"] != database.ROLE_ADMIN:
        raise HTTPException(status_code=403, detail="Administrator role required")
    return current_user


def _sanitize_user(user: Dict[str, object]) -> Dict[str, object]:
    user_id = user["id"]
    sections = user.get("sections") or database.get_user_sections(user_id)
    favorites = database.list_favorite_dialog_ids(user_id)
    raw_bins = user.get("bins")
    if raw_bins and all(isinstance(assignment, dict) for assignment in raw_bins):
        bins = raw_bins
    else:
        bins = database.get_user_bin_assignments(user_id)
    return {
        "id": user_id,
        "email": user["email"],
        "login": user.get("login", ""),
        "name": user["name"],
        "created_at": user["created_at"],
        "job_title": user.get("job_title", ""),
        "phone": user.get("phone", ""),
        "bio": user.get("bio", ""),
        "role": user.get("role", database.ROLE_VIEWER),
        "sections": sections,
        "bins": bins,
        "favorite_dialog_ids": favorites,
    }


@router.post("/auth/register", response_model=AuthResponse)
def register_user(request: RegisterRequest, _: None = Depends(require_api_token)):
    existing = database.find_user_by_email(request.email)
    if existing:
        raise HTTPException(status_code=409, detail="User already exists")
    password_hash = hashlib.sha256(request.password.encode("utf-8")).hexdigest()
    user = database.create_user(
        request.email,
        request.name,
        password_hash,
        login=request.email,
        role=database.ROLE_VIEWER,
    )
    # Refresh from DB to include persisted metadata
    created_user = database.get_user_by_id(user["id"])
    if created_user is None:
        raise HTTPException(status_code=500, detail="Failed to create user")
    token = database.create_session(user["id"])
    return AuthResponse(token=token, user=UserResponse(**_sanitize_user(created_user)))


@router.post("/auth/login", response_model=AuthResponse)
def login_user(request: LoginRequest, _: None = Depends(require_api_token)):
    user = database.find_user_by_identifier(request.identifier)
    password_hash = hashlib.sha256(request.password.encode("utf-8")).hexdigest()
    if not user or user["password_hash"] != password_hash:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = database.create_session(user["id"])
    sanitized = _sanitize_user(user)
    return AuthResponse(token=token, user=UserResponse(**sanitized))


@router.get("/profile")
def get_profile(current_user: Dict[str, object] = Depends(get_current_user)):
    return UserResponse(**current_user)


class ProfileUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    job_title: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=50)
    bio: str | None = Field(default=None, max_length=500)
    email: EmailStr | None = None


@router.put("/profile", response_model=UserResponse)
def update_profile(
    request: ProfileUpdateRequest,
    current_user: Dict[str, object] = Depends(get_current_user),
):
    payload = {
        "name": request.name if request.name is not None else current_user["name"],
        "job_title": request.job_title if request.job_title is not None else current_user.get("job_title", ""),
        "phone": request.phone if request.phone is not None else current_user.get("phone", ""),
        "bio": request.bio if request.bio is not None else current_user.get("bio", ""),
        "email": request.email if request.email is not None else current_user.get("email"),
    }
    try:
        updated = database.update_user_profile(
            current_user["id"],
            name=payload["name"],
            job_title=payload["job_title"],
            phone=payload["phone"],
            bio=payload["bio"],
            email=payload["email"],
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return UserResponse(**updated)


@router.put("/profile/password", response_model=AuthResponse)
def change_password(
    request: PasswordChangeRequest,
    current_user: Dict[str, object] = Depends(get_current_user),
):
    current_hash = hashlib.sha256(request.current_password.encode("utf-8")).hexdigest()
    try:
        is_valid = database.verify_user_password(current_user["id"], current_hash)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if not is_valid:
        raise HTTPException(status_code=400, detail="Текущий пароль указан неверно")
    new_hash = hashlib.sha256(request.new_password.encode("utf-8")).hexdigest()
    try:
        database.update_user_password(current_user["id"], new_hash)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    fresh = database.get_user_by_id(current_user["id"])
    if fresh is None:
        raise HTTPException(status_code=404, detail="User not found")
    sanitized = _sanitize_user(fresh)
    token = database.create_session(current_user["id"])
    return AuthResponse(token=token, user=UserResponse(**sanitized))


@router.get("/users", response_model=List[UserResponse])
def list_users_admin(
    query: str | None = None,
    _: Dict[str, object] = Depends(require_admin),
):
    users = database.list_users(query=query)
    return [UserResponse(**_sanitize_user(user)) for user in users]


@router.put("/users/{user_id}/role", response_model=UserResponse)
def set_user_role(
    user_id: int,
    request: RoleUpdateRequest,
    current_admin: Dict[str, object] = Depends(require_admin),
):
    desired_role = request.role.strip()
    if desired_role not in database.ALL_ROLES:
        raise HTTPException(status_code=400, detail="Unknown role")
    if user_id == current_admin["id"] and desired_role != database.ROLE_ADMIN:
        raise HTTPException(status_code=400, detail="Администратор не может снять собственные права")
    try:
        updated = database.update_user_role(user_id, desired_role)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return UserResponse(**_sanitize_user(updated))


@router.put("/users/{user_id}/password", response_model=UserResponse)
def admin_set_user_password(
    user_id: int,
    request: PasswordResetRequest,
    _: Dict[str, object] = Depends(require_admin),
):
    new_hash = hashlib.sha256(request.new_password.encode("utf-8")).hexdigest()
    try:
        database.update_user_password(user_id, new_hash)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    fresh = database.get_user_by_id(user_id)
    if fresh is None:
        raise HTTPException(status_code=404, detail="User not found")
    return UserResponse(**_sanitize_user(fresh))


@router.put("/users/{user_id}/sections", response_model=UserResponse)
def set_user_sections_endpoint(
    user_id: int,
    request: SectionsUpdateRequest,
    current_admin: Dict[str, object] = Depends(require_admin),
):
    # Ensure target user exists
    user = database.get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user_id == current_admin["id"]:
        # Admin may adjust own sections but they already see all chats; allow update but ignore? We'll allow.
        pass
    valid_ids = {section["id"] for section in database.SECTIONS}
    invalid = [section_id for section_id in request.sections if section_id not in valid_ids]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Unknown sections: {', '.join(invalid)}")
    updated_sections = database.set_user_sections(user_id, request.sections)
    sanitized = _sanitize_user({**user, "sections": updated_sections})
    return UserResponse(**sanitized)


@router.put("/users/{user_id}/bins", response_model=UserResponse)
def set_user_bins_endpoint(
    user_id: int,
    request: BinsUpdateRequest,
    current_admin: Dict[str, object] = Depends(require_admin),
):
    user = database.get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    updated_bins = database.set_user_bins(user_id, request.bins, assigned_by=current_admin["id"])
    sanitized = _sanitize_user({**user, "bins": updated_bins})
    return UserResponse(**sanitized)


@router.delete("/users/{user_id}")
def delete_user_endpoint(
    user_id: int,
    current_admin: Dict[str, object] = Depends(require_admin),
):
    if user_id == current_admin["id"]:
        raise HTTPException(status_code=400, detail="Нельзя удалить собственный аккаунт")
    try:
        database.delete_user(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


@router.get("/roles")
def list_roles(_: Dict[str, object] = Depends(require_admin)):
    return [
        {"id": role, "title": ROLE_LABELS.get(role, role)}
        for role in database.ALL_ROLES
    ]


@router.get("/sections")
def list_sections(_: Dict[str, object] = Depends(get_current_user)):
    return database.SECTIONS


@router.get("/bins", response_model=List[str])
def list_bins_endpoint(
    query: str | None = None,
    _: Dict[str, object] = Depends(get_current_user),
):
    return database.list_bins(query)


@router.get("/bins/unassigned", response_model=List[UnassignedBinResponse])
def list_unassigned_bins_endpoint(
    _: Dict[str, object] = Depends(require_admin),
):
    return [UnassignedBinResponse(**item) for item in database.list_unassigned_bins()]


@router.get("/bins/pending", response_model=List[UnassignedBinResponse])
def list_pending_bins_endpoint(
    _: Dict[str, object] = Depends(require_admin),
):
    """Legacy alias for clients expecting the previous endpoint path."""
    return list_unassigned_bins_endpoint()


@router.get("/faq")
def list_faq(_: Dict[str, object] = Depends(get_current_user)):
    return database.list_faq()


@router.get("/analytics/dashboard", response_model=DashboardSummaryResponse)
def dashboard_summary(
    operator_id: int | None = Query(default=None),
    _: Dict[str, object] = Depends(require_admin),
):
    summary = database.get_dashboard_summary(operator_id=operator_id)
    return DashboardSummaryResponse(**summary)


@router.get("/chats", response_model=List[ChatResponse])
def list_chats(
    favorite_only: bool = False,
    bin_query: str | None = None,
    current_user: Dict[str, object] = Depends(get_current_user),
):
    chats = database.list_chats_for_user(
        current_user["id"],
        current_user["role"],
        favorite_only=favorite_only,
        bin_query=bin_query,
    )
    enriched: List[ChatResponse] = []
    def _normalize(value: object, *, fallback: Optional[str] = None) -> str:
        if value is None:
            return fallback or datetime.utcnow().isoformat()
        if isinstance(value, datetime):
            return value.isoformat()
        return str(value)

    for chat in chats:
        section_id = chat.get("section")
        section_title = None
        if section_id:
            section = next((s for s in database.SECTIONS if s["id"] == section_id), None)
            if section:
                section_title = section["title"]
        enriched.append(
            ChatResponse(
                chat_id=int(chat["chat_id"]),
                dialog_id=int(chat["dialog_id"]),
                title=str(chat["title"]),
                username=chat.get("username"),
                type=str(chat["type"]),
                updated_at=_normalize(chat.get("updated_at")),
                dialog_started_at=_normalize(chat.get("dialog_started_at")),
                dialog_closed_at=
                    _normalize(chat.get("dialog_closed_at"))
                    if chat.get("dialog_closed_at")
                    else None,
                section=section_id,
                section_title=section_title,
                bin=chat.get("bin"),
                is_favorite=bool(chat.get("is_favorite")),
            )
        )
    return enriched


@router.get("/chats/{chat_id}/messages", response_model=List[MessageResponse])
def get_chat_messages(
    chat_id: int,
    limit: int = 50,
    dialog_id: int | None = None,
    current_user: Dict[str, object] = Depends(get_current_user),
):
    if dialog_id is not None:
        dialog = database.get_chat_dialog(dialog_id)
        if dialog is None or dialog["chat_id"] != chat_id:
            raise HTTPException(status_code=404, detail="Диалог не найден")
    if not database.user_can_access_chat(
        current_user["id"], current_user["role"], chat_id, dialog_id
    ):
        raise HTTPException(status_code=403, detail="Нет доступа к диалогу")
    allowed_sections = None
    if current_user["role"] != database.ROLE_ADMIN:
        allowed_sections = current_user.get("sections") or []
    messages = database.get_messages(
        chat_id,
        limit=limit,
        allowed_sections=allowed_sections,
        dialog_id=dialog_id,
    )
    result: List[MessageResponse] = []
    for message in messages:
        section_id = message.get("section")
        section_title = None
        if section_id:
            section = next((s for s in database.SECTIONS if s["id"] == section_id), None)
            if section:
                section_title = section["title"]
        stored_message_id = message.get("message_id")
        resolved_message_id = (
            int(stored_message_id)
            if stored_message_id is not None
            else int(message["id"])
        )
        result.append(
            MessageResponse(
                id=int(message["id"]),
                message_id=resolved_message_id,
                chat_id=int(message["chat_id"]),
                direction=str(message["direction"]),
                text=str(message["text"]),
                author=message.get("author"),
                created_at=str(message["created_at"]),
                section=section_id,
                section_title=section_title,
                dialog_id=message.get("dialog_id"),
            )
        )
    return result


def _resolve_onec_chat_id(external_chat_id: str, explicit_chat_id: int | None) -> int:
    if explicit_chat_id is not None:
        return explicit_chat_id
    digest = hashlib.sha256(external_chat_id.encode("utf-8")).digest()
    hashed = int.from_bytes(digest[:8], "big")
    return ONEC_CHAT_ID_OFFSET + (hashed % ONEC_CHAT_ID_SPACE)


def _normalize_optional(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


@router.post("/messages/send")
def send_message(request: ReplyRequest, current_user: Dict[str, object] = Depends(get_current_user)):
    if current_user["role"] not in (database.ROLE_ADMIN, database.ROLE_MODERATOR):
        raise HTTPException(status_code=403, detail="Недостаточно прав для отправки сообщений")
    if request.dialog_id is not None:
        dialog = database.get_chat_dialog(request.dialog_id)
        if dialog is None or dialog["chat_id"] != request.chat_id:
            raise HTTPException(status_code=404, detail="Диалог не найден")
    if not database.user_can_access_chat(
        current_user["id"], current_user["role"], request.chat_id, request.dialog_id
    ):
        raise HTTPException(status_code=403, detail="Нет доступа к выбранному диалогу")
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Message text can not be empty")
    
    chat = database.get_chat(request.chat_id)
    chat_type = chat.get("type") if chat else None
    if chat_type == "onec":
        section = chat.get("section") if chat else None
        resolved_dialog_id = request.dialog_id or database.get_active_chat_dialog_id(request.chat_id)
        chat_title = chat.get("title") if chat else None
        if not chat_title:
            bin_hint = chat.get("bin") if chat else None
            if bin_hint:
                chat_title = f"1C клиент {bin_hint}"
            else:
                chat_title = f"1C чат {request.chat_id}"
        inserted_id = database.save_message(
            chat_id=request.chat_id,
            direction="outgoing",
            text=request.text,
            message_id=None,
            author=current_user["name"],
            chat_title=chat_title,
            username=chat.get("username") if chat else None,
            chat_type=chat_type,
            section=section,
            dialog_id=resolved_dialog_id,
        )
        return {
            "status": "ok",
            "message_id": inserted_id,
            "operator": current_user["name"],
            "dialog_id": resolved_dialog_id,
        }
    try:
        sent_message = bot.send_message(request.chat_id, request.text)
    except Exception as exc:  # pragma: no cover - depends on Telegram API
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    section = None
    if chat:
        section = chat.get("section")
    resolved_dialog_id = request.dialog_id or database.get_active_chat_dialog_id(request.chat_id)
    database.save_message(
        chat_id=request.chat_id,
        direction="outgoing",
        text=request.text,
        message_id=sent_message.message_id,
        author=current_user["name"],
        chat_title=sent_message.chat.title or sent_message.chat.username or str(sent_message.chat.id),
        username=sent_message.chat.username,
        chat_type=sent_message.chat.type,
        section=section,
        dialog_id=resolved_dialog_id,
    )
    return {
        "status": "ok",
        "message_id": sent_message.message_id,
        "operator": current_user["name"],
        "dialog_id": resolved_dialog_id,
    }


@router.post("/integrations/1c/messages")
def create_onec_message(
    request: OneCIncomingMessageRequest,
    _: None = Depends(require_onec_token),
):
    section_id = _normalize_optional(request.section)
    if section_id and not any(section["id"] == section_id for section in database.SECTIONS):
        raise HTTPException(status_code=400, detail="Указан неизвестный раздел")

    bin_value = _normalize_optional(request.bin)
    if not bin_value:
        raise HTTPException(status_code=400, detail="BIN обязателен")

    external_chat_id = request.external_chat_id.strip()
    if not external_chat_id:
        raise HTTPException(status_code=400, detail="external_chat_id обязателен")

    message_text = request.text.strip()
    if not message_text:
        raise HTTPException(status_code=400, detail="Текст сообщения не может быть пустым")

    chat_id = _resolve_onec_chat_id(external_chat_id, request.chat_id)
    author = _normalize_optional(request.author)
    title_candidate = _normalize_optional(request.title)
    chat_title = title_candidate or f"1C клиент {bin_value}"

    database.upsert_chat(chat_id, chat_title, None, "onec")
    try:
        dialog_id = database.ensure_active_chat_dialog(chat_id, bin_value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:  # pragma: no cover - defensive branch
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    database.save_message(
        chat_id=chat_id,
        direction="incoming",
        text=message_text,
        message_id=None,
        author=author,
        chat_title=chat_title,
        username=None,
        chat_type="onec",
        section=section_id,
        dialog_id=dialog_id,
    )

    if section_id:
        database.set_chat_section(chat_id, section_id)

    return {
        "status": "ok",
        "chat_id": chat_id,
        "dialog_id": dialog_id,
    }


@router.get(
    "/integrations/1c/messages",
    response_model=OneCMessagesResponse,
)
def list_onec_messages(
    external_chat_id: str = Query(min_length=1, max_length=128),
    _: None = Depends(require_onec_token),
    chat_id: int | None = Query(default=None),
    dialog_id: int | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
):
    normalized_external = external_chat_id.strip()
    if not normalized_external:
        raise HTTPException(status_code=400, detail="external_chat_id обязателен")

    resolved_chat_id = _resolve_onec_chat_id(normalized_external, chat_id)

    if dialog_id is not None:
        dialog = database.get_chat_dialog(dialog_id)
        if dialog is None or dialog["chat_id"] != resolved_chat_id:
            raise HTTPException(status_code=404, detail="Диалог не найден")

    chat = database.get_chat(resolved_chat_id)
    if chat and chat.get("type") not in (None, "onec"):
        raise HTTPException(status_code=403, detail="Чат не предназначен для интеграции 1С")

    raw_messages = database.get_messages(
        resolved_chat_id,
        limit=limit,
        dialog_id=dialog_id,
    )

    messages: List[OneCMessageEntry] = []
    for message in reversed(raw_messages):
        stored_message_id = message.get("message_id")
        if stored_message_id is None:
            stored_message_id = message.get("id")
        created_at_value = message.get("created_at")
        if isinstance(created_at_value, datetime):
            created_at_iso = created_at_value.isoformat()
        else:
            created_at_iso = str(created_at_value)
        messages.append(
            OneCMessageEntry(
                message_id=int(stored_message_id)
                if stored_message_id is not None
                else None,
                chat_id=int(message["chat_id"]),
                dialog_id=message.get("dialog_id"),
                direction=str(message["direction"]),
                text=str(message["text"]),
                author=message.get("author"),
                created_at=created_at_iso,
                section=message.get("section"),
            )
        )

    resolved_dialog_id = dialog_id or database.get_active_chat_dialog_id(resolved_chat_id)

    return OneCMessagesResponse(
        external_chat_id=normalized_external,
        chat_id=resolved_chat_id,
        dialog_id=resolved_dialog_id,
        messages=messages,
    )


@router.post("/dialogs/{dialog_id}/favorite")
def mark_dialog_favorite(
    dialog_id: int,
    current_user: Dict[str, object] = Depends(get_current_user),
):
    dialog = database.get_chat_dialog(dialog_id)
    if dialog is None:
        raise HTTPException(status_code=404, detail="Диалог не найден")
    if not database.user_can_access_chat(
        current_user["id"], current_user["role"], dialog["chat_id"], dialog_id
    ):
        raise HTTPException(status_code=403, detail="Нет доступа к диалогу")
    database.set_favorite_dialog(current_user["id"], dialog_id, True)
    return {"status": "ok"}


@router.delete("/dialogs/{dialog_id}/favorite")
def unmark_dialog_favorite(
    dialog_id: int,
    current_user: Dict[str, object] = Depends(get_current_user),
):
    dialog = database.get_chat_dialog(dialog_id)
    if dialog is None:
        raise HTTPException(status_code=404, detail="Диалог не найден")
    if not database.user_can_access_chat(
        current_user["id"], current_user["role"], dialog["chat_id"], dialog_id
    ):
        raise HTTPException(status_code=403, detail="Нет доступа к диалогу")
    database.set_favorite_dialog(current_user["id"], dialog_id, False)
    return {"status": "ok"}


@router.delete("/chats/{chat_id}")
def delete_chat_endpoint(
    chat_id: int,
    _: Dict[str, object] = Depends(require_admin),
):
    chat = database.get_chat(chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="Диалог не найден")
    try:
        database.delete_chat(chat_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


@router.delete("/dialogs/{dialog_id}")
def delete_dialog_endpoint(
    dialog_id: int,
    _: Dict[str, object] = Depends(require_admin),
):
    try:
        database.delete_chat_dialog(dialog_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


@router.get("/updates", response_model=List[NotificationResponse])
def list_updates(
    since: Optional[str] = None,
    current_user: Dict[str, object] = Depends(get_current_user),
):
    since_dt: Optional[datetime] = None
    if since:
        try:
            since_dt = datetime.fromisoformat(since)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Некорректный формат времени") from exc
    updates = database.list_updates_since(current_user["id"], current_user["role"], since_dt)
    enriched: List[NotificationResponse] = []
    for entry in updates:
        created_at_value = entry.get("created_at")
        if isinstance(created_at_value, datetime):
            created_at_iso = created_at_value.isoformat()
        else:
            created_at_iso = str(created_at_value)
        entry_type = entry.get("type", "message")
        if entry_type == "message":
            section_id = entry.get("section")
            section_title = None
            if section_id:
                section = next((s for s in database.SECTIONS if s["id"] == section_id), None)
                if section:
                    section_title = section["title"]
            enriched.append(
                NotificationResponse(
                    type="message",
                    chat_id=entry.get("chat_id"),
                    chat_title=entry.get("chat_title"),
                    text=entry.get("text", ""),
                    created_at=created_at_iso,
                    section=section_id,
                    section_title=section_title,
                    bin=entry.get("bin"),
                    dialog_id=entry.get("dialog_id"),
                )
            )
            continue
        if entry_type == "bin_assigned":
            bin_value = entry.get("bin") or entry.get("metadata", {}).get("bin")
            message = "Вам назначен новый БИН."
            if bin_value:
                message = f"Вам назначен БИН {bin_value}."
            enriched.append(
                NotificationResponse(
                    type="bin_assignment",
                    chat_id=None,
                    chat_title=None,
                    text=message,
                    created_at=created_at_iso,
                    section=None,
                    section_title=None,
                    bin=bin_value,
                )
            )
        else:
            enriched.append(
                NotificationResponse(
                    type=str(entry_type),
                    chat_id=entry.get("chat_id"),
                    chat_title=entry.get("chat_title"),
                    text=entry.get("text", ""),
                    created_at=created_at_iso,
                    section=entry.get("section"),
                    section_title=None,
                    bin=entry.get("bin"),
                    dialog_id=entry.get("dialog_id"),
                )
            )
    return enriched


@app.get("/health")
def healthcheck() -> Dict[str, str]:
    return {"status": "ok"}


app.include_router(router)
app.include_router(router, prefix="/api")