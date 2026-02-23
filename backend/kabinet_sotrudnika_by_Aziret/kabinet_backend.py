import hashlib
from fastapi import APIRouter, FastAPI, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime, timedelta
import random
import string
import smtplib

from email.mime.text import MIMEText
from email.header import Header

router = APIRouter()

# 🟢 "База данных" в памяти
users_db = {}  # {email: {name, phone, password_hash}}
verification_codes = {}  # {email: {"code": "123456", "expires_at": datetime}}

class ForgotPasswordRequest(BaseModel):
    email: EmailStr

class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str
    new_password: str

class VerifyCodeRequest(BaseModel):
    email: EmailStr
    code: str

# 📦 Pydantic схемалары
class RegisterStep1(BaseModel):
    name: str

class RegisterStep2(BaseModel):
    email: EmailStr
    phone: Optional[str]

class RegisterStep3(BaseModel):
    email: EmailStr
    password: str
    confirm_password: str
    code: str

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

# 🔹 Utility functions
def send_email_forgot_password(to_email: str, subject: str, body: str):
    FROM_EMAIL = "a.develop2021@gmail.com"
    APP_PASSWORD = "ooyg phvz odwj woqv"

    # Тек мысал үшін, на практике используем SMTP сервер немесе SendGrid, Mailgun
    #print(f"Отправка кода {code} на email: {to_email}")
    
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = FROM_EMAIL
    msg["To"] = to_email

    with smtplib.SMTP("smtp.gmail.com", 587) as server:
        server.starttls()
        server.login(FROM_EMAIL, APP_PASSWORD)
        server.send_message(msg)

# 🔹 Utility functions
def send_email_for_register(to_email: str, code: str):
    # Тек мысал үшін, на практике используем SMTP сервер немесе SendGrid, Mailgun
    print(f"Отправка кода {code} на email: {to_email}")
    # Пример SMTP (Gmail)

    FROM_EMAIL = "a.develop2021@gmail.com"      # өз Gmail
    APP_PASSWORD = "ooyg phvz odwj woqv"    # Google App Password
    
    subject = Header("Подтверждение почты", "utf-8")
    body = f"Ваш код подтверждения: {code}"

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = FROM_EMAIL
    msg["To"] = to_email

    with smtplib.SMTP("smtp.gmail.com", 587) as server:
        server.starttls()
        server.login(FROM_EMAIL, APP_PASSWORD)
        server.send_message(msg)
    

def generate_code(length=6):
    return ''.join(random.choices(string.digits, k=length))

# 🟢 Временное хранение данных регистрации
registration_data = {}  # {email: {"name": str, "phone": str}}

@router.post("/register-step1/")
def register_step1(data: RegisterStep1):
    # тут можно создать временный email-ключ или запросить email сразу
    return {"message": "Step1 done, сохраните email на клиенте"}


@router.get("/getinfo/")
def send_verification_code():
    return {"message": "getinfo",}

# 🔹 Registration Step 2 - Send code
@router.post("/send-code/")
def send_verification_code(step2: RegisterStep2, background_tasks: BackgroundTasks):
    email = step2.email.lower()
    if email in users_db:
        raise HTTPException(status_code=400, detail="Email уже зарегистрирован")
    
    # Сохраняем временно имя и телефон
    registration_data[email] = {
        "name": step2.name if hasattr(step2, "name") else "Имя",
        "phone": step2.phone
    }

    code = generate_code()
    expires_at = datetime.utcnow() + timedelta(seconds=60)
    verification_codes[email] = {"code": code, "expires_at": expires_at}
    background_tasks.add_task(send_email_for_register, email, code)
    return {"message": "Код отправлен на почту", "expires_in": 60}

# 🔹 Registration Step 3 - Confirm code and set password
@router.post("/register/")
def register_user(step3: RegisterStep3):
    email = step3.email.lower()
    if email in users_db:
        raise HTTPException(status_code=400, detail="Email уже зарегистрирован")
    if step3.password != step3.confirm_password:
        raise HTTPException(status_code=400, detail="Пароли не совпадают")
    # Проверяем код
    code_data = verification_codes.get(email)
    if not code_data or code_data["code"] != step3.code:
        raise HTTPException(status_code=400, detail="Неверный код")
    if datetime.utcnow() > code_data["expires_at"]:
        raise HTTPException(status_code=400, detail="Код устарел. Отправьте повторно.")
    
    
    # Берем данные name и phone из временного хранилища
    temp_data = registration_data.get(email, {})
    users_db[email] = {
        "name": temp_data.get("name"),
        "phone": temp_data.get("phone"),
        "password": step3.password
    }

    verification_codes.pop(email)
    registration_data.pop(email, None)
    return {"message": "Регистрация прошла успешно"}

# 🔹 Login
@router.post("/login/")
def login_user(request: LoginRequest):
    email = request.email.lower()
    user = users_db.get(email)
    if not user or user["password"] != request.password:
        raise HTTPException(status_code=400, detail="Неверный email или пароль")
    return {
        "user": {
            "id": email,            # можно использовать email как ID
            "email": email,
            "name": user["name"],
            "phone": user.get("phone"),
            "created_at": datetime.utcnow().isoformat()
        }}

# 🔹 Resend code
@router.post("/resend-code/")
def resend_code(email: EmailStr, background_tasks: BackgroundTasks):
    email = email.lower()
    code = generate_code()
    expires_at = datetime.utcnow() + timedelta(seconds=60)
    verification_codes[email] = {"code": code, "expires_at": expires_at}
    background_tasks.add_task(send_email_for_register, email, code)
    return {"message": "Код отправлен повторно", "expires_in": 60}

@router.post("/verify-code/")
def verify_code(payload: VerifyCodeRequest):
    email = payload.email.lower()
    code = payload.code

    data = verification_codes.get(email)

    if not data:
        raise HTTPException(status_code=400, detail="Код не найден")

    if datetime.utcnow() > data["expires_at"]:
        raise HTTPException(status_code=400, detail="Код истек")

    if data["code"] != code:
        raise HTTPException(status_code=400, detail="Неверный код")

    return {"message": "Код подтвержден"}

reset_codes = {} 

@router.post("/forgot-password/")
async def forgot_password(data: ForgotPasswordRequest):
    email = data.email

    user = users_db.get(email)
    if not user:
        raise HTTPException(status_code=404, detail="Email не найден")

    code = generate_code()

    reset_codes[email] = {
        "code": code,
        "expires_at": datetime.utcnow() + timedelta(minutes=10)
    }

    send_email_forgot_password(
        to_email=email,
        subject="Восстановление пароля",
        body=f"Код для восстановления пароля: {code}"
    )

    return {"message": "Код отправлен на почту"}

@router.post("/reset-password/")
async def reset_password(data: ResetPasswordRequest):
    record = reset_codes.get(data.email)

    if not record:
        raise HTTPException(status_code=400, detail="Код не найден")

    if record["code"] != data.code:
        raise HTTPException(status_code=400, detail="Неверный код")

    if record["expires_at"] < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Код истёк")

    users_db[data.email]["password"] = data.new_password

    del reset_codes[data.email]

    return {"message": "Пароль успешно обновлён"}

def hash_password(password: str) -> str:
    """Возвращает SHA256-хеш пароля"""
    return hashlib.sha256(password.encode('utf-8')).hexdigest()


