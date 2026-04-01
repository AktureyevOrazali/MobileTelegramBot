from sqlalchemy import Column, ForeignKey, Integer, String, DateTime, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from .base import Base   # ← ОСЫЛАЙ


class User(Base):
    __tablename__ = "users_kabinet"

    id = Column(Integer, primary_key=True, index=True)

    surname = Column(String, nullable=True)
    lastname = Column(String, nullable=True)
    name = Column(String, nullable=True)

    email = Column(String, unique=True, index=True, nullable=False)
    email_verified = Column(Boolean, default=False)

    phone = Column(String, nullable=True)

    gender = Column(String, nullable=True)

    birth_date = Column(DateTime, nullable=True)
    profile_photo = Column(String, nullable=True)

    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    attendances = relationship("Attendance", back_populates="user")

class Attendance(Base):
    __tablename__ = "attendance_kabinet"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users_kabinet.id"))
    check_in = Column(DateTime, nullable=True)
    check_out = Column(DateTime, nullable=True)

    check_in_photo = Column(String, nullable=True) 

    user = relationship("User", back_populates="attendances")