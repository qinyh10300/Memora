from datetime import datetime
from time import perf_counter
from typing import Annotated, Literal
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, model_validator

from memora.ai.openai_compatible import build_embedding_model
from memora.ai.ports import AIProviderError
from memora.database import DatabaseSession
from memora.identity.dependencies import CurrentPrincipal
from memora.identity.rate_limit import LoginRateLimiter
from memora.memories.schemas import MemoryResponse, memory_response_for
from memora.observability import metrics
from memora.retrieval.reranking import RerankerPort, RerankStatus, rerank_authorized_results
from memora.retrieval.service import (
    Retriever,
    keyword_search,
    merge_hybrid_results,
    semantic_search,
)
from memora.settings import Settings, get_settings

router = APIRouter(prefix="/search", tags=["retrieval"])
logger = structlog.get_logger("memora.api.search")
SearchVisibility = Literal["PRIVATE", "WORKSPACE"]
SemanticStatus = Literal["AVAILABLE", "DISABLED", "DEGRADED"]
MatchReason = Literal["KEYWORD", "SEMANTIC"]
SearchMode = Literal["HYBRID", "KEYWORD"]
SearchField = Literal["ALL", "TITLE"]


class SearchMatchDetail(BaseModel):
    retriever: Retriever
    rank: int
    score: float


class SearchResultResponse(BaseModel):
    memory: MemoryResponse
    score: float
    match_reasons: list[MatchReason]
    matches: list[SearchMatchDetail] = Field(default_factory=list)


class SearchDiagnostics(BaseModel):
    authorization_applied: bool
    active_filters: list[str]
    keyword_candidates: int
    semantic_candidates: int
    returned_candidates: int
    fusion: Literal["RRF"]
    reranker_status: RerankStatus
    elapsed_ms: float


class SearchResponse(BaseModel):
    query: str
    semantic_status: SemanticStatus
    results: list[SearchResultResponse]
    diagnostics: SearchDiagnostics | None = None


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
    started_at = perf_counter()
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
    reranker = getattr(request.app.state, "retrieval_reranker", None)
    if reranker is not None and not isinstance(reranker, RerankerPort):
        raise RuntimeError("application retrieval_reranker does not implement RerankerPort")
    rerank_outcome = rerank_authorized_results(
        normalized_query,
        results,
        reranker=reranker,
        timeout_seconds=settings.retrieval_reranker_timeout_seconds,
        candidate_limit=settings.retrieval_reranker_candidate_limit,
    )
    results = rerank_outcome.results
    active_filters = [
        name
        for name, is_active in (
            ("author", payload.author_id is not None),
            ("visibility", payload.visibility is not None),
            ("created_from", payload.created_from is not None),
            ("created_to", payload.created_to is not None),
            ("title", payload.field == "TITLE"),
        )
        if is_active
    ]
    diagnostics = SearchDiagnostics(
        authorization_applied=True,
        active_filters=active_filters,
        keyword_candidates=len(keyword_results),
        semantic_candidates=len(semantic_results),
        returned_candidates=len(results),
        fusion="RRF",
        reranker_status=rerank_outcome.status,
        elapsed_ms=round((perf_counter() - started_at) * 1000, 2),
    )
    logger.info(
        "retrieval_completed",
        workspace_id=str(principal.workspace_id),
        user_id=str(principal.user_id),
        mode=payload.mode,
        semantic_status=semantic_status,
        active_filters=active_filters,
        keyword_candidates=len(keyword_results),
        semantic_candidates=len(semantic_results),
        returned_candidates=len(results),
        reranker_status=rerank_outcome.status,
        elapsed_ms=diagnostics.elapsed_ms,
    )
    metrics.increment(
        "memora_retrieval_requests_total",
        labels={
            "semantic_status": semantic_status,
            "reranker_status": rerank_outcome.status,
        },
    )
    for stage, candidate_count in (
        ("keyword", len(keyword_results)),
        ("semantic", len(semantic_results)),
        ("returned", len(results)),
    ):
        metrics.observe(
            "memora_retrieval_candidates",
            labels={"stage": stage},
            value=float(candidate_count),
        )
    metrics.observe(
        "memora_retrieval_duration_seconds",
        labels={},
        value=diagnostics.elapsed_ms / 1000,
    )
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
                matches=[
                    SearchMatchDetail(
                        retriever=match.retriever,
                        rank=match.rank,
                        score=match.score,
                    )
                    for match in result.matches
                ],
            )
            for result in results
        ],
        diagnostics=diagnostics,
    )
