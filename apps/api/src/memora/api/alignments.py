from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from memora.alignment.models import AlignmentTopic
from memora.alignment.schemas import (
    AlignmentPositionResponse,
    AlignmentTopicResponse,
    CreateAlignmentRequest,
    DecisionRecordResponse,
    PublishDecisionRequest,
    UpdateAlignmentPositionRequest,
)
from memora.alignment.service import (
    AlignmentAccessError,
    accessible_alignment_topics_statement,
    alignment_topic_response,
    create_alignment_topic,
    get_accessible_alignment_topic,
    publish_decision,
    update_own_position,
)
from memora.billing.service import InsufficientCreditsError
from memora.database import DatabaseSession
from memora.identity.dependencies import CurrentPrincipal
from memora.settings import Settings, get_settings

router = APIRouter(prefix="/alignments", tags=["alignments"])


def _topic_or_404(
    database: DatabaseSession,
    principal: CurrentPrincipal,
    topic_id: UUID,
) -> AlignmentTopic:
    topic = get_accessible_alignment_topic(database, principal, topic_id)
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="对齐议题不存在")
    return topic


@router.get("", response_model=list[AlignmentTopicResponse])
def list_alignments(
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> list[AlignmentTopicResponse]:
    topics = database.scalars(
        accessible_alignment_topics_statement(principal).order_by(
            AlignmentTopic.updated_at.desc(),
            AlignmentTopic.id.desc(),
        )
    ).all()
    return [alignment_topic_response(database, principal, topic) for topic in topics]


@router.post("", response_model=AlignmentTopicResponse, status_code=status.HTTP_201_CREATED)
def create_alignment(
    payload: CreateAlignmentRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> AlignmentTopicResponse:
    if not settings.team_intelligence_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="团队智能尚未启用")
    try:
        topic = create_alignment_topic(database, principal, payload, settings)
    except InsufficientCreditsError as error:
        database.rollback()
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="credits 余额不足，请升级套餐后继续",
        ) from error
    except AlignmentAccessError as error:
        database.rollback()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error
    except ValueError as error:
        database.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    database.commit()
    database.refresh(topic)
    return alignment_topic_response(database, principal, topic)


@router.get("/{topic_id}", response_model=AlignmentTopicResponse)
def get_alignment(
    topic_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> AlignmentTopicResponse:
    return alignment_topic_response(
        database, principal, _topic_or_404(database, principal, topic_id)
    )


@router.post(
    "/{topic_id}/positions/{position_id}/confirm",
    response_model=AlignmentPositionResponse,
)
def update_alignment_position(
    topic_id: UUID,
    position_id: UUID,
    payload: UpdateAlignmentPositionRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> AlignmentPositionResponse:
    topic = _topic_or_404(database, principal, topic_id)
    try:
        position = update_own_position(database, principal, topic, position_id, payload)
    except AlignmentAccessError as error:
        database.rollback()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error
    except ValueError as error:
        database.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    database.commit()
    database.refresh(position)
    refreshed = alignment_topic_response(database, principal, topic)
    response = next((item for item in refreshed.positions if item.id == position.id), None)
    if response is None:
        raise RuntimeError("updated alignment position disappeared")
    return response


@router.post(
    "/{topic_id}/decisions",
    response_model=DecisionRecordResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_decision(
    topic_id: UUID,
    payload: PublishDecisionRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> DecisionRecordResponse:
    topic = _topic_or_404(database, principal, topic_id)
    try:
        decision = publish_decision(database, principal, topic, payload)
    except AlignmentAccessError as error:
        database.rollback()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error
    except ValueError as error:
        database.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    database.commit()
    database.refresh(decision)
    refreshed = database.scalar(select(AlignmentTopic).where(AlignmentTopic.id == topic.id))
    if refreshed is None:
        raise RuntimeError("alignment topic disappeared")
    response = alignment_topic_response(database, principal, refreshed)
    result = next((item for item in response.decisions if item.id == decision.id), None)
    if result is None:
        raise RuntimeError("created decision disappeared")
    return result
