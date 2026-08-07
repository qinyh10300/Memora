import json

import pytest
from pydantic import SecretStr

from memora.ai.model_registry import AIModelSpec, available_ai_models
from memora.ai.router import ModelRoutingError, model_timeout_seconds, route_ai_models
from memora.settings import Settings


def _models() -> list[dict[str, object]]:
    return [
        {
            "id": "gpt",
            "label": "GPT",
            "provider_model": "gpt-5.6-terra",
            "capabilities": ["chat", "tools"],
            "provider_family": "gpt",
            "cost_tier": "premium",
            "priority": 20,
            "timeout_seconds": 80,
            "fallback_ids": ["gemini"],
            "default": True,
        },
        {
            "id": "claude",
            "label": "Claude",
            "provider_model": "claude-sonnet-4-6",
            "capabilities": ["chat", "vision", "tools"],
            "cost_tier": "balanced",
            "priority": 10,
            "timeout_seconds": 45,
        },
        {
            "id": "gemini",
            "label": "Gemini",
            "provider_model": "gemini-3.1-pro-preview",
            "capabilities": ["chat", "vision", "web_search", "tools"],
            "cost_tier": "economy",
            "priority": 5,
            "timeout_seconds": 30,
        },
    ]


def _configured_models() -> list[AIModelSpec]:
    settings = Settings(
        app_env="test",
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="model-router-test-secret",
        ai_chat_api_key=SecretStr("test-key"),
        ai_model_registry_json=json.dumps(_models()),
    )
    return available_ai_models(settings)


def test_model_router_respects_explicit_choice_and_declared_fallbacks() -> None:
    models = _configured_models()
    claude = route_ai_models(
        models,
        required_capabilities=frozenset({"chat", "vision"}),
        preferred_model_id="claude",
    )
    fallback = route_ai_models(
        models,
        required_capabilities=frozenset({"chat", "vision", "web_search"}),
        preferred_model_id="gpt",
    )

    assert [model.id for model in claude.candidates] == ["claude"]
    assert [model.id for model in fallback.candidates] == ["gemini"]
    assert [(item.model_id, item.code) for item in fallback.rejections] == [
        ("gpt", "missing_capability")
    ]


def test_model_router_applies_cost_priority_and_timeout_budgets() -> None:
    models = _configured_models()
    economical = route_ai_models(
        models,
        required_capabilities=frozenset({"chat"}),
        preferred_model_id=None,
        max_cost_tier="balanced",
        timeout_budget_seconds=40,
    )

    assert [model.id for model in economical.candidates] == ["gemini"]
    assert {(item.model_id, item.code) for item in economical.rejections} == {
        ("gpt", "cost_budget_exceeded"),
        ("claude", "timeout_budget_exceeded"),
    }
    assert model_timeout_seconds(economical.candidates[0], default_timeout_seconds=60) == 30


def test_model_registry_rejects_unknown_fallback_and_router_rejects_unknown_choice() -> None:
    invalid = _models()
    assert isinstance(invalid[0], dict)
    invalid[0]["fallback_ids"] = ["missing"]
    settings = Settings(
        app_env="test",
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="model-router-test-secret",
        ai_chat_api_key=SecretStr("test-key"),
        ai_model_registry_json=json.dumps(invalid),
    )

    with pytest.raises(ValueError, match="unknown fallback"):
        available_ai_models(settings)
    with pytest.raises(ModelRoutingError, match="preferred_model_unavailable"):
        route_ai_models(
            _configured_models(),
            required_capabilities=frozenset({"chat"}),
            preferred_model_id="missing",
        )


def test_legacy_model_registry_defaults_remain_backward_compatible() -> None:
    settings = Settings(
        app_env="test",
        database_url="sqlite+pysqlite:///:memory:",
        session_secret="model-router-test-secret",
        ai_chat_api_key=SecretStr("test-key"),
        ai_chat_model="gpt-5.6-terra",
    )

    model = available_ai_models(settings)[0]
    assert model.id == "default"
    assert model.provider_family == "gpt"
    assert model.cost_tier == "balanced"
    assert model.timeout_seconds is None
    assert model.fallback_ids == ()
