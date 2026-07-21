import pytest
from pydantic import ValidationError

from memora.settings import DEFAULT_SESSION_SECRET, Settings


def test_production_rejects_default_session_secret() -> None:
    with pytest.raises(ValidationError, match="non-default SESSION_SECRET"):
        Settings(app_env="production", session_secret=DEFAULT_SESSION_SECRET)


def test_production_accepts_explicit_session_secret() -> None:
    settings = Settings(app_env="production", session_secret="a-long-test-only-secret")

    assert settings.app_env == "production"
