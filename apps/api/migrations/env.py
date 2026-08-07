from logging.config import fileConfig
from typing import Any

from alembic import context
from sqlalchemy import engine_from_config, pool

from memora.database import Base, _install_database_error_redaction
from memora.model_registry import load_all_models
from memora.settings import get_settings

load_all_models()

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", get_settings().database_url)
target_metadata = Base.metadata

MANUALLY_MANAGED_INDEXES = {
    "ix_document_chunks_fts",
    "ix_document_chunks_text_trgm",
    "ix_memories_active_body_trgm",
    "ix_memories_active_search_vector",
    "ix_memories_active_title_trgm",
}


def include_schema_object(
    _object: Any,
    name: str | None,
    object_type: str,
    _reflected: bool,
    _compare_to: Any,
) -> bool:
    return not (object_type == "index" and name in MANUALLY_MANAGED_INDEXES)


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=include_schema_object,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = _install_database_error_redaction(
        engine_from_config(
            config.get_section(config.config_ini_section, {}),
            prefix="sqlalchemy.",
            hide_parameters=True,
            poolclass=pool.NullPool,
        )
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_object=include_schema_object,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
