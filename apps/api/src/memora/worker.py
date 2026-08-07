import argparse
import time
from collections.abc import Sequence
from time import perf_counter

import structlog
from sqlalchemy import Engine

from memora.ai.openai_compatible import build_embedding_model
from memora.ai.ports import EmbeddingModelPort
from memora.database import build_engine
from memora.documents.worker import (
    process_next_document_embedding_batch,
    process_next_document_job,
)
from memora.jobs.embedding import process_next_embedding_job
from memora.logging import configure_logging
from memora.model_registry import load_all_models
from memora.observability import metrics, new_request_id, observability_context
from memora.reports.worker import process_due_report_subscription
from memora.settings import Settings, get_settings
from memora.visuals.worker import process_next_visual_job


def run_once(
    settings: Settings,
    engine: Engine,
    embedding_model: EmbeddingModelPort | None,
) -> bool:
    request_id = new_request_id(prefix="worker")
    started_at = perf_counter()
    job_kind = "document_parse"
    outcome = "failed"
    with observability_context(request_id=request_id):
        try:
            processed = process_next_document_job(engine, settings)
            if not processed:
                job_kind = "memory_embedding"
                processed = process_next_embedding_job(engine, settings, embedding_model)
            if not processed:
                job_kind = "document_embedding"
                processed = process_next_document_embedding_batch(engine, settings, embedding_model)
            if not processed:
                job_kind = "visual_generation"
                processed = process_next_visual_job(engine, settings)
            if not processed:
                job_kind = "scheduled_report"
                processed = process_due_report_subscription(engine, settings)
            if not processed:
                job_kind = "idle"
            outcome = "processed" if processed else "idle"
            return processed
        finally:
            duration_seconds = max(0.0, perf_counter() - started_at)
            metrics.increment(
                "memora_worker_iterations_total",
                labels={"job_kind": job_kind, "outcome": outcome},
            )
            metrics.observe(
                "memora_worker_iteration_duration_seconds",
                labels={"job_kind": job_kind},
                value=duration_seconds,
            )
            structlog.get_logger("memora.worker").info(
                "worker.iteration",
                processed=outcome == "processed",
                outcome=outcome,
                job_kind=job_kind,
                duration_ms=round(duration_seconds * 1000, 2),
                embedding_configured=embedding_model is not None,
                app_env=settings.app_env,
                version=settings.app_version,
            )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Memora background worker")
    parser.add_argument(
        "--once",
        action="store_true",
        help="process at most one job and exit",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=5.0,
        help="idle polling interval in seconds",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = get_settings()
    configure_logging(level=settings.log_level, json_logs=settings.app_env == "production")
    load_all_models()
    engine = build_engine(settings.database_url)
    embedding_model = build_embedding_model(settings)

    try:
        if args.once:
            run_once(settings, engine, embedding_model)
            return 0
        while True:
            processed = run_once(settings, engine, embedding_model)
            if not processed:
                time.sleep(args.interval)
    except KeyboardInterrupt:
        return 0
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
