from __future__ import annotations

from datetime import datetime
from typing import Literal, cast
from uuid import UUID

from pydantic import BaseModel, Field

from memora.assets.models import Asset
from memora.documents.models import DocumentParseJob
from memora.documents.schemas import DocumentStatusResponse, document_status_for

AssetKind = Literal["IMAGE", "PDF"]
AssetMediaType = Literal["image/png", "image/jpeg", "image/webp", "application/pdf"]


class AssetResponse(BaseModel):
    id: UUID
    name: str
    kind: AssetKind
    media_type: AssetMediaType
    size_bytes: int
    markdown_url: str | None
    document: DocumentStatusResponse | None = None
    created_at: datetime


class CreateAssetRequest(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    media_type: AssetMediaType
    data: str = Field(min_length=1)


def asset_response_for(
    asset: Asset,
    document_job: DocumentParseJob | None = None,
    *,
    is_owner: bool = True,
) -> AssetResponse:
    markdown_url = f"/api/assets/{asset.id}/content" if asset.kind == "IMAGE" else None
    return AssetResponse(
        id=asset.id,
        name=asset.name,
        kind=cast(AssetKind, asset.kind),
        media_type=cast(AssetMediaType, asset.content_type),
        size_bytes=asset.size_bytes,
        markdown_url=markdown_url,
        document=(
            document_status_for(document_job, is_owner=is_owner)
            if document_job is not None
            else None
        ),
        created_at=asset.created_at,
    )
