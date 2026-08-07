from dataclasses import dataclass

from memora.ai.model_registry import AIModelSpec, ModelCapability, ModelCostTier

_COST_RANK: dict[ModelCostTier, int] = {
    "economy": 0,
    "balanced": 1,
    "premium": 2,
}


@dataclass(frozen=True)
class ModelRouteRejection:
    model_id: str
    code: str


@dataclass(frozen=True)
class ModelRoutePlan:
    candidates: tuple[AIModelSpec, ...]
    rejections: tuple[ModelRouteRejection, ...]

    @property
    def selected(self) -> AIModelSpec | None:
        return self.candidates[0] if self.candidates else None


class ModelRoutingError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def model_timeout_seconds(model: AIModelSpec, *, default_timeout_seconds: float) -> float:
    return model.timeout_seconds or default_timeout_seconds


def _preferred_order(models: list[AIModelSpec], preferred_model_id: str) -> list[AIModelSpec]:
    by_id = {model.id: model for model in models}
    preferred = by_id.get(preferred_model_id)
    if preferred is None:
        raise ModelRoutingError("preferred_model_unavailable")
    ordered: list[AIModelSpec] = []
    visited: set[str] = set()

    def visit(model: AIModelSpec) -> None:
        if model.id in visited:
            return
        visited.add(model.id)
        ordered.append(model)
        for fallback_id in model.fallback_ids:
            fallback = by_id.get(fallback_id)
            if fallback is not None:
                visit(fallback)

    visit(preferred)
    return ordered


def route_ai_models(
    models: list[AIModelSpec],
    *,
    required_capabilities: frozenset[ModelCapability],
    preferred_model_id: str | None,
    max_cost_tier: ModelCostTier = "premium",
    timeout_budget_seconds: float | None = None,
    default_timeout_seconds: float = 60,
) -> ModelRoutePlan:
    if preferred_model_id is not None:
        ordered = _preferred_order(models, preferred_model_id)
    else:
        ordered = sorted(
            models,
            key=lambda model: (
                not model.is_default,
                model.priority,
                _COST_RANK[model.cost_tier],
                model.id,
            ),
        )

    candidates: list[AIModelSpec] = []
    rejections: list[ModelRouteRejection] = []
    for model in ordered:
        if not required_capabilities.issubset(model.capabilities):
            rejections.append(ModelRouteRejection(model_id=model.id, code="missing_capability"))
            continue
        if _COST_RANK[model.cost_tier] > _COST_RANK[max_cost_tier]:
            rejections.append(ModelRouteRejection(model_id=model.id, code="cost_budget_exceeded"))
            continue
        timeout_seconds = model_timeout_seconds(
            model,
            default_timeout_seconds=default_timeout_seconds,
        )
        if timeout_budget_seconds is not None and timeout_seconds > timeout_budget_seconds:
            rejections.append(
                ModelRouteRejection(model_id=model.id, code="timeout_budget_exceeded")
            )
            continue
        candidates.append(model)
    return ModelRoutePlan(candidates=tuple(candidates), rejections=tuple(rejections))
