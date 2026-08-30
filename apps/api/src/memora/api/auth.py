import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID, uuid4

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
from memora.identity.email_verification import (
    VerificationCodeDeliveryError,
    VerificationCodePurpose,
    VerificationCodeSender,
)
from memora.identity.models import EmailVerificationChallenge, User, UserSession
from memora.identity.rate_limit import LoginRateLimiter
from memora.identity.security import (
    digest_session_token,
    digest_verification_code,
    hash_password,
    normalize_email,
    verify_password,
    verify_verification_code,
)
from memora.identity.seed import seed_users_from_settings
from memora.settings import Settings, get_settings
from memora.workspaces.models import Workspace, WorkspaceMembership

router = APIRouter(prefix="/auth", tags=["identity"])
SettingsDependency = Annotated[Settings, Depends(get_settings)]


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: SecretStr


class DevelopmentAccountResponse(BaseModel):
    account_id: str
    display_name: str
    email: str


class DevelopmentLoginRequest(BaseModel):
    account_id: str = Field(min_length=1, max_length=32)


class RegisterRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=320)
    password: SecretStr = Field(min_length=10, max_length=128)


class RequestEmailCodeRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    purpose: VerificationCodePurpose


class RequestEmailCodeResponse(BaseModel):
    challenge_id: str
    expires_in_seconds: int


class EmailCodeRegisterRequest(RegisterRequest):
    challenge_id: UUID
    code: SecretStr = Field(min_length=6, max_length=6)


class EmailCodeLoginRequest(BaseModel):
    challenge_id: UUID
    email: str = Field(min_length=3, max_length=320)
    code: SecretStr = Field(min_length=6, max_length=6)


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


def _validated_email(value: str) -> str:
    email = normalize_email(value)
    if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="请输入有效邮箱",
        )
    return email


def _validated_display_name(value: str) -> str:
    display_name = " ".join(value.split())
    if not display_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="昵称不能为空",
        )
    return display_name


def _require_development_quick_login(settings: Settings) -> None:
    if (
        settings.app_env != "development"
        or not settings.seed_development_data_enabled
        or not settings.development_quick_login_enabled
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到")


def _configured_development_accounts(settings: Settings) -> list[tuple[str, str, str]]:
    accounts: list[tuple[str, str, str]] = []
    seen_emails: set[str] = set()
    for index, seed_user in enumerate(seed_users_from_settings(settings), start=1):
        email = normalize_email(seed_user.email)
        if email in seen_emails:
            continue
        seen_emails.add(email)
        accounts.append((f"seed-{index}", email, seed_user.display_name.strip()))
    return accounts


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


def _create_personal_account(
    *,
    database: DatabaseSession,
    email: str,
    display_name: str,
    password: str,
) -> tuple[User, Workspace, WorkspaceMembership]:
    user = User(
        email=email,
        display_name=display_name,
        password_hash=hash_password(password),
    )
    database.add(user)
    database.flush()

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
    return user, workspace, membership


def _require_verification_challenge(
    *,
    database: DatabaseSession,
    settings: Settings,
    challenge_id: UUID,
    email: str,
    purpose: VerificationCodePurpose,
    code: str,
) -> EmailVerificationChallenge:
    challenge = database.scalar(
        select(EmailVerificationChallenge)
        .where(
            EmailVerificationChallenge.id == challenge_id,
            EmailVerificationChallenge.email == email,
            EmailVerificationChallenge.purpose == purpose,
            EmailVerificationChallenge.expires_at > datetime.now(UTC),
            EmailVerificationChallenge.attempts_remaining > 0,
            EmailVerificationChallenge.consumed_at.is_(None),
        )
        .with_for_update()
    )
    if challenge is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="验证码无效或已过期")

    valid = verify_verification_code(
        challenge_id=challenge.id,
        email=email,
        purpose=purpose,
        code=code,
        expected_digest=challenge.code_digest,
        secret=settings.session_secret,
    )
    if not valid:
        challenge.attempts_remaining = max(0, challenge.attempts_remaining - 1)
        database.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="验证码无效或已过期")

    challenge.consumed_at = datetime.now(UTC)
    return challenge


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


@router.get(
    "/development/accounts",
    response_model=list[DevelopmentAccountResponse],
    responses={404: {"description": "开发快捷登录未启用"}},
)
def development_accounts(
    response: Response,
    database: DatabaseSession,
    settings: SettingsDependency,
) -> list[DevelopmentAccountResponse]:
    _require_development_quick_login(settings)
    response.headers["Cache-Control"] = "no-store"
    configured_accounts = _configured_development_accounts(settings)
    configured_emails = [email for _account_id, email, _display_name in configured_accounts]
    available_emails = set(
        database.scalars(
            select(User.email)
            .join(WorkspaceMembership, WorkspaceMembership.user_id == User.id)
            .where(
                User.email.in_(configured_emails),
                User.status == "ACTIVE",
            )
            .distinct()
        ).all()
    )
    return [
        DevelopmentAccountResponse(
            account_id=account_id,
            display_name=display_name,
            email=email,
        )
        for account_id, email, display_name in configured_accounts
        if email in available_emails
    ]


@router.post(
    "/development/login",
    response_model=CurrentUserResponse,
    responses={
        404: {"description": "开发快捷登录未启用或账号不可用"},
        429: {"description": "尝试过多"},
    },
)
def development_login(
    payload: DevelopmentLoginRequest,
    request: Request,
    response: Response,
    database: DatabaseSession,
    settings: SettingsDependency,
) -> CurrentUserResponse:
    _require_development_quick_login(settings)
    account = next(
        (
            (email, display_name)
            for account_id, email, display_name in _configured_development_accounts(settings)
            if account_id == payload.account_id
        ),
        None,
    )
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到")
    email, _display_name = account

    rate_limit_key = _rate_limit_key(request, f"development:{email}")
    limiter: LoginRateLimiter = request.app.state.login_rate_limiter
    if not limiter.consume(rate_limit_key):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="请稍后再试")

    user = database.scalar(select(User).where(User.email == email, User.status == "ACTIVE"))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到")
    membership_row = database.execute(
        select(WorkspaceMembership, Workspace)
        .join(Workspace, Workspace.id == WorkspaceMembership.workspace_id)
        .where(WorkspaceMembership.user_id == user.id)
        .order_by(Workspace.created_at, Workspace.slug)
        .limit(1)
    ).one_or_none()
    if membership_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到")
    membership, workspace = membership_row

    _start_session(
        database=database,
        response=response,
        settings=settings,
        user=user,
        workspace=workspace,
    )
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
    email = _validated_email(payload.email)
    display_name = _validated_display_name(payload.display_name)

    rate_limit_key = _rate_limit_key(request, f"register:{email}")
    limiter: LoginRateLimiter = request.app.state.login_rate_limiter
    if not limiter.consume(rate_limit_key):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="请稍后再试")
    if database.scalar(select(User.id).where(User.email == email)) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该邮箱已注册")

    try:
        user, workspace, membership = _create_personal_account(
            database=database,
            email=email,
            display_name=display_name,
            password=payload.password.get_secret_value(),
        )
    except IntegrityError as error:
        database.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该邮箱已注册") from error
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
    "/email-codes",
    response_model=RequestEmailCodeResponse,
    status_code=status.HTTP_202_ACCEPTED,
    responses={429: {"description": "发送过于频繁"}, 503: {"description": "邮件服务不可用"}},
)
def request_email_code(
    payload: RequestEmailCodeRequest,
    request: Request,
    response: Response,
    database: DatabaseSession,
    settings: SettingsDependency,
) -> RequestEmailCodeResponse:
    email = _validated_email(payload.email)
    sender: VerificationCodeSender = request.app.state.email_verification_sender
    if not sender.available:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="邮箱验证码服务尚未配置",
        )

    limiter: LoginRateLimiter = request.app.state.email_verification_rate_limiter
    rate_limit_key = _rate_limit_key(request, f"email-code:{payload.purpose}:{email}")
    if not limiter.consume(rate_limit_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="验证码发送过于频繁"
        )

    challenge_id = uuid4()
    user = database.scalar(select(User).where(User.email == email))
    eligible = (payload.purpose == "REGISTER" and user is None) or (
        payload.purpose == "LOGIN" and user is not None and user.status == "ACTIVE"
    )
    if eligible:
        now = datetime.now(UTC)
        database.execute(
            update(EmailVerificationChallenge)
            .where(
                EmailVerificationChallenge.email == email,
                EmailVerificationChallenge.purpose == payload.purpose,
                EmailVerificationChallenge.consumed_at.is_(None),
            )
            .values(consumed_at=now)
        )
        code = f"{secrets.randbelow(1_000_000):06d}"
        challenge = EmailVerificationChallenge(
            id=challenge_id,
            email=email,
            purpose=payload.purpose,
            code_digest=digest_verification_code(
                challenge_id=challenge_id,
                email=email,
                purpose=payload.purpose,
                code=code,
                secret=settings.session_secret,
            ),
            attempts_remaining=settings.email_verification_max_attempts,
            expires_at=now + timedelta(seconds=settings.email_verification_code_ttl_seconds),
        )
        database.add(challenge)
        database.flush()
        try:
            sender.send(email=email, code=code, purpose=payload.purpose)
        except VerificationCodeDeliveryError as error:
            database.rollback()
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="验证码邮件发送失败，请稍后重试",
            ) from error
        database.commit()

    response.headers["Cache-Control"] = "no-store"
    return RequestEmailCodeResponse(
        challenge_id=str(challenge_id),
        expires_in_seconds=settings.email_verification_code_ttl_seconds,
    )


@router.post(
    "/email-code/register",
    response_model=CurrentUserResponse,
    status_code=status.HTTP_201_CREATED,
    responses={401: {"description": "验证码无效或已过期"}, 409: {"description": "账号已存在"}},
)
def register_with_email_code(
    payload: EmailCodeRegisterRequest,
    request: Request,
    response: Response,
    database: DatabaseSession,
    settings: SettingsDependency,
) -> CurrentUserResponse:
    email = _validated_email(payload.email)
    display_name = _validated_display_name(payload.display_name)
    limiter: LoginRateLimiter = request.app.state.login_rate_limiter
    rate_limit_key = _rate_limit_key(request, f"verify:REGISTER:{email}")
    if not limiter.consume(rate_limit_key):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="请稍后再试")

    _require_verification_challenge(
        database=database,
        settings=settings,
        challenge_id=payload.challenge_id,
        email=email,
        purpose="REGISTER",
        code=payload.code.get_secret_value(),
    )
    if database.scalar(select(User.id).where(User.email == email)) is not None:
        database.commit()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该邮箱已注册")

    try:
        user, workspace, membership = _create_personal_account(
            database=database,
            email=email,
            display_name=display_name,
            password=payload.password.get_secret_value(),
        )
        _start_session(
            database=database,
            response=response,
            settings=settings,
            user=user,
            workspace=workspace,
        )
    except IntegrityError as error:
        database.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该邮箱已注册") from error

    limiter.reset(rate_limit_key)
    return _response_for(user=user, workspace=workspace, membership=membership)


@router.post(
    "/email-code/login",
    response_model=CurrentUserResponse,
    responses={401: {"description": "验证码无效或已过期"}, 429: {"description": "尝试过多"}},
)
def login_with_email_code(
    payload: EmailCodeLoginRequest,
    request: Request,
    response: Response,
    database: DatabaseSession,
    settings: SettingsDependency,
) -> CurrentUserResponse:
    email = _validated_email(payload.email)
    limiter: LoginRateLimiter = request.app.state.login_rate_limiter
    rate_limit_key = _rate_limit_key(request, f"verify:LOGIN:{email}")
    if not limiter.consume(rate_limit_key):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="请稍后再试")

    _require_verification_challenge(
        database=database,
        settings=settings,
        challenge_id=payload.challenge_id,
        email=email,
        purpose="LOGIN",
        code=payload.code.get_secret_value(),
    )
    user = database.scalar(select(User).where(User.email == email, User.status == "ACTIVE"))
    if user is None:
        database.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="验证码无效或已过期")

    membership_row = database.execute(
        select(WorkspaceMembership, Workspace)
        .join(Workspace, Workspace.id == WorkspaceMembership.workspace_id)
        .where(WorkspaceMembership.user_id == user.id)
        .order_by(Workspace.created_at, Workspace.slug)
        .limit(1)
    ).one_or_none()
    if membership_row is None:
        database.commit()
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
