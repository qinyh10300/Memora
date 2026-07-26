from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select

from memora.database import DatabaseSession
from memora.identity.models import User, UserSession
from memora.identity.security import digest_session_token
from memora.settings import Settings, get_settings
from memora.workspaces.models import WorkspaceMembership

SESSION_COOKIE_NAME = "memora_session"


@dataclass(frozen=True)
class Principal:
    user_id: UUID
    workspace_id: UUID
    email: str
    display_name: str
    role: str
    session_id: UUID | None = None


def get_current_principal(
    request: Request,
    database: DatabaseSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Principal:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="需要登录")

    token_digest = digest_session_token(token, settings.session_secret)
    row = database.execute(
        select(UserSession, User, WorkspaceMembership)
        .join(User, User.id == UserSession.user_id)
        .join(
            WorkspaceMembership,
            (WorkspaceMembership.user_id == UserSession.user_id)
            & (WorkspaceMembership.workspace_id == UserSession.workspace_id),
        )
        .where(
            UserSession.token_digest == token_digest,
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > datetime.now(UTC),
            User.status == "ACTIVE",
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="会话已失效")

    user_session, user, membership = row
    return Principal(
        user_id=user.id,
        workspace_id=user_session.workspace_id,
        email=user.email,
        display_name=user.display_name,
        role=membership.role,
        session_id=user_session.id,
    )


CurrentPrincipal = Annotated[Principal, Depends(get_current_principal)]
