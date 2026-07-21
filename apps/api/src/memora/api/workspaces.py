from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select

from memora.database import DatabaseSession
from memora.identity.dependencies import CurrentPrincipal
from memora.identity.models import User
from memora.workspaces.models import WorkspaceMembership

router = APIRouter(prefix="/workspace", tags=["workspaces"])


class WorkspaceMemberResponse(BaseModel):
    id: str
    display_name: str
    role: str


@router.get("/members", response_model=list[WorkspaceMemberResponse])
def list_members(
    principal: CurrentPrincipal, database: DatabaseSession
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
            id=str(user.id), display_name=user.display_name, role=membership.role
        )
        for user, membership in rows
    ]
