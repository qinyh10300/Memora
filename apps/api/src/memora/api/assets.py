from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response, status

from memora.assets.schemas import AssetResponse, CreateAssetRequest, asset_response_for
from memora.assets.service import (
    AssetValidationError,
    create_asset,
    decode_asset_base64,
    get_authorized_asset,
)
from memora.audit.models import AuditEvent
from memora.database import DatabaseSession
from memora.documents.schemas import DocumentStatusResponse, document_status_for
from memora.documents.service import (
    delete_document_derivatives,
    get_authorized_document_job,
    get_owned_document_job,
    queue_document_parse,
    request_document_cancel,
    retry_document_parse,
)
from memora.identity.dependencies import CurrentPrincipal

router = APIRouter(prefix="/assets", tags=["assets"])


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="附件不存在")


@router.post("", response_model=AssetResponse, status_code=status.HTTP_201_CREATED)
def upload_asset(
    payload: CreateAssetRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> AssetResponse:
    try:
        content = decode_asset_base64(payload.data)
        asset = create_asset(
            database,
            principal,
            name=payload.name,
            media_type=payload.media_type,
            content=content,
        )
    except AssetValidationError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error

    database.flush()
    document_job = queue_document_parse(database, asset) if asset.kind == "PDF" else None
    if document_job is not None:
        database.flush()
    database.add(
        AuditEvent(
            workspace_id=principal.workspace_id,
            actor_id=principal.user_id,
            action="ASSET_UPLOADED",
            resource_type="ASSET",
            resource_id=asset.id,
        )
    )
    database.commit()
    database.refresh(asset)
    return asset_response_for(asset, document_job)


@router.get("/{asset_id}/content")
def get_asset_content(
    asset_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> Response:
    asset = get_authorized_asset(database, principal, asset_id)
    if asset is None:
        raise _not_found()
    return Response(
        content=asset.content,
        media_type=asset.content_type,
        headers={
            "Cache-Control": "private, max-age=3600",
            "Content-Disposition": f'inline; filename="{asset.name}"',
            "X-Memora-Asset-Id": str(asset.id),
        },
    )


@router.get("/{asset_id}/document", response_model=DocumentStatusResponse)
def get_document_status(
    asset_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> DocumentStatusResponse:
    row = get_authorized_document_job(database, principal, asset_id)
    if row is None:
        raise _not_found()
    asset, job = row
    return document_status_for(job, is_owner=asset.owner_id == principal.user_id)


@router.post("/{asset_id}/document/cancel", response_model=DocumentStatusResponse)
def cancel_document_parse(
    asset_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> DocumentStatusResponse:
    row = get_owned_document_job(database, principal, asset_id)
    if row is None:
        raise _not_found()
    _asset, job = row
    request_document_cancel(job)
    database.add(
        AuditEvent(
            workspace_id=principal.workspace_id,
            actor_id=principal.user_id,
            action="DOCUMENT_PARSE_CANCEL_REQUESTED",
            resource_type="ASSET",
            resource_id=asset_id,
        )
    )
    database.commit()
    database.refresh(job)
    return document_status_for(job, is_owner=True)


@router.post("/{asset_id}/document/retry", response_model=DocumentStatusResponse)
def retry_document_parse_job(
    asset_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> DocumentStatusResponse:
    row = get_owned_document_job(database, principal, asset_id)
    if row is None:
        raise _not_found()
    _asset, job = row
    retry_document_parse(job)
    database.add(
        AuditEvent(
            workspace_id=principal.workspace_id,
            actor_id=principal.user_id,
            action="DOCUMENT_PARSE_RETRIED",
            resource_type="ASSET",
            resource_id=asset_id,
        )
    )
    database.commit()
    database.refresh(job)
    return document_status_for(job, is_owner=True)


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document_asset(
    asset_id: UUID,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> None:
    row = get_owned_document_job(database, principal, asset_id)
    if row is None:
        raise _not_found()
    asset, _job = row
    delete_document_derivatives(database, asset.id)
    asset.content = b""
    asset.deleted_at = datetime.now(UTC)
    database.add(
        AuditEvent(
            workspace_id=principal.workspace_id,
            actor_id=principal.user_id,
            action="DOCUMENT_ASSET_DELETED",
            resource_type="ASSET",
            resource_id=asset.id,
        )
    )
    database.commit()
