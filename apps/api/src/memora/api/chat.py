from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from memora.ai.openai_compatible import build_chat_model
from memora.ai.ports import AIProviderError, ChatResult
from memora.audit.models import AuditEvent
from memora.conversations.service import (
    ChatEvidence,
    complete_with_model,
    deterministic_answer,
    excerpt_for,
    persist_exchange,
    reauthorize_evidence,
    select_chat_evidence,
)
from memora.database import DatabaseSession
from memora.identity.dependencies import CurrentPrincipal
from memora.identity.models import User
from memora.identity.rate_limit import LoginRateLimiter
from memora.retrieval.schemas import EvidenceCitationResponse, evidence_citation_for
from memora.settings import Settings, get_settings
from memora.workspaces.models import WorkspaceMembership

router = APIRouter(prefix="/chat", tags=["chat"])
ChatScope = Literal["PERSONAL", "COLLEAGUE", "WORKSPACE"]
AnswerStatus = Literal["ANSWERED", "NO_EVIDENCE", "NEEDS_CLARIFICATION"]
ModelStatus = Literal["AVAILABLE", "DISABLED", "DEGRADED"]


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2_000)
    topic: str | None = Field(default=None, max_length=500)
    scope: ChatScope
    author_id: UUID | None = None
    created_from: datetime | None = None
    created_to: datetime | None = None
    evidence_limit: int = Field(default=8, ge=1, le=12)

    @field_validator("question")
    @classmethod
    def normalize_question(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("问题不能为空")
        return normalized

    @field_validator("topic")
    @classmethod
    def normalize_topic(cls, value: str | None) -> str | None:
        normalized = value.strip() if value is not None else None
        return normalized or None


class ChatResponse(BaseModel):
    conversation_id: UUID | None
    message_id: UUID | None
    status: AnswerStatus
    model_status: ModelStatus
    scope: ChatScope
    topic: str | None
    answer: str
    citations: list[EvidenceCitationResponse]


def _citation_for(evidence: ChatEvidence) -> EvidenceCitationResponse:
    return evidence_citation_for(
        evidence.memory,
        evidence.author,
        excerpt=excerpt_for(evidence.memory.body or ""),
    )


def _validate_time_range(payload: ChatRequest) -> None:
    for value in (payload.created_from, payload.created_to):
        if value is not None and value.tzinfo is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="时间范围必须包含时区",
            )
    if (
        payload.created_from is not None
        and payload.created_to is not None
        and payload.created_from >= payload.created_to
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="开始时间必须早于结束时间",
        )


def _validate_scope(
    payload: ChatRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> UUID | None:
    if payload.scope != "COLLEAGUE":
        if payload.author_id is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="只有同事范围可以指定成员",
            )
        return None
    if payload.author_id is None or payload.author_id == principal.user_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="请选择另一位工作区成员",
        )
    member = database.scalar(
        select(User)
        .join(WorkspaceMembership, WorkspaceMembership.user_id == User.id)
        .where(
            User.id == payload.author_id,
            WorkspaceMembership.workspace_id == principal.workspace_id,
            User.status == "ACTIVE",
        )
    )
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="成员不存在")
    return member.id


@router.post("/questions", response_model=ChatResponse)
def ask_chatbot(
    payload: ChatRequest,
    request: Request,
    principal: CurrentPrincipal,
    database: DatabaseSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> ChatResponse:
    limiter: LoginRateLimiter = request.app.state.ai_rate_limiter
    if not limiter.consume(str(principal.user_id)):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="请稍后再试")
    _validate_time_range(payload)
    subject_author_id = _validate_scope(payload, principal, database)

    needs_time_range = any(
        phrase in payload.question for phrase in ("这段时间", "最近一段时间", "这一段时间")
    )
    if payload.topic is None or (
        needs_time_range and (payload.created_from is None or payload.created_to is None)
    ):
        missing = "一个明确的检索主题" if payload.topic is None else "开始和结束日期"
        return ChatResponse(
            conversation_id=None,
            message_id=None,
            status="NEEDS_CLARIFICATION",
            model_status="DISABLED",
            scope=payload.scope,
            topic=payload.topic,
            answer=f"我还不能可靠判断你指的范围。请补充{missing}后再提问。",
            citations=[],
        )

    evidence = select_chat_evidence(
        database,
        principal,
        scope=payload.scope,
        subject_author_id=subject_author_id,
        topic=payload.topic,
        created_from=payload.created_from,
        created_to=payload.created_to,
        limit=payload.evidence_limit,
    )
    # 外部模型调用期间不持有数据库事务；问题和证据不会写入访问日志。
    database.commit()

    chat_model = build_chat_model(settings)
    model_status: ModelStatus = "DISABLED"
    model_result: ChatResult | None = None
    if evidence and chat_model is not None:
        try:
            model_result = complete_with_model(
                chat_model,
                question=payload.question,
                topic=payload.topic,
                scope=payload.scope,
                evidence=evidence,
            )
            model_status = "AVAILABLE"
        except AIProviderError:
            model_status = "DEGRADED"

    authorized_evidence = reauthorize_evidence(database, principal, evidence)
    if len(authorized_evidence) != len(evidence):
        # 生成期间发生撤回或删除时丢弃模型答案，只基于仍授权证据重建。
        model_result = None
        model_status = "DEGRADED" if chat_model is not None else "DISABLED"
    answer = (
        model_result.content
        if model_result is not None
        else deterministic_answer(authorized_evidence)
    )
    conversation, assistant = persist_exchange(
        database,
        principal,
        question=payload.question,
        answer=answer,
        topic=payload.topic,
        scope=payload.scope,
        subject_author_id=subject_author_id,
        evidence=authorized_evidence,
        model_result=model_result,
    )
    database.add(
        AuditEvent(
            workspace_id=principal.workspace_id,
            actor_id=principal.user_id,
            action="CHAT_ANSWERED",
            resource_type="MESSAGE",
            resource_id=assistant.id,
        )
    )
    database.commit()
    return ChatResponse(
        conversation_id=conversation.id,
        message_id=assistant.id,
        status="ANSWERED" if authorized_evidence else "NO_EVIDENCE",
        model_status=model_status,
        scope=payload.scope,
        topic=payload.topic,
        answer=answer,
        citations=[_citation_for(item) for item in authorized_evidence],
    )
