import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, SecretStr
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from memora.assets.models import Asset
from memora.assets.service import AssetValidationError, create_asset, decode_asset_base64
from memora.audit.models import AuditEvent
from memora.database import DatabaseSession
from memora.identity.dependencies import (
    SESSION_COOKIE_NAME,
    CurrentPrincipal,
    Principal,
)
from memora.identity.models import User, UserSession
from memora.identity.rate_limit import LoginRateLimiter
from memora.identity.security import (
    digest_session_token,
    hash_password,
    normalize_email,
    verify_password,
)
from memora.settings import Settings, get_settings
from memora.workspaces.models import Workspace, WorkspaceMembership

router = APIRouter(prefix="/auth", tags=["identity"])
SettingsDependency = Annotated[Settings, Depends(get_settings)]


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: SecretStr


class RegisterRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=320)
    password: SecretStr = Field(min_length=10, max_length=128)


class CurrentUserResponse(BaseModel):
    id: str
    email: str
    display_name: str
    avatar_url: str | None
    workspace_id: str
    workspace_name: str
    role: str


class UpdateProfileRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)


class UpdateAvatarRequest(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    media_type: Literal["image/png", "image/jpeg", "image/webp"]
    data: str = Field(min_length=1)


class UpdatePasswordRequest(BaseModel):
    current_password: SecretStr = Field(min_length=1, max_length=128)
    new_password: SecretStr = Field(min_length=10, max_length=128)


def _response_for(
    *, user: User, workspace: Workspace, membership: WorkspaceMembership
) -> CurrentUserResponse:
    return CurrentUserResponse(
        id=str(user.id),
        email=user.email,
        display_name=user.display_name,
        avatar_url=(f"/api/auth/avatar/{user.avatar_asset_id}" if user.avatar_asset_id else None),
        workspace_id=str(workspace.id),
        workspace_name=workspace.name,
        role=membership.role,
    )


def _rate_limit_key(request: Request, email: str) -> str:
    client_host = request.client.host if request.client else "unknown"
    return f"{client_host}:{email}"


def _start_session(
    *,
    database: DatabaseSession,
    response: Response,
    settings: Settings,
    user: User,
    workspace: Workspace,
) -> None:
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


def _current_user_context(
    database: DatabaseSession, principal: Principal
) -> tuple[User, Workspace, WorkspaceMembership]:
    user, workspace, membership = database.execute(
        select(User, Workspace, WorkspaceMembership)
        .join(WorkspaceMembership, WorkspaceMembership.user_id == User.id)
        .join(Workspace, Workspace.id == WorkspaceMembership.workspace_id)
        .where(
            User.id == principal.user_id,
            Workspace.id == principal.workspace_id,
        )
    ).one()
    return user, workspace, membership


def _audit_account_change(database: DatabaseSession, principal: Principal, action: str) -> None:
    database.add(
        AuditEvent(
            workspace_id=principal.workspace_id,
            actor_id=principal.user_id,
            action=action,
            resource_type="USER",
            resource_id=principal.user_id,
        )
    )


def _delete_previous_avatar(database: DatabaseSession, user: User) -> None:
    if user.avatar_asset_id is None:
        return
    previous = database.scalar(
        select(Asset).where(
            Asset.id == user.avatar_asset_id,
            Asset.owner_id == user.id,
            Asset.deleted_at.is_(None),
        )
    )
    if previous is not None:
        previous.deleted_at = datetime.now(UTC)


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

    _start_session(
        database=database,
        response=response,
        settings=settings,
        user=user,
        workspace=workspace,
    )
    limiter.reset(rate_limit_key)
    return _response_for(user=user, workspace=workspace, membership=membership)


@router.post(
    "/register",
    response_model=CurrentUserResponse,
    status_code=status.HTTP_201_CREATED,
    responses={409: {"description": "账号已存在"}, 429: {"description": "尝试过多"}},
)
def register(
    payload: RegisterRequest,
    request: Request,
    response: Response,
    database: DatabaseSession,
    settings: SettingsDependency,
) -> CurrentUserResponse:
    email = normalize_email(payload.email)
    if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="请输入有效邮箱",
        )
    display_name = " ".join(payload.display_name.split())
    if not display_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="昵称不能为空",
        )

    rate_limit_key = _rate_limit_key(request, f"register:{email}")
    limiter: LoginRateLimiter = request.app.state.login_rate_limiter
    if not limiter.consume(rate_limit_key):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="请稍后再试")
    if database.scalar(select(User.id).where(User.email == email)) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该邮箱已注册")

    user = User(
        email=email,
        display_name=display_name,
        password_hash=hash_password(payload.password.get_secret_value()),
    )
    database.add(user)
    try:
        database.flush()
    except IntegrityError as error:
        database.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该邮箱已注册") from error

    workspace = Workspace(
        slug=f"personal-{user.id.hex}",
        name=f"{display_name} 的个人空间",
        kind="PERSONAL",
    )
    database.add(workspace)
    database.flush()
    membership = WorkspaceMembership(
        workspace_id=workspace.id,
        user_id=user.id,
        role="OWNER",
    )
    database.add(membership)
    database.add(
        AuditEvent(
            workspace_id=workspace.id,
            actor_id=user.id,
            action="ACCOUNT_REGISTERED",
            resource_type="USER",
            resource_id=user.id,
        )
    )
    _start_session(
        database=database,
        response=response,
        settings=settings,
        user=user,
        workspace=workspace,
    )
    limiter.reset(rate_limit_key)
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
    user, workspace, membership = _current_user_context(database, principal)
    return _response_for(user=user, workspace=workspace, membership=membership)


@router.patch("/profile", response_model=CurrentUserResponse)
def update_profile(
    payload: UpdateProfileRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> CurrentUserResponse:
    display_name = " ".join(payload.display_name.split())
    if not display_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="昵称不能为空",
        )

    user, workspace, membership = _current_user_context(database, principal)
    user.display_name = display_name
    personal_workspaces = database.scalars(
        select(Workspace)
        .join(WorkspaceMembership, WorkspaceMembership.workspace_id == Workspace.id)
        .where(
            WorkspaceMembership.user_id == user.id,
            Workspace.kind == "PERSONAL",
        )
    ).all()
    for personal_workspace in personal_workspaces:
        personal_workspace.name = f"{display_name} 的个人空间"
    _audit_account_change(database, principal, "PROFILE_UPDATED")
    database.commit()
    database.refresh(user)
    if workspace.kind == "PERSONAL":
        database.refresh(workspace)
    return _response_for(user=user, workspace=workspace, membership=membership)


@router.put("/avatar", response_model=CurrentUserResponse)
def update_avatar(
    payload: UpdateAvatarRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> CurrentUserResponse:
    user, workspace, membership = _current_user_context(database, principal)
    try:
        content = decode_asset_base64(payload.data)
        avatar = create_asset(
            database,
            principal,
            name=payload.name,
            media_type=payload.media_type,
            content=content,
        )
    except AssetValidationError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error

    database.flush()
    _delete_previous_avatar(database, user)
    user.avatar_asset_id = avatar.id
    _audit_account_change(database, principal, "PROFILE_AVATAR_UPDATED")
    database.commit()
    database.refresh(user)
    return _response_for(user=user, workspace=workspace, membership=membership)


@router.delete("/avatar", response_model=CurrentUserResponse)
def delete_avatar(
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> CurrentUserResponse:
    user, workspace, membership = _current_user_context(database, principal)
    _delete_previous_avatar(database, user)
    user.avatar_asset_id = None
    _audit_account_change(database, principal, "PROFILE_AVATAR_REMOVED")
    database.commit()
    database.refresh(user)
    return _response_for(user=user, workspace=workspace, membership=membership)


@router.get("/avatar/{avatar_id}")
def get_avatar(
    avatar_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> Response:
    avatar = database.scalar(
        select(Asset)
        .join(User, User.avatar_asset_id == Asset.id)
        .where(
            User.id == principal.user_id,
            User.avatar_asset_id == avatar_id,
            Asset.id == avatar_id,
            Asset.owner_id == principal.user_id,
            Asset.kind == "IMAGE",
            Asset.deleted_at.is_(None),
        )
    )
    if avatar is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="头像不存在")
    return Response(
        content=avatar.content,
        media_type=avatar.content_type,
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": f'inline; filename="{avatar.name}"',
        },
    )


@router.put("/password", status_code=status.HTTP_204_NO_CONTENT)
def update_password(
    payload: UpdatePasswordRequest,
    request: Request,
    response: Response,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> None:
    limiter: LoginRateLimiter = request.app.state.login_rate_limiter
    rate_limit_key = _rate_limit_key(request, f"password:{principal.user_id}")
    if not limiter.consume(rate_limit_key):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="请稍后再试")

    user = database.get(User, principal.user_id)
    if user is None or not verify_password(
        payload.current_password.get_secret_value(), user.password_hash if user else None
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前密码不正确")
    new_password = payload.new_password.get_secret_value()
    if verify_password(new_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="新密码不能与当前密码相同",
        )

    user.password_hash = hash_password(new_password)
    revoke_query = update(UserSession).where(
        UserSession.user_id == principal.user_id,
        UserSession.revoked_at.is_(None),
    )
    if principal.session_id is not None:
        revoke_query = revoke_query.where(UserSession.id != principal.session_id)
    database.execute(revoke_query.values(revoked_at=datetime.now(UTC)))
    _audit_account_change(database, principal, "PASSWORD_CHANGED")
    database.commit()
    limiter.reset(rate_limit_key)
    response.headers["Cache-Control"] = "no-store"
