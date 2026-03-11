"""FastAPI routes serving chat data for the mobile client."""
from __future__ import annotations

import logging
import hashlib
import hmac
import io
import json
import os
import re
from datetime import date, datetime, timezone
from typing import Dict, List, Optional, Literal
import asyncio
from collections import defaultdict

from fastapi import APIRouter, Body, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPBearer
from pydantic import AliasChoices, BaseModel, EmailStr, Field, validator

from . import database
from .ai_manager import ai_manager
from .telegram_bot import bot, enable_ai_session, send_ai_csat_request, send_csat_request
from . import contract_checker

# ------------------------ Temporary import for Aziret's employee cabinet ------------------
from .kabinet_sotrudnika_by_Aziret import kabinet_backend

API_TOKEN = os.getenv("MOBILE_API_TOKEN")
ONEC_INTEGRATION_TOKEN = os.getenv("ONEC_INTEGRATION_TOKEN")

ONEC_CHAT_ID_OFFSET = 9_000_000_000_000
ONEC_CHAT_ID_SPACE = 1_000_000_000_000

# Опциональный общий секрет для подписи HMAC нагрузки, которую 1С забирает из outbox
ONEC_SHARED_SECRET = os.getenv("ONEC_SHARED_SECRET", "")

CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]

app = FastAPI(title="MobileBot Companion API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")
security = HTTPBearer()

# ── SSE Event Bus ──
class EventBus:
    def __init__(self):
        # Maps user_id -> list of queues
        self.connections: dict[int, list[asyncio.Queue]] = defaultdict(list)
        self.loop: asyncio.AbstractEventLoop | None = None

    async def publish(self, user_id: int, event_type: str, data: dict):
        if user_id in self.connections:
            message = {"type": event_type, "data": data}
            for q in self.connections[user_id]:
                await q.put(message)

    async def publish_all(self, event_type: str, data: dict):
        message = {"type": event_type, "data": data}
        for qs in self.connections.values():
            for q in qs:
                await q.put(message)

event_bus = EventBus()

ROLE_LABELS: Dict[str, str] = {
    database.ROLE_ADMIN: "Администратор",
    database.ROLE_MODERATOR: "Модератор",
    database.ROLE_OPERATOR: "Оператор",
}


def _sign_payload(payload: dict) -> str:
    """HMAC-SHA256 подпись компактного JSON. Если секрет пуст — возвращает пустую строку."""
    if not ONEC_SHARED_SECRET:
        return ""
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return hmac.new(ONEC_SHARED_SECRET.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()


def _enqueue_onec_outgoing_message(
    *,
    message_id: int,
    chat_id: int,
    dialog_id: int | None,
    external_chat_id: str,
    bin_value: str | None,
    text: str,
    author: str | None,
    section: str | None,
    direction: str = "outgoing",
) -> None:
    payload = {
        "external_chat_id": external_chat_id,
        "chat_id": chat_id,
        "dialog_id": dialog_id,
        "text": text,
        "author": author,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds") + "Z",
        "bin": bin_value,
        "section": section,
        "direction": direction,
    }
    signature = _sign_payload(payload)
    if signature:
        payload["signature"] = signature
    try:
        database.outbox_enqueue_onec(
            message_id=message_id,
            chat_id=chat_id,
            external_chat_id=external_chat_id,
            bin_value=bin_value,
            payload=payload,
        )
    except Exception as exc:  # pragma: no cover - best-effort side effect
        logger.exception("Failed to enqueue 1C outbox message: %s", exc)


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
    is_approved: bool = True
    sections: List[str] = Field(default_factory=list)
    bins: List[BinAssignmentResponse] = Field(default_factory=list)
    favorite_dialog_ids: List[int] = []


class AuthResponse(BaseModel):
    token: str
    user: UserResponse


class RegisterResponse(BaseModel):
    status: str = "pending"
    message: str = "Регистрация отправлена. Ожидайте подтверждения модератора."


class PendingUserResponse(BaseModel):
    id: int
    email: EmailStr
    name: str
    created_at: str


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
    has_contract: bool = True


class OrganizationWithoutContractResponse(BaseModel):
    customer_bin: str
    customer_legal_address: str | None = None
    customer_bank_name_ru: str | None = None
    created_at: str


class BinDetailedResponse(BaseModel):
    bin: str
    has_contract: bool
    customer_legal_address: str | None = None
    customer_bank_name_ru: str | None = None


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
    operator_mode: bool = False
    unread_count: int = 0
    last_message_text: str | None = None
    last_message_direction: str | None = None
    last_message_author: str | None = None


class DialogStatusResponse(BaseModel):
    status: str = Field(default="ok")
    chat_id: int
    dialog_id: int
    dialog_closed_at: str | None = None
    ai_enabled: bool = True


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
    questions: List[DashboardTopQuestion] = Field(default_factory=list)


class DashboardAgentStat(BaseModel):
    name: str
    dialogs: int
    messages: int
    avg_messages_per_dialog: float
    avg_response_time_minutes: float | None = None
    last_activity: Optional[str] = None
    avg_csat: float | None = None


class DashboardActivityPoint(BaseModel):
    date: str
    dialogs: int
    incoming_messages: int


class DashboardResponseTimeDialog(BaseModel):
    chat_id: int | None = None
    dialog_id: int | None = None
    author: str
    response_time_minutes: float


class DashboardTopBin(BaseModel):
    bin: str
    requests: int


class DashboardHeatmapPoint(BaseModel):
    day_of_week: int
    hour: int
    count: int

class DashboardDialogMetric(BaseModel):
    dialog_id: int
    bin: str | None
    is_open: bool
    is_ai_closed: bool
    response_time_minutes: float | None
    csat_rating: int | None = None
    ai_csat_rating: int | None = None

class CsatDistributionEntry(BaseModel):
    rating: int
    count: int


class DashboardSummaryResponse(BaseModel):
    total_dialogs: int
    open_dialogs: int
    closed_dialogs: int
    total_chats: int
    total_messages: int
    total_incoming_messages: int
    total_outgoing_messages: int
    ai_closed_dialogs: int = 0
    transferred_to_operator_dialogs: int = 0
    avg_messages_before_transfer: float | None = None
    ai_messages_count: int = 0
    requests_with_contract: int = 0
    requests_without_contract: int = 0
    recurring_requests_count: int = 0
    recurring_requests_percentage: float | None = None
    sla_violations_count: int = 0
    sla_compliance_percentage: float | None = None
    average_first_message_length: float | None = None
    average_messages_per_dialog: float
    avg_dialog_duration_minutes: float | None = None
    avg_response_time_minutes: float | None = None
    avg_response_time_seconds: float | None = None
    response_time_dialogs: List[DashboardResponseTimeDialog] = Field(default_factory=list)
    section_breakdown: List[DashboardSectionStat] = Field(default_factory=list)
    top_questions: List[DashboardTopQuestion] = Field(default_factory=list)
    questions_by_section: List[DashboardSectionQuestions] = Field(default_factory=list)
    agent_breakdown: List[DashboardAgentStat] = Field(default_factory=list)
    recent_activity: List[DashboardActivityPoint] = Field(default_factory=list)
    top_bins_without_contract: List[DashboardTopBin] = Field(default_factory=list)
    top_bins_with_contract: List[DashboardTopBin] = Field(default_factory=list)
    peak_load_heatmap: List[DashboardHeatmapPoint] = Field(default_factory=list)
    dialog_metrics: List[DashboardDialogMetric] = Field(default_factory=list)
    csat_average: float | None = None
    csat_count: int = 0
    csat_distribution: List[CsatDistributionEntry] = Field(default_factory=list)
    ai_csat_average: float | None = None
    ai_csat_count: int = 0
    ai_csat_distribution: List[CsatDistributionEntry] = Field(default_factory=list)
    updated_at: str


def require_api_token(
    x_api_token: str | None = Header(default=None, alias="X-Api-Token"),
    api_token: str | None = Query(default=None, alias="api_token"),
) -> None:
    if not API_TOKEN:
        raise HTTPException(status_code=503, detail="API token is not configured")
    token_to_check = x_api_token or api_token
    if token_to_check != API_TOKEN:
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
    session_token: str | None = Query(default=None, alias="session_token"),
) -> Dict[str, object]:
    token_to_check = x_session_token or session_token
    if not token_to_check:
        raise HTTPException(status_code=401, detail="Session token required")
    user = database.get_user_by_session(token_to_check)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid session token")
    return _sanitize_user(user)


@router.get("/stream")
async def sse_endpoint(request: Request, current_user: Dict[str, object] = Depends(get_current_user)):
    user_id = current_user["id"]
    queue = asyncio.Queue()
    event_bus.connections[user_id].append(queue)
    logger.info("SSE client connected: user_id=%s", user_id)

    async def event_generator():
        try:
            while True:
                # If client closes connection, request.is_disconnected() will be true 
                # but run in next tick, so asyncio.wait allows us to detect it
                if await request.is_disconnected():
                    break
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=1.0)
                    yield f"data: {json.dumps(message, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    # Keep-alive heartbeat
                    yield ": keepalive\n\n"
        finally:
            logger.info("SSE client disconnected: user_id=%s", user_id)
            if queue in event_bus.connections[user_id]:
                event_bus.connections[user_id].remove(queue)
            if not event_bus.connections[user_id]:
                del event_bus.connections[user_id]

    return StreamingResponse(event_generator(), media_type="text/event-stream")


def require_admin_or_moderator(
    current_user: Dict[str, object] = Depends(get_current_user),
) -> Dict[str, object]:
    if not database.is_admin_like(current_user["role"]):
        raise HTTPException(status_code=403, detail="Administrator role required")
    return current_user


def _ensure_moderator_can_manage(current_user: Dict[str, object], target_user: Dict[str, object]) -> None:
    if current_user["role"] == database.ROLE_MODERATOR:
        if target_user["role"] != database.ROLE_OPERATOR:
            raise HTTPException(status_code=403, detail="Недостаточно прав для управления этим пользователем")


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
        "role": user.get("role", database.ROLE_OPERATOR),
        "is_approved": bool(user.get("is_approved", True)),
        "sections": sections,
        "bins": bins,
        "favorite_dialog_ids": favorites,
    }


@router.post("/auth/register", response_model=RegisterResponse)
def register_user(request: RegisterRequest, _: None = Depends(require_api_token)):
    logger.info("Registration attempt for email=%s", request.email)
    existing = database.find_user_by_email(request.email)
    if existing:
        logger.warning("Registration rejected: email=%s already exists", request.email)
        raise HTTPException(status_code=409, detail="User already exists")
    password_hash = hashlib.sha256(request.password.encode("utf-8")).hexdigest()
    try:
        created_user = database.create_user(
            request.email,
            request.name,
            password_hash,
            login=request.email,
            role=database.ROLE_OPERATOR,
            is_approved=False,
        )
    except ValueError as exc:
        logger.warning("Registration failed for email=%s: %s", request.email, exc)
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if created_user is None or created_user.get("id") is None:
        logger.error("Registration failed for email=%s: user not created", request.email)
        raise HTTPException(status_code=500, detail="Failed to create user")
    logger.info("Registration successful: email=%s, user_id=%s", request.email, created_user["id"])
    return RegisterResponse()


@router.post("/auth/login", response_model=AuthResponse)
def login_user(request: LoginRequest, _: None = Depends(require_api_token)):
    logger.info("Login attempt for identifier=%s", request.identifier)
    user = database.find_user_by_identifier(request.identifier)
    password_hash = hashlib.sha256(request.password.encode("utf-8")).hexdigest()
    if not user or user["password_hash"] != password_hash:
        logger.warning("Login failed: invalid credentials for identifier=%s", request.identifier)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.get("is_approved", True):
        logger.warning("Login blocked: user_id=%s not approved", user["id"])
        raise HTTPException(status_code=403, detail="Аккаунт ожидает подтверждения модератора")
    token = database.create_session(user["id"])
    logger.info("Login successful: user_id=%s, role=%s", user["id"], user.get("role"))
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
    _: Dict[str, object] = Depends(require_admin_or_moderator),
):
    users = database.list_users(query=query)
    return [UserResponse(**_sanitize_user(user)) for user in users]


@router.get("/users/pending", response_model=List[PendingUserResponse])
def list_pending_users(
    _: Dict[str, object] = Depends(require_admin_or_moderator),
):
    pending = database.list_pending_users()
    return [
        PendingUserResponse(
            id=user["id"],
            email=user["email"],
            name=user["name"],
            created_at=user["created_at"],
        )
        for user in pending
    ]


@router.post("/users/{user_id}/approve", response_model=UserResponse)
def approve_user_registration(
    user_id: int,
    current_admin: Dict[str, object] = Depends(require_admin_or_moderator),
):
    user = database.get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    _ensure_moderator_can_manage(current_admin, user)
    if user.get("is_approved", True):
        raise HTTPException(status_code=400, detail="Аккаунт уже подтверждён")
    updated = database.set_user_approved(user_id, True)
    return UserResponse(**_sanitize_user(updated))


@router.post("/users/{user_id}/reject")
def reject_user_registration(
    user_id: int,
    current_admin: Dict[str, object] = Depends(require_admin_or_moderator),
):
    user = database.get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    _ensure_moderator_can_manage(current_admin, user)
    if user.get("is_approved", True):
        raise HTTPException(status_code=400, detail="Аккаунт уже подтверждён")
    database.delete_user(user_id)
    return {"status": "ok"}


@router.put("/users/{user_id}/role", response_model=UserResponse)
def set_user_role(
    user_id: int,
    request: RoleUpdateRequest,
    current_admin: Dict[str, object] = Depends(require_admin_or_moderator),
):
    desired_role = request.role.strip()
    if desired_role not in database.ALL_ROLES:
        raise HTTPException(status_code=400, detail="Unknown role")
    target_user = database.get_user_by_id(user_id)
    if target_user is None:
        raise HTTPException(status_code=404, detail="User not found")
    _ensure_moderator_can_manage(current_admin, target_user)
    if current_admin["role"] == database.ROLE_MODERATOR and desired_role != database.ROLE_OPERATOR:
        raise HTTPException(status_code=403, detail="Недостаточно прав для назначения этой роли")
    if user_id == current_admin["id"] and current_admin["role"] == database.ROLE_ADMIN and desired_role != database.ROLE_ADMIN:
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
    current_admin: Dict[str, object] = Depends(require_admin_or_moderator),
):
    target_user = database.get_user_by_id(user_id)
    if target_user is None:
        raise HTTPException(status_code=404, detail="User not found")
    _ensure_moderator_can_manage(current_admin, target_user)
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
    current_admin: Dict[str, object] = Depends(require_admin_or_moderator),
):
    # Ensure target user exists
    user = database.get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    _ensure_moderator_can_manage(current_admin, user)
    if user_id == current_admin["id"]:
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
    current_admin: Dict[str, object] = Depends(require_admin_or_moderator),
):
    user = database.get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    _ensure_moderator_can_manage(current_admin, user)
    updated_bins = database.set_user_bins(user_id, request.bins, assigned_by=current_admin["id"])
    sanitized = _sanitize_user({**user, "bins": updated_bins})
    return UserResponse(**sanitized)


@router.delete("/users/{user_id}")
def delete_user_endpoint(
    user_id: int,
    current_admin: Dict[str, object] = Depends(require_admin_or_moderator),
):
    if user_id == current_admin["id"]:
        raise HTTPException(status_code=400, detail="Нельзя удалить собственный аккаунт")
    target_user = database.get_user_by_id(user_id)
    if target_user is None:
        raise HTTPException(status_code=404, detail="User not found")
    _ensure_moderator_can_manage(current_admin, target_user)
    try:
        database.delete_user(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


@router.get("/roles")
def list_roles(_: Dict[str, object] = Depends(require_admin_or_moderator)):
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


@router.delete("/bins/{bin_value}")
def delete_bin_endpoint(
    bin_value: str,
    _: Dict[str, object] = Depends(require_admin_or_moderator),
):
    """Удаляет БИН из базы."""
    removed = database.remove_bin(bin_value)
    if not removed:
        raise HTTPException(status_code=404, detail="БИН не найден")
    return {"status": "ok"}


@router.get("/bins/detailed", response_model=List[BinDetailedResponse])
def list_bins_detailed_endpoint(
    query: str | None = None,
    _: Dict[str, object] = Depends(require_admin_or_moderator),
):
    """Возвращает список БИНов с информацией о наличии договора."""
    bins = database.list_bins(query)
    
    # Загружаем все контракты одним запросом (кэш 30 минут)
    bins_with_contracts = contract_checker.get_all_customer_bins_with_contracts()
    
    # Get organizations without contracts for quick lookup
    orgs_without_contracts = {
        org["customer_bin"]: org
        for org in database.list_organizations_without_contracts()
    }
    
    result = []
    for bin_value in bins:
        org_data = orgs_without_contracts.get(bin_value)
        
        if bin_value in bins_with_contracts:
            # Has contract - use preloaded data
            # Если БИН был в без договора, но теперь есть договор — удаляем
            if org_data:
                database.remove_organization_without_contract(bin_value)
            contract_info = bins_with_contracts[bin_value]
            result.append(BinDetailedResponse(
                bin=bin_value,
                has_contract=True,
                customer_legal_address=contract_info.get("customer_legal_address"),
                customer_bank_name_ru=contract_info.get("customer_bank_name_ru"),
            ))
        elif org_data:
            # No contract - already in organizations_without_contracts
            result.append(BinDetailedResponse(
                bin=bin_value,
                has_contract=False,
                customer_legal_address=org_data.get("customer_legal_address"),
                customer_bank_name_ru=org_data.get("customer_bank_name_ru"),
            ))
        else:
            # No contract and not in without-contracts table
            # Get info from any historical contract for this BIN and ADD to table
            contract_data = contract_checker.check_customer_contracts(bin_value)
            has_contract = contract_data.get("has_contract", False)
            
            if not has_contract:
                # Автоматически добавляем в таблицу organizations_without_contracts
                database.add_organization_without_contract(
                    bin_value,
                    customer_legal_address=contract_data.get("customer_legal_address"),
                    customer_bank_name_ru=contract_data.get("customer_bank_name_ru"),
                )
            
            result.append(BinDetailedResponse(
                bin=bin_value,
                has_contract=has_contract,
                customer_legal_address=contract_data.get("customer_legal_address"),
                customer_bank_name_ru=contract_data.get("customer_bank_name_ru"),
            ))
    return result


@router.get("/bins/{bin_value}/info", response_model=BinDetailedResponse)
def get_bin_info_endpoint(
    bin_value: str,
    _: Dict[str, object] = Depends(require_admin_or_moderator),
):
    """Возвращает информацию о БИНе с проверкой договора через GraphQL."""
    contract_data = contract_checker.check_customer_contracts(bin_value)
    return BinDetailedResponse(
        bin=bin_value,
        has_contract=contract_data.get("has_contract", False),
        customer_legal_address=contract_data.get("customer_legal_address"),
        customer_bank_name_ru=contract_data.get("customer_bank_name_ru"),
    )


@router.get("/bins/unassigned", response_model=List[UnassignedBinResponse])
def list_unassigned_bins_endpoint(
    _: Dict[str, object] = Depends(require_admin_or_moderator),
):
    return [UnassignedBinResponse(**item) for item in database.list_unassigned_bins()]


@router.post("/bins/sync")
def sync_bins_with_contracts_endpoint(
    _: Dict[str, object] = Depends(require_admin_or_moderator),
):
    """Синхронизирует все БИНы с информацией о договорах."""
    result = database.sync_bins_with_contracts()
    return {
        "status": "ok",
        **result,
    }


@router.get("/bins/pending", response_model=List[UnassignedBinResponse])
def list_pending_bins_endpoint(
    _: Dict[str, object] = Depends(require_admin_or_moderator),
):
    """Legacy alias for clients expecting the previous endpoint path."""
    return list_unassigned_bins_endpoint()


@router.get("/organizations/without-contracts", response_model=List[OrganizationWithoutContractResponse])
def list_organizations_without_contracts_endpoint(
    _: Dict[str, object] = Depends(require_admin_or_moderator),
):
    """Возвращает список организаций без действующих договоров."""
    return [OrganizationWithoutContractResponse(**item) for item in database.list_organizations_without_contracts()]


@router.get("/faq")
def list_faq(_: Dict[str, object] = Depends(get_current_user)):
    return database.list_faq()


# ------------------ Reply Templates (Шаблоны быстрых ответов) ------------------


class ReplyTemplateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=2000)
    section: str | None = None
    sort_order: int = 0


class ReplyTemplateResponse(BaseModel):
    id: int
    title: str
    text: str
    section: str | None = None
    section_title: str | None = None
    sort_order: int = 0
    created_by: int | None = None
    created_at: str


def _enrich_template(template: dict) -> dict:
    """Add section_title from SECTIONS list."""
    section_id = template.get("section")
    section_title = None
    if section_id:
        section = next((s for s in database.SECTIONS if s["id"] == section_id), None)
        if section:
            section_title = section["title"]
    return {**template, "section_title": section_title}


@router.get("/reply-templates", response_model=List[ReplyTemplateResponse])
def list_reply_templates(
    section: str | None = None,
    _: Dict[str, object] = Depends(get_current_user),
):
    templates = database.list_reply_templates(section=section)
    return [ReplyTemplateResponse(**_enrich_template(t)) for t in templates]


@router.post("/reply-templates", response_model=ReplyTemplateResponse)
def create_reply_template(
    request: ReplyTemplateRequest,
    current_user: Dict[str, object] = Depends(require_admin_or_moderator),
):
    template = database.create_reply_template(
        title=request.title,
        text=request.text,
        section=request.section,
        sort_order=request.sort_order,
        created_by=current_user["id"],
    )
    logger.info(
        "Reply template created: id=%s, title=%s, by user_id=%s",
        template["id"], template["title"], current_user["id"],
    )
    return ReplyTemplateResponse(**_enrich_template(template))


@router.put("/reply-templates/{template_id}", response_model=ReplyTemplateResponse)
def update_reply_template(
    template_id: int,
    request: ReplyTemplateRequest,
    _: Dict[str, object] = Depends(require_admin_or_moderator),
):
    try:
        template = database.update_reply_template(
            template_id,
            title=request.title,
            text=request.text,
            section=request.section,
            sort_order=request.sort_order,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    logger.info("Reply template updated: id=%s", template_id)
    return ReplyTemplateResponse(**_enrich_template(template))


@router.delete("/reply-templates/{template_id}")
def delete_reply_template(
    template_id: int,
    _: Dict[str, object] = Depends(require_admin_or_moderator),
):
    deleted = database.delete_reply_template(template_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Шаблон не найден")
    logger.info("Reply template deleted: id=%s", template_id)
    return {"status": "ok"}


@router.get("/analytics/dashboard", response_model=DashboardSummaryResponse)
def dashboard_summary(
    operator_id: int | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    _: Dict[str, object] = Depends(require_admin_or_moderator),
):
    summary = database.get_dashboard_summary(
        operator_id=operator_id,
        start_date=start_date,
        end_date=end_date,
    )
    return DashboardSummaryResponse(**summary)


@router.get("/analytics/export")
def export_dashboard(
    operator_id: int | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    format: str = Query(default="xlsx"),
    _: Dict[str, object] = Depends(require_admin_or_moderator),
):
    """Generate an Excel or PDF report from dashboard data."""
    summary = database.get_dashboard_summary(
        operator_id=operator_id,
        start_date=start_date,
        end_date=end_date,
    )

    def _fmt(value, suffix=""):
        if value is None:
            return "—"
        if isinstance(value, float):
            return f"{value:.1f}{suffix}"
        return f"{value}{suffix}"

    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    if format == "pdf":
        return _build_pdf_report(summary, _fmt, now_str)

    return _build_xlsx_report(summary, _fmt, now_str)


def _build_xlsx_report(summary: dict, _fmt, now_str: str):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.worksheet.table import Table, TableStyleInfo
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    header_font = Font(bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="6366F1", end_color="6366F1", fill_type="solid")
    header_align = Alignment(horizontal="center", vertical="center")
    thin_border = Border(
        left=Side(style="thin", color="E2E8F0"),
        right=Side(style="thin", color="E2E8F0"),
        top=Side(style="thin", color="E2E8F0"),
        bottom=Side(style="thin", color="E2E8F0"),
    )

    def _style_header(ws, headers: list[str]):
        for col_idx, header in enumerate(headers, 1):
            cell = ws.cell(row=1, column=col_idx, value=header)
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = header_align
            cell.border = thin_border

    def _auto_width(ws):
        for column_cells in ws.columns:
            max_len = 0
            col_letter = column_cells[0].column_letter
            for cell in column_cells:
                try:
                    if cell.value:
                        max_len = max(max_len, len(str(cell.value)))
                except Exception:
                    pass
            ws.column_dimensions[col_letter].width = min(max_len + 5, 60)

    def _add_table(ws, display_name: str, num_rows: int, num_cols: int):
        if num_rows <= 1:
            return
        ref = f"A1:{get_column_letter(num_cols)}{num_rows}"
        tab = Table(displayName=display_name.replace(" ", "_").replace("(", "").replace(")", ""), ref=ref)
        style = TableStyleInfo(name="TableStyleMedium9", showFirstColumn=False,
                               showLastColumn=False, showRowStripes=True, showColumnStripes=False)
        tab.tableStyleInfo = style
        ws.add_table(tab)

    # ── Sheet 1: Обзор ──
    ws = wb.active
    ws.title = "Обзор"
    headers1 = ["Метрика", "Значение"]
    _style_header(ws, headers1)
    overview_rows = [
        ("Всего диалогов", summary.get("total_dialogs", 0)),
        ("Открытых", summary.get("open_dialogs", 0)),
        ("Закрытых", summary.get("closed_dialogs", 0)),
        ("Всего чатов", summary.get("total_chats", 0)),
        ("Всего сообщений", summary.get("total_messages", 0)),
        ("Входящих", summary.get("total_incoming_messages", 0)),
        ("Исходящих", summary.get("total_outgoing_messages", 0)),
        ("Ср. сообщений/диалог", _fmt(summary.get("average_messages_per_dialog"))),
        ("Ср. время ответа (мин)", _fmt(summary.get("avg_response_time_minutes"), " мин")),
        ("Ср. длительность диалога (мин)", _fmt(summary.get("avg_dialog_duration_minutes"), " мин")),
        ("Решено ботом (AI)", summary.get("ai_closed_dialogs", 0)),
        ("Переведено оператору", summary.get("transferred_to_operator_dialogs", 0)),
        ("Сообщений от AI", summary.get("ai_messages_count", 0)),
        ("Нарушений SLA", summary.get("sla_violations_count", 0)),
        ("SLA (% соблюдения)", _fmt(summary.get("sla_compliance_percentage"), "%")),
        ("Повторных обращений", summary.get("recurring_requests_count", 0)),
        ("% повторных", _fmt(summary.get("recurring_requests_percentage"), "%")),
        ("С договором", summary.get("requests_with_contract", 0)),
        ("Без договора", summary.get("requests_without_contract", 0)),
    ]
    for row_idx, (metric, value) in enumerate(overview_rows, 2):
        ws.cell(row=row_idx, column=1, value=metric).border = thin_border
        ws.cell(row=row_idx, column=2, value=value).border = thin_border
    _add_table(ws, "OverviewTable", len(overview_rows)+1, 2)
    _auto_width(ws)

    # ── Sheet 2: Операторы ──
    ws2 = wb.create_sheet("Операторы")
    headers2 = ["Сотрудник", "Обращений", "Сообщений", "Ср. сообщ./обр.", "Ср. время ответа (мин)", "Последняя активность"]
    _style_header(ws2, headers2)
    agents = summary.get("agent_breakdown", [])
    for row_idx, agent in enumerate(agents, 2):
        ws2.cell(row=row_idx, column=1, value=agent.get("name", "")).border = thin_border
        ws2.cell(row=row_idx, column=2, value=agent.get("dialogs", 0)).border = thin_border
        ws2.cell(row=row_idx, column=3, value=agent.get("messages", 0)).border = thin_border
        ws2.cell(row=row_idx, column=4, value=_fmt(agent.get("avg_messages_per_dialog"))).border = thin_border
        ws2.cell(row=row_idx, column=5, value=_fmt(agent.get("avg_response_time_minutes"))).border = thin_border
        ws2.cell(row=row_idx, column=6, value=agent.get("last_activity", "—")).border = thin_border
    _add_table(ws2, "AgentsTable", len(agents)+1, 6)
    _auto_width(ws2)

    # ── Sheet 3: Разделы ──
    ws3 = wb.create_sheet("Разделы")
    headers3 = ["Раздел", "Диалогов", "Доля (%)"]
    _style_header(ws3, headers3)
    sections = summary.get("section_breakdown", [])
    for row_idx, section in enumerate(sections, 2):
        ws3.cell(row=row_idx, column=1, value=section.get("title", "")).border = thin_border
        ws3.cell(row=row_idx, column=2, value=section.get("dialogs", 0)).border = thin_border
        ws3.cell(row=row_idx, column=3, value=_fmt(section.get("percentage"), "%")).border = thin_border
    _add_table(ws3, "SectionsTable", len(sections)+1, 3)
    _auto_width(ws3)

    # ── Sheet 4: Активность ──
    ws4 = wb.create_sheet("Активность")
    headers4 = ["Дата", "Диалогов", "Входящих сообщений"]
    _style_header(ws4, headers4)
    activity = summary.get("recent_activity", [])
    for row_idx, point in enumerate(activity, 2):
        ws4.cell(row=row_idx, column=1, value=point.get("date", "")).border = thin_border
        ws4.cell(row=row_idx, column=2, value=point.get("dialogs", 0)).border = thin_border
        ws4.cell(row=row_idx, column=3, value=point.get("incoming_messages", 0)).border = thin_border
    _add_table(ws4, "ActivityTable", len(activity)+1, 3)
    _auto_width(ws4)

    # ── Sheet 5: БИНы (с договорами) ──
    ws5 = wb.create_sheet("БИНы (с договорами)")
    headers5 = ["БИН", "Обращений"]
    _style_header(ws5, headers5)
    bins_with = summary.get("top_bins_with_contract", [])
    for row_idx, bin_row in enumerate(bins_with, 2):
        ws5.cell(row=row_idx, column=1, value=bin_row.get("bin", "")).border = thin_border
        ws5.cell(row=row_idx, column=2, value=bin_row.get("requests", 0)).border = thin_border
    _add_table(ws5, "BinsWithContract", len(bins_with)+1, 2)
    _auto_width(ws5)

    # ── Sheet 6: БИНы (без договоров) ──
    ws6 = wb.create_sheet("БИНы (без договоров)")
    headers6 = ["БИН", "Обращений"]
    _style_header(ws6, headers6)
    bins_without = summary.get("top_bins_without_contract", [])
    for row_idx, bin_row in enumerate(bins_without, 2):
        ws6.cell(row=row_idx, column=1, value=bin_row.get("bin", "")).border = thin_border
        ws6.cell(row=row_idx, column=2, value=bin_row.get("requests", 0)).border = thin_border
    _add_table(ws6, "BinsWithoutContract", len(bins_without)+1, 2)
    _auto_width(ws6)

    # ── Sheet 7: Нагрузка по часам ──
    ws7 = wb.create_sheet("Нагрузка по часам")
    headers7 = ["День", "Час", "Кол-во обращений"]
    day_names = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"]
    _style_header(ws7, headers7)
    heatmap = [e for e in summary.get("peak_load_heatmap", []) if e.get("count", 0) > 0]
    for row_idx, entry in enumerate(heatmap, 2):
        day_idx = entry.get("day", 0)
        ws7.cell(row=row_idx, column=1, value=day_names[day_idx] if 0 <= day_idx < 7 else str(day_idx)).border = thin_border
        ws7.cell(row=row_idx, column=2, value=f"{entry.get('hour', 0)}:00").border = thin_border
        ws7.cell(row=row_idx, column=3, value=entry.get("count", 0)).border = thin_border
    _add_table(ws7, "HeatmapTable", len(heatmap)+1, 3)
    _auto_width(ws7)

    # ── Save to buffer and return ──
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    filename = f"report_{now_str}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )



def _build_pdf_report(summary: dict, _fmt, now_str: str):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
    )
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    import matplotlib
    from pathlib import Path

    # Load DejaVuSans from matplotlib to support Cyrillic
    mpl_data_dir = Path(matplotlib.get_data_path())
    font_path = mpl_data_dir / "fonts" / "ttf" / "DejaVuSans.ttf"
    if font_path.exists():
        pdfmetrics.registerFont(TTFont("DejaVu", str(font_path)))
        font_name = "DejaVu"
    else:
        font_name = "Helvetica" # Fallback, though Cyrillic will fail

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=15 * mm, bottomMargin=15 * mm)
    styles = getSampleStyleSheet()

    # ── Colours ──
    brand = colors.HexColor("#6366F1")
    header_text_color = colors.white
    row_alt = colors.HexColor("#F8FAFC")
    border_color = colors.HexColor("#E2E8F0")

    title_style = ParagraphStyle(
        "PDFTitle", parent=styles["Title"], fontName=font_name, fontSize=18,
        textColor=brand, spaceAfter=4,
    )
    section_style = ParagraphStyle(
        "PDFSection", parent=styles["Heading2"], fontName=font_name, fontSize=13,
        textColor=brand, spaceBefore=14, spaceAfter=6,
    )
    normal = styles["Normal"]
    normal.fontName = font_name

    day_names = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

    def _pdf_table(headers: list[str], rows: list[list], col_widths=None):
        data = [headers] + rows
        t = Table(data, colWidths=col_widths, repeatRows=1)
        style_cmds = [
            ("BACKGROUND", (0, 0), (-1, 0), brand),
            ("TEXTCOLOR", (0, 0), (-1, 0), header_text_color),
            ("FONTNAME", (0, 0), (-1, -1), font_name),
            ("FONTSIZE", (0, 0), (-1, 0), 9),
            ("FONTSIZE", (0, 1), (-1, -1), 8),
            ("ALIGN", (0, 0), (-1, -1), "LEFT"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("GRID", (0, 0), (-1, -1), 0.4, border_color),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ]
        for i in range(1, len(data)):
            if i % 2 == 0:
                style_cmds.append(("BACKGROUND", (0, i), (-1, i), row_alt))
        t.setStyle(TableStyle(style_cmds))
        return t

    def _create_pie_chart(sections):
        try:
            import matplotlib
            matplotlib.use('Agg')
            import matplotlib.pyplot as plt
            if not sections: return None
            fig, ax = plt.subplots(figsize=(5, 3.5))
            
            sorted_sec = sorted(sections, key=lambda x: x.get("dialogs", 0), reverse=True)
            top_sec = sorted_sec[:8]
            other_sum = sum(s.get("dialogs", 0) for s in sorted_sec[8:])
            labels = [s.get("title", "Unknown")[:20] for s in top_sec]
            sizes = [s.get("dialogs", 0) for s in top_sec]
            if other_sum > 0:
                labels.append("Остальные")
                sizes.append(other_sum)
            
            if sum(sizes) == 0: return None
            
            ax.pie(sizes, labels=labels, autopct='%1.1f%%', startangle=90, colors=plt.cm.Pastel1.colors)
            ax.axis('equal')
            plt.title("Разделы (доля обращений)")
            
            img_buf = io.BytesIO()
            plt.savefig(img_buf, format='png', bbox_inches='tight', dpi=150)
            plt.close(fig)
            img_buf.seek(0)
            return img_buf
        except Exception as e:
            print("Matplotlib error:", e)
            return None

    elements = []

    # ── Title ──
    elements.append(Paragraph(f"Аналитический отчёт — {now_str}", title_style))
    elements.append(Spacer(1, 6))

    # ── 1. Обзор ──
    elements.append(Paragraph("Обзор", section_style))
    overview_rows = [
        ["Всего диалогов", str(summary.get("total_dialogs", 0))],
        ["Открытых", str(summary.get("open_dialogs", 0))],
        ["Закрытых", str(summary.get("closed_dialogs", 0))],
        ["Всего сообщений", str(summary.get("total_messages", 0))],
        ["Входящих", str(summary.get("total_incoming_messages", 0))],
        ["Исходящих", str(summary.get("total_outgoing_messages", 0))],
        ["Ср. время ответа", _fmt(summary.get("avg_response_time_minutes"), " мин")],
        ["Решено ботом (AI)", str(summary.get("ai_closed_dialogs", 0))],
        ["Переведено оператору", str(summary.get("transferred_to_operator_dialogs", 0))],
        ["SLA (%)", _fmt(summary.get("sla_compliance_percentage"), "%")],
        ["Нарушений SLA", str(summary.get("sla_violations_count", 0))],
        ["С договором", str(summary.get("requests_with_contract", 0))],
        ["Без договора", str(summary.get("requests_without_contract", 0))],
    ]
    elements.append(_pdf_table(["Метрика", "Значение"], overview_rows, col_widths=[120 * mm, 50 * mm]))

    # ── 2. Операторы ──
    agents = summary.get("agent_breakdown", [])
    if agents:
        elements.append(Paragraph("Операторы", section_style))
        agent_rows = [
            [
                a.get("name", ""),
                str(a.get("dialogs", 0)),
                str(a.get("messages", 0)),
                _fmt(a.get("avg_response_time_minutes")),
            ]
            for a in agents
        ]
        elements.append(_pdf_table(
            ["Сотрудник", "Обращ.", "Сообщ.", "Ср. ответ"],
            agent_rows,
        ))

    # ── 3. Разделы ──
    sections = summary.get("section_breakdown", [])
    if sections:
        elements.append(Paragraph("Разделы", section_style))
        chart_buf = _create_pie_chart(sections)
        if chart_buf:
            elements.append(Image(chart_buf, width=100*mm, height=70*mm))
            elements.append(Spacer(1, 6))
            
        section_rows = [
            [s.get("title", ""), str(s.get("dialogs", 0)), _fmt(s.get("percentage"), "%")]
            for s in sections
        ]
        elements.append(_pdf_table(["Раздел", "Диалогов", "Доля"], section_rows))

    # ── 4. Активность ──
    activity = summary.get("recent_activity", [])
    if activity:
        elements.append(Paragraph("Активность по дням", section_style))
        act_rows = [
            [p.get("date", ""), str(p.get("dialogs", 0)), str(p.get("incoming_messages", 0))]
            for p in activity
        ]
        elements.append(_pdf_table(["Дата", "Диалогов", "Входящих"], act_rows))

    # ── 5. БИНы (с договорами) ──
    bins_with = summary.get("top_bins_with_contract", [])
    if bins_with:
        elements.append(Paragraph("БИНы (с договорами)", section_style))
        bin_rows = [
            [b.get("bin", "—"), str(b.get("requests", 0))]
            for b in bins_with
        ]
        elements.append(_pdf_table(["БИН", "Обращений"], bin_rows))

    # ── 6. БИНы (без договоров) ──
    bins_without = summary.get("top_bins_without_contract", [])
    if bins_without:
        elements.append(Paragraph("БИНы (без договоров)", section_style))
        bin_rows2 = [
            [b.get("bin", "—"), str(b.get("requests", 0))]
            for b in bins_without
        ]
        elements.append(_pdf_table(["БИН", "Обращений"], bin_rows2))

    # ── 7. Нагрузка по часам ──
    heatmap = summary.get("peak_load_heatmap", [])
    heat_mapped = [e for e in heatmap if e.get("count", 0) > 0]
    if heat_mapped:
        elements.append(Paragraph("Нагрузка по часам", section_style))
        heat_rows = [
            [
                day_names[e.get("day", 0)] if 0 <= e.get("day", 0) < 7 else str(e.get("day", 0)),
                f"{e.get('hour', 0)}:00",
                str(e.get("count", 0)),
            ]
            for e in heat_mapped
        ]
        elements.append(_pdf_table(["День", "Час", "Обращений"], heat_rows))

    doc.build(elements)
    buf.seek(0)

    filename = f"report_{now_str}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

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
            return fallback or datetime.now(timezone.utc).isoformat()
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
                dialog_closed_at=_normalize(chat.get("dialog_closed_at")) if chat.get("dialog_closed_at") else None,
                section=section_id,
                section_title=section_title,
                bin=chat.get("bin"),
                is_favorite=bool(chat.get("is_favorite")),
                operator_mode=bool(chat.get("operator_mode")),
                unread_count=int(chat.get("unread_count") or 0),
                last_message_text=chat.get("last_message_text"),
                last_message_direction=chat.get("last_message_direction"),
                last_message_author=chat.get("last_message_author"),
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
    if not database.is_admin_like(current_user["role"]):
        secs = current_user.get("sections")
        if secs:
            allowed_sections = secs
    messages = database.get_messages(
        chat_id,
        limit=limit,
        allowed_sections=allowed_sections,
        dialog_id=dialog_id,
    )
    resolved_dialog_id = dialog_id
    if resolved_dialog_id is None:
        resolved_dialog_id = next(
            (entry.get("dialog_id") for entry in reversed(messages) if entry.get("dialog_id") is not None),
            None,
        )
    if resolved_dialog_id is None:
        active_dialog = database.get_active_chat_dialog(chat_id)
        if active_dialog:
            resolved_dialog_id = int(active_dialog.get("id"))
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
    if resolved_dialog_id is not None:
        database.mark_dialog_read(current_user["id"], resolved_dialog_id)
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


def _parse_int_from_string(value: str | None) -> int | None:
    """Парсит целое число из строки, удаляя пробелы и нечисловые символы."""
    if value is None:
        return None
    # Удаляем все пробелы и нечисловые символы, кроме минуса
    cleaned = re.sub(r'[^\d-]', '', str(value).replace(' ', ''))
    if not cleaned:
        return None
    try:
        return int(cleaned)
    except (ValueError, TypeError):
        return None


@router.post("/messages/send")
def send_message(request: ReplyRequest, current_user: Dict[str, object] = Depends(get_current_user)):
    logger.info("Send message: user_id=%s, chat_id=%s, dialog_id=%s",
                current_user["id"], request.chat_id, request.dialog_id)
    if current_user["role"] not in (database.ROLE_ADMIN, database.ROLE_MODERATOR, database.ROLE_OPERATOR):
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
        external_chat_id_value = None
        if chat:
            external_chat_id_value = chat.get("external_chat_id")
        if not external_chat_id_value:
            external_chat_id_value = str(request.chat_id)
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
        if resolved_dialog_id:
            database.set_dialog_operator_mode(resolved_dialog_id, True)
        _enqueue_onec_outgoing_message(
            message_id=inserted_id,
            chat_id=request.chat_id,
            dialog_id=resolved_dialog_id,
            external_chat_id=external_chat_id_value,
            bin_value=chat.get("bin") if chat else None,
            text=request.text,
            author=current_user["name"],
            section=section,
        )

        # ── Notify SSE clients ──
        if event_bus.loop:
            asyncio.run_coroutine_threadsafe(
                event_bus.publish_all("new_message", {
                    "chat_id": request.chat_id,
                    "dialog_id": resolved_dialog_id,
                    "message_id": inserted_id,
                    "text": request.text,
                    "direction": "outgoing",
                    "author": current_user["name"],
                }),
                event_bus.loop
            )

        return {
            "status": "ok",
            "message_id": inserted_id,
            "operator": current_user["name"],
            "dialog_id": resolved_dialog_id,
        }

    # Telegram-ветка
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

    # ── Notify SSE clients ──
    if event_bus.loop:
        asyncio.run_coroutine_threadsafe(
            event_bus.publish_all("new_message", {
                "chat_id": request.chat_id,
                "dialog_id": resolved_dialog_id,
                "message_id": sent_message.message_id,
                "text": request.text,
                "direction": "outgoing",
                "author": current_user["name"],
            }),
            event_bus.loop
        )

    return {
        "status": "ok",
        "message_id": sent_message.message_id,
        "operator": current_user["name"],
        "dialog_id": resolved_dialog_id,
    }


@router.post("/dialogs/{dialog_id}/ai/enable")
def enable_ai_for_dialog(
    dialog_id: int, current_user: Dict[str, object] = Depends(get_current_user)
):
    dialog = database.get_chat_dialog(dialog_id)
    if dialog is None:
        raise HTTPException(status_code=404, detail="Диалог не найден")

    chat_id = int(dialog["chat_id"])
    if not database.user_can_access_chat(
        current_user["id"], current_user["role"], chat_id, dialog_id
    ):
        raise HTTPException(status_code=403, detail="Нет доступа к диалогу")

    chat = database.get_chat(chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="Чат не найден")

    database.set_dialog_operator_mode(dialog_id, False)

    section = chat.get("section") if chat else None
    chat_title = chat.get("title") if chat else None
    chat_type = chat.get("type") if chat else None
    notification_text = (
        "🤖 AI помощник снова включён для этого диалога. Можно продолжать задавать вопросы."
    )

    if chat_type == "onec":
        message_id = database.save_message(
            chat_id=chat_id,
            direction="outgoing",
            text=notification_text,
            message_id=None,
            author="System",
            chat_title=chat_title or str(chat_id),
            username=None,
            chat_type=chat_type,
            section=section,
            dialog_id=dialog_id,
        )
        external_chat_id = chat.get("external_chat_id") or str(chat_id)
        _enqueue_onec_outgoing_message(
            message_id=message_id,
            chat_id=chat_id,
            dialog_id=dialog_id,
            external_chat_id=external_chat_id,
            bin_value=chat.get("bin"),
            text=notification_text,
            author="System",
            section=section,
        )
        return {
            "status": "ok",
            "chat_id": chat_id,
            "dialog_id": dialog_id,
            "message_id": message_id,
        }

    try:
        sent_message = bot.send_message(chat_id, notification_text)
    except Exception as exc:  # pragma: no cover - depends on Telegram API
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    enable_ai_session(chat_id)

    database.save_message(
        chat_id=chat_id,
        direction="outgoing",
        text=notification_text,
        message_id=sent_message.message_id,
        author="System",
        chat_title=chat_title or sent_message.chat.title or sent_message.chat.username or str(chat_id),
        username=sent_message.chat.username,
        chat_type=sent_message.chat.type,
        section=section,
        dialog_id=dialog_id,
    )
    return {
        "status": "ok",
        "chat_id": chat_id,
        "dialog_id": dialog_id,
        "message_id": sent_message.message_id,
    }


@router.post("/dialogs/{dialog_id}/ai/disable")
def disable_ai_for_dialog(
    dialog_id: int, current_user: Dict[str, object] = Depends(get_current_user)
):
    dialog = database.get_chat_dialog(dialog_id)
    if dialog is None:
        raise HTTPException(status_code=404, detail="Диалог не найден")

    chat_id = int(dialog["chat_id"])
    if not database.user_can_access_chat(
        current_user["id"], current_user["role"], chat_id, dialog_id
    ):
        raise HTTPException(status_code=403, detail="Нет доступа к диалогу")

    chat = database.get_chat(chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="Чат не найден")

    database.set_dialog_operator_mode(dialog_id, True)

    section = chat.get("section") if chat else None
    chat_title = chat.get("title") if chat else None
    chat_type = chat.get("type") if chat else None
    notification_text = (
        "👨‍💼 Оператор подключён. AI помощник отключён для этого диалога."
    )

    if chat_type == "onec":
        message_id = database.save_message(
            chat_id=chat_id,
            direction="outgoing",
            text=notification_text,
            message_id=None,
            author="System",
            chat_title=chat_title or str(chat_id),
            username=None,
            chat_type=chat_type,
            section=section,
            dialog_id=dialog_id,
        )
        external_chat_id = chat.get("external_chat_id") or str(chat_id)
        _enqueue_onec_outgoing_message(
            message_id=message_id,
            chat_id=chat_id,
            dialog_id=dialog_id,
            external_chat_id=external_chat_id,
            bin_value=chat.get("bin"),
            text=notification_text,
            author="System",
            section=section,
        )
        return {
            "status": "ok",
            "chat_id": chat_id,
            "dialog_id": dialog_id,
            "message_id": message_id,
        }

    try:
        sent_message = bot.send_message(chat_id, notification_text)
    except Exception as exc:  # pragma: no cover - depends on Telegram API
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    database.save_message(
        chat_id=chat_id,
        direction="outgoing",
        text=notification_text,
        message_id=sent_message.message_id,
        author="System",
        chat_title=chat_title
        or sent_message.chat.title
        or sent_message.chat.username
        or str(chat_id),
        username=sent_message.chat.username,
        chat_type=sent_message.chat.type,
        section=section,
        dialog_id=dialog_id,
    )

    return {
        "status": "ok",
        "chat_id": chat_id,
        "dialog_id": dialog_id,
        "message_id": sent_message.message_id,
    }


@router.post("/dialogs/{dialog_id}/close", response_model=DialogStatusResponse)
def close_dialog(
    dialog_id: int, current_user: Dict[str, object] = Depends(get_current_user)
):
    dialog = database.get_chat_dialog(dialog_id)
    if dialog is None:
        raise HTTPException(status_code=404, detail="Диалог не найден")

    chat_id = int(dialog["chat_id"])
    if not database.user_can_access_chat(
        current_user["id"], current_user["role"], chat_id, dialog_id
    ):
        raise HTTPException(status_code=403, detail="Нет доступа к диалогу")

    chat = database.get_chat(chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="Чат не найден")

    if database.close_chat_dialog(dialog_id) is None:
        raise HTTPException(status_code=404, detail="Диалог не найден")

    database.set_dialog_operator_mode(dialog_id, False)

    section = chat.get("section") if chat else None
    chat_title = chat.get("title") if chat else None
    chat_type = chat.get("type") if chat else None
    notification_text = (
        "Обращение закрыто оператором. "
        "🤖 AI снова включён. Напишите новое сообщение, чтобы возобновить диалог."
    )

    closed_at = datetime.now(timezone.utc).isoformat()

    if chat_type == "onec":
        message_id = database.save_message(
            chat_id=chat_id,
            direction="outgoing",
            text=notification_text,
            message_id=None,
            author="System",
            chat_title=chat_title or str(chat_id),
            username=None,
            chat_type=chat_type,
            section=section,
            dialog_id=dialog_id,
        )
        external_chat_id = chat.get("external_chat_id") or str(chat_id)
        _enqueue_onec_outgoing_message(
            message_id=message_id,
            chat_id=chat_id,
            dialog_id=dialog_id,
            external_chat_id=external_chat_id,
            bin_value=chat.get("bin"),
            text=notification_text,
            author="System",
            section=section,
        )
        return DialogStatusResponse(
            chat_id=chat_id,
            dialog_id=dialog_id,
            dialog_closed_at=closed_at,
            ai_enabled=True,
        )

    try:
        sent_message = bot.send_message(chat_id, notification_text)
    except Exception as exc:  # pragma: no cover - depends on Telegram API
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    enable_ai_session(chat_id)

    database.save_message(
        chat_id=chat_id,
        direction="outgoing",
        text=notification_text,
        message_id=sent_message.message_id,
        author="System",
        chat_title=chat_title
        or sent_message.chat.title
        or sent_message.chat.username
        or str(chat_id),
        username=sent_message.chat.username,
        chat_type=sent_message.chat.type,
        section=section,
        dialog_id=dialog_id,
    )

    # Send CSAT rating request to the client
    try:
        latest_appeal_id = database.get_latest_closed_appeal_id(dialog_id)
        send_csat_request(chat_id, dialog_id, latest_appeal_id)
    except Exception:
        logger.warning("Failed to send CSAT request for dialog %s", dialog_id, exc_info=True)

    return DialogStatusResponse(
        chat_id=chat_id,
        dialog_id=dialog_id,
        dialog_closed_at=closed_at,
        ai_enabled=True,
    )


@router.post("/dialogs/{dialog_id}/open", response_model=DialogStatusResponse)
def open_dialog(
    dialog_id: int, current_user: Dict[str, object] = Depends(get_current_user)
):
    dialog = database.get_chat_dialog(dialog_id)
    if dialog is None:
        raise HTTPException(status_code=404, detail="Диалог не найден")

    chat_id = int(dialog["chat_id"])
    if not database.user_can_access_chat(
        current_user["id"], current_user["role"], chat_id, dialog_id
    ):
        raise HTTPException(status_code=403, detail="Нет доступа к диалогу")

    activated = database.activate_chat_dialog(dialog_id, chat_id=chat_id)
    if activated is None:
        raise HTTPException(status_code=404, detail="Диалог не найден")

    database.set_dialog_operator_mode(dialog_id, False)

    return DialogStatusResponse(
        chat_id=chat_id,
        dialog_id=dialog_id,
        dialog_closed_at=None,
        ai_enabled=not database.is_dialog_in_operator_mode(dialog_id),
    )

@app.post("/integrations/1c/messages")
@router.post("/integrations/1c/messages")
def create_onec_message(
    request: OneCIncomingMessageRequest,
    _: None = Depends(require_onec_token),
):
    section_id = _normalize_optional(request.section)
    if section_id and not any(section["id"] == section_id for section in database.SECTIONS):
        section_id = None

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
    normalized_text = message_text.lower()
    stored_text = "[ЗАПРОС ОПЕРАТОРА]" if normalized_text == "оператор" else message_text

    # ИСПРАВЛЕНИЕ: В названии используем external_chat_id вместо BIN
    title_candidate = _normalize_optional(request.title)
    chat_title = title_candidate or f"1С клиент {external_chat_id}"  # ← Здесь меняем

    # Check if customer has a valid contract for 2026
    logger.info("Checking contract for 1C customer BIN: %s", bin_value)
    contract_result = contract_checker.check_customer_contracts(bin_value)
    has_contract = contract_result.get("has_contract", False)
    logger.info("Contract check result for %s: has_contract=%s", bin_value, has_contract)
    response_message = None
    
    # Save organization without contract info (for admin tracking)
    if not has_contract:
        database.add_organization_without_contract(
            customer_bin=bin_value,
            customer_legal_address=contract_result.get("customer_legal_address"),
            customer_bank_name_ru=contract_result.get("customer_bank_name_ru"),
        )
        logger.info("1C Organization %s saved as organization without contract", bin_value)
        response_message = (
            "⚠️ Обратите внимание: у вашей организации нет действующего договора с нами на 2026 год.\n"
            "Для заключения договора обратитесь в наш офис."
        )

    # Create dialog for ALL BINs (with or without contract)
    database.upsert_chat(
        chat_id,
        chat_title,
        None,
        "onec",
        external_chat_id=external_chat_id,
    )
    try:
        # БИН и раздел сохраняем для диалога
        dialog_id = database.ensure_active_chat_dialog(chat_id, bin_value, section=section_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    message_id = database.save_message(
        chat_id=chat_id,
        direction="incoming",
        text=stored_text,
        message_id=None,
        author=author,
        chat_title=chat_title,
        username=None,
        chat_type="onec",
        section=section_id,
        dialog_id=dialog_id,
    )
    logger.info(
        "1C incoming message saved: ext_id=%s, chat_id=%s, dialog_id=%s, message_id=%s, author=%s",
        external_chat_id, chat_id, dialog_id, message_id, author,
    )

    # ── Notify SSE clients ──
    if event_bus.loop:
        asyncio.run_coroutine_threadsafe(
            event_bus.publish_all("new_message", {
                "chat_id": chat_id,
                "dialog_id": dialog_id,
                "message_id": message_id,
                "text": stored_text,
                "direction": "incoming",
                "author": author,
            }),
            event_bus.loop,
        )

    if section_id:
        database.set_chat_section(chat_id, section_id, dialog_id=dialog_id)

    chat_record = database.get_chat(chat_id)
    chat_section = section_id or (chat_record.get("section") if chat_record else None)
    chat_bin = chat_record.get("bin") if chat_record else None
    dialog_external_id = (
        (chat_record.get("external_chat_id") if chat_record else None) or external_chat_id
    )

    # Если нет договора — сохраняем уведомление в историю чата ТОЛЬКО при первом сообщении
    if response_message:
        # Проверяем количество сообщений в диалоге - если это первое сообщение
        existing_messages = database.get_messages(chat_id, limit=5, dialog_id=dialog_id)
        # Если только 1 сообщение (только что отправленное) - показываем уведомление о договоре
        is_first_message = len(existing_messages) <= 1
        
        if is_first_message:
            contract_notice_id = database.save_message(
                chat_id=chat_id,
                direction="outgoing",
                text=response_message,
                message_id=None,
                author="System",
                chat_title=chat_title,
                username=None,
                chat_type="onec",
                section=chat_section,
                dialog_id=dialog_id,
            )
            if dialog_external_id:
                _enqueue_onec_outgoing_message(
                    message_id=contract_notice_id,
                    chat_id=chat_id,
                    dialog_id=dialog_id,
                    external_chat_id=dialog_external_id,
                    bin_value=chat_bin or bin_value,
                    text=response_message,
                    author="System",
                    section=chat_section,
                )


    auto_reply_sent = False

    if normalized_text == "оператор":
        database.set_dialog_operator_mode(dialog_id, True)
        operator_notice = "👨‍💼 Подключаю оператора..."
        notice_message_id = database.save_message(
            chat_id=chat_id,
            direction="outgoing",
            text=operator_notice,
            message_id=None,
            author="System",
            chat_title=chat_title,
            username=None,
            chat_type="onec",
            section=chat_section,
            dialog_id=dialog_id,
        )
        if dialog_external_id:
            _enqueue_onec_outgoing_message(
                message_id=notice_message_id,
                chat_id=chat_id,
                dialog_id=dialog_id,
                external_chat_id=dialog_external_id,
                bin_value=chat_bin,
                text=operator_notice,
                author="System",
                section=chat_section,
            )
        auto_reply_sent = True
        database.create_operator_request_notifications(
            chat_id,
            dialog_id=dialog_id,
            chat_title=chat_title,
            section=chat_section,
            bin_value=chat_bin,
        )
    else:
        if not database.is_dialog_in_operator_mode(dialog_id):
            faq_entry = database.find_faq_entry_by_keywords(message_text, chat_section)
            if faq_entry:
                response_section = faq_entry.get("section") or chat_section
                response_text = faq_entry.get("answer", "").strip()
                response_question = faq_entry.get("question", "").strip()
                if response_question:
                    response_text = f"📚 Частый вопрос:\n{response_question}\n\n{response_text}" if response_text else response_question
                if not response_text:
                    response_text = "Пока нет готового ответа. Напишите 'оператор', чтобы связаться с консультантом."

                if response_section and response_section != chat_section:
                    database.set_chat_section(chat_id, response_section, dialog_id=dialog_id)
                    chat_section = response_section

                database.set_dialog_operator_mode(dialog_id, False)
                faq_message_id = database.save_message(
                    chat_id=chat_id,
                    direction="outgoing",
                    text=response_text,
                    message_id=None,
                    author="AutoBot",
                    chat_title=chat_title,
                    username=None,
                    chat_type="onec",
                    section=chat_section,
                    dialog_id=dialog_id,
                )
                if dialog_external_id:
                    _enqueue_onec_outgoing_message(
                        message_id=faq_message_id,
                        chat_id=chat_id,
                        dialog_id=dialog_id,
                        external_chat_id=dialog_external_id,
                        bin_value=chat_bin,
                        text=response_text,
                        author="AutoBot",
                        section=chat_section,
                    )
                auto_reply_sent = True

            if not auto_reply_sent:
                history = database.get_messages(chat_id, limit=6, dialog_id=dialog_id)
                if ai_manager is not None:
                    ai_reply = ai_manager.generate_response(message_text, history)
                else:
                    ai_reply = (
                        "Извините, AI помощник временно недоступен. Пожалуйста, напишите 'оператор' "
                        "для связи с консультантом."
                    )
                ai_reply = (ai_reply or "").strip()
                if ai_reply:
                    database.set_dialog_operator_mode(dialog_id, False)
                    ai_message_id = database.save_message(
                        chat_id=chat_id,
                        direction="outgoing",
                        text=ai_reply,
                        message_id=None,
                        author="AI Assistant",
                        chat_title=chat_title,
                        username=None,
                        chat_type="onec",
                        section=chat_section,
                        dialog_id=dialog_id,
                    )
                    if dialog_external_id:
                        _enqueue_onec_outgoing_message(
                            message_id=ai_message_id,
                            chat_id=chat_id,
                            dialog_id=dialog_id,
                            external_chat_id=dialog_external_id,
                            bin_value=chat_bin,
                            text=ai_reply,
                            author="AI Assistant",
                            section=chat_section,
                        )
                    auto_reply_sent = True

    return {
        "status": "ok",
        "has_contract": has_contract,
        "response_message": response_message,
        "chat_id": chat_id,
        "dialog_id": dialog_id,
    }


# ------------------ История для 1С ------------------

def _onec_history_core(
    external_chat_id: str,
    chat_id: int | None,
    dialog_id: int | None,
    bin_value: str | None,
    limit: int,
) -> OneCMessagesResponse:
    normalized_external = external_chat_id.strip()
    if not normalized_external:
        raise HTTPException(status_code=400, detail="external_chat_id обязателен")

    resolved_chat_id = _resolve_onec_chat_id(normalized_external, chat_id)

    # Если явно передали dialog_id – проверяем его и используем как есть
    if dialog_id is not None:
        dialog = database.get_chat_dialog(dialog_id)
        if dialog is None or dialog["chat_id"] != resolved_chat_id:
            raise HTTPException(status_code=404, detail="Диалог не найден")
        resolved_dialog_id = dialog_id
    else:
        # Если dialog_id нет, но есть BIN – применяем ту же логику, что в create_onec_message:
        normalized_bin = (bin_value or "").strip() or None
        if normalized_bin is not None:
            try:
                # Убеждаемся, что чат существует, перед созданием диалога
                database.upsert_chat(resolved_chat_id, "External User", None, "onec", external_chat_id=normalized_external)
                resolved_dialog_id = database.ensure_active_chat_dialog(
                    resolved_chat_id, normalized_bin
                )
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            except RuntimeError as exc:
                raise HTTPException(status_code=500, detail=str(exc)) from exc
        else:
            # Совместимость: как раньше, без фильтра по диалогу
            resolved_dialog_id = None

    chat = database.get_chat(resolved_chat_id)
    if chat and chat.get("type") not in (None, "onec"):
        raise HTTPException(status_code=403, detail="Чат не предназначен для интеграции 1С")

    raw_messages = database.get_messages(
        resolved_chat_id,
        limit=limit,
        dialog_id=resolved_dialog_id,
    )

    logger.info(
        "1C history request: ext_id=%s, chat_id=%s, dialog_id=%s, messages_count=%d",
        normalized_external, resolved_chat_id, resolved_dialog_id, len(raw_messages),
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
                message_id=int(stored_message_id) if stored_message_id is not None else None,
                chat_id=int(message["chat_id"]),
                dialog_id=message.get("dialog_id"),
                direction=str(message["direction"]),
                text=str(message["text"]),
                author=message.get("author"),
                created_at=created_at_iso,
                section=message.get("section"),
            )
        )

    # Если диалог не был определён выше – берём активный (как и раньше)
    if resolved_dialog_id is None:
        resolved_dialog_id = database.get_active_chat_dialog_id(resolved_chat_id)

    return OneCMessagesResponse(
        external_chat_id=normalized_external,
        chat_id=resolved_chat_id,
        dialog_id=resolved_dialog_id,
        messages=messages,
    )



@app.get(
    "/integrations/1c/messages",
    response_model=OneCMessagesResponse,
)
@router.get(
    "/integrations/1c/messages",
    response_model=OneCMessagesResponse,
)
def list_onec_messages(
    external_chat_id: str = Query(min_length=1, max_length=128),
    _: None = Depends(require_onec_token),
    chat_id: str | None = Query(default=None),
    dialog_id: str | None = Query(default=None),
    bin: str | None = Query(default=None),  # НОВЫЙ ПАРАМЕТР
    limit: int = Query(default=200, ge=1, le=500),
):
    parsed_chat_id = _parse_int_from_string(chat_id) if chat_id else None
    parsed_dialog_id = _parse_int_from_string(dialog_id) if dialog_id else None

    return _onec_history_core(
        external_chat_id,
        parsed_chat_id,
        parsed_dialog_id,
        bin,
        limit,
    )



class OneCHistoryPostRequest(BaseModel):
    external_chat_id: str = Field(min_length=1, max_length=128)
    chat_id: str | None = None
    dialog_id: str | None = None
    bin: str | None = None             # НОВОЕ ПОЛЕ
    limit: int = Field(default=200, ge=1, le=500)



@app.post("/integrations/1c/messages/history", response_model=OneCMessagesResponse)
@router.post("/integrations/1c/messages/history", response_model=OneCMessagesResponse)
def list_onec_messages_post(
    body: OneCHistoryPostRequest,
    _: None = Depends(require_onec_token),
):
    parsed_chat_id = _parse_int_from_string(body.chat_id) if body.chat_id else None
    parsed_dialog_id = _parse_int_from_string(body.dialog_id) if body.dialog_id else None

    return _onec_history_core(
        body.external_chat_id,
        parsed_chat_id,
        parsed_dialog_id,
        body.bin,
        body.limit,
    )



# ------------------ Outbox 1С ------------------

class OneCOutboxItem(BaseModel):
    outbox_id: int
    payload: dict
    signature: str | None = None


class OneCOutboxResponse(BaseModel):
    items: List[OneCOutboxItem] = Field(default_factory=list)


class OneCAckRequest(BaseModel):
    delivered_ids: List[int] = Field(default_factory=list)
    failed_ids: List[Dict[str, object]] = Field(default_factory=list)  # [{"id": 1, "error": "text"}]


@app.get("/integrations/1c/outbox", response_model=OneCOutboxResponse)
@router.get("/integrations/1c/outbox", response_model=OneCOutboxResponse)
def onec_outbox(
    external_chat_id: str = Query(min_length=1, max_length=128),
    limit: int = Query(default=100, ge=1, le=500),
    _: None = Depends(require_onec_token),
):
    """1С забирает сообщения оператора (Web->Backend) для указанного external_chat_id."""
    items = []
    rows = database.outbox_list_pending_onec(external_chat_id, limit)
    for r in rows:
        payload = r["payload"] or {}
        sig = payload.get("signature") or _sign_payload(payload)
        items.append(OneCOutboxItem(outbox_id=r["id"], payload=payload, signature=sig or None))
    return OneCOutboxResponse(items=items)


@app.post("/integrations/1c/ack")
@router.post("/integrations/1c/ack")
def onec_ack(
    body: OneCAckRequest,
    _: None = Depends(require_onec_token),
):
    """1С подтверждает доставку (delivered_ids) и/или сообщает failed_ids с ошибкой."""
    try:
        if body.delivered_ids:
            database.outbox_mark_delivered_onec(body.delivered_ids)
        if body.failed_ids:
            database.outbox_mark_failed_onec(body.failed_ids)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"status": "ok"}


class OneCCloseRequest(BaseModel):
    external_chat_id: str = Field(min_length=1, max_length=128)
    chat_id: int | None = None
    bin: str | None = None


class OneCRatingRequest(BaseModel):
    external_chat_id: str = Field(min_length=1, max_length=128)
    dialog_id: int | None = None
    appeal_id: int | None = None
    rating: int = Field(ge=1, le=5)
    target: Literal["operator", "ai"] = "operator"


@app.post("/integrations/1c/close")
@router.post("/integrations/1c/close")
def onec_close_dialog(
    body: OneCCloseRequest,
    _: None = Depends(require_onec_token),
):
    """1С закрывает активный диалог (обращение) клиента."""
    external_chat_id = body.external_chat_id.strip()
    if not external_chat_id:
        raise HTTPException(status_code=400, detail="external_chat_id обязателен")

    chat_id = _resolve_onec_chat_id(external_chat_id, body.chat_id)
    active = database.get_active_chat_dialog(chat_id)
    if active is None:
        return {"status": "no_active_dialog", "message": "Нет активного диалога для закрытия"}

    dialog_id = int(active["id"])
    database.close_chat_dialog(dialog_id, closed_by="client")
    latest_stats = database.get_latest_dialog_stats(dialog_id)
    latest_appeal_id = (
        int(latest_stats["appeal_id"])
        if latest_stats and latest_stats.get("appeal_id") is not None
        else database.get_latest_closed_appeal_id(dialog_id)
    )
    rating_target = "ai" if latest_stats and latest_stats.get("is_ai_closed") else "operator"
    rating_required = latest_appeal_id is not None

    # Notify Telegram client if applicable
    try:
        from backend.telegram_bot import bot as tg_bot
        tg_bot.send_message(
            chat_id,
            "Обращение завершено клиентом из 1С. 🤖 AI снова включён.\n"
            "Напишите новое сообщение, чтобы возобновить диалог.",
        )
        if rating_required and latest_appeal_id is not None:
            if rating_target == "ai":
                send_ai_csat_request(chat_id, dialog_id, latest_appeal_id)
            else:
                send_csat_request(chat_id, dialog_id, latest_appeal_id)
    except Exception:
        pass  # Telegram notification is best-effort

    logger.info(
        "1C client closed dialog: ext_id=%s, chat_id=%s, dialog_id=%s",
        external_chat_id, chat_id, dialog_id,
    )
    return {
        "status": "ok",
        "dialog_id": dialog_id,
        "appeal_id": latest_appeal_id,
        "rating_required": bool(rating_required),
        "rating_target": rating_target,
    }


@app.post("/integrations/1c/rating")
@router.post("/integrations/1c/rating")
def onec_submit_rating(
    body: OneCRatingRequest,
    _: None = Depends(require_onec_token),
):
    """1С сохраняет оценку качества обслуживания (оператор или AI)."""
    external_chat_id = body.external_chat_id.strip()
    if not external_chat_id:
        raise HTTPException(status_code=400, detail="external_chat_id обязателен")

    appeal_id = body.appeal_id
    dialog_id = body.dialog_id
    if appeal_id is not None and dialog_id is None:
        dialog_id = database.get_dialog_id_for_appeal(appeal_id)

    if dialog_id is None:
        raise HTTPException(status_code=400, detail="dialog_id или appeal_id обязателен")

    chat_id = _resolve_onec_chat_id(external_chat_id, None)

    if appeal_id is None:
        appeal_id = database.get_latest_closed_appeal_id(dialog_id)

    if body.target == "ai":
        saved = database.save_ai_csat_rating(dialog_id, body.rating, appeal_id=appeal_id)
    else:
        saved = database.save_csat_rating(dialog_id, body.rating, appeal_id=appeal_id)

    if not saved:
        raise HTTPException(status_code=404, detail="Не удалось сохранить оценку")

    logger.info(
        "1C rating saved: ext_id=%s chat_id=%s dialog_id=%s appeal_id=%s target=%s rating=%s",
        external_chat_id,
        chat_id,
        dialog_id,
        appeal_id,
        body.target,
        body.rating,
    )
    return {
        "status": "ok",
        "dialog_id": dialog_id,
        "appeal_id": appeal_id,
        "target": body.target,
        "rating": body.rating,
    }


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
    _: Dict[str, object] = Depends(require_admin_or_moderator),
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
    _: Dict[str, object] = Depends(require_admin_or_moderator),
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

app.include_router(kabinet_backend.router, prefix="/kabinet")



