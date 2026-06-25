from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.auth.jwt import (
    ACCESS_TOKEN_EXPIRE_SECONDS,
    InvalidTokenError,
    generate_refresh_token,
    generate_token,
    verify_refresh_token,
)
from app.auth.password import hash_password, verify_password
from app.auth_schema import (
    LoginRequest,
    LoginResponse,
    RefreshRequest,
    RefreshResponse,
    RegisterRequest,
    RegisterResponse,
)
from app.database import get_db
from app.models import User, UserRole

router = APIRouter(prefix="/auth", tags=["auth"])

_INVALID_CREDENTIALS = "Invalid credentials"
_UNAUTHORIZED_HEADERS = {"WWW-Authenticate": "Bearer"}
DB_DEPENDENCY = Annotated[DBSession, Depends(get_db)]


def _role_enum(role_value: str) -> UserRole:
    return UserRole(role_value)


@router.post(
    "/register",
    status_code=status.HTTP_201_CREATED,
    response_model=RegisterResponse,
)
def register(payload: RegisterRequest, db: DB_DEPENDENCY) -> RegisterResponse:
    existing = (
        db.query(User)
        .filter(User.email == payload.email, User.tenant_id == payload.tenant_id)
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        role=payload.role.value,
        tenant_id=payload.tenant_id,
    )
    db.add(user)

    try:
        db.flush()
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        ) from None
    except Exception:
        db.rollback()
        raise

    return RegisterResponse(user_id=user.id, role=_role_enum(user.role))


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: DB_DEPENDENCY) -> LoginResponse:
    user = db.query(User).filter(User.email == payload.email).first()
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_INVALID_CREDENTIALS,
            headers=_UNAUTHORIZED_HEADERS,
        )

    role = _role_enum(user.role)
    return LoginResponse(
        access_token=generate_token(user.id, role, user.tenant_id),
        refresh_token=generate_refresh_token(user.id, role, user.tenant_id),
        expires_in=ACCESS_TOKEN_EXPIRE_SECONDS,
    )


@router.post("/refresh", response_model=RefreshResponse)
def refresh(payload: RefreshRequest, db: DB_DEPENDENCY) -> RefreshResponse:
    try:
        token_payload = verify_refresh_token(payload.refresh_token)
        user_id = UUID(token_payload["user_id"])
    except (InvalidTokenError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers=_UNAUTHORIZED_HEADERS,
        ) from None

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers=_UNAUTHORIZED_HEADERS,
        )

    role = _role_enum(user.role)
    return RefreshResponse(
        access_token=generate_token(user.id, role, user.tenant_id),
        expires_in=ACCESS_TOKEN_EXPIRE_SECONDS,
    )
