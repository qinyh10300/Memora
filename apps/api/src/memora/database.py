from collections.abc import Generator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


def build_engine(database_url: str) -> Engine:
    if database_url.startswith("sqlite"):
        return create_engine(
            database_url,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
    return create_engine(database_url, pool_pre_ping=True)


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
