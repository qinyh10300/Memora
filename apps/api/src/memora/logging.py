import logging
import sys
from collections.abc import Mapping, MutableMapping
from typing import Any, cast

import structlog

_SENSITIVE_LOG_KEYS = {
    "api_key",
    "authorization",
    "body",
    "content",
    "cookie",
    "document_text",
    "filename",
    "markdown",
    "password",
    "pdf_text",
    "prompt",
    "query",
    "raw_body",
    "session",
    "session_token",
    "token",
}


def _is_sensitive_log_key(key: str) -> bool:
    normalized = key.casefold()
    return (
        normalized in _SENSITIVE_LOG_KEYS
        or "password" in normalized
        or "secret" in normalized
        or "authorization" in normalized
        or normalized.endswith("_api_key")
        or normalized.endswith("_cookie")
        or normalized.endswith("_session_token")
    )


def _redact_log_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): "[REDACTED]" if _is_sensitive_log_key(str(key)) else _redact_log_value(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_log_value(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_redact_log_value(item) for item in value)
    return value


def redact_sensitive_values(
    _logger: Any,
    _method_name: str,
    event_dict: MutableMapping[str, Any],
) -> Mapping[str, Any]:
    return cast(dict[str, Any], _redact_log_value(dict(event_dict)))


def configure_logging(*, level: str, json_logs: bool) -> None:
    processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        redact_sensitive_values,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
    ]

    renderer: structlog.types.Processor
    if json_logs:
        renderer = structlog.processors.JSONRenderer()
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=sys.stderr.isatty())

    logging.basicConfig(format="%(message)s", level=level.upper(), stream=sys.stdout)
    structlog.configure(
        processors=[*processors, renderer],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelNamesMapping().get(level.upper(), logging.INFO)
        ),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=True,
    )
