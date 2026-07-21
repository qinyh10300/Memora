from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

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


class SearchResultResponse(BaseModel):
    memory: MemoryResponse
    score: float
    match_reasons: list[MatchReason]


class SearchResponse(BaseModel):
    query: str
    semantic_status: SemanticStatus
    results: list[SearchResultResponse]


class SearchRequest(BaseModel):
    q: str = Field(min_length=1, max_length=500)
    author_id: UUID | None = None
    visibility: SearchVisibility | None = None
    created_from: datetime | None = None
    created_to: datetime | None = None
    limit: int = Field(default=20, ge=1, le=50)


@router.post("", response_model=SearchResponse)
def search_memories(
    payload: SearchRequest,
    request: Request,
    principal: CurrentPrincipal,
    database: DatabaseSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> SearchResponse:
    normalized_query = payload.q.strip()
    if not normalized_query:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="搜索内容不能为空",
        )
    keyword_results = keyword_search(
        database,
        principal,
        normalized_query,
        author_id=payload.author_id,
        visibility=payload.visibility,
        created_from=payload.created_from,
        created_to=payload.created_to,
        limit=payload.limit,
    )
    # 身份与关键词读取已经完成；外部模型调用不持有数据库事务。
    database.commit()

    embedding_model = build_embedding_model(settings)
    semantic_status: SemanticStatus = "DISABLED"
    semantic_results = []
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
