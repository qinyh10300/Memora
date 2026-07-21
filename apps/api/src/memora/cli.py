import uvicorn

from memora.settings import get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "memora.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.app_env == "development",
    )
