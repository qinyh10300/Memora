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


def test_development_quick_login_requires_development_seed_opt_in() -> None:
    with pytest.raises(ValidationError, match="requires APP_ENV=development"):
        Settings(
            app_env="test",
            development_quick_login_enabled=True,
            seed_development_data_enabled=True,
        )

    with pytest.raises(ValidationError, match="requires development seed data"):
        Settings(
            app_env="development",
            development_quick_login_enabled=True,
            seed_development_data_enabled=False,
        )

    settings = Settings(
        app_env="development",
        development_quick_login_enabled=True,
        seed_development_data_enabled=True,
    )
    assert settings.development_quick_login_enabled is True


def test_production_rejects_development_quick_login() -> None:
    with pytest.raises(ValidationError, match="requires APP_ENV=development"):
        Settings(
            app_env="production",
            session_secret="a-long-test-only-secret-with-32-characters",
            development_quick_login_enabled=True,
        )


def test_enabled_metrics_require_a_dedicated_token() -> None:
    with pytest.raises(ValidationError, match=r"dedicated token of 32\+ characters"):
        Settings(metrics_enabled=True, metrics_token=SecretStr("too-short"))

    settings = Settings(
        metrics_enabled=True,
        metrics_token=SecretStr("metrics-test-token-with-at-least-32-characters"),
    )
    assert settings.metrics_enabled is True


def test_email_verification_requires_a_complete_smtp_transport() -> None:
    with pytest.raises(ValidationError, match="EMAIL_SMTP_HOST"):
        Settings(email_verification_enabled=True)

    with pytest.raises(ValidationError, match="STARTTLS and implicit SSL"):
        Settings(
            email_verification_enabled=True,
            email_smtp_host="smtp.example.com",
            email_smtp_from_email="noreply@example.com",
            email_smtp_starttls=True,
            email_smtp_use_ssl=True,
        )

    with pytest.raises(ValidationError, match="configured together"):
        Settings(
            email_verification_enabled=True,
            email_smtp_host="smtp.example.com",
            email_smtp_from_email="noreply@example.com",
            email_smtp_username="memora",
        )

    settings = Settings(
        email_verification_enabled=True,
        email_smtp_host="smtp.example.com",
        email_smtp_from_email="noreply@example.com",
        email_smtp_username="memora",
        email_smtp_password=SecretStr("smtp-test-password"),
    )
    assert settings.email_verification_enabled is True
