import argparse
import time
from collections.abc import Sequence

import structlog
from sqlalchemy import Engine

from memora.ai.openai_compatible import build_embedding_model
from memora.ai.ports import EmbeddingModelPort
from memora.database import build_engine
from memora.jobs.embedding import process_next_embedding_job
from memora.logging import configure_logging
from memora.model_registry import load_all_models
from memora.settings import Settings, get_settings


def run_once(
    settings: Settings,
    engine: Engine,
    embedding_model: EmbeddingModelPort | None,
) -> bool:
    processed = process_next_embedding_job(engine, settings, embedding_model)
    structlog.get_logger("memora.worker").info(
        "worker.iteration",
        processed=processed,
        embedding_configured=embedding_model is not None,
        app_env=settings.app_env,
        version=settings.app_version,
    )
    return processed


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
