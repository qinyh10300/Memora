import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from memora.workspaces.models import Workspace

TEAM_JOIN_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
TEAM_JOIN_CODE_LENGTH = 12


def normalize_join_code(value: str) -> str:
    return "".join(character for character in value.upper() if character.isalnum())


def generate_unique_join_code(database: Session) -> str:
    for _attempt in range(8):
        code = "".join(
            secrets.choice(TEAM_JOIN_CODE_ALPHABET) for _ in range(TEAM_JOIN_CODE_LENGTH)
        )
        if database.scalar(select(Workspace.id).where(Workspace.join_code == code)) is None:
            return code
    raise RuntimeError("unable to generate a unique team join code")
