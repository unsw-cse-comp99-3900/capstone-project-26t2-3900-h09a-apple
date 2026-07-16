from __future__ import annotations

from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, BeforeValidator, ConfigDict, EmailStr, Field

from app.models import UserRole


def normalize_email(value: object) -> object:
    if isinstance(value, str):
        return value.strip().lower()
    return value


NormalizedEmail = Annotated[EmailStr, BeforeValidator(normalize_email)]


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: NormalizedEmail
    password: str = Field(min_length=1)
    role: UserRole
    tenant_id: UUID


class RegisterResponse(BaseModel):
    user_id: UUID
    role: UserRole


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: NormalizedEmail
    password: str = Field(min_length=1)


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user_id: UUID


class RefreshRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refresh_token: str = Field(min_length=1)


class RefreshResponse(BaseModel):
    access_token: str
    expires_in: int


class LogoutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refresh_token: str = Field(min_length=1)


class LogoutResponse(BaseModel):
    ok: bool = True


class ForgotPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: NormalizedEmail


class ForgotPasswordResponse(BaseModel):
    detail: str = "If an account exists for that email, a reset link has been sent."


class ResetPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str = Field(min_length=1)
    new_password: str = Field(min_length=1)


class ResetPasswordResponse(BaseModel):
    ok: bool = True


class MeResponse(BaseModel):
    id: UUID
    email: NormalizedEmail
    role: UserRole
    tenant_id: UUID


class ExtensionHandoffCreateResponse(BaseModel):
    code: str
    expires_in: int


class ExtensionHandoffRedeemRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1)
