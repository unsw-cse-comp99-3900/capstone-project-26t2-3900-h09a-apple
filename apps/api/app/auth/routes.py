from __future__ import annotations

import logging
import secrets
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DBSession

from app.auth.deps import get_current_user
from app.auth.google import (
    GoogleAuthError,
    build_google_authorization_url,
    exchange_google_code_for_id_token,
    verify_google_id_token,
)
from app.auth.handoff_store import (
    HANDOFF_CODE_EXPIRE_SECONDS,
    HandoffCodeError,
    create_handoff_code,
    redeem_handoff_code,
)
from app.auth.jwt import (
    ACCESS_TOKEN_EXPIRE_SECONDS,
    InvalidTokenError,
    generate_token,
    verify_refresh_token,
)
from app.auth.password import hash_password, verify_login_password
from app.auth.password_reset import consume_reset_token, create_reset_token, hash_reset_token
from app.auth.rate_limit import auth_rate_limiter
from app.auth.refresh_tokens import (
    get_active_refresh_token,
    issue_refresh_token,
    revoke_refresh_token,
)
from app.auth.user_lookup import find_user_by_email, touch_user_lookup
from app.auth_schema import (
    ExtensionHandoffCreateResponse,
    ExtensionHandoffRedeemRequest,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    GoogleAuthCodeRequest,
    LoginRequest,
    LoginResponse,
    LogoutRequest,
    LogoutResponse,
    MeResponse,
    MockEmailOutboxItem,
    MockEmailOutboxResponse,
    RefreshRequest,
    RefreshResponse,
    RegisterRequest,
    RegisterResponse,
    ResetPasswordRequest,
    ResetPasswordResponse,
)
from app.database import get_db
from app.email.sender import (
    build_password_reset_email,
    get_email_sender,
    get_mock_email_outbox,
    is_mock_outbox_available,
)
from app.models import User, UserRole
from app.settings import SettingsError, get_default_tenant_id

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/api/v1/auth",
    tags=["auth"],
    dependencies=[Depends(auth_rate_limiter)],
)

_INVALID_CREDENTIALS = "Invalid credentials"
_REGISTRATION_FAILED = "Registration failed"
_INVALID_TOKEN = "Invalid or expired token"
_INVALID_RESET = "Invalid or expired reset token"
_UNAUTHORIZED_HEADERS = {"WWW-Authenticate": "Bearer"}
DB_DEPENDENCY = Annotated[DBSession, Depends(get_db)]


def _role_enum(role_value: str) -> UserRole:
    return UserRole(role_value)


def _issue_login_tokens(db: DBSession, user: User) -> LoginResponse:
    role = _role_enum(user.role)
    return LoginResponse(
        access_token=generate_token(user.id, role, user.tenant_id),
        refresh_token=issue_refresh_token(db, user, role),
        expires_in=ACCESS_TOKEN_EXPIRE_SECONDS,
        user_id=user.id,
    )


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

    return _issue_login_tokens(db, user)


@router.post("/google/callback", response_model=LoginResponse)
def google_callback(payload: GoogleAuthCodeRequest, db: DB_DEPENDENCY) -> LoginResponse:
    try:
        id_token = exchange_google_code_for_id_token(payload.code, payload.redirect_uri)
        google_identity = verify_google_id_token(id_token)
    except SettingsError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from None
    except GoogleAuthError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google sign-in",
            headers=_UNAUTHORIZED_HEADERS,
        ) from None

    user = find_user_by_email(db, google_identity.email)

    if user is None:
        role = UserRole.employee

        try:
            tenant_id = get_default_tenant_id()
        except SettingsError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(exc),
            ) from None

        user = User(
            email=google_identity.email,
            hashed_password=hash_password(uuid4().hex),
            role=role.value,
            tenant_id=tenant_id,
        )
        db.add(user)

        try:
            db.flush()
            db.commit()
        except IntegrityError:
            db.rollback()
            user = find_user_by_email(db, google_identity.email)
            if user is None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=_REGISTRATION_FAILED,
                ) from None
        except Exception:
            db.rollback()
            raise

    return _issue_login_tokens(db, user)


@router.get("/google/authorize")
def google_authorize(
    redirect_uri: str = Query(..., min_length=1),
    state: str | None = Query(default=None),
) -> RedirectResponse:
    try:
        authorization_url = build_google_authorization_url(redirect_uri, state)
    except SettingsError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from None

    return RedirectResponse(authorization_url)


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

    return _issue_login_tokens(db, user)


@router.post("/refresh", response_model=RefreshResponse)
def refresh(payload: RefreshRequest, db: DB_DEPENDENCY) -> RefreshResponse:
    try:
        token_payload = verify_refresh_token(payload.refresh_token)
        user_id = UUID(token_payload["user_id"])
        jti = UUID(token_payload["jti"])
    except (InvalidTokenError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_INVALID_TOKEN,
            headers=_UNAUTHORIZED_HEADERS,
        ) from None

    stored = get_active_refresh_token(db, jti)
    if stored is None or stored.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_INVALID_TOKEN,
            headers=_UNAUTHORIZED_HEADERS,
        )

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_INVALID_TOKEN,
            headers=_UNAUTHORIZED_HEADERS,
        )

    role = _role_enum(user.role)
    return RefreshResponse(
        access_token=generate_token(user.id, role, user.tenant_id),
        expires_in=ACCESS_TOKEN_EXPIRE_SECONDS,
    )


@router.post("/logout", response_model=LogoutResponse)
def logout(payload: LogoutRequest, db: DB_DEPENDENCY) -> LogoutResponse:
    try:
        token_payload = verify_refresh_token(payload.refresh_token)
        jti = UUID(token_payload["jti"])
    except (InvalidTokenError, ValueError):
        return LogoutResponse(ok=True)

    revoke_refresh_token(db, jti)
    return LogoutResponse(ok=True)


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
def forgot_password(
    payload: ForgotPasswordRequest,
    db: DB_DEPENDENCY,
) -> ForgotPasswordResponse:
    # Always hash a throwaway token so missing users take similar CPU work.
    hash_reset_token(secrets.token_urlsafe(32))
    user = find_user_by_email(db, payload.email)
    touch_user_lookup(db)

    if user is not None:
        raw_token = create_reset_token(db, user)
        message = build_password_reset_email(to=user.email, raw_token=raw_token)
        try:
            get_email_sender().send(
                to=message.to,
                subject=message.subject,
                text_body=message.text_body,
                html_body=message.html_body,
            )
            logger.info("Password reset email queued", extra={"user_id": str(user.id)})
        except Exception:
            logger.exception(
                "Password reset email send failed",
                extra={"user_id": str(user.id)},
            )

    return ForgotPasswordResponse()


@router.get("/dev/mock-email-outbox", response_model=MockEmailOutboxResponse)
def mock_email_outbox() -> MockEmailOutboxResponse:
    if not is_mock_outbox_available():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    return MockEmailOutboxResponse(
        messages=[
            MockEmailOutboxItem(
                to=message.to,
                subject=message.subject,
                text_body=message.text_body,
                html_body=message.html_body,
                reset_url=message.reset_url,
            )
            for message in get_mock_email_outbox()
        ]
    )


@router.post("/reset-password", response_model=ResetPasswordResponse)
def reset_password(payload: ResetPasswordRequest, db: DB_DEPENDENCY) -> ResetPasswordResponse:
    user_id = consume_reset_token(db, payload.token, payload.new_password)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_INVALID_RESET,
        )
    return ResetPasswordResponse(ok=True)
