from collections.abc import Iterator
from datetime import UTC, datetime
from typing import cast
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql

from memora.database import Base
from memora.identity.dependencies import SESSION_COOKIE_NAME, Principal
from memora.identity.models import User
from memora.identity.seed import seed_database
from memora.main import create_app
from memora.memories.models import Memory
from memora.memories.service import authorized_memories_statement
from memora.retrieval.reranking import RerankCandidate, RerankScore
from memora.retrieval.service import (
    MatchReason,
    RetrievalMatch,
    RetrievedMemory,
    Retriever,
    merge_hybrid_results,
)
from memora.settings import Settings


@pytest.fixture
def retrieval_client() -> Iterator[TestClient]:
    settings = Settings(
        app_env="test",
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="retrieval-test-secret-not-for-production",
    )
    app = create_app(settings)
    with TestClient(app) as client:
        Base.metadata.create_all(app.state.engine)
        seed_database(app.state.engine, settings)
        yield client


def _login(client: TestClient, email: str, password: str) -> dict[str, str]:
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    token = response.cookies.get(SESSION_COOKIE_NAME)
    assert token
    return {"Cookie": f"{SESSION_COOKIE_NAME}={token}"}


def test_keyword_search_never_crosses_private_or_deleted_boundary(
    retrieval_client: TestClient,
    capsys: pytest.CaptureFixture[str],
) -> None:
    alex = _login(retrieval_client, "alex@memora.local", "memora-local-alex")
    blair = _login(retrieval_client, "blair@memora.local", "memora-local-blair")
    created_response = retrieval_client.post(
        "/memories",
        headers=alex,
        json={"body": "海豚定价方案应该先按席位订阅。"},
    )
    assert created_response.status_code == 201
    memory_id = cast(str, created_response.json()["id"])
    assert created_response.json()["processing_status"] == "PENDING"

    private_search = retrieval_client.post("/search", headers=blair, json={"q": "海豚定价"})
    assert private_search.status_code == 200
    assert private_search.json()["query"] == "海豚定价"
    assert private_search.json()["semantic_status"] == "DISABLED"
    assert private_search.json()["results"] == []
    captured_logs = capsys.readouterr().out
    assert "retrieval_completed" in captured_logs
    assert "海豚定价" not in captured_logs
    assert private_search.json()["diagnostics"] | {"elapsed_ms": 0.0} == {
        "authorization_applied": True,
        "active_filters": [],
        "keyword_candidates": 0,
        "semantic_candidates": 0,
        "returned_candidates": 0,
        "fusion": "RRF",
        "reranker_status": "DISABLED",
        "elapsed_ms": 0.0,
    }

    retrieval_client.post(f"/memories/{memory_id}/share", headers=alex)
    shared_search = retrieval_client.post("/search", headers=blair, json={"q": "海豚定价"})
    assert shared_search.status_code == 200
    assert [result["memory"]["id"] for result in shared_search.json()["results"]] == [memory_id]
    assert shared_search.json()["results"][0]["match_reasons"] == ["KEYWORD"]
    assert shared_search.json()["results"][0]["matches"] == [
        {"retriever": "EXACT", "rank": 1, "score": 1.0}
    ]

    retrieval_client.post(f"/memories/{memory_id}/unshare", headers=alex)
    assert (
        retrieval_client.post("/search", headers=blair, json={"q": "海豚定价"}).json()["results"]
        == []
    )
    retrieval_client.delete(f"/memories/{memory_id}", headers=alex)
    assert (
        retrieval_client.post("/search", headers=alex, json={"q": "海豚定价"}).json()["results"]
        == []
    )


def test_memory_library_keyword_title_date_and_member_filters(
    retrieval_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    alex = _login(retrieval_client, "alex@memora.local", "memora-local-alex")
    private = retrieval_client.post(
        "/memories",
        headers=alex,
        json={"body": "# Project Aurora\n\n海龟定价需要一轮访谈。"},
    )
    shared = retrieval_client.post(
        "/memories",
        headers=alex,
        json={"body": "# 海龟访谈记录\n\nProject Aurora 的共享结论。", "visibility": "WORKSPACE"},
    )
    assert private.status_code == 201
    assert private.json()["title"] == "Project Aurora"
    assert shared.status_code == 201

    def fail_if_embedding_is_built(_settings: Settings) -> None:
        raise AssertionError("keyword-only search must not build an embedding model")

    monkeypatch.setattr("memora.api.search.build_embedding_model", fail_if_embedding_is_built)

    title_search = retrieval_client.post(
        "/search",
        headers=alex,
        json={"q": "Aurora", "mode": "KEYWORD", "field": "TITLE", "limit": 200},
    )
    assert title_search.status_code == 200
    assert [item["memory"]["id"] for item in title_search.json()["results"]] == [
        private.json()["id"]
    ]
    assert title_search.json()["semantic_status"] == "DISABLED"

    body_search = retrieval_client.post(
        "/search",
        headers=alex,
        json={"q": "共享结论", "mode": "KEYWORD", "field": "ALL"},
    )
    assert [item["memory"]["id"] for item in body_search.json()["results"]] == [shared.json()["id"]]

    date_only = retrieval_client.post(
        "/search",
        headers=alex,
        json={
            "mode": "KEYWORD",
            "created_from": "2000-01-01T00:00:00Z",
            "created_to": "2100-01-01T00:00:00Z",
            "limit": 200,
        },
    )
    assert date_only.status_code == 200
    assert {item["memory"]["id"] for item in date_only.json()["results"]} >= {
        private.json()["id"],
        shared.json()["id"],
    }
    assert all(item["match_reasons"] == [] for item in date_only.json()["results"])

    blair = _login(retrieval_client, "blair@memora.local", "memora-local-blair")
    member_search = retrieval_client.post(
        "/search",
        headers=blair,
        json={
            "q": "Project Aurora",
            "mode": "KEYWORD",
            "author_id": private.json()["author"]["id"],
            "limit": 200,
        },
    )
    assert member_search.status_code == 200
    assert [item["memory"]["id"] for item in member_search.json()["results"]] == [
        shared.json()["id"]
    ]


def test_memory_library_requires_a_query_or_filter(retrieval_client: TestClient) -> None:
    alex = _login(retrieval_client, "alex@memora.local", "memora-local-alex")
    response = retrieval_client.post(
        "/search",
        headers=alex,
        json={"q": "  ", "mode": "KEYWORD"},
    )
    assert response.status_code == 422


def test_search_can_apply_an_injected_authorized_reranker(
    retrieval_client: TestClient,
) -> None:
    alex = _login(retrieval_client, "alex@memora.local", "memora-local-alex")
    older = retrieval_client.post(
        "/memories",
        headers=alex,
        json={"body": "# Older\n\n共同主题的第一条记录。"},
    )
    newer = retrieval_client.post(
        "/memories",
        headers=alex,
        json={"body": "# Newer\n\n共同主题的第二条记录。"},
    )
    assert older.status_code == newer.status_code == 201

    class PreferOlder:
        model_id = "test-reranker"

        def rerank(
            self,
            _query: str,
            candidates: list[RerankCandidate],
            *,
            timeout_seconds: float,
        ) -> list[RerankScore]:
            assert timeout_seconds == 3
            return [
                RerankScore(
                    memory_id=candidate.memory_id,
                    score=1.0 if candidate.memory_id == UUID(older.json()["id"]) else 0.0,
                )
                for candidate in candidates
            ]

    cast(FastAPI, retrieval_client.app).state.retrieval_reranker = PreferOlder()
    response = retrieval_client.post(
        "/search",
        headers=alex,
        json={"q": "共同主题", "mode": "KEYWORD"},
    )

    assert response.status_code == 200
    assert response.json()["diagnostics"]["reranker_status"] == "APPLIED"
    assert [item["memory"]["id"] for item in response.json()["results"][:2]] == [
        older.json()["id"],
        newer.json()["id"],
    ]
    assert response.json()["results"][0]["matches"][-1]["retriever"] == "RERANKER"


def test_authorized_candidate_sql_contains_hard_workspace_and_visibility_filters() -> None:
    principal = Principal(
        user_id=UUID("00000000-0000-0000-0000-000000000001"),
        workspace_id=UUID("00000000-0000-0000-0000-000000000002"),
        email="alex@memora.local",
        display_name="Alex",
        role="MEMBER",
    )
    compiled = str(
        authorized_memories_statement(principal).compile(
            dialect=postgresql.dialect(),  # type: ignore[no-untyped-call]
            compile_kwargs={"literal_binds": False},
        )
    )

    assert "memories.workspace_id" in compiled
    assert "memories.deleted_at IS NULL" in compiled
    assert "memories.timeline_visible IS true" in compiled
    assert "memories.author_id" in compiled
    assert "memories.visibility" in compiled
    assert "memory_embeddings" in compiled
    assert Memory.__tablename__ == "memories"


def test_rrf_prioritizes_evidence_supported_by_keyword_and_semantic_channels() -> None:
    author = User(
        id=uuid4(),
        email="evaluation@example.test",
        display_name="Evaluation",
        password_hash="not-a-password",
    )

    def result(
        *,
        reason: MatchReason,
        retriever: Retriever,
        rank: int,
        created_at: datetime,
    ) -> RetrievedMemory:
        memory = Memory(
            id=uuid4(),
            workspace_id=uuid4(),
            author_id=author.id,
            title="Synthetic",
            body="Synthetic",
            visibility="PRIVATE",
            timeline_entry_id=uuid4(),
            timeline_visible=True,
            revision_kind="ROOT",
            created_at=created_at,
        )
        return RetrievedMemory(
            memory=memory,
            author=author,
            projection=None,
            score=1.0,
            reasons=(reason,),
            matches=(
                RetrievalMatch(
                    retriever=retriever,
                    rank=rank,
                    score=1.0,
                ),
            ),
        )

    shared = result(
        reason="KEYWORD",
        retriever="FULL_TEXT",
        rank=1,
        created_at=datetime(2026, 1, 3, tzinfo=UTC),
    )
    keyword_only = result(
        reason="KEYWORD",
        retriever="TRIGRAM",
        rank=2,
        created_at=datetime(2026, 1, 2, tzinfo=UTC),
    )
    semantic_only = result(
        reason="SEMANTIC",
        retriever="SEMANTIC",
        rank=1,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    shared_semantic = RetrievedMemory(
        memory=shared.memory,
        author=shared.author,
        projection=None,
        score=0.9,
        reasons=("SEMANTIC",),
        matches=(RetrievalMatch(retriever="SEMANTIC", rank=2, score=0.9),),
    )

    merged = merge_hybrid_results(
        [shared, keyword_only],
        [semantic_only, shared_semantic],
        limit=3,
    )

    assert [item.memory.id for item in merged] == [
        shared.memory.id,
        semantic_only.memory.id,
        keyword_only.memory.id,
    ]
    assert merged[0].reasons == ("KEYWORD", "SEMANTIC")
    assert {match.retriever for match in merged[0].matches} == {"FULL_TEXT", "SEMANTIC"}
    assert merged[0].score > merged[1].score > merged[2].score
