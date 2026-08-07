import json

import pytest

from memora.ai.image_registry import available_image_models, image_plan_allows
from memora.settings import Settings


def test_image_catalog_is_stable_and_configuration_only_adds_provider_ids() -> None:
    settings = Settings(
        ai_image_model_registry_json=json.dumps(
            [
                {"id": "gpt-image-2", "provider_model": "gpt-image-2-provider"},
                {"id": "nano-banana", "provider_model": "nano-banana-provider"},
            ]
        )
    )

    models = available_image_models(settings)

    assert [model.label for model in models] == [
        "GPT Image 2",
        "Nano Banana",
        "Nano Banana 2",
        "Nano Banana Pro",
    ]
    assert models[0].provider_model == "gpt-image-2-provider"
    assert models[2].provider_model is None
    assert image_plan_allows("PLUS", "PLUS") is True
    assert image_plan_allows("PLUS", "PRO") is False
    assert image_plan_allows("ULTRA", "PRO") is True


def test_image_catalog_rejects_unknown_or_duplicate_ids() -> None:
    with pytest.raises(ValueError, match="invalid id"):
        available_image_models(
            Settings(ai_image_model_registry_json='[{"id":"unknown","provider_model":"x"}]')
        )
    with pytest.raises(ValueError, match="duplicate"):
        available_image_models(
            Settings(
                ai_image_model_registry_json=(
                    '[{"id":"gpt-image-2","provider_model":"x"},'
                    '{"id":"gpt-image-2","provider_model":"y"}]'
                )
            )
        )
