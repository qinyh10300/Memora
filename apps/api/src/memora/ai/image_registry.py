import json
import re
from dataclasses import dataclass, replace
from typing import Literal, cast

from memora.settings import Settings

ImagePlanCode = Literal["PLUS", "PRO", "ULTRA"]
ImageModelBadge = Literal["BEST", "NEW"]
_MODEL_ID_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$")
_PLAN_CODES = {"PLUS", "PRO", "ULTRA"}


@dataclass(frozen=True)
class ImageModelSpec:
    id: str
    label: str
    description: str
    provider_model: str | None
    min_plan: ImagePlanCode
    badge: ImageModelBadge | None = None
    is_default: bool = False

    @property
    def configured(self) -> bool:
        return bool(self.provider_model)


IMAGE_MODEL_CATALOG: tuple[ImageModelSpec, ...] = (
    ImageModelSpec(
        id="gpt-image-2",
        label="GPT Image 2",
        description="通用科研绘图与高质量视觉",
        provider_model=None,
        min_plan="PLUS",
        badge="BEST",
        is_default=True,
    ),
    ImageModelSpec(
        id="nano-banana",
        label="Nano Banana",
        description="快速生成与轻量迭代",
        provider_model=None,
        min_plan="PLUS",
    ),
    ImageModelSpec(
        id="nano-banana-2",
        label="Nano Banana 2",
        description="更稳定的文字与构图控制",
        provider_model=None,
        min_plan="PRO",
        badge="NEW",
    ),
    ImageModelSpec(
        id="nano-banana-pro",
        label="Nano Banana Pro",
        description="复杂科研视觉与高精度输出",
        provider_model=None,
        min_plan="ULTRA",
    ),
)


def _configured_provider_models(settings: Settings) -> dict[str, str]:
    configured = settings.ai_image_model_registry_json.strip()
    if not configured:
        return {}
    try:
        decoded = json.loads(configured)
    except json.JSONDecodeError as error:
        raise ValueError("AI_IMAGE_MODEL_REGISTRY_JSON must be valid JSON") from error
    if not isinstance(decoded, list):
        raise ValueError("AI_IMAGE_MODEL_REGISTRY_JSON must be a list")
    known_ids = {model.id for model in IMAGE_MODEL_CATALOG}
    provider_models: dict[str, str] = {}
    for index, raw in enumerate(decoded):
        if not isinstance(raw, dict):
            raise ValueError(f"AI_IMAGE_MODEL_REGISTRY_JSON item {index} must be an object")
        model_id = raw.get("id")
        provider_model = raw.get("provider_model")
        if (
            not isinstance(model_id, str)
            or not _MODEL_ID_PATTERN.fullmatch(model_id)
            or model_id not in known_ids
        ):
            raise ValueError(f"AI_IMAGE_MODEL_REGISTRY_JSON item {index} has an invalid id")
        if (
            not isinstance(provider_model, str)
            or not provider_model.strip()
            or len(provider_model) > 120
        ):
            raise ValueError(
                f"AI_IMAGE_MODEL_REGISTRY_JSON item {index} has an invalid provider_model"
            )
        if model_id in provider_models:
            raise ValueError("AI_IMAGE_MODEL_REGISTRY_JSON contains duplicate model ids")
        provider_models[model_id] = provider_model.strip()
    return provider_models


def available_image_models(settings: Settings) -> list[ImageModelSpec]:
    configured = _configured_provider_models(settings)
    return [
        replace(model, provider_model=configured.get(model.id)) for model in IMAGE_MODEL_CATALOG
    ]


def resolve_image_model(settings: Settings, model_id: str) -> ImageModelSpec | None:
    return next((model for model in available_image_models(settings) if model.id == model_id), None)


def image_plan_allows(current_plan: str, required_plan: ImagePlanCode) -> bool:
    ranks = {"PLUS": 0, "PRO": 1, "ULTRA": 2}
    if current_plan not in _PLAN_CODES:
        return False
    return ranks[cast(ImagePlanCode, current_plan)] >= ranks[required_plan]


def image_api_key(settings: Settings) -> str:
    dedicated = settings.ai_image_api_key.get_secret_value()
    if dedicated:
        return dedicated
    if settings.ai_image_base_url.rstrip("/") == settings.ai_chat_base_url.rstrip("/"):
        return settings.ai_chat_api_key.get_secret_value()
    return ""
