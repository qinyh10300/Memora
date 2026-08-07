import json
import re
from dataclasses import dataclass, replace
from math import isfinite
from typing import Literal, cast

from memora.settings import Settings

ModelCapability = Literal["chat", "vision", "web_search", "tools"]
ModelCostTier = Literal["economy", "balanced", "premium"]
ModelProviderFamily = Literal["gpt", "claude", "gemini", "other"]
ModelPlanCode = Literal["PLUS", "PRO", "ULTRA"]
ModelBadge = Literal["BEST", "NEW"]
_VALID_CAPABILITIES = {"chat", "vision", "web_search", "tools"}
_VALID_COST_TIERS = {"economy", "balanced", "premium"}
_VALID_PROVIDER_FAMILIES = {"gpt", "claude", "gemini", "other"}
_VALID_PLAN_CODES = {"PLUS", "PRO", "ULTRA"}
_VALID_BADGES = {"BEST", "NEW"}
_MODEL_ID_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$")


@dataclass(frozen=True)
class AIModelSpec:
    id: str
    label: str
    provider_model: str
    capabilities: tuple[ModelCapability, ...]
    is_default: bool = False
    provider_family: ModelProviderFamily = "other"
    cost_tier: ModelCostTier = "balanced"
    priority: int = 100
    timeout_seconds: float | None = None
    fallback_ids: tuple[str, ...] = ()
    description: str = ""
    min_plan: ModelPlanCode = "PLUS"
    badges: tuple[ModelBadge, ...] = ()


def _provider_family_for(model: str) -> ModelProviderFamily:
    normalized = model.casefold()
    if "claude" in normalized:
        return "claude"
    if "gemini" in normalized:
        return "gemini"
    if "gpt" in normalized or normalized.startswith(("o1", "o3", "o4")):
        return "gpt"
    return "other"


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
    raw_provider_family = raw.get("provider_family")
    raw_cost_tier = raw.get("cost_tier", "balanced")
    raw_priority = raw.get("priority", index)
    raw_timeout = raw.get("timeout_seconds")
    raw_fallback_ids = raw.get("fallback_ids", [])
    raw_description = raw.get("description", "")
    raw_min_plan = raw.get("min_plan", "PLUS")
    raw_badges = raw.get("badges", [])
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
    if raw_provider_family is None:
        provider_family = _provider_family_for(provider_model)
    elif (
        not isinstance(raw_provider_family, str)
        or raw_provider_family not in _VALID_PROVIDER_FAMILIES
    ):
        raise ValueError(f"AI_MODEL_REGISTRY_JSON item {index} has an invalid provider_family")
    else:
        provider_family = cast(ModelProviderFamily, raw_provider_family)
    if not isinstance(raw_cost_tier, str) or raw_cost_tier not in _VALID_COST_TIERS:
        raise ValueError(f"AI_MODEL_REGISTRY_JSON item {index} has an invalid cost_tier")
    if not isinstance(raw_priority, int) or isinstance(raw_priority, bool) or raw_priority < 0:
        raise ValueError(f"AI_MODEL_REGISTRY_JSON item {index} has an invalid priority")
    if raw_timeout is not None and (
        not isinstance(raw_timeout, (int, float))
        or isinstance(raw_timeout, bool)
        or not isfinite(float(raw_timeout))
        or not 0 < float(raw_timeout) <= 300
    ):
        raise ValueError(f"AI_MODEL_REGISTRY_JSON item {index} has an invalid timeout_seconds")
    if not isinstance(raw_fallback_ids, list) or any(
        not isinstance(fallback_id, str)
        or not _MODEL_ID_PATTERN.fullmatch(fallback_id)
        or fallback_id == model_id
        for fallback_id in raw_fallback_ids
    ):
        raise ValueError(f"AI_MODEL_REGISTRY_JSON item {index} has invalid fallback_ids")
    if len(set(raw_fallback_ids)) != len(raw_fallback_ids):
        raise ValueError(f"AI_MODEL_REGISTRY_JSON item {index} has duplicate fallback_ids")
    if not isinstance(raw_description, str) or len(raw_description) > 160:
        raise ValueError(f"AI_MODEL_REGISTRY_JSON item {index} has an invalid description")
    if not isinstance(raw_min_plan, str) or raw_min_plan not in _VALID_PLAN_CODES:
        raise ValueError(f"AI_MODEL_REGISTRY_JSON item {index} has an invalid min_plan")
    if (
        not isinstance(raw_badges, list)
        or any(not isinstance(badge, str) or badge not in _VALID_BADGES for badge in raw_badges)
        or len(set(raw_badges)) != len(raw_badges)
    ):
        raise ValueError(f"AI_MODEL_REGISTRY_JSON item {index} has invalid badges")
    return AIModelSpec(
        id=model_id,
        label=label.strip(),
        provider_model=provider_model.strip(),
        capabilities=tuple(normalized_capabilities),
        is_default=bool(raw.get("default", False)),
        provider_family=provider_family,
        cost_tier=cast(ModelCostTier, raw_cost_tier),
        priority=raw_priority,
        timeout_seconds=float(raw_timeout) if raw_timeout is not None else None,
        fallback_ids=tuple(raw_fallback_ids),
        description=raw_description.strip(),
        min_plan=cast(ModelPlanCode, raw_min_plan),
        badges=tuple(cast(ModelBadge, badge) for badge in raw_badges),
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
                provider_family=_provider_family_for(legacy_model),
            )
        ]

    if not any(model.is_default for model in models):
        models[0] = replace(models[0], is_default=True)
    seen_ids: set[str] = set()
    for model in models:
        if model.id in seen_ids:
            raise ValueError("AI_MODEL_REGISTRY_JSON contains duplicate model ids")
        seen_ids.add(model.id)
    for model in models:
        if any(fallback_id not in seen_ids for fallback_id in model.fallback_ids):
            raise ValueError("AI_MODEL_REGISTRY_JSON contains an unknown fallback model id")
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


def model_plan_allows(current_plan: str, required_plan: ModelPlanCode) -> bool:
    ranks = {"PLUS": 0, "PRO": 1, "ULTRA": 2}
    if current_plan not in _VALID_PLAN_CODES:
        return False
    return ranks[cast(ModelPlanCode, current_plan)] >= ranks[required_plan]
