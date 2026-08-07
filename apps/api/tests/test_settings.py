import pytest
from pydantic import SecretStr, ValidationError

from memora.settings import DEFAULT_SESSION_SECRET, Settings


def test_production_rejects_default_session_secret() -> None:
    with pytest.raises(ValidationError, match="non-placeholder SESSION_SECRET"):
        Settings(app_env="production", session_secret=DEFAULT_SESSION_SECRET)


@pytest.mark.parametrize(
    "unsafe_secret",
    ["", "change-me", "replace-with-a-long-random-value", "too-short"],
)
def test_production_rejects_placeholder_or_short_secret(unsafe_secret: str) -> None:
    with pytest.raises(ValidationError, match="32\\+ characters"):
        Settings(app_env="production", session_secret=unsafe_secret)


def test_production_accepts_explicit_session_secret() -> None:
    settings = Settings(
        app_env="production",
        session_secret="a-long-test-only-secret-with-32-characters",
    )

    assert settings.app_env == "production"
    assert settings.seed_development_data_enabled is False


def test_production_rejects_development_seed_data() -> None:
    with pytest.raises(ValidationError, match="cannot enable development seed data"):
        Settings(
            app_env="production",
            session_secret="a-long-test-only-secret-with-32-characters",
            seed_development_data_enabled=True,
        )


def test_enabled_metrics_require_a_dedicated_token() -> None:
    with pytest.raises(ValidationError, match=r"dedicated token of 32\+ characters"):
        Settings(metrics_enabled=True, metrics_token=SecretStr("too-short"))

    settings = Settings(
        metrics_enabled=True,
        metrics_token=SecretStr("metrics-test-token-with-at-least-32-characters"),
    )
    assert settings.metrics_enabled is True
