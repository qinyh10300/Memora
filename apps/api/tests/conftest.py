from collections.abc import Iterator

import pytest
from pytest import MonkeyPatch

from memora.settings import get_settings


@pytest.fixture(autouse=True)
def isolate_external_ai_configuration(monkeypatch: MonkeyPatch) -> Iterator[None]:
    """Keep the default test suite offline even when the developer has a real .env."""
    for name in (
        "AI_CHAT_API_KEY",
        "AI_CHAT_MODEL",
        "AI_EMBEDDING_API_KEY",
        "AI_EMBEDDING_MODEL",
    ):
        monkeypatch.setenv(name, "")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
