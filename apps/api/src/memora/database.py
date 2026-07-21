from sqlalchemy import Engine, create_engine, text


def build_engine(database_url: str) -> Engine:
    return create_engine(database_url, pool_pre_ping=True)


def check_database(engine: Engine) -> None:
    with engine.connect() as connection:
        result = connection.execute(text("SELECT 1"))
        result.close()
