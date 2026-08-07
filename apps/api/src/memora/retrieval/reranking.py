from __future__ import annotations

import math
from dataclasses import dataclass, replace
from typing import Literal, Protocol, runtime_checkable
from uuid import UUID

from memora.ai.ports import AIProviderError
from memora.retrieval.service import RetrievalMatch, RetrievedMemory

RerankStatus = Literal["DISABLED", "APPLIED", "DEGRADED"]


@dataclass(frozen=True)
class RerankCandidate:
    memory_id: UUID
    title: str | None
    excerpt: str


@dataclass(frozen=True)
class RerankScore:
    memory_id: UUID
    score: float


@runtime_checkable
class RerankerPort(Protocol):
    @property
    def model_id(self) -> str: ...

    def rerank(
        self,
        query: str,
        candidates: list[RerankCandidate],
        *,
        timeout_seconds: float,
    ) -> list[RerankScore]: ...


@dataclass(frozen=True)
class RerankOutcome:
    results: list[RetrievedMemory]
    status: RerankStatus
    model: str | None = None


def rerank_authorized_results(
    query: str,
    results: list[RetrievedMemory],
    *,
    reranker: RerankerPort | None,
    timeout_seconds: float,
    candidate_limit: int,
) -> RerankOutcome:
    """Rerank an already-authorized candidate list and preserve RRF on any failure."""
    if reranker is None or not query or len(results) < 2:
        return RerankOutcome(results=results, status="DISABLED")

    selected = results[:candidate_limit]
    candidates = [
        RerankCandidate(
            memory_id=result.memory.id,
            title=result.memory.title,
            excerpt=(result.memory.body or "")[:2000],
        )
        for result in selected
    ]
    allowed_ids = {candidate.memory_id for candidate in candidates}
    try:
        scores = reranker.rerank(
            query,
            candidates,
            timeout_seconds=timeout_seconds,
        )
        score_by_id: dict[UUID, float] = {}
        for score in scores:
            if score.memory_id not in allowed_ids:
                raise ValueError("reranker returned a memory outside the authorized candidate set")
            if score.memory_id in score_by_id:
                raise ValueError("reranker returned a duplicate memory score")
            if not math.isfinite(score.score) or not 0.0 <= score.score <= 1.0:
                raise ValueError("reranker scores must be finite values between zero and one")
            score_by_id[score.memory_id] = score.score
    except (AIProviderError, ValueError):
        return RerankOutcome(results=results, status="DEGRADED", model=reranker.model_id)

    original_rank = {result.memory.id: rank for rank, result in enumerate(selected, start=1)}
    reordered = sorted(
        selected,
        key=lambda result: (
            -score_by_id.get(result.memory.id, -1.0),
            original_rank[result.memory.id],
        ),
    )
    enriched = [
        replace(
            result,
            matches=result.matches
            + (
                RetrievalMatch(
                    retriever="RERANKER",
                    rank=rank,
                    score=score_by_id.get(result.memory.id, 0.0),
                ),
            ),
        )
        for rank, result in enumerate(reordered, start=1)
    ]
    return RerankOutcome(
        results=enriched + results[candidate_limit:],
        status="APPLIED",
        model=reranker.model_id,
    )
