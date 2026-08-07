from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from memora.audit.models import AuditEvent
from memora.database import DatabaseSession
from memora.diagrams.models import Diagram
from memora.diagrams.schemas import DiagramResponse, DiagramWriteRequest
from memora.diagrams.service import (
    DiagramReferenceError,
    accessible_diagrams_statement,
    diagram_response_for,
    get_accessible_diagram,
    get_owned_diagram,
    validate_and_serialize_graph,
)
from memora.identity.dependencies import CurrentPrincipal

router = APIRouter(prefix="/diagrams", tags=["diagrams"])


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="框图不存在")


def _audit(
    database: DatabaseSession,
    principal: CurrentPrincipal,
    action: str,
    diagram_id: UUID,
) -> None:
    database.add(
        AuditEvent(
            workspace_id=principal.workspace_id,
            actor_id=principal.user_id,
            action=action,
            resource_type="DIAGRAM",
            resource_id=diagram_id,
        )
    )


@router.get("", response_model=list[DiagramResponse])
def list_diagrams(
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> list[DiagramResponse]:
    diagrams = database.scalars(
        accessible_diagrams_statement(principal).order_by(Diagram.updated_at.desc(), Diagram.id)
    ).all()
    return [diagram_response_for(database, principal, diagram) for diagram in diagrams]


@router.post("", response_model=DiagramResponse, status_code=status.HTTP_201_CREATED)
def create_diagram(
    payload: DiagramWriteRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> DiagramResponse:
    try:
        nodes, edges = validate_and_serialize_graph(
            database,
            principal,
            payload.nodes,
            payload.edges,
            payload.visibility,
        )
    except DiagramReferenceError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    diagram = Diagram(
        workspace_id=principal.workspace_id,
        owner_id=principal.user_id,
        title=payload.title,
        kind=payload.kind,
        visibility=payload.visibility,
        nodes=nodes,
        edges=edges,
    )
    database.add(diagram)
    database.flush()
    _audit(database, principal, "DIAGRAM_CREATED", diagram.id)
    database.commit()
    database.refresh(diagram)
    return diagram_response_for(database, principal, diagram)


@router.get("/{diagram_id}", response_model=DiagramResponse)
def get_diagram(
    diagram_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> DiagramResponse:
    diagram = get_accessible_diagram(database, principal, diagram_id)
    if diagram is None:
        raise _not_found()
    return diagram_response_for(database, principal, diagram)


@router.put("/{diagram_id}", response_model=DiagramResponse)
def update_diagram(
    diagram_id: UUID,
    payload: DiagramWriteRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> DiagramResponse:
    diagram = get_owned_diagram(database, principal, diagram_id)
    if diagram is None:
        raise _not_found()
    try:
        nodes, edges = validate_and_serialize_graph(
            database,
            principal,
            payload.nodes,
            payload.edges,
            payload.visibility,
        )
    except DiagramReferenceError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    diagram.title = payload.title
    diagram.kind = payload.kind
    diagram.visibility = payload.visibility
    diagram.nodes = nodes
    diagram.edges = edges
    diagram.updated_at = datetime.now(UTC)
    _audit(database, principal, "DIAGRAM_UPDATED", diagram.id)
    database.commit()
    database.refresh(diagram)
    return diagram_response_for(database, principal, diagram)


@router.delete("/{diagram_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_diagram(
    diagram_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> None:
    diagram = get_owned_diagram(database, principal, diagram_id)
    if diagram is None:
        raise _not_found()
    _audit(database, principal, "DIAGRAM_DELETED", diagram.id)
    database.delete(diagram)
    database.commit()
