from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import Select, func, literal_column, or_
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from memora.identity.dependencies import Principal
from memora.identity.models import User
from memora.memories.models import Memory
from memora.memories.service import authorized_memories_statement
from memora.retrieval.models import MemoryEmbedding

MatchReason = Literal["KEYWORD", "SEMANTIC"]
SearchField = Literal["ALL", "TITLE"]
Retriever = Literal[
    "FILTER",
    "EXACT",
    "FULL_TEXT",
    "TRIGRAM",
    "SEMANTIC",
    "RERANKER",
]
RRF_K = 60
TRIGRAM_MIN_SCORE = 0.35


@dataclass(frozen=True)
class RetrievalMatch:
    retriever: Retriever
    rank: int
    score: float


@dataclass(frozen=True)
class RetrievedMemory:
    memory: Memory
    author: User
    projection: MemoryEmbedding | None
    score: float
    reasons: tuple[MatchReason, ...]
    matches: tuple[RetrievalMatch, ...] = ()


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
    if database.get_bind().dialect.name == "postgresql" and query:
        return _postgres_keyword_search(
            database,
            principal,
            query,
            author_id=author_id,
            visibility=visibility,
            created_from=created_from,
            created_to=created_to,
            search_field=search_field,
            limit=limit,
        )

    statement = authorized_memories_statement(principal)
    if query:
        match_expression = (
            Memory.title.icontains(query, autoescape=True)
            if search_field == "TITLE"
            else or_(
                Memory.title.icontains(query, autoescape=True),
                Memory.body.icontains(query, autoescape=True),
            )
        )
        statement = statement.where(match_expression)
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
            matches=(
                RetrievalMatch(
                    retriever="EXACT" if query else "FILTER",
                    rank=rank,
                    score=1.0,
                ),
            ),
        )
        for rank, (memory, author, projection) in enumerate(rows, start=1)
    ]


def _postgres_keyword_search(
    database: Session,
    principal: Principal,
    query: str,
    *,
    author_id: UUID | None,
    visibility: str | None,
    created_from: datetime | None,
    created_to: datetime | None,
    search_field: SearchField,
    limit: int,
) -> list[RetrievedMemory]:
    configuration: ColumnElement[Any] = literal_column("'simple'::regconfig")
    empty_text: ColumnElement[Any] = literal_column("''")
    title_text = func.coalesce(Memory.title, empty_text)
    body_text = func.coalesce(Memory.body, empty_text)
    title_vector = func.setweight(
        func.to_tsvector(configuration, title_text), literal_column("'A'::\"char\"")
    )
    search_vector: ColumnElement[Any]
    exact_match: ColumnElement[Any]
    trigram_index_match: ColumnElement[Any]
    trigram_match: ColumnElement[Any]
    trigram_score: ColumnElement[Any]
    if search_field == "TITLE":
        search_vector = title_vector
        exact_match = Memory.title.icontains(query, autoescape=True)
        trigram_index_match = Memory.title.op("%")(query)
        trigram_score = func.greatest(
            func.similarity(title_text, query),
            func.word_similarity(query, title_text),
        )
    else:
        body_vector = func.setweight(
            func.to_tsvector(configuration, body_text), literal_column("'B'::\"char\"")
        )
        search_vector = title_vector.op("||")(body_vector)
        exact_match = or_(
            Memory.title.icontains(query, autoescape=True),
            Memory.body.icontains(query, autoescape=True),
        )
        trigram_index_match = or_(Memory.title.op("%")(query), Memory.body.op("%")(query))
        trigram_score = func.greatest(
            func.similarity(title_text, query),
            func.similarity(body_text, query),
            func.word_similarity(query, title_text),
            func.word_similarity(query, body_text),
        )
    trigram_match = or_(trigram_index_match, trigram_score >= TRIGRAM_MIN_SCORE)
    ts_query = func.websearch_to_tsquery(configuration, query)
    full_text_match = search_vector.bool_op("@@")(ts_query)
    full_text_score = func.ts_rank_cd(search_vector, ts_query, 32)
    statement = _apply_filters(
        authorized_memories_statement(principal)
        .add_columns(
            full_text_score.label("full_text_score"),
            trigram_score.label("trigram_score"),
            exact_match.label("exact_match"),
            trigram_match.label("trigram_match"),
        )
        .where(or_(full_text_match, exact_match, trigram_match)),
        author_id=author_id,
        visibility=visibility,
        created_from=created_from,
        created_to=created_to,
    )
    rows = database.execute(
        statement.order_by(
            exact_match.desc(),
            full_text_score.desc(),
            trigram_score.desc(),
            Memory.created_at.desc(),
            Memory.id,
        ).limit(limit)
    ).all()
    results: list[RetrievedMemory] = []
    for rank, row in enumerate(rows, start=1):
        memory, author, projection, raw_full_text, raw_trigram, is_exact, is_trigram = row
        full_text_value = max(0.0, min(1.0, float(raw_full_text or 0.0)))
        trigram_value = max(0.0, min(1.0, float(raw_trigram or 0.0)))
        matches: list[RetrievalMatch] = []
        if is_exact:
            matches.append(RetrievalMatch(retriever="EXACT", rank=rank, score=1.0))
        if full_text_value > 0:
            matches.append(
                RetrievalMatch(
                    retriever="FULL_TEXT",
                    rank=rank,
                    score=full_text_value,
                )
            )
        if is_trigram:
            matches.append(
                RetrievalMatch(
                    retriever="TRIGRAM",
                    rank=rank,
                    score=trigram_value,
                )
            )
        results.append(
            RetrievedMemory(
                memory=memory,
                author=author,
                projection=projection,
                score=max((match.score for match in matches), default=0.0),
                reasons=("KEYWORD",),
                matches=tuple(matches),
            )
        )
    return results


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
    for rank, row in enumerate(rows, start=1):
        memory, author, projection, raw_distance = row
        cosine_similarity = max(0.0, min(1.0, 1.0 - float(raw_distance)))
        results.append(
            RetrievedMemory(
                memory=memory,
                author=author,
                projection=projection,
                score=cosine_similarity,
                reasons=("SEMANTIC",),
                matches=(
                    RetrievalMatch(
                        retriever="SEMANTIC",
                        rank=rank,
                        score=cosine_similarity,
                    ),
                ),
            )
        )
    return results


def merge_hybrid_results(
    keyword_results: list[RetrievedMemory],
    semantic_results: list[RetrievedMemory],
    *,
    limit: int,
) -> list[RetrievedMemory]:
    if not keyword_results and not semantic_results:
        return []

    result_by_id: dict[UUID, RetrievedMemory] = {}
    fused_score_by_id: dict[UUID, float] = {}
    best_rank_by_id: dict[UUID, int] = {}
    reasons_by_id: dict[UUID, set[MatchReason]] = {}
    matches_by_id: dict[UUID, list[RetrievalMatch]] = {}
    channels: list[list[RetrievedMemory]] = []
    if keyword_results:
        channels.append(keyword_results)
    if semantic_results:
        channels.append(semantic_results)
    for results in channels:
        for rank, result in enumerate(results, start=1):
            memory_id = result.memory.id
            result_by_id.setdefault(memory_id, result)
            fused_score_by_id[memory_id] = fused_score_by_id.get(memory_id, 0.0) + 1.0 / (
                RRF_K + rank
            )
            best_rank_by_id[memory_id] = min(best_rank_by_id.get(memory_id, rank), rank)
            reasons_by_id.setdefault(memory_id, set()).update(result.reasons)
            matches_by_id.setdefault(memory_id, []).extend(result.matches)

    maximum_score = len(channels) / (RRF_K + 1)
    merged = [
        RetrievedMemory(
            memory=result.memory,
            author=result.author,
            projection=result.projection,
            score=min(1.0, fused_score_by_id[memory_id] / maximum_score),
            reasons=tuple(
                reason for reason in ("KEYWORD", "SEMANTIC") if reason in reasons_by_id[memory_id]
            ),
            matches=tuple(matches_by_id[memory_id]),
        )
        for memory_id, result in result_by_id.items()
    ]
    return sorted(
        merged,
        key=lambda result: (
            -result.score,
            best_rank_by_id[result.memory.id],
            -result.memory.created_at.timestamp(),
            str(result.memory.id),
        ),
    )[:limit]
