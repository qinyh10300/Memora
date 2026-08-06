from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, model_validator

from memora.ai.openai_compatible import build_embedding_model
from memora.ai.ports import AIProviderError
from memora.database import DatabaseSession
from memora.identity.dependencies import CurrentPrincipal
from memora.identity.rate_limit import LoginRateLimiter
from memora.memories.schemas import MemoryResponse, memory_response_for
from memora.retrieval.service import keyword_search, merge_hybrid_results, semantic_search
from memora.settings import Settings, get_settings

router = APIRouter(prefix="/search", tags=["retrieval"])
SearchVisibility = Literal["PRIVATE", "WORKSPACE"]
SemanticStatus = Literal["AVAILABLE", "DISABLED", "DEGRADED"]
MatchReason = Literal["KEYWORD", "SEMANTIC"]
SearchMode = Literal["HYBRID", "KEYWORD"]
SearchField = Literal["ALL", "TITLE"]


class SearchResultResponse(BaseModel):
    memory: MemoryResponse
    score: float
    match_reasons: list[MatchReason]


class SearchResponse(BaseModel):
    query: str
    semantic_status: SemanticStatus
    results: list[SearchResultResponse]


class SearchRequest(BaseModel):
    q: str = Field(default="", max_length=500)
    author_id: UUID | None = None
    visibility: SearchVisibility | None = None
    created_from: datetime | None = None
    created_to: datetime | None = None
    mode: SearchMode = "HYBRID"
    field: SearchField = "ALL"
    limit: int = Field(default=20, ge=1, le=200)

    @model_validator(mode="after")
    def validate_search_criteria(self) -> "SearchRequest":
        if (
            self.created_from is not None
            and self.created_to is not None
            and self.created_from >= self.created_to
        ):
            raise ValueError("结束时间必须晚于开始时间")
        if not self.q.strip() and all(
            value is None
            for value in (
                self.author_id,
                self.visibility,
                self.created_from,
                self.created_to,
            )
        ):
            raise ValueError("请至少填写一个检索条件")
        return self


@router.post("", response_model=SearchResponse)
def search_memories(
    payload: SearchRequest,
    request: Request,
    principal: CurrentPrincipal,
    database: DatabaseSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> SearchResponse:
    normalized_query = payload.q.strip()
    keyword_results = keyword_search(
        database,
        principal,
        normalized_query,
        author_id=payload.author_id,
        visibility=payload.visibility,
        created_from=payload.created_from,
        created_to=payload.created_to,
        search_field=payload.field,
        limit=payload.limit,
    )
    # 身份与关键词读取已经完成；外部模型调用不持有数据库事务。
    database.commit()

    semantic_status: SemanticStatus = "DISABLED"
    semantic_results = []
    should_run_semantic = payload.mode == "HYBRID" and payload.field == "ALL" and normalized_query
    embedding_model = build_embedding_model(settings) if should_run_semantic else None
    if embedding_model is not None:
        limiter: LoginRateLimiter = request.app.state.ai_rate_limiter
        if not limiter.consume(str(principal.user_id)):
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="请稍后再试")
        try:
            batch = embedding_model.embed([normalized_query])
            semantic_results = semantic_search(
                database,
                principal,
                batch.vectors[0],
                batch.model,
                author_id=payload.author_id,
                visibility=payload.visibility,
                created_from=payload.created_from,
                created_to=payload.created_to,
                limit=payload.limit,
            )
            semantic_status = "AVAILABLE"
        except (AIProviderError, IndexError):
            semantic_status = "DEGRADED"

    results = merge_hybrid_results(keyword_results, semantic_results, limit=payload.limit)
    return SearchResponse(
        query=normalized_query,
        semantic_status=semantic_status,
        results=[
            SearchResultResponse(
                memory=memory_response_for(
                    result.memory,
                    result.author,
                    result.projection,
                    principal,
                ),
                score=result.score,
                match_reasons=list(result.reasons),
            )
            for result in results
        ],
    )
