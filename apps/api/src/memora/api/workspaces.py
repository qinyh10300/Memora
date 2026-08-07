from datetime import UTC, datetime
from typing import Literal, cast
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, update

from memora.audit.models import AuditEvent
from memora.database import DatabaseSession
from memora.identity.dependencies import CurrentPrincipal
from memora.identity.models import User, UserSession
from memora.identity.rate_limit import LoginRateLimiter
from memora.identity.security import normalize_email
from memora.workspaces.models import Workspace, WorkspaceJoinRequest, WorkspaceMembership
from memora.workspaces.service import generate_unique_join_code, normalize_join_code

router = APIRouter(tags=["workspaces"])
WorkspaceKind = Literal["PERSONAL", "TEAM", "FAMILY"]
WorkspaceRole = Literal["OWNER", "MEMBER"]
JoinRequestStatus = Literal["PENDING", "APPROVED", "REJECTED"]
JoinWorkspaceStatus = Literal["PENDING", "ACTIVE"]


class WorkspaceResponse(BaseModel):
    id: UUID
    name: str
    kind: WorkspaceKind
    role: WorkspaceRole
    is_current: bool
    join_code: str | None


class CreateWorkspaceRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["TEAM", "FAMILY"] = "TEAM"

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("空间名称不能为空")
        return normalized


class WorkspaceMemberResponse(BaseModel):
    id: str
    display_name: str
    role: WorkspaceRole
    joined_at: datetime
    is_current_user: bool


class WorkspaceJoinRequestResponse(BaseModel):
    workspace_id: UUID
    workspace_name: str
    user_id: UUID
    display_name: str
    status: JoinRequestStatus
    requested_at: datetime
    reviewed_at: datetime | None


class JoinWorkspaceResponse(BaseModel):
    status: JoinWorkspaceStatus
    workspace: WorkspaceResponse | None = None
    join_request: WorkspaceJoinRequestResponse | None = None


class JoinWorkspaceRequest(BaseModel):
    code: str = Field(min_length=6, max_length=32)

    @field_validator("code")
    @classmethod
    def normalize_code(cls, value: str) -> str:
        normalized = normalize_join_code(value)
        if len(normalized) != 12:
            raise ValueError("团队号格式不正确")
        return normalized


class InviteWorkspaceMemberRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)

    @field_validator("email")
    @classmethod
    def normalize_invited_email(cls, value: str) -> str:
        return normalize_email(value)


def _workspace_response(
    workspace: Workspace,
    membership: WorkspaceMembership,
    *,
    current_workspace_id: UUID,
) -> WorkspaceResponse:
    return WorkspaceResponse(
        id=workspace.id,
        name=workspace.name,
        kind=cast(WorkspaceKind, workspace.kind),
        role=cast(WorkspaceRole, membership.role),
        is_current=workspace.id == current_workspace_id,
        join_code=workspace.join_code if workspace.kind in {"TEAM", "FAMILY"} else None,
    )


def _member_response(
    user: User,
    membership: WorkspaceMembership,
    *,
    current_user_id: UUID,
) -> WorkspaceMemberResponse:
    return WorkspaceMemberResponse(
        id=str(user.id),
        display_name=user.display_name,
        role=cast(WorkspaceRole, membership.role),
        joined_at=membership.created_at,
        is_current_user=user.id == current_user_id,
    )


def _join_request_response(
    workspace: Workspace,
    user: User,
    join_request: WorkspaceJoinRequest,
) -> WorkspaceJoinRequestResponse:
    return WorkspaceJoinRequestResponse(
        workspace_id=workspace.id,
        workspace_name=workspace.name,
        user_id=user.id,
        display_name=user.display_name,
        status=cast(JoinRequestStatus, join_request.status),
        requested_at=join_request.requested_at,
        reviewed_at=join_request.reviewed_at,
    )


def _current_owner_team(
    database: DatabaseSession,
    principal: CurrentPrincipal,
) -> Workspace:
    workspace = database.get(Workspace, principal.workspace_id)
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="团队不存在")
    if workspace.kind not in {"TEAM", "FAMILY"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="个人空间没有成员管理",
        )
    if principal.role != "OWNER":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="只有团队所有者可以管理成员",
        )
    return workspace


def _session_or_error(
    database: DatabaseSession,
    principal: CurrentPrincipal,
) -> UserSession:
    if principal.session_id is None:
        raise RuntimeError("authenticated request is missing a session id")
    user_session = database.get(UserSession, principal.session_id)
    if user_session is None or user_session.user_id != principal.user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="会话已失效")
    return user_session


def _consume_team_action_limit(
    request: Request,
    principal: CurrentPrincipal,
    action: str,
) -> str:
    client_host = request.client.host if request.client else "unknown"
    key = f"{client_host}:team:{action}:{principal.user_id}"
    limiter: LoginRateLimiter = request.app.state.login_rate_limiter
    if not limiter.consume(key):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="请稍后再试")
    return key


@router.get("/workspaces", response_model=list[WorkspaceResponse])
def list_workspaces(
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> list[WorkspaceResponse]:
    rows = database.execute(
        select(Workspace, WorkspaceMembership)
        .join(
            WorkspaceMembership,
            WorkspaceMembership.workspace_id == Workspace.id,
        )
        .where(WorkspaceMembership.user_id == principal.user_id)
        .order_by(Workspace.kind, Workspace.created_at, Workspace.name)
    ).all()
    return [
        _workspace_response(
            workspace,
            membership,
            current_workspace_id=principal.workspace_id,
        )
        for workspace, membership in rows
    ]


@router.post(
    "/workspaces",
    response_model=WorkspaceResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_workspace(
    payload: CreateWorkspaceRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> WorkspaceResponse:
    workspace = Workspace(
        id=uuid4(),
        slug=f"workspace-{uuid4().hex[:20]}",
        name=payload.name,
        kind=payload.kind,
        join_code=generate_unique_join_code(database),
    )
    membership = WorkspaceMembership(
        workspace_id=workspace.id,
        user_id=principal.user_id,
        role="OWNER",
    )
    database.add(workspace)
    database.flush()
    database.add(membership)
    database.add(
        AuditEvent(
            workspace_id=workspace.id,
            actor_id=principal.user_id,
            action="WORKSPACE_CREATED",
            resource_type="WORKSPACE",
            resource_id=workspace.id,
        )
    )
    database.commit()
    database.refresh(workspace)
    return _workspace_response(
        workspace,
        membership,
        current_workspace_id=principal.workspace_id,
    )


@router.post("/workspaces/join", response_model=JoinWorkspaceResponse)
def join_workspace(
    payload: JoinWorkspaceRequest,
    request: Request,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> JoinWorkspaceResponse:
    rate_limit_key = _consume_team_action_limit(request, principal, "join")
    workspace = database.scalar(
        select(Workspace).where(
            Workspace.join_code == payload.code,
            Workspace.kind.in_(("TEAM", "FAMILY")),
        )
    )
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="团队号无效")

    membership = database.get(
        WorkspaceMembership,
        {"workspace_id": workspace.id, "user_id": principal.user_id},
    )
    limiter: LoginRateLimiter = request.app.state.login_rate_limiter
    if membership is not None:
        _session_or_error(database, principal).workspace_id = workspace.id
        database.commit()
        limiter.reset(rate_limit_key)
        return JoinWorkspaceResponse(
            status="ACTIVE",
            workspace=_workspace_response(
                workspace,
                membership,
                current_workspace_id=workspace.id,
            ),
        )

    applicant = database.get(User, principal.user_id)
    if applicant is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号不存在")
    join_request = database.get(
        WorkspaceJoinRequest,
        {"workspace_id": workspace.id, "user_id": principal.user_id},
    )
    now = datetime.now(UTC)
    if join_request is None:
        join_request = WorkspaceJoinRequest(
            workspace_id=workspace.id,
            user_id=principal.user_id,
            status="PENDING",
        )
        database.add(join_request)
    elif join_request.status != "PENDING":
        join_request.status = "PENDING"
        join_request.requested_at = now
        join_request.reviewed_at = None
        join_request.reviewed_by_user_id = None
    database.add(
        AuditEvent(
            workspace_id=workspace.id,
            actor_id=principal.user_id,
            action="WORKSPACE_JOIN_REQUESTED",
            resource_type="WORKSPACE",
            resource_id=workspace.id,
        )
    )
    database.commit()
    database.refresh(join_request)
    limiter.reset(rate_limit_key)
    return JoinWorkspaceResponse(
        status="PENDING",
        join_request=_join_request_response(workspace, applicant, join_request),
    )


@router.post("/workspaces/{workspace_id}/activate", response_model=WorkspaceResponse)
def activate_workspace(
    workspace_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> WorkspaceResponse:
    row = database.execute(
        select(Workspace, WorkspaceMembership)
        .join(
            WorkspaceMembership,
            WorkspaceMembership.workspace_id == Workspace.id,
        )
        .where(
            Workspace.id == workspace_id,
            WorkspaceMembership.user_id == principal.user_id,
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="空间不存在")
    workspace, membership = row
    _session_or_error(database, principal).workspace_id = workspace.id
    database.commit()
    return _workspace_response(
        workspace,
        membership,
        current_workspace_id=workspace.id,
    )


@router.post(
    "/workspaces/{workspace_id}/members",
    response_model=WorkspaceMemberResponse,
    status_code=status.HTTP_201_CREATED,
)
def invite_workspace_member(
    workspace_id: UUID,
    payload: InviteWorkspaceMemberRequest,
    request: Request,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> WorkspaceMemberResponse:
    owner_row = database.execute(
        select(Workspace, WorkspaceMembership)
        .join(
            WorkspaceMembership,
            WorkspaceMembership.workspace_id == Workspace.id,
        )
        .where(
            Workspace.id == workspace_id,
            WorkspaceMembership.user_id == principal.user_id,
        )
    ).one_or_none()
    if owner_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="团队不存在")
    workspace, owner_membership = owner_row
    if workspace.kind not in {"TEAM", "FAMILY"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="个人空间不能邀请成员",
        )
    if owner_membership.role != "OWNER":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只有团队所有者可以邀请")

    rate_limit_key = _consume_team_action_limit(request, principal, f"invite:{workspace.id}")
    invited_user = database.scalar(
        select(User).where(User.email == payload.email, User.status == "ACTIVE")
    )
    if invited_user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="该邮箱尚未注册")
    existing_membership = database.get(
        WorkspaceMembership,
        {"workspace_id": workspace.id, "user_id": invited_user.id},
    )
    if existing_membership is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该用户已在团队中")

    membership = WorkspaceMembership(
        workspace_id=workspace.id,
        user_id=invited_user.id,
        role="MEMBER",
    )
    database.add(membership)
    pending_request = database.get(
        WorkspaceJoinRequest,
        {"workspace_id": workspace.id, "user_id": invited_user.id},
    )
    if pending_request is not None:
        pending_request.status = "APPROVED"
        pending_request.reviewed_at = datetime.now(UTC)
        pending_request.reviewed_by_user_id = principal.user_id
    database.add(
        AuditEvent(
            workspace_id=workspace.id,
            actor_id=principal.user_id,
            action="WORKSPACE_MEMBER_INVITED",
            resource_type="USER",
            resource_id=invited_user.id,
        )
    )
    database.commit()
    database.refresh(membership)
    limiter: LoginRateLimiter = request.app.state.login_rate_limiter
    limiter.reset(rate_limit_key)
    return _member_response(
        invited_user,
        membership,
        current_user_id=principal.user_id,
    )


@router.get("/workspace/members", response_model=list[WorkspaceMemberResponse])
def list_members(
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> list[WorkspaceMemberResponse]:
    rows = database.execute(
        select(User, WorkspaceMembership)
        .join(WorkspaceMembership, WorkspaceMembership.user_id == User.id)
        .where(
            WorkspaceMembership.workspace_id == principal.workspace_id,
            User.status == "ACTIVE",
        )
        .order_by(User.display_name)
    ).all()
    return [
        _member_response(
            user,
            membership,
            current_user_id=principal.user_id,
        )
        for user, membership in rows
    ]


@router.get(
    "/workspace/join-requests",
    response_model=list[WorkspaceJoinRequestResponse],
)
def list_join_requests(
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> list[WorkspaceJoinRequestResponse]:
    workspace = _current_owner_team(database, principal)
    rows = database.execute(
        select(User, WorkspaceJoinRequest)
        .join(WorkspaceJoinRequest, WorkspaceJoinRequest.user_id == User.id)
        .where(
            WorkspaceJoinRequest.workspace_id == workspace.id,
            WorkspaceJoinRequest.status == "PENDING",
            User.status == "ACTIVE",
        )
        .order_by(WorkspaceJoinRequest.requested_at, User.display_name)
    ).all()
    return [_join_request_response(workspace, user, join_request) for user, join_request in rows]


@router.post(
    "/workspace/join-requests/{user_id}/approve",
    response_model=WorkspaceMemberResponse,
)
def approve_join_request(
    user_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> WorkspaceMemberResponse:
    workspace = _current_owner_team(database, principal)
    join_request = database.get(
        WorkspaceJoinRequest,
        {"workspace_id": workspace.id, "user_id": user_id},
    )
    if join_request is None or join_request.status != "PENDING":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="待审核申请不存在")
    user = database.scalar(select(User).where(User.id == user_id, User.status == "ACTIVE"))
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="申请账号不存在")
    membership = database.get(
        WorkspaceMembership,
        {"workspace_id": workspace.id, "user_id": user_id},
    )
    if membership is None:
        membership = WorkspaceMembership(
            workspace_id=workspace.id,
            user_id=user_id,
            role="MEMBER",
        )
        database.add(membership)
    join_request.status = "APPROVED"
    join_request.reviewed_at = datetime.now(UTC)
    join_request.reviewed_by_user_id = principal.user_id
    database.add(
        AuditEvent(
            workspace_id=workspace.id,
            actor_id=principal.user_id,
            action="WORKSPACE_JOIN_APPROVED",
            resource_type="USER",
            resource_id=user_id,
        )
    )
    database.commit()
    database.refresh(membership)
    return _member_response(user, membership, current_user_id=principal.user_id)


@router.post(
    "/workspace/join-requests/{user_id}/reject",
    response_model=WorkspaceJoinRequestResponse,
)
def reject_join_request(
    user_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> WorkspaceJoinRequestResponse:
    workspace = _current_owner_team(database, principal)
    join_request = database.get(
        WorkspaceJoinRequest,
        {"workspace_id": workspace.id, "user_id": user_id},
    )
    if join_request is None or join_request.status != "PENDING":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="待审核申请不存在")
    user = database.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="申请账号不存在")
    join_request.status = "REJECTED"
    join_request.reviewed_at = datetime.now(UTC)
    join_request.reviewed_by_user_id = principal.user_id
    database.add(
        AuditEvent(
            workspace_id=workspace.id,
            actor_id=principal.user_id,
            action="WORKSPACE_JOIN_REJECTED",
            resource_type="USER",
            resource_id=user_id,
        )
    )
    database.commit()
    database.refresh(join_request)
    return _join_request_response(workspace, user, join_request)


@router.delete(
    "/workspace/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def remove_workspace_member(
    user_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> None:
    workspace = _current_owner_team(database, principal)
    membership = database.get(
        WorkspaceMembership,
        {"workspace_id": workspace.id, "user_id": user_id},
    )
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="团队成员不存在")
    if user_id == principal.user_id or membership.role == "OWNER":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="不能移除团队所有者",
        )
    personal_workspace_id = database.scalar(
        select(Workspace.id)
        .join(
            WorkspaceMembership,
            WorkspaceMembership.workspace_id == Workspace.id,
        )
        .where(
            Workspace.kind == "PERSONAL",
            WorkspaceMembership.user_id == user_id,
        )
        .order_by(Workspace.created_at)
    )
    if personal_workspace_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="成员缺少个人空间，暂时无法移除",
        )
    database.execute(
        update(UserSession)
        .where(
            UserSession.user_id == user_id,
            UserSession.workspace_id == workspace.id,
        )
        .values(workspace_id=personal_workspace_id)
    )
    database.delete(membership)
    database.add(
        AuditEvent(
            workspace_id=workspace.id,
            actor_id=principal.user_id,
            action="WORKSPACE_MEMBER_REMOVED",
            resource_type="USER",
            resource_id=user_id,
        )
    )
    database.commit()
