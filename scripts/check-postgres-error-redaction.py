#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import traceback
from uuid import uuid4

from sqlalchemy import insert
from sqlalchemy.exc import IntegrityError

from memora.database import build_engine
from memora.identity.models import User
from memora.memories.models import Memory
from memora.workspaces.models import Workspace


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify that PostgreSQL constraint errors cannot expose protected row content."
    )
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL", ""))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.database_url:
        raise SystemExit("DATABASE_URL or --database-url is required")

    marker = "postgres-private-memory-body-must-not-reach-traceback"
    engine = build_engine(args.database_url)
    user_id = uuid4()
    workspace_id = uuid4()

    try:
        with engine.connect() as connection:
            transaction = connection.begin()
            try:
                connection.execute(
                    insert(User).values(
                        id=user_id,
                        email=f"privacy-probe-{user_id.hex}@memora.invalid",
                        password_hash="not-a-real-password-hash",
                        display_name="Privacy Probe",
                        status="ACTIVE",
                    )
                )
                connection.execute(
                    insert(Workspace).values(
                        id=workspace_id,
                        slug=f"privacy-probe-{workspace_id.hex}",
                        name="Privacy Probe",
                        kind="PERSONAL",
                    )
                )
                try:
                    connection.execute(
                        insert(Memory).values(
                            id=uuid4(),
                            workspace_id=workspace_id,
                            author_id=user_id,
                            title="Privacy probe",
                            body=marker,
                            visibility="INVALID",
                            timeline_entry_id=uuid4(),
                            timeline_visible=True,
                            revision_kind="ROOT",
                        )
                    )
                except IntegrityError as error:
                    rendered = "".join(traceback.format_exception(error))
                    detail = getattr(getattr(error.orig, "diag", None), "message_detail", None)
                    if marker in rendered or marker in repr(error) or marker in (detail or ""):
                        raise AssertionError(
                            "PostgreSQL error exposed protected memory content"
                        ) from None
                    if error.statement is not None or error.params is not None:
                        raise AssertionError(
                            "SQLAlchemy error retained statement parameters"
                        ) from None
                    if getattr(error.orig, "sqlstate", None) != "23514":
                        raise AssertionError("PostgreSQL SQLSTATE was not preserved") from None
                else:
                    raise AssertionError("Expected the memories visibility constraint to fail")
            finally:
                transaction.rollback()
    finally:
        engine.dispose()

    print("PostgreSQL error redaction passed: protected row content absent")


if __name__ == "__main__":
    main()
