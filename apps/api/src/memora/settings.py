from functools import lru_cache
from typing import Literal, Self

from pydantic import Field, SecretStr, model_validator
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

    ai_chat_base_url: str = "https://yunwu.ai/v1"
    ai_chat_api_key: SecretStr = SecretStr("")
    ai_chat_model: str = ""
    ai_embedding_base_url: str = "https://yunwu.ai/v1"
    ai_embedding_api_key: SecretStr = SecretStr("")
    ai_embedding_model: str = ""
    ai_request_timeout_seconds: float = Field(default=60, gt=0, le=300)
    ai_web_search_enabled: bool = True
    ai_web_search_timeout_seconds: float = Field(default=90, gt=0, le=300)
    ai_chat_max_output_tokens: int = Field(default=2400, ge=100, le=8000)
    ai_embedding_max_attempts: int = Field(default=5, ge=1, le=20)
    ai_job_retry_base_seconds: int = Field(default=15, ge=1, le=3600)

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
