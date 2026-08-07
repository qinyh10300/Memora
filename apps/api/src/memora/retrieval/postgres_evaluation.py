from __future__ import annotations

import argparse
import json
from pathlib import Path
from uuid import UUID

from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

from memora.database import build_engine
from memora.identity.dependencies import Principal
from memora.identity.models import User
from memora.memories.models import Memory
from memora.model_registry import load_all_models
from memora.retrieval.evaluation import (
    EvaluationDataset,
    EvaluationReport,
    evaluate_rankings,
    load_dataset,
    load_thresholds,
)
from memora.retrieval.service import keyword_search
from memora.workspaces.models import Workspace


def _seed_dataset(connection: Connection, dataset: EvaluationDataset) -> None:
    with Session(bind=connection) as database:
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
        database.flush()


def run_postgres_evaluation(
    dataset: EvaluationDataset,
    database_url: str,
) -> dict[str, list[UUID]]:
    load_all_models()
    engine = build_engine(database_url)
    if engine.dialect.name != "postgresql":
        engine.dispose()
        raise ValueError("PostgreSQL retrieval evaluation requires a PostgreSQL database URL")
    try:
        with engine.connect() as connection:
            transaction = connection.begin()
            try:
                _seed_dataset(connection, dataset)
                users = {user.id: user for user in dataset.users}
                rankings: dict[str, list[UUID]] = {}
                with Session(bind=connection) as database:
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
                transaction.rollback()
    finally:
        engine.dispose()


def _serialize_report(report: EvaluationReport) -> str:
    return json.dumps(report.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run Memora retrieval evaluation against an isolated PostgreSQL database"
    )
    parser.add_argument("--database-url", required=True)
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
    report = evaluate_rankings(
        dataset,
        run_postgres_evaluation(dataset, args.database_url),
        algorithm="postgres-full-text-trigram-rrf-v1",
        thresholds=thresholds,
    )
    serialized = _serialize_report(report)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
    else:
        print(serialized, end="")
    print(
        "PostgreSQL retrieval evaluation: "
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
