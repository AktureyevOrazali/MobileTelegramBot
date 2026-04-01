import base64
import hashlib
import os
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from fastapi.responses import FileResponse
from typing import Optional
from datetime import datetime, timedelta
import random
import string
import smtplib

from email.mime.text import MIMEText
from email.header import Header

from .models import Attendance, User
from .database_kabinet import get_db
from sqlalchemy.orm import Session

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

class RegisterStep3(BaseModel):
    name: str
    surname: Optional[str] = None
    lastname: Optional[str] = None
    email: EmailStr
    email_verified: Optional[bool]
    password: str
    confirm_password: str
    code: str
    phone: Optional[str] = None

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

# ✅ Қазір — JSON body күтеді
class ResendCodeRequest(BaseModel):
    email: EmailStr

# 🔹 Utility functions
def send_email_forgot_password(to_email: str, subject: str, body: str):

    try:
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

        print("✅ Email успешно отправлен: ", to_email, body)

    except Exception as e:
        print("❌ Ошибка отправки email:", str(e))

# 🔹 Utility functions
def send_email_for_register(to_email: str, code: str):
    # Тек мысал үшін, на практике используем SMTP сервер немесе SendGrid, Mailgun
    # print(f"Отправка кода {code} на email: {to_email}")
    # Пример SMTP (Gmail)

    try:
        FROM_EMAIL = "a.develop2021@gmail.com"
        APP_PASSWORD = "ooyg phvz odwj woqv"

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

        print("✅ Email успешно отправлен: ", to_email, "с кодом:", code)

    except Exception as e:
        print("❌ Ошибка отправки email:", str(e))

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
        # "phone": step2.phone
    }

    code = generate_code()
    expires_at = datetime.utcnow() + timedelta(seconds=60)
    verification_codes[email] = {"code": code, "expires_at": expires_at}
    background_tasks.add_task(send_email_for_register, email, code)
    return {"message": "Код отправлен на почту", "expires_in": 60}

# 🔹 Resend code
@router.post("/resend-code/")
def resend_code(data: ResendCodeRequest, background_tasks: BackgroundTasks):
    email = data.email.lower()
    code = generate_code()
    expires_at = datetime.utcnow() + timedelta(seconds=60)
    verification_codes[email] = {"code": code, "expires_at": expires_at}
    # print(f"Повторная отправка кода {code} на email: {email}")
    background_tasks.add_task(send_email_for_register, email, code)
    return {"message": "Код отправлен повторно", "expires_in": 60}

# 🔹 Registration Step 3 - Confirm code and set password
@router.post("/register/")
def register_user(step3: RegisterStep3, db: Session = Depends(get_db)):
    email = step3.email.lower()

    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email уже зарегистрирован")

    if step3.password != step3.confirm_password:
        raise HTTPException(status_code=400, detail="Пароли не совпадают")

    code_data = verification_codes.get(email)
    if not code_data or code_data["code"] != step3.code:
        raise HTTPException(status_code=400, detail="Неверный код")

    if datetime.utcnow() > code_data["expires_at"]:
        raise HTTPException(status_code=400, detail="Код устарел")

    temp_data = registration_data.get(email, {})

    new_user = User(
        name=step3.name,
        surname=step3.surname,
        lastname=step3.lastname,
        email_verified=step3.email_verified,
        email=email,
        phone=step3.phone,
        password_hash=hash_password(step3.password),
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    verification_codes.pop(email, None)
    registration_data.pop(email, None)

    return {
        "message": "Регистрация прошла успешно",
        "user_id": new_user.id
    }

# 🔹 Login
@router.post("/login/")
def login_user(request: LoginRequest, db: Session = Depends(get_db)):
    email = request.email.lower()

    user = db.query(User).filter(User.email == email).first()

    if not user or user.password_hash != hash_password(request.password):
        raise HTTPException(status_code=400, detail="Неверный email или пароль")

    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "phone": user.phone,
            "created_at": user.created_at.isoformat(),
        }
    }


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
async def forgot_password(data: ForgotPasswordRequest,
    background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    email = data.email.lower()

    user = db.query(User).filter(User.email == email).first()

    if not user:
        raise HTTPException(status_code=404, detail="Email не найден")

    code = generate_code()

    reset_codes[email] = {
        "code": code,
        "expires_at": datetime.utcnow() + timedelta(minutes=10)
    }

    # send_email_forgot_password(
    #     to_email=email,
    #     subject="Восстановление пароля",
    #     body=f"Код для восстановления пароля: {code}"
    # )

    background_tasks.add_task(
        send_email_forgot_password,
        email,
        "Восстановление пароля",
        f"Код: {code}"
    )

    return {"message": "Код отправлен на почту"}

@router.post("/reset-password/")
async def reset_password(data: ResetPasswordRequest, db: Session = Depends(get_db)):
    record = reset_codes.get(data.email)

    if not record:
        raise HTTPException(status_code=400, detail="Код не найден")

    if record["code"] != data.code:
        raise HTTPException(status_code=400, detail="Неверный код")

    if record["expires_at"] < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Код истёк")

    user = db.query(User).filter(User.email == data.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    user.password_hash = hash_password(data.new_password)
    db.commit()

    del reset_codes[data.email]

    return {"message": "Пароль успешно обновлён"}

def hash_password(password: str) -> str:
    """Возвращает SHA256-хеш пароля"""
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

class CheckInOutRequest(BaseModel):
    user_id: int
    timestamp: datetime

# Вход
@router.post("/check-in/")
def check_in(data: CheckInOutRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == data.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    # 🔥 Бүгін check-in бар ма тексеру
    today_start = data.timestamp.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)

    existing = (
        db.query(Attendance)
        .filter(
            Attendance.user_id == user.id,
            Attendance.check_in >= today_start,
            Attendance.check_in < today_end,
        )
        .first()
    )

    if existing:
        raise HTTPException(status_code=400, detail="Сегодня уже был check-in")

    attendance = Attendance(user_id=user.id, check_in=data.timestamp)
    db.add(attendance)
    db.commit()
    db.refresh(attendance)

    return {"message": "Check-in сохранен", "attendance_id": attendance.id}

# Уход
@router.post("/check-out/")
def check_out(data: CheckInOutRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == data.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    attendance = (
        db.query(Attendance)
        .filter(
            Attendance.user_id == user.id,
            Attendance.check_out == None,  
        )
        .order_by(Attendance.check_in.desc())
        .first()
    )

    if not attendance:
        raise HTTPException(status_code=400, detail="Нет открытой записи для ухода")

    attendance.check_out = data.timestamp
    db.commit()
    db.refresh(attendance)

    worked_seconds = int((attendance.check_out - attendance.check_in).total_seconds())
    hours = worked_seconds // 3600
    minutes = (worked_seconds % 3600) // 60

    return {
        "message": "Check-out сохранен",
        "attendance_id": attendance.id,
        "worked_seconds": worked_seconds,
        "worked_formatted": f"{hours}ч {minutes:02d}м",
    }

@router.get("/today-status/{user_id}")
def today_status(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)

    attendance = (
        db.query(Attendance)
        .filter(
            Attendance.user_id == user_id,
            Attendance.check_in >= today_start,
            Attendance.check_in < today_end,
        )
        .first()
    )

    if not attendance:
        return {"name": user.name, "is_checked_in": False, "is_checked_out": False}

    worked_seconds = None
    if attendance.check_out:
        worked_seconds = int(
            (attendance.check_out - attendance.check_in).total_seconds()
        )

    return {
        "name": user.name,
        "is_checked_in": attendance.check_in is not None,
        "is_checked_out": attendance.check_out is not None,
        "check_in": attendance.check_in.isoformat() if attendance.check_in else None,
        "check_out": attendance.check_out.isoformat() if attendance.check_out else None,
        "worked_seconds": worked_seconds,
    }

@router.get("/attendance-history/{user_id}")
def attendance_history(
    user_id: int,
    year: int,
    month: int,
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    start_date = datetime(year, month, 1)

    if month == 12:
        end_date = datetime(year + 1, 1, 1)
    else:
        end_date = datetime(year, month + 1, 1)

    records = (
        db.query(Attendance)
        .filter(
            Attendance.user_id == user_id,
            Attendance.check_in >= start_date,
            Attendance.check_in < end_date,
        )
        .order_by(Attendance.check_in.desc())
        .all()
    )

    result = []

    total_worked_seconds = 0
    late_count = 0
    absent_count = 0

    for r in records:
        worked_seconds = None
        worked_formatted = None

        # 🔹 Late логика (мысалы 09:00 кейін келсе)
        if r.check_in.hour > 9 or (r.check_in.hour == 9 and r.check_in.minute > 0):
            late_count += 1

        if r.check_out:
            worked_seconds = int((r.check_out - r.check_in).total_seconds())
            total_worked_seconds += worked_seconds

            hours = worked_seconds // 3600
            minutes = (worked_seconds % 3600) // 60
            worked_formatted = f"{hours}ч {minutes:02d}м"
        else:
            absent_count += 1

        result.append({
            "id": r.id,
            "check_in": r.check_in.isoformat(),
            "check_out": r.check_out.isoformat() if r.check_out else None,
            "worked_seconds": worked_seconds,
            "worked_formatted": worked_formatted,
        })

    # 🔥 Общая отработка
    total_hours = total_worked_seconds // 3600
    total_minutes = (total_worked_seconds % 3600) // 60

    return {
        "user_name": user.name,
        "year": year,
        "month": month,
        "records": result,
        "stats": {
            "total_worked_formatted": f"{total_hours}ч {total_minutes:02d}м",
            "late_count": late_count,
            "absent_count": absent_count
        }
    }

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, ".", "uploads", "faces")
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/check-in-with-photo/")
async def check_in_with_photo(
    user_id: int = Form(...),
    photo: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    # 🔥 Уникальный файл аты
    filename = f"{user_id}_{uuid4().hex}.jpg"
    file_path = os.path.join(UPLOAD_DIR, filename)

    with open(file_path, "wb") as buffer:
        buffer.write(await photo.read())

    attendance = Attendance(
        user_id=user_id,
        check_in_photo=file_path
    )

    db.add(attendance)
    db.commit()
    db.refresh(attendance)

    return {"message": "Check-in с фото сохранен", "attendance_id": attendance.id}

@router.get("/profile/{user_id}")
def get_profile(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    return {
        "id": user.id,
        "name": user.name,
        "surname": user.surname,
        "lastname": user.lastname,
        "email": user.email,
        "email_verified": user.email_verified,
        "gender": user.gender,
        "phone": user.phone,
        "birth_date": user.birth_date.isoformat() if user.birth_date else None,
        "profile_photo": user.profile_photo,
    }

class UpdateProfileRequest(BaseModel):
    name: Optional[str]
    surname: Optional[str]
    lastname: Optional[str]
    phone: Optional[str]
    birth_date: Optional[datetime]
    email: Optional[EmailStr]
    email_verified: Optional[bool]
    gender: Optional[str]

@router.put("/profile/{user_id}")
def update_profile(
    user_id: int,
    data: UpdateProfileRequest,
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    user.name = data.name
    user.surname = data.surname
    user.lastname = data.lastname
    user.phone = data.phone
    user.birth_date = data.birth_date
    user.email_verified = data.email_verified
    user.email = data.email
    user.gender = data.gender
    # user.email_verified = data.email_verified

    db.commit()

    return {"message": "Профиль обновлен успешно"}


PROFILE_UPLOAD_DIR = os.path.join(BASE_DIR, ".", "uploads", "profiles")
os.makedirs(PROFILE_UPLOAD_DIR, exist_ok=True)

@router.post("/profile-photo/{user_id}")
async def upload_profile_photo(
    user_id: int,
    photo: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    filename = f"profile_{user_id}_{uuid4().hex}.jpg"
    file_path = os.path.join(PROFILE_UPLOAD_DIR, filename)

    with open(file_path, "wb") as buffer:
        buffer.write(await photo.read())

    user.profile_photo = file_path
    db.commit()

    return {"message": "Фото обновлено", "photo_url": file_path}

@router.get("/profile-photo/{user_id}")
def get_profile_photo(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    if not user.profile_photo or not os.path.exists(user.profile_photo):
        raise HTTPException(status_code=404, detail="Фото не найдено")
    
    # 1. Файлды бинарлық режимде оқимыз ('rb')
    with open(user.profile_photo, "rb") as image_file:
        # 2. Файлдың мазмұнын оқимыз
        file_content = image_file.read()
        # 3. Оқылған мазмұнды base64-ге кодтаймыз (нәтижесі - bytes)
        encoded_content = base64.b64encode(file_content)
        # 4. Bytes типті UTF-8 строкасына айналдырамыз
        base64_string = encoded_content.decode('utf-8')

    # 5. Клиентке JSON форматында қайтарамыз
    return {"photo_base64": base64_string}

@router.post("/verify-email-send/")
def send_email_verification(email: EmailStr, background_tasks: BackgroundTasks):
    code = generate_code()
    verification_codes[email] = {
        "code": code,
        "expires_at": datetime.utcnow() + timedelta(minutes=5)
    }

    background_tasks.add_task(send_email_for_register, email, code)

    return {"message": "Код отправлен"}

@router.post("/verify-email-confirm/")
def confirm_email(email: EmailStr, code: str, db: Session = Depends(get_db)):
    data = verification_codes.get(email)

    if not data or data["code"] != code:
        raise HTTPException(status_code=400, detail="Неверный код")

    user = db.query(User).filter(User.email == email).first()
    user.email_verified = True
    db.commit()

    return {"message": "Email подтвержден"}







