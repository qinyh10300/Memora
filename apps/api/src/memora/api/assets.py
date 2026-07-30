from __future__ import annotations

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
    return asset_response_for(asset)


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
