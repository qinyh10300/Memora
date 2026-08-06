from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import Select
from sqlalchemy.orm import Session

from memora.identity.dependencies import Principal
from memora.identity.models import User
from memora.memories.models import Memory
from memora.memories.service import authorized_memories_statement
from memora.retrieval.models import MemoryEmbedding

MatchReason = Literal["KEYWORD", "SEMANTIC"]
SearchField = Literal["ALL", "TITLE"]


@dataclass(frozen=True)
class RetrievedMemory:
    memory: Memory
    author: User
    projection: MemoryEmbedding | None
    score: float
    reasons: tuple[MatchReason, ...]


def _apply_filters(
    statement: Select[Any],
    *,
    author_id: UUID | None,
    visibility: str | None,
    created_from: datetime | None,
    created_to: datetime | None,
) -> Select[Any]:
    if author_id is not None:
        statement = statement.where(Memory.author_id == author_id)
    if visibility is not None:
        statement = statement.where(Memory.visibility == visibility)
    if created_from is not None:
        statement = statement.where(Memory.created_at >= created_from)
    if created_to is not None:
        statement = statement.where(Memory.created_at < created_to)
    return statement


def keyword_search(
    database: Session,
    principal: Principal,
    query: str,
    *,
    author_id: UUID | None = None,
    visibility: str | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    search_field: SearchField = "ALL",
    limit: int = 20,
) -> list[RetrievedMemory]:
    statement = authorized_memories_statement(principal)
    if query:
        searched_column = Memory.title if search_field == "TITLE" else Memory.body
        statement = statement.where(
            searched_column.is_not(None),
            searched_column.icontains(query, autoescape=True),
        )
    statement = _apply_filters(
        statement,
        author_id=author_id,
        visibility=visibility,
        created_from=created_from,
        created_to=created_to,
    )
    rows = (
        database.execute(statement.order_by(Memory.created_at.desc(), Memory.id).limit(limit))
        .tuples()
        .all()
    )
    return [
        RetrievedMemory(
            memory=memory,
            author=author,
            projection=projection,
            score=1.0,
            reasons=("KEYWORD",) if query else (),
        )
        for memory, author, projection in rows
    ]


def semantic_search(
    database: Session,
    principal: Principal,
    query_vector: list[float],
    model: str,
    *,
    author_id: UUID | None = None,
    visibility: str | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    limit: int = 20,
) -> list[RetrievedMemory]:
    distance = MemoryEmbedding.embedding.cosine_distance(query_vector).label("distance")
    statement = _apply_filters(
        authorized_memories_statement(principal)
        .add_columns(distance)
        .where(
            MemoryEmbedding.status == "COMPLETED",
            MemoryEmbedding.model == model,
            MemoryEmbedding.dimensions == len(query_vector),
            MemoryEmbedding.embedding.is_not(None),
        ),
        author_id=author_id,
        visibility=visibility,
        created_from=created_from,
        created_to=created_to,
    )
    rows = database.execute(
        statement.order_by(distance, Memory.created_at.desc()).limit(limit)
    ).all()
    results: list[RetrievedMemory] = []
    for row in rows:
        memory, author, projection, raw_distance = row
        cosine_similarity = max(0.0, min(1.0, 1.0 - float(raw_distance)))
        results.append(
            RetrievedMemory(
                memory=memory,
                author=author,
                projection=projection,
                score=cosine_similarity,
                reasons=("SEMANTIC",),
            )
        )
    return results


def merge_hybrid_results(
    keyword_results: list[RetrievedMemory],
    semantic_results: list[RetrievedMemory],
    *,
    limit: int,
) -> list[RetrievedMemory]:
    merged = {result.memory.id: result for result in semantic_results}
    for keyword_result in keyword_results:
        existing = merged.get(keyword_result.memory.id)
        if existing is None:
            merged[keyword_result.memory.id] = keyword_result
            continue
        merged[keyword_result.memory.id] = RetrievedMemory(
            memory=existing.memory,
            author=existing.author,
            projection=existing.projection,
            score=min(1.0, max(existing.score, keyword_result.score) + 0.05),
            reasons=("KEYWORD", "SEMANTIC"),
        )
    return sorted(
        merged.values(),
        key=lambda result: (result.score, result.memory.created_at),
        reverse=True,
    )[:limit]
