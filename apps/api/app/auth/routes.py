from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.auth.deps import get_current_user
from app.auth.handoff_store import (
    HANDOFF_CODE_EXPIRE_SECONDS,
    HandoffCodeError,
    create_handoff_code,
    redeem_handoff_code,
)
from app.auth.jwt import (
    ACCESS_TOKEN_EXPIRE_SECONDS,
    InvalidTokenError,
    generate_refresh_token,
    generate_token,
    verify_refresh_token,
)
from app.auth.password import hash_password, verify_login_password
from app.auth.rate_limit import auth_rate_limiter
from app.auth.user_lookup import find_user_by_email, touch_user_lookup
from app.auth_schema import (
    ExtensionHandoffCreateResponse,
    ExtensionHandoffRedeemRequest,
    LoginRequest,
    LoginResponse,
    MeResponse,
    RefreshRequest,
    RefreshResponse,
    RegisterRequest,
    RegisterResponse,
)
from app.database import get_db
from app.models import User, UserRole
from app.settings import get_default_tenant_id

router = APIRouter(
    prefix="/api/v1/auth",
    tags=["auth"],
    dependencies=[Depends(auth_rate_limiter)],
)

_INVALID_CREDENTIALS = "Invalid credentials"
_REGISTRATION_FAILED = "Registration failed"
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
    hashed_password = hash_password(payload.password)
    tenant_id = get_default_tenant_id()
    role = UserRole.employee

    existing = (
        db.query(User).filter(User.email == payload.email, User.tenant_id == tenant_id).first()
    )
    touch_user_lookup(db)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_REGISTRATION_FAILED,
        )

    user = User(
        email=payload.email,
        hashed_password=hashed_password,
        role=role.value,
        tenant_id=tenant_id,
    )
    db.add(user)

    try:
        db.flush()
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_REGISTRATION_FAILED,
        ) from None
    except Exception:
        db.rollback()
        raise

    return RegisterResponse(user_id=user.id, role=role)


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: DB_DEPENDENCY) -> LoginResponse:
    user = find_user_by_email(db, payload.email)
    user_hash = user.hashed_password if user is not None else None
    if not verify_login_password(payload.password, user_hash):
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
        user_id=user.id,
    )


@router.get("/me", response_model=MeResponse)
def me(current_user: Annotated[User, Depends(get_current_user)]) -> MeResponse:
    return MeResponse(
        id=current_user.id,
        email=current_user.email,
        role=_role_enum(current_user.role),
        tenant_id=current_user.tenant_id,
    )


@router.post("/extension-handoff", response_model=ExtensionHandoffCreateResponse)
def create_extension_handoff(
    current_user: Annotated[User, Depends(get_current_user)],
) -> ExtensionHandoffCreateResponse:
    code = create_handoff_code(current_user.id)
    return ExtensionHandoffCreateResponse(code=code, expires_in=HANDOFF_CODE_EXPIRE_SECONDS)


@router.post("/extension-handoff/redeem", response_model=LoginResponse)
def redeem_extension_handoff(
    payload: ExtensionHandoffRedeemRequest, db: DB_DEPENDENCY
) -> LoginResponse:
    try:
        user_id = redeem_handoff_code(payload.code)
    except HandoffCodeError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired handoff code",
            headers=_UNAUTHORIZED_HEADERS,
        ) from None

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired handoff code",
            headers=_UNAUTHORIZED_HEADERS,
        )

    role = _role_enum(user.role)
    return LoginResponse(
        access_token=generate_token(user.id, role, user.tenant_id),
        refresh_token=generate_refresh_token(user.id, role, user.tenant_id),
        expires_in=ACCESS_TOKEN_EXPIRE_SECONDS,
        user_id=user.id,
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
