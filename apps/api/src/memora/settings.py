from functools import lru_cache
from typing import Literal, Self

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SESSION_SECRET = "development-only-change-me"


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
    log_level: str = "INFO"

    @model_validator(mode="after")
    def reject_unsafe_production_secret(self) -> Self:
        if self.app_env == "production" and self.session_secret == DEFAULT_SESSION_SECRET:
            raise ValueError("production requires a non-default SESSION_SECRET")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
