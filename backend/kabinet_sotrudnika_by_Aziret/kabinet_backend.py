import hashlib
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime, timedelta
import random
import string
import smtplib

from email.mime.text import MIMEText
from email.header import Header

router = APIRouter()

# рџџў "Р‘Р°Р·Р° РґР°РЅРЅС‹С…" РІ РїР°РјСЏС‚Рё
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

# рџ“¦ Pydantic СЃС…РµРјР°Р»Р°СЂС‹
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

# рџ”№ Utility functions
def send_email_forgot_password(to_email: str, subject: str, body: str):
    FROM_EMAIL = "a.develop2021@gmail.com"
    APP_PASSWORD = "ooyg phvz odwj woqv"

    # РўРµРє РјС‹СЃР°Р» ТЇС€С–РЅ, РЅР° РїСЂР°РєС‚РёРєРµ РёСЃРїРѕР»СЊР·СѓРµРј SMTP СЃРµСЂРІРµСЂ РЅРµРјРµСЃРµ SendGrid, Mailgun
    #print(f"РћС‚РїСЂР°РІРєР° РєРѕРґР° {code} РЅР° email: {to_email}")
    
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = FROM_EMAIL
    msg["To"] = to_email

    with smtplib.SMTP("smtp.gmail.com", 587) as server:
        server.starttls()
        server.login(FROM_EMAIL, APP_PASSWORD)
        server.send_message(msg)

# рџ”№ Utility functions
def send_email_for_register(to_email: str, code: str):
    # РўРµРє РјС‹СЃР°Р» ТЇС€С–РЅ, РЅР° РїСЂР°РєС‚РёРєРµ РёСЃРїРѕР»СЊР·СѓРµРј SMTP СЃРµСЂРІРµСЂ РЅРµРјРµСЃРµ SendGrid, Mailgun
    print(f"РћС‚РїСЂР°РІРєР° РєРѕРґР° {code} РЅР° email: {to_email}")
    # РџСЂРёРјРµСЂ SMTP (Gmail)

    FROM_EMAIL = "a.develop2021@gmail.com"      # У©Р· Gmail
    APP_PASSWORD = "ooyg phvz odwj woqv"    # Google App Password
    
    subject = Header("РџРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ РїРѕС‡С‚С‹", "utf-8")
    body = f"Р’Р°С€ РєРѕРґ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ: {code}"

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

# рџџў Р’СЂРµРјРµРЅРЅРѕРµ С…СЂР°РЅРµРЅРёРµ РґР°РЅРЅС‹С… СЂРµРіРёСЃС‚СЂР°С†РёРё
registration_data = {}  # {email: {"name": str, "phone": str}}

@router.post("/register-step1/")
def register_step1(data: RegisterStep1):
    # С‚СѓС‚ РјРѕР¶РЅРѕ СЃРѕР·РґР°С‚СЊ РІСЂРµРјРµРЅРЅС‹Р№ email-РєР»СЋС‡ РёР»Рё Р·Р°РїСЂРѕСЃРёС‚СЊ email СЃСЂР°Р·Сѓ
    return {"message": "Step1 done, СЃРѕС…СЂР°РЅРёС‚Рµ email РЅР° РєР»РёРµРЅС‚Рµ"}


@router.get("/getinfo/")
def get_info():
    return {"message": "getinfo",}

# рџ”№ Registration Step 2 - Send code
@router.post("/send-code/")
def send_verification_code(step2: RegisterStep2, background_tasks: BackgroundTasks):
    email = step2.email.lower()
    if email in users_db:
        raise HTTPException(status_code=400, detail="Email СѓР¶Рµ Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ")
    
    # РЎРѕС…СЂР°РЅСЏРµРј РІСЂРµРјРµРЅРЅРѕ РёРјСЏ Рё С‚РµР»РµС„РѕРЅ
    registration_data[email] = {
        "name": step2.name if hasattr(step2, "name") else "РРјСЏ",
        "phone": step2.phone
    }

    code = generate_code()
    expires_at = datetime.utcnow() + timedelta(seconds=60)
    verification_codes[email] = {"code": code, "expires_at": expires_at}
    background_tasks.add_task(send_email_for_register, email, code)
    return {"message": "РљРѕРґ РѕС‚РїСЂР°РІР»РµРЅ РЅР° РїРѕС‡С‚Сѓ", "expires_in": 60}

# рџ”№ Registration Step 3 - Confirm code and set password
@router.post("/register/")
def register_user(step3: RegisterStep3):
    email = step3.email.lower()
    if email in users_db:
        raise HTTPException(status_code=400, detail="Email СѓР¶Рµ Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ")
    if step3.password != step3.confirm_password:
        raise HTTPException(status_code=400, detail="РџР°СЂРѕР»Рё РЅРµ СЃРѕРІРїР°РґР°СЋС‚")
    # РџСЂРѕРІРµСЂСЏРµРј РєРѕРґ
    code_data = verification_codes.get(email)
    if not code_data or code_data["code"] != step3.code:
        raise HTTPException(status_code=400, detail="РќРµРІРµСЂРЅС‹Р№ РєРѕРґ")
    if datetime.utcnow() > code_data["expires_at"]:
        raise HTTPException(status_code=400, detail="РљРѕРґ СѓСЃС‚Р°СЂРµР». РћС‚РїСЂР°РІСЊС‚Рµ РїРѕРІС‚РѕСЂРЅРѕ.")
    
    
    # Р‘РµСЂРµРј РґР°РЅРЅС‹Рµ name Рё phone РёР· РІСЂРµРјРµРЅРЅРѕРіРѕ С…СЂР°РЅРёР»РёС‰Р°
    temp_data = registration_data.get(email, {})
    users_db[email] = {
        "name": temp_data.get("name"),
        "phone": temp_data.get("phone"),
        "password": step3.password
    }

    verification_codes.pop(email)
    registration_data.pop(email, None)
    return {"message": "Р РµРіРёСЃС‚СЂР°С†РёСЏ РїСЂРѕС€Р»Р° СѓСЃРїРµС€РЅРѕ"}

# рџ”№ Login
@router.post("/login/")
def login_user(request: LoginRequest):
    email = request.email.lower()
    user = users_db.get(email)
    if not user or user["password"] != request.password:
        raise HTTPException(status_code=400, detail="РќРµРІРµСЂРЅС‹Р№ email РёР»Рё РїР°СЂРѕР»СЊ")
    return {
        "user": {
            "id": email,            # РјРѕР¶РЅРѕ РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ email РєР°Рє ID
            "email": email,
            "name": user["name"],
            "phone": user.get("phone"),
            "created_at": datetime.utcnow().isoformat()
        }}

# рџ”№ Resend code
@router.post("/resend-code/")
def resend_code(email: EmailStr, background_tasks: BackgroundTasks):
    email = email.lower()
    code = generate_code()
    expires_at = datetime.utcnow() + timedelta(seconds=60)
    verification_codes[email] = {"code": code, "expires_at": expires_at}
    background_tasks.add_task(send_email_for_register, email, code)
    return {"message": "РљРѕРґ РѕС‚РїСЂР°РІР»РµРЅ РїРѕРІС‚РѕСЂРЅРѕ", "expires_in": 60}

@router.post("/verify-code/")
def verify_code(payload: VerifyCodeRequest):
    email = payload.email.lower()
    code = payload.code

    data = verification_codes.get(email)

    if not data:
        raise HTTPException(status_code=400, detail="РљРѕРґ РЅРµ РЅР°Р№РґРµРЅ")

    if datetime.utcnow() > data["expires_at"]:
        raise HTTPException(status_code=400, detail="РљРѕРґ РёСЃС‚РµРє")

    if data["code"] != code:
        raise HTTPException(status_code=400, detail="РќРµРІРµСЂРЅС‹Р№ РєРѕРґ")

    return {"message": "РљРѕРґ РїРѕРґС‚РІРµСЂР¶РґРµРЅ"}

reset_codes = {} 

@router.post("/forgot-password/")
async def forgot_password(data: ForgotPasswordRequest):
    email = data.email

    user = users_db.get(email)
    if not user:
        raise HTTPException(status_code=404, detail="Email РЅРµ РЅР°Р№РґРµРЅ")

    code = generate_code()

    reset_codes[email] = {
        "code": code,
        "expires_at": datetime.utcnow() + timedelta(minutes=10)
    }

    send_email_forgot_password(
        to_email=email,
        subject="Р’РѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ РїР°СЂРѕР»СЏ",
        body=f"РљРѕРґ РґР»СЏ РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёСЏ РїР°СЂРѕР»СЏ: {code}"
    )

    return {"message": "РљРѕРґ РѕС‚РїСЂР°РІР»РµРЅ РЅР° РїРѕС‡С‚Сѓ"}

@router.post("/reset-password/")
async def reset_password(data: ResetPasswordRequest):
    record = reset_codes.get(data.email)

    if not record:
        raise HTTPException(status_code=400, detail="РљРѕРґ РЅРµ РЅР°Р№РґРµРЅ")

    if record["code"] != data.code:
        raise HTTPException(status_code=400, detail="РќРµРІРµСЂРЅС‹Р№ РєРѕРґ")

    if record["expires_at"] < datetime.utcnow():
        raise HTTPException(status_code=400, detail="РљРѕРґ РёСЃС‚С‘Рє")

    users_db[data.email]["password"] = data.new_password

    del reset_codes[data.email]

    return {"message": "РџР°СЂРѕР»СЊ СѓСЃРїРµС€РЅРѕ РѕР±РЅРѕРІР»С‘РЅ"}

def hash_password(password: str) -> str:
    """Р’РѕР·РІСЂР°С‰Р°РµС‚ SHA256-С…РµС€ РїР°СЂРѕР»СЏ"""
    return hashlib.sha256(password.encode('utf-8')).hexdigest()



