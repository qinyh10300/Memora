from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select

from memora.ai.image_registry import available_image_models, image_api_key, image_plan_allows
from memora.audit.models import AuditEvent
from memora.billing.service import InsufficientCreditsError, get_or_create_subscription
from memora.database import DatabaseSession
from memora.identity.dependencies import CurrentPrincipal
from memora.settings import Settings, get_settings
from memora.visuals.models import VisualProject
from memora.visuals.schemas import (
    ConfirmVisualStructureRequest,
    CreateVisualProjectRequest,
    GenerateVisualRequest,
    ImageModelResponse,
    VisualGenerationResponse,
    VisualJobResponse,
    VisualProjectResponse,
    VisualTemplateResponse,
)
from memora.visuals.service import (
    VisualAccessError,
    VisualConfigurationError,
    cancel_visual_job,
    confirm_visual_structure,
    create_visual_project,
    get_accessible_visual_job,
    get_accessible_visual_project,
    get_authorized_visual_asset,
    get_owned_visual_project,
    queue_visual_generation,
    task_credit_costs,
    visual_generation_response,
    visual_job_response,
    visual_project_response,
    visual_project_sources_available,
)
from memora.visuals.templates import VISUAL_TEMPLATES

router = APIRouter(prefix="/visuals", tags=["visuals"])
job_router = APIRouter(prefix="/visual-jobs", tags=["visuals"])


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="作品不存在")


@router.get("/models", response_model=list[ImageModelResponse])
def list_image_models(
    principal: CurrentPrincipal,
    database: DatabaseSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> list[ImageModelResponse]:
    subscription = get_or_create_subscription(database, principal.user_id)
    database.commit()
    try:
        models = available_image_models(settings)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="图片模型配置无效",
        ) from error
    has_provider = bool(settings.ai_visuals_enabled and image_api_key(settings))
    return [
        ImageModelResponse(
            id=model.id,
            label=model.label,
            description=model.description,
            min_plan=model.min_plan,
            badge=model.badge,
            is_default=model.is_default,
            configured=has_provider and model.configured,
            locked=not image_plan_allows(subscription.plan_code, model.min_plan),
        )
        for model in models
    ]


@router.get("/templates", response_model=list[VisualTemplateResponse])
def list_visual_templates() -> list[VisualTemplateResponse]:
    return [VisualTemplateResponse(**template.__dict__) for template in VISUAL_TEMPLATES]


@router.get("/costs", response_model=dict[str, int])
def get_visual_costs(
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, int]:
    try:
        return task_credit_costs(settings)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="生成额度配置无效",
        ) from error


@router.get("", response_model=list[VisualProjectResponse])
def list_visual_projects(
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> list[VisualProjectResponse]:
    projects = database.scalars(
        select(VisualProject)
        .where(
            VisualProject.workspace_id == principal.workspace_id,
            (VisualProject.owner_id == principal.user_id)
            | (VisualProject.visibility == "WORKSPACE"),
        )
        .order_by(VisualProject.updated_at.desc(), VisualProject.id.desc())
    ).all()
    return [
        visual_project_response(database, principal, project)
        for project in projects
        if visual_project_sources_available(database, principal, project)
    ]


@router.post("", response_model=VisualProjectResponse, status_code=status.HTTP_201_CREATED)
def create_visual(
    payload: CreateVisualProjectRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> VisualProjectResponse:
    if not settings.ai_visuals_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="科研绘图尚未启用")
    project = create_visual_project(database, principal, payload)
    database.add(
        AuditEvent(
            workspace_id=principal.workspace_id,
            actor_id=principal.user_id,
            action="VISUAL_PROJECT_CREATED",
            resource_type="VISUAL_PROJECT",
            resource_id=project.id,
        )
    )
    database.commit()
    database.refresh(project)
    return visual_project_response(database, principal, project)


@router.get("/{project_id}", response_model=VisualProjectResponse)
def get_visual(
    project_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> VisualProjectResponse:
    project = get_accessible_visual_project(database, principal, project_id)
    if project is None:
        raise _not_found()
    return visual_project_response(database, principal, project)


@router.post("/{project_id}/confirm-structure", response_model=VisualProjectResponse)
def confirm_structure(
    project_id: UUID,
    payload: ConfirmVisualStructureRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> VisualProjectResponse:
    project = get_owned_visual_project(database, principal, project_id)
    if project is None:
        raise _not_found()
    try:
        version = confirm_visual_structure(
            database,
            principal,
            project,
            payload.version_id,
        )
    except VisualAccessError as error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    database.add(
        AuditEvent(
            workspace_id=principal.workspace_id,
            actor_id=principal.user_id,
            action="VISUAL_STRUCTURE_CONFIRMED",
            resource_type="VISUAL_VERSION",
            resource_id=version.id,
        )
    )
    database.commit()
    database.refresh(project)
    return visual_project_response(database, principal, project)


@router.post("/{project_id}/generate", response_model=VisualGenerationResponse)
def generate_visual(
    project_id: UUID,
    payload: GenerateVisualRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> VisualGenerationResponse:
    project = get_owned_visual_project(database, principal, project_id)
    if project is None:
        raise _not_found()
    try:
        job, _reservation = queue_visual_generation(
            database,
            principal,
            project,
            payload,
            settings,
        )
    except InsufficientCreditsError as error:
        database.rollback()
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="credits 余额不足，请升级套餐后继续",
        ) from error
    except VisualAccessError as error:
        database.rollback()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error
    except VisualConfigurationError as error:
        database.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    except ValueError as error:
        database.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    database.add(
        AuditEvent(
            workspace_id=principal.workspace_id,
            actor_id=principal.user_id,
            action="VISUAL_GENERATION_QUEUED",
            resource_type="VISUAL_JOB",
            resource_id=job.id,
        )
    )
    database.commit()
    database.refresh(project)
    database.refresh(job)
    return visual_generation_response(database, principal, project, job)


@job_router.get("/{job_id}", response_model=VisualJobResponse)
def get_visual_job(
    job_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> VisualJobResponse:
    job = get_accessible_visual_job(database, principal, job_id)
    if job is None:
        raise _not_found()
    return visual_job_response(job)


@job_router.post("/{job_id}/cancel", response_model=VisualJobResponse)
def cancel_visual_generation(
    job_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> VisualJobResponse:
    job = get_accessible_visual_job(database, principal, job_id)
    if job is None:
        raise _not_found()
    try:
        cancel_visual_job(database, principal, job)
    except VisualAccessError as error:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    database.add(
        AuditEvent(
            workspace_id=principal.workspace_id,
            actor_id=principal.user_id,
            action="VISUAL_GENERATION_CANCELLED",
            resource_type="VISUAL_JOB",
            resource_id=job.id,
        )
    )
    database.commit()
    database.refresh(job)
    return visual_job_response(job)


@router.get("/{project_id}/versions/{version_id}/content")
def get_visual_version_content(
    project_id: UUID,
    version_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> Response:
    asset = get_authorized_visual_asset(database, principal, project_id, version_id)
    if asset is None:
        raise _not_found()
    return Response(
        content=asset.content,
        media_type=asset.content_type,
        headers={
            "Cache-Control": "private, max-age=3600",
            "Content-Disposition": (
                f'inline; filename="visual.{asset.content_type.split("/")[-1]}"; '
                f"filename*=UTF-8''{quote(asset.name)}"
            ),
        },
    )
