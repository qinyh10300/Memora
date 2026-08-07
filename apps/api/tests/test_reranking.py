from datetime import UTC, datetime
from uuid import UUID, uuid4

from memora.ai.ports import AIProviderError
from memora.identity.models import User
from memora.memories.models import Memory
from memora.retrieval.reranking import (
    RerankCandidate,
    RerankScore,
    rerank_authorized_results,
)
from memora.retrieval.service import RetrievalMatch, RetrievedMemory


def _result(author: User, *, body: str, rank: int) -> RetrievedMemory:
    memory = Memory(
        id=uuid4(),
        workspace_id=uuid4(),
        author_id=author.id,
        title=f"Memory {rank}",
        body=body,
        visibility="PRIVATE",
        timeline_entry_id=uuid4(),
        timeline_visible=True,
        revision_kind="ROOT",
        created_at=datetime(2026, 1, rank, tzinfo=UTC),
    )
    return RetrievedMemory(
        memory=memory,
        author=author,
        projection=None,
        score=1.0 / rank,
        reasons=("KEYWORD",),
        matches=(RetrievalMatch(retriever="FULL_TEXT", rank=rank, score=1.0 / rank),),
    )


class ReverseReranker:
    model_id = "fake-reranker"

    def __init__(self) -> None:
        self.timeout_seconds = 0.0
        self.candidates: list[RerankCandidate] = []

    def rerank(
        self,
        _query: str,
        candidates: list[RerankCandidate],
        *,
        timeout_seconds: float,
    ) -> list[RerankScore]:
        self.timeout_seconds = timeout_seconds
        self.candidates = candidates
        return [
            RerankScore(memory_id=candidate.memory_id, score=index / len(candidates))
            for index, candidate in enumerate(candidates, start=1)
        ]


class FailingReranker:
    model_id = "failing-reranker"

    def rerank(
        self,
        _query: str,
        _candidates: list[RerankCandidate],
        *,
        timeout_seconds: float,
    ) -> list[RerankScore]:
        assert timeout_seconds == 1.5
        raise AIProviderError("timeout", retryable=True)


class LeakingReranker:
    model_id = "leaking-reranker"

    def rerank(
        self,
        _query: str,
        _candidates: list[RerankCandidate],
        *,
        timeout_seconds: float,
    ) -> list[RerankScore]:
        assert timeout_seconds == 1.5
        return [RerankScore(memory_id=UUID(int=1), score=1.0)]


def test_reranker_reorders_only_authorized_candidates_with_bounded_context() -> None:
    author = User(
        id=uuid4(),
        email="reranker@example.test",
        display_name="Reranker",
        password_hash="not-a-password",
    )
    original = [
        _result(author, body="a" * 3000, rank=1),
        _result(author, body="second", rank=2),
        _result(author, body="third", rank=3),
    ]
    reranker = ReverseReranker()

    outcome = rerank_authorized_results(
        "query",
        original,
        reranker=reranker,
        timeout_seconds=1.5,
        candidate_limit=2,
    )

    assert outcome.status == "APPLIED"
    assert outcome.model == "fake-reranker"
    assert [result.memory.id for result in outcome.results] == [
        original[1].memory.id,
        original[0].memory.id,
        original[2].memory.id,
    ]
    assert reranker.timeout_seconds == 1.5
    assert len(reranker.candidates[0].excerpt) == 2000
    assert outcome.results[0].matches[-1].retriever == "RERANKER"


def test_reranker_failure_or_unknown_memory_degrades_to_original_rrf_order() -> None:
    author = User(
        id=uuid4(),
        email="failure@example.test",
        display_name="Failure",
        password_hash="not-a-password",
    )
    original = [
        _result(author, body="first", rank=1),
        _result(author, body="second", rank=2),
    ]

    for reranker in (FailingReranker(), LeakingReranker()):
        outcome = rerank_authorized_results(
            "query",
            original,
            reranker=reranker,
            timeout_seconds=1.5,
            candidate_limit=2,
        )
        assert outcome.status == "DEGRADED"
        assert outcome.results == original
