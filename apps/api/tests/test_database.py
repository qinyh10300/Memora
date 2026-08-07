import traceback
from unittest.mock import patch

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from memora.database import _redact_database_exception, build_engine


def test_database_exceptions_hide_bound_parameters() -> None:
    marker = "private-memory-body-must-never-reach-logs"
    engine = build_engine("sqlite+pysqlite:///:memory:")
    try:
        assert engine.hide_parameters is True
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE protected_values (body TEXT UNIQUE NOT NULL)"))
            connection.execute(
                text("INSERT INTO protected_values (body) VALUES (:body)"),
                {"body": marker},
            )
            with pytest.raises(IntegrityError) as captured:
                connection.execute(
                    text("INSERT INTO protected_values (body) VALUES (:body)"),
                    {"body": marker},
                )

        rendered = "".join(traceback.format_exception(captured.value))
        assert marker not in rendered
        assert "database operation failed" in rendered
        assert captured.value.statement is None
        assert captured.value.params is None
    finally:
        engine.dispose()


def test_postgresql_engine_enables_parameter_hiding() -> None:
    database_url = "postgresql+psycopg://memora:secret@db:5432/memora"

    with (
        patch("memora.database.create_engine") as create_engine,
        patch("memora.database.event.listen") as listen,
    ):
        engine = build_engine(database_url)

    assert engine is create_engine.return_value
    create_engine.assert_called_once_with(
        database_url,
        hide_parameters=True,
        pool_pre_ping=True,
    )
    listen.assert_called_once_with(engine, "handle_error", _redact_database_exception)
