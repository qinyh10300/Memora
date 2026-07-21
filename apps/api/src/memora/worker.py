import argparse
import time
from collections.abc import Sequence

import structlog

from memora.logging import configure_logging
from memora.settings import Settings, get_settings


def run_once(settings: Settings) -> None:
    logger = structlog.get_logger("memora.worker")
    logger.info("worker.ready", app_env=settings.app_env, version=settings.app_version)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Memora background worker")
    parser.add_argument(
        "--once",
        action="store_true",
        help="run one health iteration and exit",
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

    if args.once:
        run_once(settings)
        return 0

    try:
        while True:
            run_once(settings)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
