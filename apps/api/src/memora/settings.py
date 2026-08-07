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
    metrics_enabled: bool = False
    metrics_token: SecretStr = SecretStr("")
    observability_sink_url: str = ""
    observability_sink_token: SecretStr = SecretStr("")
    observability_sink_timeout_seconds: float = Field(default=2, gt=0, le=10)
    seed_development_data_enabled: bool = False

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
    ai_model_registry_json: str = ""
    ai_embedding_base_url: str = "https://yunwu.ai/v1"
    ai_embedding_api_key: SecretStr = SecretStr("")
    ai_embedding_model: str = ""
    ai_request_timeout_seconds: float = Field(default=60, gt=0, le=300)
    ai_web_search_enabled: bool = True
    ai_web_search_model: str = ""
    ai_web_search_timeout_seconds: float = Field(default=90, gt=0, le=300)
    ai_chat_max_output_tokens: int = Field(default=2400, ge=100, le=8000)
    ai_model_pricing_json: str = ""
    ai_embedding_max_attempts: int = Field(default=5, ge=1, le=20)
    ai_job_retry_base_seconds: int = Field(default=15, ge=1, le=3600)
    retrieval_reranker_timeout_seconds: float = Field(default=3, gt=0, le=30)
    retrieval_reranker_candidate_limit: int = Field(default=20, ge=2, le=100)
    document_parse_max_pages: int = Field(default=100, ge=1, le=500)
    document_parse_max_chars: int = Field(default=500_000, ge=10_000, le=2_000_000)
    document_parse_timeout_seconds: float = Field(default=120, gt=0, le=600)
    document_parse_max_attempts: int = Field(default=3, ge=1, le=10)
    document_parse_max_concurrency: int = Field(default=1, ge=1, le=8)
    document_chunk_max_chars: int = Field(default=1_400, ge=400, le=4_000)
    document_chunk_overlap_chars: int = Field(default=120, ge=0, le=500)
    document_ocr_min_text_chars: int = Field(default=40, ge=0, le=1_000)
    document_ocr_page_timeout_seconds: float = Field(default=30, gt=0, le=120)
    document_ocr_languages: str = Field(default="chi_sim+eng", min_length=1, max_length=80)

    @model_validator(mode="after")
    def reject_unsafe_production_secret(self) -> Self:
        if self.app_env == "production" and (
            self.session_secret in UNSAFE_SESSION_SECRETS or len(self.session_secret) < 32
        ):
            raise ValueError(
                "production requires a non-placeholder SESSION_SECRET of 32+ characters"
            )
        if self.app_env == "production" and self.seed_development_data_enabled:
            raise ValueError("production cannot enable development seed data")
        if self.metrics_enabled and len(self.metrics_token.get_secret_value()) < 32:
            raise ValueError("enabled metrics require a dedicated token of 32+ characters")
        return self

    @model_validator(mode="after")
    def validate_document_chunk_limits(self) -> Self:
        if self.document_chunk_overlap_chars >= self.document_chunk_max_chars:
            raise ValueError("document chunk overlap must be smaller than chunk size")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
