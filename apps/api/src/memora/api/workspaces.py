from typing import Literal, cast
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from memora.audit.models import AuditEvent
from memora.database import DatabaseSession
from memora.identity.dependencies import CurrentPrincipal
from memora.identity.models import User, UserSession
from memora.workspaces.models import Workspace, WorkspaceMembership

router = APIRouter(tags=["workspaces"])
WorkspaceKind = Literal["PERSONAL", "TEAM"]
WorkspaceRole = Literal["OWNER", "MEMBER"]


class WorkspaceResponse(BaseModel):
    id: UUID
    name: str
    kind: WorkspaceKind
    role: WorkspaceRole
    is_current: bool


class CreateWorkspaceRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)

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
    role: str


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
    )


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
        kind="TEAM",
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
    if principal.session_id is None:
        raise RuntimeError("authenticated request is missing a session id")
    workspace, membership = row
    user_session = database.get(UserSession, principal.session_id)
    if user_session is None or user_session.user_id != principal.user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="会话已失效")
    user_session.workspace_id = workspace.id
    database.commit()
    return _workspace_response(
        workspace,
        membership,
        current_workspace_id=workspace.id,
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
        WorkspaceMemberResponse(
            id=str(user.id),
            display_name=user.display_name,
            role=membership.role,
        )
        for user, membership in rows
    ]
