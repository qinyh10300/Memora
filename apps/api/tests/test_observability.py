from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from fastapi.testclient import TestClient
from pydantic import SecretStr

from memora.ai.openai_compatible import OpenAICompatibleChatModel
from memora.ai.ports import ChatMessage
from memora.database import Base
from memora.logging import redact_sensitive_values
from memora.main import create_app
from memora.observability import (
    ModelPricing,
    ObservabilityEventSink,
    current_trace_headers,
    metrics,
    normalize_request_id,
    observability_context,
    parse_model_pricing,
)
from memora.settings import Settings


class CapturingTransport:
    def __init__(self) -> None:
        self.headers: dict[str, str] = {}

    def post(
        self,
        url: str,
        *,
        headers: dict[str, str],
        payload: dict[str, object],
        timeout: float,
    ) -> dict[str, Any]:
        del url, payload, timeout
        self.headers = headers
        return {
            "choices": [{"message": {"role": "assistant", "content": "完成"}}],
            "model": "observed-model",
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        }


class CapturingSink(ObservabilityEventSink):
    def __init__(self) -> None:
        self.events: list[dict[str, str | int | float | bool | None]] = []

    def send(self, event: Mapping[str, str | int | float | bool | None]) -> bool:
        self.events.append(dict(event))
        return True


def test_observability_context_propagates_only_safe_trace_headers() -> None:
    assert normalize_request_id("valid-request.123") == "valid-request.123"
    assert normalize_request_id("invalid request with spaces") != "invalid request with spaces"

    with observability_context(request_id="request-123", execution_id="execution-456"):
        assert current_trace_headers() == {
            "X-Request-ID": "request-123",
            "X-Agent-Execution-ID": "execution-456",
        }

    assert current_trace_headers() == {}


def test_request_middleware_and_metrics_do_not_record_query_content() -> None:
    metrics.reset()
    metrics_token = "observability-metrics-token-for-tests"
    app = create_app(
        Settings(
            app_env="test",
            database_url="sqlite+pysqlite:///:memory:",
            session_secret="observability-test-secret",
            metrics_enabled=True,
            metrics_token=SecretStr(metrics_token),
        )
    )
    with TestClient(app) as client:
        Base.metadata.create_all(app.state.engine)
        response = client.get(
            "/health?prompt=private-memory-content",
            headers={"X-Request-ID": "browser-request-123"},
        )
        invalid_response = client.get(
            "/health",
            headers={"X-Request-ID": "invalid request id"},
        )
        unauthorized_metric_response = client.get("/metrics")
        metric_response = client.get(
            "/metrics",
            headers={"Authorization": f"Bearer {metrics_token}"},
        )

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "browser-request-123"
    assert invalid_response.headers["X-Request-ID"] != "invalid request id"
    assert unauthorized_metric_response.status_code == 401
    assert unauthorized_metric_response.headers["www-authenticate"] == "Bearer"
    assert metric_response.status_code == 200
    assert metric_response.headers["content-type"].startswith("text/plain")
    assert 'memora_http_requests_total{method="GET",route="/health",status="200"} 2' in (
        metric_response.text
    )
    assert "memora_document_parse_jobs" in metric_response.text
    assert "private-memory-content" not in metric_response.text


def test_metrics_are_disabled_by_default() -> None:
    app = create_app(
        Settings(
            app_env="test",
            database_url="sqlite+pysqlite:///:memory:",
            session_secret="observability-disabled-metrics-test-secret",
        )
    )
    with TestClient(app) as client:
        Base.metadata.create_all(app.state.engine)
        response = client.get("/metrics")

    assert response.status_code == 404


def test_frontend_error_report_is_bounded_and_forwarded_without_message_or_stack() -> None:
    metrics.reset()
    app = create_app(
        Settings(
            app_env="test",
            database_url="sqlite+pysqlite:///:memory:",
            session_secret="client-error-test-secret",
        )
    )
    sink = CapturingSink()
    with TestClient(app) as client:
        app.state.observability_event_sink = sink
        response = client.post(
            "/client-errors",
            json={
                "surface": "workbench",
                "error_type": "ChunkLoadError",
                "digest": "nextjs-digest-123",
                "recovery_action": "reload",
            },
        )
        rejected = client.post(
            "/client-errors",
            json={
                "surface": "workbench",
                "error_type": "Error with private message",
                "recovery_action": "reload",
            },
        )

    assert response.status_code == 202
    assert rejected.status_code == 422
    assert sink.events == [
        {
            "event": "client.error_reported",
            "surface": "workbench",
            "error_type": "ChunkLoadError",
            "digest": "nextjs-digest-123",
            "recovery_action": "reload",
        }
    ]


def test_log_redaction_recurses_without_hiding_operational_token_counts() -> None:
    redacted = redact_sensitive_values(
        None,
        "info",
        {
            "event": "safe.event",
            "password": "private-password",
            "nested": {
                "authorization": "Bearer private-token",
                "input_tokens": 42,
                "content_type": "application/pdf",
            },
        },
    )

    assert redacted == {
        "event": "safe.event",
        "password": "[REDACTED]",
        "nested": {
            "authorization": "[REDACTED]",
            "input_tokens": 42,
            "content_type": "application/pdf",
        },
    }


def test_ai_adapter_propagates_trace_and_reports_tokens_and_configured_cost() -> None:
    metrics.reset()
    transport = CapturingTransport()
    model = OpenAICompatibleChatModel(
        base_url="https://relay.example/v1",
        api_key="test-key",
        model="observed-model",
        timeout_seconds=10,
        max_output_tokens=100,
        transport=transport,
        pricing={
            "observed-model": ModelPricing(
                input_usd_per_million=2,
                output_usd_per_million=4,
            )
        },
    )

    with observability_context(request_id="request-ai", execution_id="execution-ai"):
        result = model.complete([ChatMessage(role="user", content="private prompt")])

    rendered = metrics.render_prometheus()
    assert result.content == "完成"
    assert transport.headers["X-Request-ID"] == "request-ai"
    assert transport.headers["X-Agent-Execution-ID"] == "execution-ai"
    assert (
        'memora_ai_tokens_total{operation="chat",model="observed-model",direction="input"} 10'
        in (rendered)
    )
    assert (
        'memora_ai_estimated_cost_usd_total{operation="chat",model="observed-model",'
        'pricing="configured"} 4e-05'
    ) in rendered
    assert "private prompt" not in rendered


def test_model_pricing_parser_ignores_malformed_or_unbounded_values() -> None:
    parsed = parse_model_pricing(
        '{"valid":{"input_usd_per_million":1.5,"output_usd_per_million":4},'
        '"negative":{"input_usd_per_million":-1,"output_usd_per_million":2},'
        '"invalid":{"input_usd_per_million":"secret","output_usd_per_million":2}}'
    )

    assert parsed == {"valid": ModelPricing(input_usd_per_million=1.5, output_usd_per_million=4)}
    assert parse_model_pricing("not-json") == {}
