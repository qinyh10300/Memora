from __future__ import annotations

import json
import math
import re
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from threading import Lock
from time import perf_counter
from typing import Any, Literal, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

import structlog
from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from memora.settings import Settings

MetricKind = Literal["counter", "gauge", "histogram"]
LabelSet = tuple[tuple[str, str], ...]
MetricKey = tuple[str, LabelSet]

_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$")
_LABEL_VALUE_PATTERN = re.compile(r"[^A-Za-z0-9._:/-]+")
_request_id_context: ContextVar[str | None] = ContextVar("request_id", default=None)
_execution_id_context: ContextVar[str | None] = ContextVar("execution_id", default=None)


@dataclass(frozen=True)
class MetricDefinition:
    kind: MetricKind
    help: str
    labels: tuple[str, ...]
    buckets: tuple[float, ...] = ()


@dataclass
class HistogramValue:
    counts: list[int]
    total: int = 0
    total_sum: float = 0.0


METRIC_DEFINITIONS: dict[str, MetricDefinition] = {
    "memora_http_requests_total": MetricDefinition(
        "counter",
        "Completed HTTP requests.",
        ("method", "route", "status"),
    ),
    "memora_http_request_duration_seconds": MetricDefinition(
        "histogram",
        "HTTP request duration in seconds.",
        ("method", "route"),
        (0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 15.0, 60.0),
    ),
    "memora_ai_requests_total": MetricDefinition(
        "counter",
        "OpenAI-compatible provider requests.",
        ("operation", "model", "outcome"),
    ),
    "memora_ai_request_duration_seconds": MetricDefinition(
        "histogram",
        "OpenAI-compatible provider request duration in seconds.",
        ("operation", "model"),
        (0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 15.0, 30.0, 60.0, 120.0, 300.0),
    ),
    "memora_ai_tokens_total": MetricDefinition(
        "counter",
        "Provider-reported AI tokens.",
        ("operation", "model", "direction"),
    ),
    "memora_ai_estimated_cost_usd_total": MetricDefinition(
        "counter",
        "Estimated AI cost in USD using operator-configured prices.",
        ("operation", "model", "pricing"),
    ),
    "memora_ai_cost_estimate_unavailable_total": MetricDefinition(
        "counter",
        "AI responses without configured model pricing.",
        ("operation", "model"),
    ),
    "memora_agent_tool_executions_total": MetricDefinition(
        "counter",
        "Agent tool executions by public status.",
        ("tool", "status"),
    ),
    "memora_agent_tool_duration_seconds": MetricDefinition(
        "histogram",
        "Agent tool execution duration in seconds.",
        ("tool", "status"),
        (0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 15.0, 30.0, 90.0),
    ),
    "memora_document_parse_jobs": MetricDefinition(
        "gauge",
        "Document parse jobs by status.",
        ("status",),
    ),
    "memora_document_embedding_chunks": MetricDefinition(
        "gauge",
        "Document chunks by embedding status.",
        ("status",),
    ),
    "memora_memory_embedding_jobs": MetricDefinition(
        "gauge",
        "Memory embedding jobs by status.",
        ("status",),
    ),
    "memora_retrieval_candidates": MetricDefinition(
        "histogram",
        "Authorized retrieval candidate counts.",
        ("stage",),
        (0.0, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0, 200.0),
    ),
    "memora_retrieval_requests_total": MetricDefinition(
        "counter",
        "Retrieval requests by semantic and reranker outcome.",
        ("semantic_status", "reranker_status"),
    ),
    "memora_retrieval_duration_seconds": MetricDefinition(
        "histogram",
        "Authorized retrieval request duration in seconds.",
        (),
        (0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 15.0),
    ),
    "memora_worker_iterations_total": MetricDefinition(
        "counter",
        "Worker iterations by selected job kind and outcome.",
        ("job_kind", "outcome"),
    ),
    "memora_worker_iteration_duration_seconds": MetricDefinition(
        "histogram",
        "Worker iteration duration in seconds.",
        ("job_kind",),
        (0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 15.0, 30.0, 120.0, 600.0),
    ),
    "memora_client_errors_total": MetricDefinition(
        "counter",
        "Sanitized frontend error reports.",
        ("surface", "error_type"),
    ),
    "memora_observability_sink_deliveries_total": MetricDefinition(
        "counter",
        "External observability event deliveries.",
        ("outcome",),
    ),
    "memora_metrics_collection_errors_total": MetricDefinition(
        "counter",
        "Failures while refreshing database-backed metrics.",
        ("collector",),
    ),
}


def _safe_label_value(value: str) -> str:
    normalized = _LABEL_VALUE_PATTERN.sub("_", value.strip())[:120]
    return normalized or "unknown"


def _render_number(value: float | int) -> str:
    if isinstance(value, int) or value.is_integer():
        return str(int(value))
    return format(value, ".12g")


def _render_labels(labels: LabelSet) -> str:
    if not labels:
        return ""
    rendered = ",".join(
        f'{key}="{value.replace(chr(92), chr(92) * 2).replace(chr(34), chr(92) + chr(34))}"'
        for key, value in labels
    )
    return f"{{{rendered}}}"


class MetricsRegistry:
    def __init__(self, definitions: Mapping[str, MetricDefinition]) -> None:
        self._definitions = dict(definitions)
        self._counters: dict[MetricKey, float] = {}
        self._gauges: dict[MetricKey, float] = {}
        self._histograms: dict[MetricKey, HistogramValue] = {}
        self._lock = Lock()

    def _key(self, name: str, labels: Mapping[str, str]) -> MetricKey:
        definition = self._definitions[name]
        if set(labels) != set(definition.labels):
            raise ValueError(f"metric {name} requires labels {definition.labels}")
        normalized = tuple((key, _safe_label_value(labels[key])) for key in definition.labels)
        return name, normalized

    def increment(
        self,
        name: str,
        *,
        labels: Mapping[str, str],
        amount: float = 1.0,
    ) -> None:
        definition = self._definitions[name]
        if definition.kind != "counter" or not math.isfinite(amount) or amount < 0:
            raise ValueError(f"invalid counter update for {name}")
        key = self._key(name, labels)
        with self._lock:
            self._counters[key] = self._counters.get(key, 0.0) + amount

    def set_gauge(self, name: str, *, labels: Mapping[str, str], value: float) -> None:
        definition = self._definitions[name]
        if definition.kind != "gauge" or not math.isfinite(value):
            raise ValueError(f"invalid gauge update for {name}")
        key = self._key(name, labels)
        with self._lock:
            self._gauges[key] = value

    def observe(self, name: str, *, labels: Mapping[str, str], value: float) -> None:
        definition = self._definitions[name]
        if definition.kind != "histogram" or not math.isfinite(value) or value < 0:
            raise ValueError(f"invalid histogram observation for {name}")
        key = self._key(name, labels)
        with self._lock:
            histogram = self._histograms.setdefault(
                key,
                HistogramValue(counts=[0 for _ in definition.buckets]),
            )
            for index, bucket in enumerate(definition.buckets):
                if value <= bucket:
                    histogram.counts[index] += 1
            histogram.total += 1
            histogram.total_sum += value

    def render_prometheus(self) -> str:
        lines: list[str] = []
        with self._lock:
            counters = dict(self._counters)
            gauges = dict(self._gauges)
            histograms = {
                key: HistogramValue(
                    counts=list(value.counts),
                    total=value.total,
                    total_sum=value.total_sum,
                )
                for key, value in self._histograms.items()
            }
        for name, definition in self._definitions.items():
            lines.extend((f"# HELP {name} {definition.help}", f"# TYPE {name} {definition.kind}"))
            if definition.kind == "counter":
                for (metric_name, labels), counter_value in sorted(counters.items()):
                    if metric_name != name:
                        continue
                    lines.append(f"{name}{_render_labels(labels)} {_render_number(counter_value)}")
            elif definition.kind == "gauge":
                for (metric_name, labels), gauge_value in sorted(gauges.items()):
                    if metric_name != name:
                        continue
                    lines.append(f"{name}{_render_labels(labels)} {_render_number(gauge_value)}")
            else:
                for (metric_name, labels), histogram in sorted(histograms.items()):
                    if metric_name != name:
                        continue
                    for bucket, count in zip(definition.buckets, histogram.counts, strict=True):
                        bucket_labels = (*labels, ("le", _render_number(bucket)))
                        lines.append(f"{name}_bucket{_render_labels(bucket_labels)} {count}")
                    infinite_labels = (*labels, ("le", "+Inf"))
                    lines.append(
                        f"{name}_bucket{_render_labels(infinite_labels)} {histogram.total}"
                    )
                    rendered_sum = _render_number(histogram.total_sum)
                    lines.append(f"{name}_sum{_render_labels(labels)} {rendered_sum}")
                    lines.append(f"{name}_count{_render_labels(labels)} {histogram.total}")
        return "\n".join(lines) + "\n"

    def reset(self) -> None:
        with self._lock:
            self._counters.clear()
            self._gauges.clear()
            self._histograms.clear()


metrics = MetricsRegistry(METRIC_DEFINITIONS)


def new_request_id(*, prefix: str | None = None) -> str:
    identifier = uuid4().hex
    return f"{prefix}-{identifier}" if prefix else identifier


def normalize_request_id(candidate: str | None) -> str:
    if candidate is not None and _REQUEST_ID_PATTERN.fullmatch(candidate):
        return candidate
    return new_request_id()


def current_request_id() -> str | None:
    return _request_id_context.get()


def current_execution_id() -> str | None:
    return _execution_id_context.get()


def current_trace_headers() -> dict[str, str]:
    headers: dict[str, str] = {}
    request_id = current_request_id()
    execution_id = current_execution_id()
    if request_id is not None:
        headers["X-Request-ID"] = request_id
    if execution_id is not None:
        headers["X-Agent-Execution-ID"] = execution_id
    return headers


@contextmanager
def observability_context(
    *,
    request_id: str,
    execution_id: str | None = None,
) -> Iterator[None]:
    request_token = _request_id_context.set(request_id)
    execution_token = _execution_id_context.set(execution_id)
    values = {"request_id": request_id}
    if execution_id is not None:
        values["execution_id"] = execution_id
    structlog_tokens = structlog.contextvars.bind_contextvars(**values)
    try:
        yield
    finally:
        structlog.contextvars.reset_contextvars(**structlog_tokens)
        _execution_id_context.reset(execution_token)
        _request_id_context.reset(request_token)


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self._logger = structlog.get_logger("memora.http")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = normalize_request_id(Headers(scope=scope).get("x-request-id"))
        state = scope.setdefault("state", {})
        state["request_id"] = request_id
        method = str(scope.get("method", "UNKNOWN")).upper()
        status_code = 500
        started_at = perf_counter()

        async def send_with_request_id(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message["status"])
                response_headers = MutableHeaders(scope=message)
                response_headers["X-Request-ID"] = request_id
            await send(message)

        with observability_context(request_id=request_id):
            try:
                await self.app(scope, receive, send_with_request_id)
            finally:
                route = getattr(scope.get("route"), "path", None)
                route_label = route if isinstance(route, str) else "__unmatched__"
                duration_seconds = max(0.0, perf_counter() - started_at)
                metrics.increment(
                    "memora_http_requests_total",
                    labels={
                        "method": method,
                        "route": route_label,
                        "status": str(status_code),
                    },
                )
                metrics.observe(
                    "memora_http_request_duration_seconds",
                    labels={"method": method, "route": route_label},
                    value=duration_seconds,
                )
                self._logger.info(
                    "http.request_completed",
                    method=method,
                    route=route_label,
                    status_code=status_code,
                    duration_ms=round(duration_seconds * 1000, 2),
                )


@dataclass(frozen=True)
class ModelPricing:
    input_usd_per_million: float
    output_usd_per_million: float


def parse_model_pricing(raw_json: str) -> dict[str, ModelPricing]:
    if not raw_json.strip():
        return {}
    try:
        decoded = json.loads(raw_json)
    except json.JSONDecodeError:
        return {}
    if not isinstance(decoded, dict):
        return {}
    parsed: dict[str, ModelPricing] = {}
    for raw_model, raw_prices in decoded.items():
        if not isinstance(raw_model, str) or not raw_model.strip() or len(raw_model) > 160:
            continue
        if not isinstance(raw_prices, dict):
            continue
        input_price = raw_prices.get("input_usd_per_million")
        output_price = raw_prices.get("output_usd_per_million")
        if not isinstance(input_price, int | float) or not isinstance(output_price, int | float):
            continue
        normalized_input = float(input_price)
        normalized_output = float(output_price)
        if not all(
            math.isfinite(value) and 0 <= value <= 100_000
            for value in (normalized_input, normalized_output)
        ):
            continue
        parsed[raw_model.strip()] = ModelPricing(
            input_usd_per_million=normalized_input,
            output_usd_per_million=normalized_output,
        )
    return parsed


def record_ai_usage(
    *,
    operation: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    pricing: Mapping[str, ModelPricing],
) -> None:
    normalized_input = max(0, input_tokens)
    normalized_output = max(0, output_tokens)
    metrics.increment(
        "memora_ai_tokens_total",
        labels={"operation": operation, "model": model, "direction": "input"},
        amount=float(normalized_input),
    )
    metrics.increment(
        "memora_ai_tokens_total",
        labels={"operation": operation, "model": model, "direction": "output"},
        amount=float(normalized_output),
    )
    price = pricing.get(model)
    if price is None:
        metrics.increment(
            "memora_ai_estimated_cost_usd_total",
            labels={"operation": operation, "model": model, "pricing": "unconfigured"},
            amount=0,
        )
        metrics.increment(
            "memora_ai_cost_estimate_unavailable_total",
            labels={"operation": operation, "model": model},
        )
        return
    estimated_cost = (
        normalized_input * price.input_usd_per_million
        + normalized_output * price.output_usd_per_million
    ) / 1_000_000
    metrics.increment(
        "memora_ai_estimated_cost_usd_total",
        labels={"operation": operation, "model": model, "pricing": "configured"},
        amount=estimated_cost,
    )


class ObservabilityEventSink(Protocol):
    def send(self, event: Mapping[str, str | int | float | bool | None]) -> bool: ...


@dataclass(frozen=True)
class NullObservabilityEventSink:
    def send(self, event: Mapping[str, str | int | float | bool | None]) -> bool:
        del event
        return True


@dataclass(frozen=True)
class HttpObservabilityEventSink:
    url: str
    token: str
    timeout_seconds: float
    _logger: Any = field(
        default_factory=lambda: structlog.get_logger("memora.observability.sink"),
        compare=False,
        repr=False,
    )

    def send(self, event: Mapping[str, str | int | float | bool | None]) -> bool:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = Request(
            self.url,
            data=json.dumps(dict(event), ensure_ascii=True).encode(),
            headers=headers,
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                delivered = 200 <= int(response.status) < 300
        except (HTTPError, URLError, TimeoutError, OSError):
            delivered = False
        outcome = "success" if delivered else "failed"
        metrics.increment(
            "memora_observability_sink_deliveries_total",
            labels={"outcome": outcome},
        )
        if not delivered:
            self._logger.warning("observability.sink_delivery_failed")
        return delivered


def build_observability_event_sink(settings: Settings) -> ObservabilityEventSink:
    url = settings.observability_sink_url.strip()
    if not url:
        return NullObservabilityEventSink()
    return HttpObservabilityEventSink(
        url=url,
        token=settings.observability_sink_token.get_secret_value(),
        timeout_seconds=settings.observability_sink_timeout_seconds,
    )
