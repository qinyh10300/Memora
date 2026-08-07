from collections.abc import Generator
from typing import Annotated, Any

from fastapi import Depends, Request
from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.engine import ExceptionContext
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


def _redact_database_exception(context: ExceptionContext) -> None:
    sqlalchemy_error = context.sqlalchemy_exception
    if not isinstance(sqlalchemy_error, DBAPIError):
        return

    original = context.original_exception
    sqlstate = getattr(original, "sqlstate", None)
    safe_sqlstate = sqlstate if isinstance(sqlstate, str) and len(sqlstate) == 5 else None
    safe_message = "database operation failed"
    if safe_sqlstate and safe_sqlstate.isalnum():
        safe_message = f"{safe_message} (sqlstate={safe_sqlstate})"

    # psycopg formats server DETAIL from its PGresult instead of Exception.args.
    # Clearing it prevents row contents from reappearing as the chained cause.
    if hasattr(original, "_info"):
        original.__dict__["_info"] = None
    original.args = (safe_message,)

    # SQLAlchemy caches the original message before handle_error runs.
    sqlalchemy_error.args = (safe_message,)
    sqlalchemy_error.statement = None
    sqlalchemy_error.params = None


def _install_database_error_redaction(engine: Engine) -> Engine:
    event.listen(engine, "handle_error", _redact_database_exception)
    return engine


def build_engine(database_url: str) -> Engine:
    if database_url.startswith("sqlite"):
        engine = create_engine(
            database_url,
            connect_args={"check_same_thread": False},
            hide_parameters=True,
            poolclass=StaticPool,
        )

        # SQLite 默认不执行外键约束；测试环境必须打开，避免只在 PostgreSQL
        # 才暴露事务写入顺序和孤儿数据问题。
        @event.listens_for(engine, "connect")
        def enable_sqlite_foreign_keys(dbapi_connection: Any, _connection_record: Any) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        return _install_database_error_redaction(engine)
    return _install_database_error_redaction(
        create_engine(database_url, hide_parameters=True, pool_pre_ping=True)
    )


def build_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)


def get_database_session(request: Request) -> Generator[Session]:
    session_factory: sessionmaker[Session] = request.app.state.session_factory
    with session_factory() as session:
        yield session


DatabaseSession = Annotated[Session, Depends(get_database_session)]


def check_database(engine: Engine) -> None:
    with engine.connect() as connection:
        result = connection.execute(text("SELECT 1"))
        result.close()
