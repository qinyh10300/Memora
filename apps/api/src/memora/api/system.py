from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from memora.database import check_database
from memora.settings import Settings, get_settings

router = APIRouter(tags=["system"])
SettingsDependency = Annotated[Settings, Depends(get_settings)]


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str
    version: str


class ReadinessFailure(BaseModel):
    status: Literal["not_ready"] = "not_ready"
    service: str


@router.get("/health", response_model=HealthResponse)
def health(settings: SettingsDependency) -> HealthResponse:
    return HealthResponse(service="api", version=settings.app_version)


@router.get(
    "/ready",
    response_model=HealthResponse,
    responses={503: {"model": ReadinessFailure}},
)
def ready(request: Request, settings: SettingsDependency) -> HealthResponse | JSONResponse:
    try:
        check_database(request.app.state.engine)
    except Exception:
        return JSONResponse(
            status_code=503,
            content=ReadinessFailure(service="api").model_dump(),
        )
    return HealthResponse(service="api", version=settings.app_version)
