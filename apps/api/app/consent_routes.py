from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session as DBSession

from app.auth.deps import require_role
from app.consent_constants import CURRENT_CONSENT_TERMS_VERSION
from app.consent_schema import (
    ConsentAcceptRequest,
    ConsentAcceptResponse,
    ConsentStatusResponse,
)
from app.database import get_db
from app.models import ConsentAcceptance, ConsentType, User, UserRole

router = APIRouter(prefix="/api/v1/consent", tags=["consent"])


@router.post(
    "/accept",
    response_model=ConsentAcceptResponse,
    status_code=status.HTTP_201_CREATED,
)
def accept_consent(
    payload: ConsentAcceptRequest,
    current_user: Annotated[User, Depends(require_role(UserRole.employee))],
    db: Annotated[DBSession, Depends(get_db)],
) -> ConsentAcceptResponse:
    accepted_at = datetime.now(UTC)
    row = ConsentAcceptance(
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        consent_type=payload.consent_type.value,
        version=payload.version.strip(),
        accepted_at=accepted_at,
    )
    db.add(row)
    db.commit()

    return ConsentAcceptResponse(
        consent_type=payload.consent_type,
        version=row.version,
        accepted_at=accepted_at,
    )


@router.get("/status", response_model=ConsentStatusResponse)
def get_consent_status(
    consent_type: Annotated[ConsentType, Query()],
    current_user: Annotated[User, Depends(require_role(UserRole.employee))],
    db: Annotated[DBSession, Depends(get_db)],
) -> ConsentStatusResponse:
    latest = (
        db.query(ConsentAcceptance)
        .filter(
            ConsentAcceptance.user_id == current_user.id,
            ConsentAcceptance.consent_type == consent_type.value,
            ConsentAcceptance.version == CURRENT_CONSENT_TERMS_VERSION,
        )
        .order_by(ConsentAcceptance.accepted_at.desc())
        .first()
    )

    if latest is None:
        return ConsentStatusResponse(
            accepted=False,
            accepted_at=None,
            consent_type=consent_type,
            version=CURRENT_CONSENT_TERMS_VERSION,
        )

    return ConsentStatusResponse(
        accepted=True,
        accepted_at=latest.accepted_at,
        consent_type=consent_type,
        version=CURRENT_CONSENT_TERMS_VERSION,
    )
