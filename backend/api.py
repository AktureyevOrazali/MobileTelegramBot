"""FastAPI routes serving chat data for the mobile client."""
from __future__ import annotations

import logging
import hashlib
import hmac
import json
import os
import re
from datetime import date, datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Body, Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import AliasChoices, BaseModel, EmailStr, Field, validator

from . import database
from .ai_manager import ai_manager
from .telegram_bot import bot, enable_ai_session
from . import contract_checker

API_TOKEN = os.getenv("MOBILE_API_TOKEN")
ONEC_INTEGRATION_TOKEN = os.getenv("ONEC_INTEGRATION_TOKEN")

ONEC_CHAT_ID_OFFSET = 9_000_000_000_000
ONEC_CHAT_ID_SPACE = 1_000_000_000_000

# Опциональный общий секрет для подписи HMAC нагрузки, которую 1С забирает из outbox
ONEC_SHARED_SECRET = os.getenv("ONEC_SHARED_SECRET", "")

app = FastAPI(title="MobileBot Companion API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

router = APIRouter()


logger = logging.getLogger(__name__)


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
        "created_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
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


class DashboardActivityPoint(BaseModel):
    date: str
    dialogs: int
    incoming_messages: int


class DashboardResponseTimeDialog(BaseModel):
    chat_id: int | None = None
    dialog_id: int | None = None
    author: str
    response_time_minutes: float


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
    response_time_dialogs: List[DashboardResponseTimeDialog] = Field(default_factory=list)
    section_breakdown: List[DashboardSectionStat] = Field(default_factory=list)
    top_questions: List[DashboardTopQuestion] = Field(default_factory=list)
    questions_by_section: List[DashboardSectionQuestions] = Field(default_factory=list)
    agent_breakdown: List[DashboardAgentStat] = Field(default_factory=list)
    recent_activity: List[DashboardActivityPoint] = Field(default_factory=list)
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
    existing = database.find_user_by_email(request.email)
    if existing:
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
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if created_user is None or created_user.get("id") is None:
        raise HTTPException(status_code=500, detail="Failed to create user")
    return RegisterResponse()


@router.post("/auth/login", response_model=AuthResponse)
def login_user(request: LoginRequest, _: None = Depends(require_api_token)):
    user = database.find_user_by_identifier(request.identifier)
    password_hash = hashlib.sha256(request.password.encode("utf-8")).hexdigest()
    if not user or user["password_hash"] != password_hash:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.get("is_approved", True):
        raise HTTPException(status_code=403, detail="Аккаунт ожидает подтверждения модератора")
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
                dialog_closed_at=_normalize(chat.get("dialog_closed_at")) if chat.get("dialog_closed_at") else None,
                section=section_id,
                section_title=section_title,
                bin=chat.get("bin"),
                is_favorite=bool(chat.get("is_favorite")),
                operator_mode=bool(chat.get("operator_mode")),
                unread_count=int(chat.get("unread_count") or 0),
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
        allowed_sections = current_user.get("sections") or []
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


def _parse_int_from_string(value: str) -> int:
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
        "Диалог закрыт. 🤖 AI снова включён. Напишите новое сообщение, чтобы открыть его заново."
    )

    closed_at = datetime.utcnow().isoformat()

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
    logger.info(f"Checking contract for 1C customer BIN: {bin_value}")
    contract_result = contract_checker.check_customer_contracts(bin_value)
    has_contract = contract_result.get("has_contract", False)
    logger.info(f"Contract check result for {bin_value}: has_contract={has_contract}")
    response_message = None
    
    # Save organization without contract info (for admin tracking)
    if not has_contract:
        database.add_organization_without_contract(
            customer_bin=bin_value,
            customer_legal_address=contract_result.get("customer_legal_address"),
            customer_bank_name_ru=contract_result.get("customer_bank_name_ru"),
        )
        logger.info(f"1C Organization {bin_value} saved as organization without contract")
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
        f"1C incoming message saved: ext_id={external_chat_id}, chat_id={chat_id}, "
        f"dialog_id={dialog_id}, message_id={message_id}, author={author}"
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
        f"1C history request: ext_id={normalized_external}, chat_id={resolved_chat_id}, "
        f"dialog_id={resolved_dialog_id}, messages_count={len(raw_messages)}"
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