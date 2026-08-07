import math
from pathlib import Path
from uuid import UUID

import pytest
from pydantic import ValidationError

from memora.retrieval.evaluation import (
    EvaluationDataset,
    EvaluationThresholds,
    evaluate_rankings,
    load_dataset,
    run_keyword_baseline,
)

API_ROOT = Path(__file__).resolve().parents[1]
DATASET_PATH = API_ROOT / "evaluation" / "retrieval" / "v1.json"


def test_evaluation_metrics_score_rank_order_and_authorization() -> None:
    dataset = EvaluationDataset.model_validate(
        {
            "version": "unit",
            "description": "metric fixture",
            "users": [
                {
                    "id": "20000000-0000-0000-0000-000000000001",
                    "email": "alex@example.test",
                    "display_name": "Alex",
                }
            ],
            "workspaces": [
                {
                    "id": "10000000-0000-0000-0000-000000000001",
                    "slug": "unit",
                    "name": "Unit",
                }
            ],
            "memories": [
                {
                    "id": f"30000000-0000-0000-0000-{index:012d}",
                    "workspace_id": "10000000-0000-0000-0000-000000000001",
                    "author_id": "20000000-0000-0000-0000-000000000001",
                    "body": f"memory {index}",
                    "visibility": "PRIVATE",
                    "created_at": "2026-01-01T00:00:00Z",
                }
                for index in range(1, 5)
            ],
            "cases": [
                {
                    "id": "ranked",
                    "description": "ranked relevance",
                    "principal_user_id": "20000000-0000-0000-0000-000000000001",
                    "workspace_id": "10000000-0000-0000-0000-000000000001",
                    "expected_sources": [
                        {
                            "memory_id": "30000000-0000-0000-0000-000000000001",
                            "relevance": 3,
                        },
                        {
                            "memory_id": "30000000-0000-0000-0000-000000000002",
                            "relevance": 1,
                        },
                    ],
                    "forbidden_memory_ids": ["30000000-0000-0000-0000-000000000004"],
                },
                {
                    "id": "none",
                    "description": "no evidence",
                    "principal_user_id": "20000000-0000-0000-0000-000000000001",
                    "workspace_id": "10000000-0000-0000-0000-000000000001",
                    "expects_evidence": False,
                },
            ],
        }
    )
    rankings = {
        "ranked": [
            UUID("30000000-0000-0000-0000-000000000002"),
            UUID("30000000-0000-0000-0000-000000000003"),
            UUID("30000000-0000-0000-0000-000000000001"),
            UUID("30000000-0000-0000-0000-000000000004"),
        ],
        "none": [],
    }
    report = evaluate_rankings(
        dataset,
        rankings,
        algorithm="unit",
        thresholds=EvaluationThresholds(
            min_recall_at_k=1.0,
            min_mrr=1.0,
            min_ndcg_at_k=1.0,
            min_citation_precision=1.0,
            min_no_evidence_accuracy=1.0,
            max_unauthorized_candidate_count=0,
        ),
    )

    ranked = report.cases[0].metrics
    assert ranked.recall_at_k == 1.0
    assert ranked.reciprocal_rank == 1.0
    assert ranked.citation_precision == 0.5
    assert ranked.unauthorized_candidate_count == 1
    expected_ndcg = (1 / math.log2(2) + 7 / math.log2(4)) / (7 / math.log2(2) + 1 / math.log2(3))
    assert ranked.ndcg_at_k == pytest.approx(expected_ndcg)
    assert report.metrics.no_evidence_accuracy == 1.0
    assert report.metrics.unauthorized_candidate_count == 1
    assert report.gates is not None and not report.gates.passed
    assert report.gates.failures == [
        "ndcg_at_k below minimum",
        "citation_precision below minimum",
        "unauthorized_candidate_count above maximum",
    ]


def test_dataset_rejects_conflicting_expected_and_forbidden_sources() -> None:
    raw = load_dataset(DATASET_PATH).model_dump(mode="json")
    source_id = raw["cases"][0]["expected_sources"][0]["memory_id"]
    raw["cases"][0]["forbidden_memory_ids"] = [source_id]

    with pytest.raises(ValidationError, match="both expected and forbidden"):
        EvaluationDataset.model_validate(raw)


def test_versioned_dataset_runs_current_authorized_keyword_baseline() -> None:
    dataset = load_dataset(DATASET_PATH)
    rankings = run_keyword_baseline(dataset)
    report = evaluate_rankings(
        dataset,
        rankings,
        algorithm="authorized-icontains-keyword-v1",
        thresholds=EvaluationThresholds(
            min_recall_at_k=0.0,
            min_mrr=0.0,
            min_ndcg_at_k=0.0,
            min_citation_precision=0.0,
            min_no_evidence_accuracy=1.0,
            max_unauthorized_candidate_count=0,
        ),
    )

    assert report.metrics.case_count == 14
    assert report.metrics.evidence_case_count == 9
    assert report.metrics.no_evidence_case_count == 5
    assert report.metrics.unauthorized_candidate_count == 0
    assert report.metrics.no_evidence_accuracy == 1.0
    assert report.gates is not None and report.gates.passed
    cases = {case.id: case for case in report.cases}
    assert cases["chinese-synonym"].retrieved_memory_ids == []
    assert cases["latin-typo"].retrieved_memory_ids == []
    assert cases["other-user-private"].retrieved_memory_ids == []
