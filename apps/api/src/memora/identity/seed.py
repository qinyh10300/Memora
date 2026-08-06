from dataclasses import dataclass

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from memora.database import build_engine
from memora.identity.models import User
from memora.identity.security import hash_password, normalize_email
from memora.settings import Settings, get_settings
from memora.workspaces.models import Workspace, WorkspaceMembership
from memora.workspaces.service import generate_unique_join_code

LOCAL_PASSWORD_PREFIX = "memora-local-"


@dataclass(frozen=True)
class SeedUser:
    email: str
    display_name: str
    password: str


def seed_users_from_settings(settings: Settings) -> list[SeedUser]:
    return [
        SeedUser(
            settings.seed_user_1_email,
            settings.seed_user_1_display_name,
            settings.seed_user_1_password.get_secret_value(),
        ),
        SeedUser(
            settings.seed_user_2_email,
            settings.seed_user_2_display_name,
            settings.seed_user_2_password.get_secret_value(),
        ),
        SeedUser(
            settings.seed_user_3_email,
            settings.seed_user_3_display_name,
            settings.seed_user_3_password.get_secret_value(),
        ),
        SeedUser(
            settings.seed_user_4_email,
            settings.seed_user_4_display_name,
            settings.seed_user_4_password.get_secret_value(),
        ),
    ]


def validate_seed_users(settings: Settings, users: list[SeedUser]) -> None:
    if settings.app_env != "production":
        return
    if any(user.password.startswith(LOCAL_PASSWORD_PREFIX) for user in users):
        raise ValueError("production seed users require explicit non-local passwords")
    if any(len(user.password) < 12 for user in users):
        raise ValueError("production seed user passwords must contain at least 12 characters")


def seed_database(engine: Engine, settings: Settings) -> tuple[int, int]:
    seed_users = seed_users_from_settings(settings)
    validate_seed_users(settings, seed_users)
    created_users = 0
    created_memberships = 0

    with Session(engine) as database, database.begin():
        team_workspace = database.scalar(select(Workspace).where(Workspace.slug == "memora-test"))
        if team_workspace is None:
            team_workspace = Workspace(
                slug="memora-test",
                name="Memora 测试工作区",
                kind="TEAM",
                join_code=generate_unique_join_code(database),
            )
            database.add(team_workspace)
            database.flush()
        else:
            team_workspace.kind = "TEAM"
            if team_workspace.join_code is None:
                team_workspace.join_code = generate_unique_join_code(database)

        for index, seed_user in enumerate(seed_users):
            email = normalize_email(seed_user.email)
            user = database.scalar(select(User).where(User.email == email))
            if user is None:
                user = User(
                    email=email,
                    display_name=seed_user.display_name.strip(),
                    password_hash=hash_password(seed_user.password),
                )
                database.add(user)
                database.flush()
                created_users += 1

            membership = database.get(
                WorkspaceMembership,
                {"workspace_id": team_workspace.id, "user_id": user.id},
            )
            if membership is None:
                database.add(
                    WorkspaceMembership(
                        workspace_id=team_workspace.id,
                        user_id=user.id,
                        role="OWNER" if index == 0 else "MEMBER",
                    )
                )
                created_memberships += 1
            elif index == 0:
                membership.role = "OWNER"

            personal_slug = f"personal-{user.id.hex}"
            personal_workspace = database.scalar(
                select(Workspace).where(Workspace.slug == personal_slug)
            )
            if personal_workspace is None:
                personal_workspace = Workspace(
                    slug=personal_slug,
                    name=f"{user.display_name} 的个人空间",
                    kind="PERSONAL",
                )
                database.add(personal_workspace)
                database.flush()
            else:
                personal_workspace.kind = "PERSONAL"

            personal_membership = database.get(
                WorkspaceMembership,
                {"workspace_id": personal_workspace.id, "user_id": user.id},
            )
            if personal_membership is None:
                database.add(
                    WorkspaceMembership(
                        workspace_id=personal_workspace.id,
                        user_id=user.id,
                        role="OWNER",
                    )
                )
                created_memberships += 1
            else:
                personal_membership.role = "OWNER"

    return created_users, created_memberships


def main() -> int:
    settings = get_settings()
    engine = build_engine(settings.database_url)
    try:
        created_users, created_memberships = seed_database(engine, settings)
    finally:
        engine.dispose()
    print(
        "Memora seed completed: "
        f"users_created={created_users}, memberships_created={created_memberships}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
