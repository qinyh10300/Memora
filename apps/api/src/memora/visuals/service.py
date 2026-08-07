import json
from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID, uuid4

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from memora.ai.image_registry import image_api_key, image_plan_allows, resolve_image_model
from memora.ai.model_registry import default_ai_model, model_plan_allows, resolve_ai_model
from memora.assets.models import Asset
from memora.billing.models import CreditReservation
from memora.billing.service import (
    get_or_create_subscription,
    release_credit_reservation,
    reserve_credits,
)
from memora.diagrams.models import Diagram
from memora.diagrams.schemas import DiagramWriteRequest
from memora.diagrams.service import validate_and_serialize_graph
from memora.identity.dependencies import Principal
from memora.memories.models import Memory
from memora.memories.service import authorized_memories_statement
from memora.settings import Settings
from memora.visuals.models import (
    VisualGenerationJob,
    VisualProject,
    VisualSource,
    VisualVersion,
)
from memora.visuals.schemas import (
    CreateVisualProjectRequest,
    GenerateVisualRequest,
    VisualGenerationResponse,
    VisualJobResponse,
    VisualProjectResponse,
    VisualVersionResponse,
)

DEFAULT_TASK_COSTS = {
    "report": 20,
    "alignment": 15,
    "structured_visual": 30,
    "gpt-image-2": 120,
    "nano-banana": 60,
    "nano-banana-2": 90,
    "nano-banana-pro": 160,
}


class VisualAccessError(PermissionError):
    pass


class VisualConfigurationError(RuntimeError):
    pass


def task_credit_costs(settings: Settings) -> dict[str, int]:
    configured = settings.ai_task_credit_costs_json.strip()
    if not configured:
        return dict(DEFAULT_TASK_COSTS)
    try:
        decoded = json.loads(configured)
    except json.JSONDecodeError as error:
        raise ValueError("AI_TASK_CREDIT_COSTS_JSON must be valid JSON") from error
    if not isinstance(decoded, dict):
        raise ValueError("AI_TASK_CREDIT_COSTS_JSON must be an object")
    result = dict(DEFAULT_TASK_COSTS)
    for key, value in decoded.items():
        if key not in result or not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            raise ValueError("AI_TASK_CREDIT_COSTS_JSON contains an invalid cost")
        result[key] = value
    return result


def accessible_visual_projects_statement(principal: Principal) -> Select[tuple[VisualProject]]:
    return select(VisualProject).where(
        VisualProject.workspace_id == principal.workspace_id,
        or_(
            VisualProject.owner_id == principal.user_id,
            VisualProject.visibility == "WORKSPACE",
        ),
    )


def get_accessible_visual_project(
    database: Session,
    principal: Principal,
    project_id: UUID,
) -> VisualProject | None:
    project = database.scalar(
        accessible_visual_projects_statement(principal).where(VisualProject.id == project_id)
    )
    if project is None or not visual_project_sources_available(database, principal, project):
        return None
    return project


def get_owned_visual_project(
    database: Session,
    principal: Principal,
    project_id: UUID,
) -> VisualProject | None:
    return database.scalar(
        select(VisualProject).where(
            VisualProject.id == project_id,
            VisualProject.workspace_id == principal.workspace_id,
            VisualProject.owner_id == principal.user_id,
        )
    )


def create_visual_project(
    database: Session,
    principal: Principal,
    payload: CreateVisualProjectRequest,
) -> VisualProject:
    project = VisualProject(
        workspace_id=principal.workspace_id,
        owner_id=principal.user_id,
        title=payload.title,
        mode=payload.mode,
        kind=payload.kind,
        visibility=payload.visibility,
        status="DRAFT",
    )
    database.add(project)
    database.flush()
    return project


def _authorized_source_rows(
    database: Session,
    principal: Principal,
    memory_ids: list[UUID],
) -> dict[UUID, Memory]:
    if not memory_ids:
        return {}
    rows = database.execute(
        authorized_memories_statement(principal).where(Memory.id.in_(memory_ids))
    ).tuples()
    return {memory.id: memory for memory, _author, _projection in rows}


def _validate_sources(
    database: Session,
    principal: Principal,
    project: VisualProject,
    memory_ids: list[UUID],
) -> None:
    authorized = _authorized_source_rows(database, principal, memory_ids)
    if set(authorized) != set(memory_ids):
        raise VisualAccessError("作品引用了当前账号无权访问的记忆")
    if project.visibility == "WORKSPACE" and any(
        memory.visibility != "WORKSPACE" for memory in authorized.values()
    ):
        raise VisualAccessError("共享作品只能使用已共享到当前空间的记忆")


def _sources_available_for_job(
    database: Session,
    principal: Principal,
    job: VisualGenerationJob,
) -> bool:
    expected_ids: set[UUID] = set()
    for raw_id in job.request_payload.get("memory_ids", []):
        try:
            expected_ids.add(UUID(str(raw_id)))
        except ValueError:
            return False
    memory_ids = set(
        database.scalars(select(VisualSource.memory_id).where(VisualSource.job_id == job.id)).all()
    )
    if memory_ids != expected_ids:
        return False
    if not memory_ids:
        return True
    return set(_authorized_source_rows(database, principal, list(memory_ids))) == memory_ids


def visual_project_sources_available(
    database: Session,
    principal: Principal,
    project: VisualProject,
) -> bool:
    jobs = database.scalars(
        select(VisualGenerationJob).where(VisualGenerationJob.project_id == project.id)
    ).all()
    return all(_sources_available_for_job(database, principal, job) for job in jobs)


def _resolved_generation_model(
    database: Session,
    principal: Principal,
    project: VisualProject,
    payload: GenerateVisualRequest,
    settings: Settings,
) -> tuple[str, str, int]:
    costs = task_credit_costs(settings)
    if project.mode == "STRUCTURED":
        structured_model = (
            resolve_ai_model(settings, payload.model_id)
            if payload.model_id is not None
            else default_ai_model(settings)
        )
        if structured_model is None:
            raise VisualConfigurationError("结构生成模型尚未配置")
        subscription = get_or_create_subscription(database, principal.user_id, lock=True)
        if not model_plan_allows(subscription.plan_code, structured_model.min_plan):
            raise VisualAccessError(
                f"{structured_model.label} 需要 {structured_model.min_plan.title()} 套餐"
            )
        return (
            structured_model.id,
            structured_model.provider_model,
            costs["structured_visual"],
        )

    if payload.model_id is None:
        raise VisualConfigurationError("请选择绘图引擎")
    image_model = resolve_image_model(settings, payload.model_id)
    if image_model is None:
        raise VisualConfigurationError("绘图引擎不存在")
    subscription = get_or_create_subscription(database, principal.user_id, lock=True)
    if not image_plan_allows(subscription.plan_code, image_model.min_plan):
        raise VisualAccessError(f"{image_model.label} 需要 {image_model.min_plan.title()} 套餐")
    if not settings.ai_visuals_enabled or not image_api_key(settings):
        raise VisualConfigurationError("图片生成服务尚未配置")
    if not image_model.configured or image_model.provider_model is None:
        raise VisualConfigurationError(f"{image_model.label} 尚未配置供应商模型")
    return (
        image_model.id,
        image_model.provider_model,
        costs[image_model.id] * payload.count,
    )


def queue_visual_generation(
    database: Session,
    principal: Principal,
    project: VisualProject,
    payload: GenerateVisualRequest,
    settings: Settings,
) -> tuple[VisualGenerationJob, CreditReservation]:
    if project.owner_id != principal.user_id:
        raise VisualAccessError("只有作品创建者可以发起生成")
    if project.status in {"QUEUED", "GENERATING"}:
        raise ValueError("当前作品已有正在执行的生成任务")
    _validate_sources(database, principal, project, payload.memory_ids)
    model_id, provider_model, credit_cost = _resolved_generation_model(
        database,
        principal,
        project,
        payload,
        settings,
    )
    job_id = uuid4()
    reservation = reserve_credits(
        database,
        principal.user_id,
        credit_cost,
        idempotency_key=f"visual:{job_id}",
        reference_type="VISUAL_GENERATION_JOB",
        reference_id=str(job_id),
    )
    request_payload = payload.model_dump(mode="json")
    request_payload["model_id"] = model_id
    if project.mode == "STRUCTURED":
        request_payload["count"] = 1
    job = VisualGenerationJob(
        id=job_id,
        project_id=project.id,
        workspace_id=project.workspace_id,
        requested_by_user_id=principal.user_id,
        reservation_id=reservation.id,
        mode=project.mode,
        model_id=model_id,
        provider_model=provider_model,
        request_payload=request_payload,
        status="QUEUED",
        stage="QUEUED",
        progress=0,
        credit_cost=credit_cost,
    )
    database.add(job)
    database.flush()
    for memory_id in payload.memory_ids:
        database.add(VisualSource(job_id=job.id, memory_id=memory_id))
    project.status = "QUEUED"
    database.flush()
    return job, reservation


def get_accessible_visual_job(
    database: Session,
    principal: Principal,
    job_id: UUID,
) -> VisualGenerationJob | None:
    job = database.scalar(
        select(VisualGenerationJob).where(
            VisualGenerationJob.id == job_id,
            VisualGenerationJob.workspace_id == principal.workspace_id,
        )
    )
    if job is None:
        return None
    project = get_accessible_visual_project(database, principal, job.project_id)
    return job if project is not None else None


def cancel_visual_job(
    database: Session,
    principal: Principal,
    job: VisualGenerationJob,
) -> VisualGenerationJob:
    project = get_owned_visual_project(database, principal, job.project_id)
    if project is None or job.requested_by_user_id != principal.user_id:
        raise VisualAccessError("只有任务创建者可以取消生成")
    if job.status in {"COMPLETED", "CANCELLED"}:
        return job
    if job.status == "WAITING_CONFIRMATION":
        raise ValueError("结构已经生成，请确认或重新生成")
    job.status = "CANCELLED"
    job.stage = "CANCELLED"
    job.progress = 100
    job.next_run_at = None
    job.locked_at = None
    job.completed_at = datetime.now(UTC)
    project.status = "CANCELLED"
    release_credit_reservation(database, job.reservation_id)
    return job


def _sources_available_for_version(
    database: Session,
    principal: Principal,
    version: VisualVersion,
) -> bool:
    job = database.get(VisualGenerationJob, version.job_id)
    if job is None:
        return False
    return _sources_available_for_job(database, principal, job)


def confirm_visual_structure(
    database: Session,
    principal: Principal,
    project: VisualProject,
    version_id: UUID,
) -> VisualVersion:
    if project.owner_id != principal.user_id or project.mode != "STRUCTURED":
        raise VisualAccessError("只有作品创建者可以确认结构")
    version = database.scalar(
        select(VisualVersion).where(
            VisualVersion.id == version_id,
            VisualVersion.project_id == project.id,
            VisualVersion.status == "CANDIDATE",
        )
    )
    if version is None or version.graph is None:
        raise ValueError("待确认结构不存在")
    if not _sources_available_for_version(database, principal, version):
        raise VisualAccessError("结构来源已失效，请重新生成")
    graph = DiagramWriteRequest.model_validate(
        {
            "title": version.graph.get("title") or project.title,
            "kind": project.kind,
            "visibility": project.visibility,
            "nodes": version.graph.get("nodes"),
            "edges": version.graph.get("edges"),
        }
    )
    nodes, edges = validate_and_serialize_graph(
        database,
        principal,
        graph.nodes,
        graph.edges,
        graph.visibility,
    )
    diagram = Diagram(
        workspace_id=project.workspace_id,
        owner_id=project.owner_id,
        title=graph.title,
        kind=graph.kind,
        visibility=graph.visibility,
        nodes=nodes,
        edges=edges,
    )
    database.add(diagram)
    database.flush()
    version.status = "CONFIRMED"
    version.diagram_id = diagram.id
    job = database.get(VisualGenerationJob, version.job_id)
    if job is not None:
        job.status = "COMPLETED"
        job.stage = "SAVED"
    project.status = "COMPLETED"
    return version


def visual_job_response(job: VisualGenerationJob) -> VisualJobResponse:
    return VisualJobResponse(
        id=job.id,
        project_id=job.project_id,
        status=cast(Any, job.status),
        stage=job.stage,
        progress=job.progress,
        model_id=job.model_id,
        credit_cost=job.credit_cost,
        error_code=job.error_code,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
    )


def visual_project_response(
    database: Session,
    principal: Principal,
    project: VisualProject,
) -> VisualProjectResponse:
    jobs = database.scalars(
        select(VisualGenerationJob)
        .where(VisualGenerationJob.project_id == project.id)
        .order_by(VisualGenerationJob.created_at.desc(), VisualGenerationJob.id.desc())
    ).all()
    versions = database.scalars(
        select(VisualVersion)
        .where(VisualVersion.project_id == project.id)
        .order_by(VisualVersion.version_number.desc())
    ).all()
    version_responses: list[VisualVersionResponse] = []
    for version in versions:
        sources_available = _sources_available_for_version(database, principal, version)
        version_responses.append(
            VisualVersionResponse(
                id=version.id,
                version_number=version.version_number,
                status=cast(Any, version.status),
                model_id=version.model_id,
                graph=version.graph if sources_available else None,
                asset_url=(
                    f"/api/visuals/{project.id}/versions/{version.id}/content"
                    if sources_available and version.asset_id is not None
                    else None
                ),
                diagram_id=version.diagram_id if sources_available else None,
                sources_available=sources_available,
                created_at=version.created_at,
            )
        )
    return VisualProjectResponse(
        id=project.id,
        title=project.title,
        mode=cast(Any, project.mode),
        kind=cast(Any, project.kind),
        visibility=cast(Any, project.visibility),
        status=cast(Any, project.status),
        owner_id=project.owner_id,
        is_owner=project.owner_id == principal.user_id,
        latest_job=visual_job_response(jobs[0]) if jobs else None,
        versions=version_responses,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def visual_generation_response(
    database: Session,
    principal: Principal,
    project: VisualProject,
    job: VisualGenerationJob,
) -> VisualGenerationResponse:
    return VisualGenerationResponse(
        project=visual_project_response(database, principal, project),
        job=visual_job_response(job),
        credits_reserved=job.credit_cost,
    )


def get_authorized_visual_asset(
    database: Session,
    principal: Principal,
    project_id: UUID,
    version_id: UUID,
) -> Asset | None:
    project = get_accessible_visual_project(database, principal, project_id)
    if project is None:
        return None
    version = database.scalar(
        select(VisualVersion).where(
            VisualVersion.id == version_id,
            VisualVersion.project_id == project.id,
            VisualVersion.asset_id.is_not(None),
        )
    )
    if version is None or not _sources_available_for_version(database, principal, version):
        return None
    asset = database.get(Asset, version.asset_id)
    if (
        asset is None
        or asset.deleted_at is not None
        or asset.workspace_id != principal.workspace_id
    ):
        return None
    return asset


def next_visual_version_number(database: Session, project_id: UUID) -> int:
    current = database.scalar(
        select(func.max(VisualVersion.version_number)).where(VisualVersion.project_id == project_id)
    )
    return int(current or 0) + 1
