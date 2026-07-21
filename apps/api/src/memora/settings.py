from functools import lru_cache
from typing import Literal, Self

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SESSION_SECRET = "development-only-change-me"
UNSAFE_SESSION_SECRETS = {
    "",
    "change-me",
    "replace-with-a-long-random-value",
    DEFAULT_SESSION_SECRET,
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: Literal["development", "test", "production"] = "development"
    app_version: str = "0.1.0"
    database_url: str = "postgresql+psycopg://memora:change-me@localhost:5432/memora"
    session_secret: str = DEFAULT_SESSION_SECRET
    session_ttl_seconds: int = 60 * 60 * 24 * 14
    log_level: str = "INFO"

    seed_user_1_email: str = "alex@memora.local"
    seed_user_1_display_name: str = "Alex"
    seed_user_1_password: SecretStr = SecretStr("memora-local-alex")
    seed_user_2_email: str = "blair@memora.local"
    seed_user_2_display_name: str = "Blair"
    seed_user_2_password: SecretStr = SecretStr("memora-local-blair")
    seed_user_3_email: str = "casey@memora.local"
    seed_user_3_display_name: str = "Casey"
    seed_user_3_password: SecretStr = SecretStr("memora-local-casey")
    seed_user_4_email: str = "devon@memora.local"
    seed_user_4_display_name: str = "Devon"
    seed_user_4_password: SecretStr = SecretStr("memora-local-devon")

    @model_validator(mode="after")
    def reject_unsafe_production_secret(self) -> Self:
        if self.app_env == "production" and (
            self.session_secret in UNSAFE_SESSION_SECRETS or len(self.session_secret) < 32
        ):
            raise ValueError(
                "production requires a non-placeholder SESSION_SECRET of 32+ characters"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
