from datetime import UTC, datetime
from typing import Literal, cast
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select

from memora.conversations.models import Conversation, Message, MessageCitation
from memora.conversations.service import (
    DEFAULT_CONVERSATION_TITLE,
    REDACTED_ANSWER,
    create_conversation,
    get_owned_conversation,
)
from memora.database import DatabaseSession
from memora.identity.dependencies import CurrentPrincipal
from memora.memories.models import Memory
from memora.memories.schemas import MemoryResponse, memory_response_for
from memora.memories.service import authorized_memories_statement
from memora.retrieval.schemas import EvidenceCitationResponse, evidence_citation_for

router = APIRouter(prefix="/conversations", tags=["conversations"])
ConversationScope = Literal["PERSONAL", "COLLEAGUE", "WORKSPACE"]
MessageRole = Literal["USER", "ASSISTANT"]
MessageStatus = Literal["COMPLETE", "REDACTED"]


class CreateConversationRequest(BaseModel):
    title: str = Field(default=DEFAULT_CONVERSATION_TITLE, min_length=1, max_length=120)


class UpdateConversationRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    archived: bool | None = None

    @model_validator(mode="after")
    def require_change(self) -> "UpdateConversationRequest":
        if self.title is None and self.archived is None:
            raise ValueError("至少需要更新一个字段")
        if self.title is not None:
            self.title = " ".join(self.title.split())
            if not self.title:
                raise ValueError("标题不能为空")
        return self


class ConversationSummaryResponse(BaseModel):
    id: UUID
    title: str
    scope: ConversationScope
    topic: str
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None
    message_count: int


class ConversationMessageResponse(BaseModel):
    id: UUID
    role: MessageRole
    status: MessageStatus
    content: str
    created_at: datetime
    citations: list[EvidenceCitationResponse]
    memory: MemoryResponse | None


class ConversationDetailResponse(ConversationSummaryResponse):
    messages: list[ConversationMessageResponse]


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="对话不存在")


def _summary_for(
    conversation: Conversation,
    *,
    message_count: int,
) -> ConversationSummaryResponse:
    return ConversationSummaryResponse(
        id=conversation.id,
        title=conversation.title,
        scope=cast(ConversationScope, conversation.scope),
        topic=conversation.topic,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        archived_at=conversation.archived_at,
        message_count=message_count,
    )


@router.get("", response_model=list[ConversationSummaryResponse])
def list_conversations(
    principal: CurrentPrincipal,
    database: DatabaseSession,
    archived: bool = False,
    limit: int = Query(default=100, ge=1, le=200),
) -> list[ConversationSummaryResponse]:
    statement = (
        select(Conversation, func.count(Message.id))
        .outerjoin(Message, Message.conversation_id == Conversation.id)
        .where(
            Conversation.workspace_id == principal.workspace_id,
            Conversation.user_id == principal.user_id,
            (
                Conversation.archived_at.is_not(None)
                if archived
                else Conversation.archived_at.is_(None)
            ),
        )
        .group_by(Conversation.id)
        .order_by(Conversation.updated_at.desc(), Conversation.id)
        .limit(limit)
    )
    return [
        _summary_for(conversation, message_count=message_count)
        for conversation, message_count in database.execute(statement).all()
    ]


@router.post(
    "",
    response_model=ConversationSummaryResponse,
    status_code=status.HTTP_201_CREATED,
)
def start_conversation(
    payload: CreateConversationRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> ConversationSummaryResponse:
    title = " ".join(payload.title.split())
    conversation = create_conversation(
        database,
        principal,
        title=title or DEFAULT_CONVERSATION_TITLE,
    )
    database.commit()
    database.refresh(conversation)
    return _summary_for(conversation, message_count=0)


@router.get("/{conversation_id}", response_model=ConversationDetailResponse)
def get_conversation(
    conversation_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> ConversationDetailResponse:
    conversation = get_owned_conversation(
        database,
        principal,
        conversation_id,
        include_archived=True,
    )
    if conversation is None:
        raise _not_found()

    messages = list(
        database.scalars(
            select(Message)
            .where(Message.conversation_id == conversation.id)
            .order_by(Message.position)
        ).all()
    )
    message_ids = [message.id for message in messages]
    citations = (
        list(
            database.scalars(
                select(MessageCitation).where(MessageCitation.message_id.in_(message_ids))
            ).all()
        )
        if message_ids
        else []
    )
    memory_ids = {
        memory_id
        for memory_id in [
            *(citation.memory_id for citation in citations),
            *(message.memory_id for message in messages),
        ]
        if memory_id is not None
    }
    authorized_rows = (
        database.execute(authorized_memories_statement(principal).where(Memory.id.in_(memory_ids)))
        .tuples()
        .all()
        if memory_ids
        else []
    )
    authorized = {
        memory.id: (memory, author, projection) for memory, author, projection in authorized_rows
    }
    citations_by_message: dict[UUID, list[EvidenceCitationResponse]] = {}
    missing_citation_message_ids: set[UUID] = set()
    for citation in citations:
        row = authorized.get(citation.memory_id)
        if row is None:
            missing_citation_message_ids.add(citation.message_id)
            continue
        memory, author, _projection = row
        citations_by_message.setdefault(citation.message_id, []).append(
            evidence_citation_for(memory, author, excerpt=citation.excerpt)
        )

    response_messages: list[ConversationMessageResponse] = []
    for message in messages:
        linked_row = authorized.get(message.memory_id) if message.memory_id is not None else None
        linked_memory = (
            memory_response_for(*linked_row, principal) if linked_row is not None else None
        )
        content = message.content
        response_status = cast(MessageStatus, message.status)
        if message.id in missing_citation_message_ids:
            content = REDACTED_ANSWER
            response_status = "REDACTED"
        elif message.memory_id is not None and linked_memory is None:
            if message.status != "REDACTED":
                content = "这条记录已删除或不再可访问。"
            response_status = "REDACTED"
        response_messages.append(
            ConversationMessageResponse(
                id=message.id,
                role=cast(MessageRole, message.role),
                status=response_status,
                content=content,
                created_at=message.created_at,
                citations=citations_by_message.get(message.id, []),
                memory=linked_memory,
            )
        )

    summary = _summary_for(conversation, message_count=len(messages))
    return ConversationDetailResponse(
        **summary.model_dump(),
        messages=response_messages,
    )


@router.patch("/{conversation_id}", response_model=ConversationSummaryResponse)
def update_conversation(
    conversation_id: UUID,
    payload: UpdateConversationRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> ConversationSummaryResponse:
    conversation = get_owned_conversation(
        database,
        principal,
        conversation_id,
        include_archived=True,
    )
    if conversation is None:
        raise _not_found()
    if payload.title is not None:
        conversation.title = payload.title
    if payload.archived is not None:
        conversation.archived_at = datetime.now(UTC) if payload.archived else None
    conversation.updated_at = datetime.now(UTC)
    database.commit()
    database.refresh(conversation)
    message_count = database.scalar(
        select(func.count(Message.id)).where(Message.conversation_id == conversation.id)
    )
    return _summary_for(conversation, message_count=message_count or 0)
