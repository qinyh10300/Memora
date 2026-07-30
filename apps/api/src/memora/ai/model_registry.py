import json
import re
from dataclasses import dataclass
from typing import Literal, cast

from memora.settings import Settings

ModelCapability = Literal["chat", "vision", "web_search", "tools"]
_VALID_CAPABILITIES = {"chat", "vision", "web_search", "tools"}
_MODEL_ID_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$")


@dataclass(frozen=True)
class AIModelSpec:
    id: str
    label: str
    provider_model: str
    capabilities: tuple[ModelCapability, ...]
    is_default: bool = False


def _capabilities_for_legacy_model(
    model: str, web_search_enabled: bool
) -> tuple[ModelCapability, ...]:
    capabilities: list[ModelCapability] = ["chat", "tools"]
    normalized = model.lower()
    if any(marker in normalized for marker in ("gpt-4o", "gpt-5", "vision", "terra")):
        capabilities.append("vision")
    if web_search_enabled:
        capabilities.append("web_search")
    return tuple(capabilities)


def _validate_model_spec(raw: object, *, index: int) -> AIModelSpec:
    if not isinstance(raw, dict):
        raise ValueError(f"AI_MODEL_REGISTRY_JSON item {index} must be an object")
    model_id = raw.get("id")
    label = raw.get("label")
    provider_model = raw.get("provider_model")
    capabilities = raw.get("capabilities")
    if not isinstance(model_id, str) or not _MODEL_ID_PATTERN.fullmatch(model_id):
        raise ValueError(f"AI_MODEL_REGISTRY_JSON item {index} has an invalid id")
    if not isinstance(label, str) or not label.strip() or len(label) > 80:
        raise ValueError(f"AI_MODEL_REGISTRY_JSON item {index} has an invalid label")
    if (
        not isinstance(provider_model, str)
        or not provider_model.strip()
        or len(provider_model) > 120
    ):
        raise ValueError(f"AI_MODEL_REGISTRY_JSON item {index} has an invalid provider_model")
    if not isinstance(capabilities, list) or "chat" not in capabilities:
        raise ValueError(f"AI_MODEL_REGISTRY_JSON item {index} must include chat capability")
    normalized_capabilities: list[ModelCapability] = []
    for capability in capabilities:
        if not isinstance(capability, str) or capability not in _VALID_CAPABILITIES:
            raise ValueError(f"AI_MODEL_REGISTRY_JSON item {index} has an invalid capability")
        typed_capability = cast(ModelCapability, capability)
        if typed_capability not in normalized_capabilities:
            normalized_capabilities.append(typed_capability)
    return AIModelSpec(
        id=model_id,
        label=label.strip(),
        provider_model=provider_model.strip(),
        capabilities=tuple(normalized_capabilities),
        is_default=bool(raw.get("default", False)),
    )


def available_ai_models(settings: Settings) -> list[AIModelSpec]:
    configured = settings.ai_model_registry_json.strip()
    if configured:
        try:
            decoded = json.loads(configured)
        except json.JSONDecodeError as error:
            raise ValueError("AI_MODEL_REGISTRY_JSON must be valid JSON") from error
        if not isinstance(decoded, list) or not decoded:
            raise ValueError("AI_MODEL_REGISTRY_JSON must be a non-empty list")
        models = [_validate_model_spec(item, index=index) for index, item in enumerate(decoded)]
    else:
        legacy_model = settings.ai_chat_model.strip()
        if not legacy_model:
            return []
        models = [
            AIModelSpec(
                id="default",
                label=legacy_model,
                provider_model=legacy_model,
                capabilities=_capabilities_for_legacy_model(
                    legacy_model,
                    settings.ai_web_search_enabled,
                ),
                is_default=True,
            )
        ]

    if not any(model.is_default for model in models):
        first_model = models[0]
        models[0] = AIModelSpec(
            id=first_model.id,
            label=first_model.label,
            provider_model=first_model.provider_model,
            capabilities=first_model.capabilities,
            is_default=True,
        )
    seen_ids: set[str] = set()
    for model in models:
        if model.id in seen_ids:
            raise ValueError("AI_MODEL_REGISTRY_JSON contains duplicate model ids")
        seen_ids.add(model.id)
    return models


def default_ai_model(settings: Settings) -> AIModelSpec | None:
    models = available_ai_models(settings)
    return next((model for model in models if model.is_default), models[0] if models else None)


def resolve_ai_model(settings: Settings, model_id: str | None) -> AIModelSpec | None:
    models = available_ai_models(settings)
    if not models:
        return None
    if model_id is None:
        return next((model for model in models if model.is_default), models[0])
    return next((model for model in models if model.id == model_id), None)
