from typing import Any, cast
from uuid import UUID

from sqlalchemy import Select, or_, select
from sqlalchemy.orm import Session

from memora.diagrams.models import Diagram
from memora.diagrams.schemas import (
    DiagramEdgeInput,
    DiagramNodeInput,
    DiagramNodeResponse,
    DiagramOwnerResponse,
    DiagramResponse,
    DiagramVisibility,
)
from memora.identity.dependencies import Principal
from memora.identity.models import User
from memora.memories.models import Memory
from memora.memories.service import authorized_memories_statement
from memora.workspaces.models import WorkspaceMembership


class DiagramReferenceError(ValueError):
    pass


def accessible_diagrams_statement(principal: Principal) -> Select[tuple[Diagram]]:
    return select(Diagram).where(
        Diagram.workspace_id == principal.workspace_id,
        or_(Diagram.owner_id == principal.user_id, Diagram.visibility == "WORKSPACE"),
    )


def get_accessible_diagram(
    database: Session,
    principal: Principal,
    diagram_id: UUID,
) -> Diagram | None:
    return cast(
        Diagram | None,
        database.scalar(accessible_diagrams_statement(principal).where(Diagram.id == diagram_id)),
    )


def get_owned_diagram(
    database: Session,
    principal: Principal,
    diagram_id: UUID,
) -> Diagram | None:
    return database.scalar(
        select(Diagram).where(
            Diagram.id == diagram_id,
            Diagram.workspace_id == principal.workspace_id,
            Diagram.owner_id == principal.user_id,
        )
    )


def validate_and_serialize_graph(
    database: Session,
    principal: Principal,
    nodes: list[DiagramNodeInput],
    edges: list[DiagramEdgeInput],
    visibility: DiagramVisibility,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    memory_ids = {node.memory_id for node in nodes if node.memory_id is not None}
    authorized_rows = (
        database.execute(authorized_memories_statement(principal).where(Memory.id.in_(memory_ids)))
        .tuples()
        .all()
        if memory_ids
        else []
    )
    authorized_memories = {memory.id: memory for memory, _author, _projection in authorized_rows}
    if set(authorized_memories) != memory_ids:
        raise DiagramReferenceError("框图引用了当前账号无权访问的记忆")
    if visibility == "WORKSPACE" and any(
        memory.visibility != "WORKSPACE" for memory in authorized_memories.values()
    ):
        raise DiagramReferenceError("共享框图只能引用已共享到当前空间的记忆")

    user_ids = {node.user_id for node in nodes if node.user_id is not None}
    member_ids = (
        set(
            database.scalars(
                select(WorkspaceMembership.user_id).where(
                    WorkspaceMembership.workspace_id == principal.workspace_id,
                    WorkspaceMembership.user_id.in_(user_ids),
                )
            ).all()
        )
        if user_ids
        else set()
    )
    if member_ids != user_ids:
        raise DiagramReferenceError("框图引用了不属于当前空间的成员")

    serialized_nodes = [node.model_dump(mode="json", exclude_none=True) for node in nodes]
    serialized_edges = [edge.model_dump(mode="json", exclude_none=True) for edge in edges]
    return serialized_nodes, serialized_edges


def diagram_response_for(
    database: Session,
    principal: Principal,
    diagram: Diagram,
) -> DiagramResponse:
    raw_nodes = [DiagramNodeInput.model_validate(node) for node in diagram.nodes]
    memory_ids = {node.memory_id for node in raw_nodes if node.memory_id is not None}
    authorized_rows = (
        database.execute(authorized_memories_statement(principal).where(Memory.id.in_(memory_ids)))
        .tuples()
        .all()
        if memory_ids
        else []
    )
    authorized_memories = {
        memory.id: (memory, author) for memory, author, _projection in authorized_rows
    }

    user_ids = {node.user_id for node in raw_nodes if node.user_id is not None}
    members = {
        user.id: user
        for user in database.scalars(
            select(User)
            .join(WorkspaceMembership, WorkspaceMembership.user_id == User.id)
            .where(
                WorkspaceMembership.workspace_id == principal.workspace_id,
                User.id.in_(user_ids),
                User.status == "ACTIVE",
            )
        ).all()
    }
    response_nodes: list[DiagramNodeResponse] = []
    for node in raw_nodes:
        if node.kind == "MEMORY":
            row = authorized_memories.get(node.memory_id) if node.memory_id is not None else None
            if row is None:
                response_nodes.append(
                    DiagramNodeResponse(
                        id=node.id,
                        kind=node.kind,
                        position=node.position,
                        label="来源已不可用",
                        available=False,
                    )
                )
                continue
            memory, author = row
            label = memory.title or (memory.body or "记忆")[:80]
            response_nodes.append(
                DiagramNodeResponse(
                    id=node.id,
                    kind=node.kind,
                    position=node.position,
                    label=label,
                    memory_id=memory.id,
                    author_name=author.display_name,
                )
            )
            continue
        if node.kind == "PERSON":
            member = members.get(node.user_id) if node.user_id is not None else None
            response_nodes.append(
                DiagramNodeResponse(
                    id=node.id,
                    kind=node.kind,
                    position=node.position,
                    label=member.display_name if member is not None else "成员已离开",
                    user_id=member.id if member is not None else None,
                    available=member is not None,
                )
            )
            continue
        response_nodes.append(
            DiagramNodeResponse(
                id=node.id,
                kind=node.kind,
                position=node.position,
                label=node.text or "注释",
            )
        )

    owner = database.get(User, diagram.owner_id)
    if owner is None:
        raise RuntimeError("diagram owner disappeared")
    return DiagramResponse(
        id=diagram.id,
        title=diagram.title,
        kind=cast(Any, diagram.kind),
        visibility=cast(Any, diagram.visibility),
        owner=DiagramOwnerResponse(id=owner.id, display_name=owner.display_name),
        is_owner=diagram.owner_id == principal.user_id,
        nodes=response_nodes,
        edges=[DiagramEdgeInput.model_validate(edge) for edge in diagram.edges],
        created_at=diagram.created_at,
        updated_at=diagram.updated_at,
    )
