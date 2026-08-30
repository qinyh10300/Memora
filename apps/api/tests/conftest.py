from collections.abc import Iterator

import pytest
from pytest import MonkeyPatch

from memora.settings import get_settings


@pytest.fixture(autouse=True)
def isolate_external_ai_configuration(monkeypatch: MonkeyPatch) -> Iterator[None]:
    """Keep tests isolated from developer-only values in the local .env."""
    for name in (
        "AI_CHAT_API_KEY",
        "AI_CHAT_MODEL",
        "AI_MODEL_REGISTRY_JSON",
        "AI_EMBEDDING_API_KEY",
        "AI_EMBEDDING_MODEL",
        "AI_SPEECH_API_KEY",
        "AI_SPEECH_MODEL",
        "AI_IMAGE_API_KEY",
        "AI_IMAGE_MODEL_REGISTRY_JSON",
        "AI_TASK_CREDIT_COSTS_JSON",
    ):
        monkeypatch.setenv(name, "")
    for name in (
        "SEED_DEVELOPMENT_DATA_ENABLED",
        "DEVELOPMENT_QUICK_LOGIN_ENABLED",
    ):
        monkeypatch.setenv(name, "false")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
