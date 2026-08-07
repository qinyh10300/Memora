from __future__ import annotations

import argparse
import json
import math
from datetime import datetime
from pathlib import Path
from statistics import fmean
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from memora.database import Base, build_engine
from memora.identity.dependencies import Principal
from memora.identity.models import User
from memora.memories.models import Memory
from memora.model_registry import load_all_models
from memora.retrieval.service import SearchField, keyword_search
from memora.workspaces.models import Workspace


class EvaluationUser(BaseModel):
    id: UUID
    email: str
    display_name: str


class EvaluationWorkspace(BaseModel):
    id: UUID
    slug: str
    name: str
    kind: Literal["PERSONAL", "TEAM"] = "TEAM"


class EvaluationMemory(BaseModel):
    id: UUID
    workspace_id: UUID
    author_id: UUID
    title: str | None = None
    body: str | None
    visibility: Literal["PRIVATE", "WORKSPACE"]
    created_at: datetime
    timeline_visible: bool = True
    deleted_at: datetime | None = None

    @model_validator(mode="after")
    def validate_deleted_body(self) -> EvaluationMemory:
        if (self.deleted_at is None) != (self.body is not None):
            raise ValueError("active memories require a body and deleted memories must remove it")
        return self


class ExpectedSource(BaseModel):
    memory_id: UUID
    relevance: int = Field(default=1, ge=1, le=3)


class EvaluationCase(BaseModel):
    id: str = Field(min_length=1)
    description: str
    principal_user_id: UUID
    workspace_id: UUID
    role: Literal["OWNER", "MEMBER"] = "MEMBER"
    query: str = ""
    search_field: SearchField = "ALL"
    author_id: UUID | None = None
    visibility: Literal["PRIVATE", "WORKSPACE"] | None = None
    created_from: datetime | None = None
    created_to: datetime | None = None
    limit: int = Field(default=10, ge=1, le=200)
    expected_sources: list[ExpectedSource] = Field(default_factory=list)
    forbidden_memory_ids: list[UUID] = Field(default_factory=list)
    expects_evidence: bool = True

    @model_validator(mode="after")
    def validate_expectations(self) -> EvaluationCase:
        expected_ids = {source.memory_id for source in self.expected_sources}
        forbidden_ids = set(self.forbidden_memory_ids)
        if self.expects_evidence and not expected_ids:
            raise ValueError("evidence cases require at least one expected source")
        if not self.expects_evidence and expected_ids:
            raise ValueError("no-evidence cases cannot declare expected sources")
        if expected_ids & forbidden_ids:
            raise ValueError("a memory cannot be both expected and forbidden")
        if self.created_from and self.created_to and self.created_from >= self.created_to:
            raise ValueError("created_from must be earlier than created_to")
        return self


class EvaluationDataset(BaseModel):
    version: str
    description: str
    users: list[EvaluationUser]
    workspaces: list[EvaluationWorkspace]
    memories: list[EvaluationMemory]
    cases: list[EvaluationCase]

    @model_validator(mode="after")
    def validate_references(self) -> EvaluationDataset:
        user_ids = {user.id for user in self.users}
        workspace_ids = {workspace.id for workspace in self.workspaces}
        memory_ids = {memory.id for memory in self.memories}
        if len(user_ids) != len(self.users) or len(workspace_ids) != len(self.workspaces):
            raise ValueError("evaluation users and workspaces must have unique ids")
        if len(memory_ids) != len(self.memories):
            raise ValueError("evaluation memories must have unique ids")
        for memory in self.memories:
            if memory.author_id not in user_ids or memory.workspace_id not in workspace_ids:
                raise ValueError(f"memory {memory.id} references an unknown user or workspace")
        for case in self.cases:
            referenced_memories = {
                *(source.memory_id for source in case.expected_sources),
                *case.forbidden_memory_ids,
            }
            if case.principal_user_id not in user_ids or case.workspace_id not in workspace_ids:
                raise ValueError(f"case {case.id} references an unknown principal or workspace")
            if not referenced_memories <= memory_ids:
                raise ValueError(f"case {case.id} references an unknown memory")
        return self


class EvaluationThresholds(BaseModel):
    min_recall_at_k: float = Field(ge=0.0, le=1.0)
    min_mrr: float = Field(ge=0.0, le=1.0)
    min_ndcg_at_k: float = Field(ge=0.0, le=1.0)
    min_citation_precision: float = Field(ge=0.0, le=1.0)
    min_no_evidence_accuracy: float = Field(ge=0.0, le=1.0)
    max_unauthorized_candidate_count: int = Field(default=0, ge=0)


class CaseMetrics(BaseModel):
    recall_at_k: float
    reciprocal_rank: float
    ndcg_at_k: float
    citation_precision: float
    no_evidence_correct: bool | None
    unauthorized_candidate_count: int


class CaseReport(BaseModel):
    id: str
    description: str
    retrieved_memory_ids: list[UUID]
    expected_memory_ids: list[UUID]
    forbidden_memory_ids: list[UUID]
    metrics: CaseMetrics


class AggregateMetrics(BaseModel):
    case_count: int
    evidence_case_count: int
    no_evidence_case_count: int
    recall_at_k: float
    mrr: float
    ndcg_at_k: float
    citation_precision: float
    no_evidence_accuracy: float
    unauthorized_candidate_count: int


class GateResult(BaseModel):
    passed: bool
    failures: list[str]


class EvaluationReport(BaseModel):
    dataset_version: str
    algorithm: str
    metrics: AggregateMetrics
    gates: GateResult | None
    cases: list[CaseReport]


def load_dataset(path: Path) -> EvaluationDataset:
    return EvaluationDataset.model_validate_json(path.read_text(encoding="utf-8"))


def load_thresholds(path: Path) -> EvaluationThresholds:
    return EvaluationThresholds.model_validate_json(path.read_text(encoding="utf-8"))


def _dcg(relevances: list[int]) -> float:
    return math.fsum(
        ((2**relevance) - 1) / math.log2(index + 2) for index, relevance in enumerate(relevances)
    )


def _case_report(case: EvaluationCase, retrieved_ids: list[UUID]) -> CaseReport:
    relevance_by_id = {source.memory_id: source.relevance for source in case.expected_sources}
    relevant_ids = set(relevance_by_id)
    retrieved_relevances = [relevance_by_id.get(memory_id, 0) for memory_id in retrieved_ids]
    relevant_retrieved = sum(1 for relevance in retrieved_relevances if relevance > 0)
    recall = relevant_retrieved / len(relevant_ids) if relevant_ids else 1.0
    first_relevant_rank = next(
        (index for index, relevance in enumerate(retrieved_relevances, start=1) if relevance > 0),
        None,
    )
    reciprocal_rank = 1.0 / first_relevant_rank if first_relevant_rank else 0.0
    ideal_relevances = sorted(relevance_by_id.values(), reverse=True)[: case.limit]
    ideal_dcg = _dcg(ideal_relevances)
    ndcg = _dcg(retrieved_relevances[: case.limit]) / ideal_dcg if ideal_dcg else 1.0
    citation_precision = relevant_retrieved / len(retrieved_ids) if retrieved_ids else 1.0
    no_evidence_correct = None
    if not case.expects_evidence:
        no_evidence_correct = not retrieved_ids
    unauthorized_count = len(set(retrieved_ids) & set(case.forbidden_memory_ids))
    return CaseReport(
        id=case.id,
        description=case.description,
        retrieved_memory_ids=retrieved_ids,
        expected_memory_ids=list(relevance_by_id),
        forbidden_memory_ids=case.forbidden_memory_ids,
        metrics=CaseMetrics(
            recall_at_k=recall,
            reciprocal_rank=reciprocal_rank,
            ndcg_at_k=ndcg,
            citation_precision=citation_precision,
            no_evidence_correct=no_evidence_correct,
            unauthorized_candidate_count=unauthorized_count,
        ),
    )


def evaluate_rankings(
    dataset: EvaluationDataset,
    rankings: dict[str, list[UUID]],
    *,
    algorithm: str,
    thresholds: EvaluationThresholds | None = None,
) -> EvaluationReport:
    case_reports = [
        _case_report(case, rankings.get(case.id, [])[: case.limit]) for case in dataset.cases
    ]
    evidence_reports = [
        report
        for case, report in zip(dataset.cases, case_reports, strict=True)
        if case.expects_evidence
    ]
    no_evidence_reports = [
        report
        for case, report in zip(dataset.cases, case_reports, strict=True)
        if not case.expects_evidence
    ]
    returned_count = sum(len(report.retrieved_memory_ids) for report in case_reports)
    relevant_returned_count = sum(
        round(report.metrics.citation_precision * len(report.retrieved_memory_ids))
        for report in case_reports
    )
    metrics = AggregateMetrics(
        case_count=len(case_reports),
        evidence_case_count=len(evidence_reports),
        no_evidence_case_count=len(no_evidence_reports),
        recall_at_k=fmean(report.metrics.recall_at_k for report in evidence_reports),
        mrr=fmean(report.metrics.reciprocal_rank for report in evidence_reports),
        ndcg_at_k=fmean(report.metrics.ndcg_at_k for report in evidence_reports),
        citation_precision=(relevant_returned_count / returned_count if returned_count else 1.0),
        no_evidence_accuracy=(
            fmean(
                1.0 if report.metrics.no_evidence_correct else 0.0 for report in no_evidence_reports
            )
            if no_evidence_reports
            else 1.0
        ),
        unauthorized_candidate_count=sum(
            report.metrics.unauthorized_candidate_count for report in case_reports
        ),
    )
    gates = _evaluate_gates(metrics, thresholds) if thresholds else None
    return EvaluationReport(
        dataset_version=dataset.version,
        algorithm=algorithm,
        metrics=metrics,
        gates=gates,
        cases=case_reports,
    )


def _evaluate_gates(metrics: AggregateMetrics, thresholds: EvaluationThresholds) -> GateResult:
    comparisons = (
        (metrics.recall_at_k >= thresholds.min_recall_at_k, "recall_at_k below minimum"),
        (metrics.mrr >= thresholds.min_mrr, "mrr below minimum"),
        (metrics.ndcg_at_k >= thresholds.min_ndcg_at_k, "ndcg_at_k below minimum"),
        (
            metrics.citation_precision >= thresholds.min_citation_precision,
            "citation_precision below minimum",
        ),
        (
            metrics.no_evidence_accuracy >= thresholds.min_no_evidence_accuracy,
            "no_evidence_accuracy below minimum",
        ),
        (
            metrics.unauthorized_candidate_count <= thresholds.max_unauthorized_candidate_count,
            "unauthorized_candidate_count above maximum",
        ),
    )
    failures = [message for passed, message in comparisons if not passed]
    return GateResult(passed=not failures, failures=failures)


def run_keyword_baseline(dataset: EvaluationDataset) -> dict[str, list[UUID]]:
    load_all_models()
    engine = build_engine("sqlite+pysqlite:///:memory:")
    try:
        Base.metadata.create_all(engine)
        with Session(engine) as database, database.begin():
            database.add_all(
                Workspace(
                    id=workspace.id,
                    slug=workspace.slug,
                    name=workspace.name,
                    kind=workspace.kind,
                )
                for workspace in dataset.workspaces
            )
            database.add_all(
                User(
                    id=user.id,
                    email=user.email,
                    display_name=user.display_name,
                    password_hash="evaluation-only-not-a-real-password",
                )
                for user in dataset.users
            )
            database.flush()
            database.add_all(
                Memory(
                    id=memory.id,
                    workspace_id=memory.workspace_id,
                    author_id=memory.author_id,
                    title=memory.title,
                    body=memory.body,
                    visibility=memory.visibility,
                    timeline_entry_id=memory.id,
                    timeline_visible=memory.timeline_visible,
                    revision_kind="ROOT",
                    created_at=memory.created_at,
                    shared_at=(memory.created_at if memory.visibility == "WORKSPACE" else None),
                    deleted_at=memory.deleted_at,
                )
                for memory in dataset.memories
            )

        users = {user.id: user for user in dataset.users}
        rankings: dict[str, list[UUID]] = {}
        with Session(engine) as database:
            for case in dataset.cases:
                user = users[case.principal_user_id]
                principal = Principal(
                    user_id=user.id,
                    workspace_id=case.workspace_id,
                    email=user.email,
                    display_name=user.display_name,
                    role=case.role,
                )
                results = keyword_search(
                    database,
                    principal,
                    case.query,
                    author_id=case.author_id,
                    visibility=case.visibility,
                    created_from=case.created_from,
                    created_to=case.created_to,
                    search_field=case.search_field,
                    limit=case.limit,
                )
                rankings[case.id] = [result.memory.id for result in results]
        return rankings
    finally:
        engine.dispose()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the deterministic Memora retrieval evaluation"
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        default=Path("evaluation/retrieval/v1.json"),
    )
    parser.add_argument("--thresholds", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--enforce", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    dataset = load_dataset(args.dataset)
    thresholds = load_thresholds(args.thresholds) if args.thresholds else None
    if args.enforce and thresholds is None:
        raise SystemExit("--enforce requires --thresholds")
    rankings = run_keyword_baseline(dataset)
    report = evaluate_rankings(
        dataset,
        rankings,
        algorithm="authorized-icontains-keyword-v1",
        thresholds=thresholds,
    )
    serialized = json.dumps(report.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
    else:
        print(serialized, end="")
    print(
        "retrieval evaluation: "
        f"recall@k={report.metrics.recall_at_k:.3f} "
        f"mrr={report.metrics.mrr:.3f} "
        f"ndcg@k={report.metrics.ndcg_at_k:.3f} "
        f"citation_precision={report.metrics.citation_precision:.3f} "
        f"no_evidence_accuracy={report.metrics.no_evidence_accuracy:.3f} "
        f"unauthorized={report.metrics.unauthorized_candidate_count}"
    )
    if args.enforce and report.gates and not report.gates.passed:
        for failure in report.gates.failures:
            print(f"gate failed: {failure}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
