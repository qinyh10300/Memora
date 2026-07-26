import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, SecretStr
from sqlalchemy import select, update

from memora.database import DatabaseSession
from memora.identity.dependencies import (
    SESSION_COOKIE_NAME,
    CurrentPrincipal,
)
from memora.identity.models import User, UserSession
from memora.identity.rate_limit import LoginRateLimiter
from memora.identity.security import digest_session_token, normalize_email, verify_password
from memora.settings import Settings, get_settings
from memora.workspaces.models import Workspace, WorkspaceMembership

router = APIRouter(prefix="/auth", tags=["identity"])
SettingsDependency = Annotated[Settings, Depends(get_settings)]


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: SecretStr


class CurrentUserResponse(BaseModel):
    id: str
    email: str
    display_name: str
    workspace_id: str
    workspace_name: str
    role: str


def _response_for(
    *, user: User, workspace: Workspace, membership: WorkspaceMembership
) -> CurrentUserResponse:
    return CurrentUserResponse(
        id=str(user.id),
        email=user.email,
        display_name=user.display_name,
        workspace_id=str(workspace.id),
        workspace_name=workspace.name,
        role=membership.role,
    )


def _rate_limit_key(request: Request, email: str) -> str:
    client_host = request.client.host if request.client else "unknown"
    return f"{client_host}:{email}"


@router.post(
    "/login",
    response_model=CurrentUserResponse,
    responses={401: {"description": "邮箱或密码错误"}, 429: {"description": "尝试过多"}},
)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    database: DatabaseSession,
    settings: SettingsDependency,
) -> CurrentUserResponse:
    email = normalize_email(payload.email)
    rate_limit_key = _rate_limit_key(request, email)
    limiter: LoginRateLimiter = request.app.state.login_rate_limiter
    if not limiter.consume(rate_limit_key):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="请稍后再试")

    user = database.scalar(select(User).where(User.email == email, User.status == "ACTIVE"))
    password_is_valid = verify_password(
        payload.password.get_secret_value(), user.password_hash if user else None
    )
    if user is None or not password_is_valid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="邮箱或密码错误")

    membership_row = database.execute(
        select(WorkspaceMembership, Workspace)
        .join(Workspace, Workspace.id == WorkspaceMembership.workspace_id)
        .where(WorkspaceMembership.user_id == user.id)
        .order_by(Workspace.created_at, Workspace.slug)
        .limit(1)
    ).one_or_none()
    if membership_row is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账号不属于工作区")
    membership, workspace = membership_row

    raw_token = secrets.token_urlsafe(32)
    expires_at = datetime.now(UTC) + timedelta(seconds=settings.session_ttl_seconds)
    database.add(
        UserSession(
            user_id=user.id,
            workspace_id=workspace.id,
            token_digest=digest_session_token(raw_token, settings.session_secret),
            expires_at=expires_at,
        )
    )
    database.commit()
    limiter.reset(rate_limit_key)

    response.set_cookie(
        SESSION_COOKIE_NAME,
        raw_token,
        max_age=settings.session_ttl_seconds,
        expires=expires_at,
        path="/",
        secure=settings.app_env == "production",
        httponly=True,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"
    return _response_for(user=user, workspace=workspace, membership=membership)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    database: DatabaseSession,
    settings: SettingsDependency,
) -> None:
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token:
        database.execute(
            update(UserSession)
            .where(
                UserSession.token_digest == digest_session_token(token, settings.session_secret),
                UserSession.revoked_at.is_(None),
            )
            .values(revoked_at=datetime.now(UTC))
        )
        database.commit()
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        path="/",
        secure=settings.app_env == "production",
        httponly=True,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"


@router.get("/me", response_model=CurrentUserResponse)
def me(principal: CurrentPrincipal, database: DatabaseSession) -> CurrentUserResponse:
    row = database.execute(
        select(User, Workspace, WorkspaceMembership)
        .join(WorkspaceMembership, WorkspaceMembership.user_id == User.id)
        .join(Workspace, Workspace.id == WorkspaceMembership.workspace_id)
        .where(
            User.id == principal.user_id,
            Workspace.id == principal.workspace_id,
        )
    ).one()
    user, workspace, membership = row
    return _response_for(user=user, workspace=workspace, membership=membership)
