from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from memora.api.auth import router as auth_router
from memora.api.chat import router as chat_router
from memora.api.conversations import router as conversations_router
from memora.api.memories import router as memories_router
from memora.api.reports import router as reports_router
from memora.api.search import router as search_router
from memora.api.system import router as system_router
from memora.api.workspaces import router as workspaces_router
from memora.database import build_engine, build_session_factory
from memora.identity.rate_limit import LoginRateLimiter
from memora.logging import configure_logging
from memora.model_registry import load_all_models
from memora.settings import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    load_all_models()
    resolved_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        configure_logging(
            level=resolved_settings.log_level,
            json_logs=resolved_settings.app_env == "production",
        )
        app.state.engine = build_engine(resolved_settings.database_url)
        app.state.session_factory = build_session_factory(app.state.engine)
        app.state.login_rate_limiter = LoginRateLimiter()
        app.state.ai_rate_limiter = LoginRateLimiter(
            maximum_attempts=30,
            window_seconds=60,
        )
        yield
        app.state.engine.dispose()

    application = FastAPI(
        title="Memora API",
        summary="Memora 的身份、记忆、检索与 AI 编排接口。",
        version=resolved_settings.app_version,
        lifespan=lifespan,
    )
    application.state.settings = resolved_settings
    application.dependency_overrides[get_settings] = lambda: resolved_settings
    application.include_router(system_router)
    application.include_router(auth_router)
    application.include_router(workspaces_router)
    application.include_router(conversations_router)
    application.include_router(memories_router)
    application.include_router(search_router)
    application.include_router(chat_router)
    application.include_router(reports_router)
    return application


app = create_app()
