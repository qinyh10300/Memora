from __future__ import annotations

import base64
import binascii
import hashlib
import re
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import exists, select

from memora.assets.models import Asset
from memora.database import DatabaseSession
from memora.identity.dependencies import Principal
from memora.memories.models import Memory

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_ASSET_BASE64_CHARS = ((MAX_PDF_BYTES + 2) // 3) * 4
ASSET_MARKDOWN_PATTERN = re.compile(
    r"/api/assets/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/content"
)


class AssetValidationError(ValueError):
    pass


def decode_asset_base64(data: str) -> bytes:
    if len(data) > MAX_ASSET_BASE64_CHARS:
        raise AssetValidationError("附件不能超过 20 MiB")
    try:
        return base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as error:
        raise AssetValidationError("附件数据不是有效的 Base64") from error


def asset_kind_for(content: bytes, media_type: str) -> str:
    if media_type == "image/png":
        if len(content) > MAX_IMAGE_BYTES:
            raise AssetValidationError("单张图片不能超过 8 MiB")
        if not content.startswith(b"\x89PNG\r\n\x1a\n"):
            raise AssetValidationError("图片内容与文件类型不匹配")
        return "IMAGE"
    if media_type == "image/jpeg":
        if len(content) > MAX_IMAGE_BYTES:
            raise AssetValidationError("单张图片不能超过 8 MiB")
        if not content.startswith(b"\xff\xd8\xff"):
            raise AssetValidationError("图片内容与文件类型不匹配")
        return "IMAGE"
    if media_type == "image/webp":
        if len(content) > MAX_IMAGE_BYTES:
            raise AssetValidationError("单张图片不能超过 8 MiB")
        if not (len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP"):
            raise AssetValidationError("图片内容与文件类型不匹配")
        return "IMAGE"
    if media_type == "application/pdf":
        if len(content) > MAX_PDF_BYTES:
            raise AssetValidationError("PDF 不能超过 20 MiB")
        if not content.startswith(b"%PDF-"):
            raise AssetValidationError("PDF 内容与文件类型不匹配")
        return "PDF"
    raise AssetValidationError("不支持的附件类型")


def normalize_asset_name(name: str) -> str:
    normalized = re.sub(r"\s+", " ", name.strip())
    if not normalized:
        raise AssetValidationError("附件名称不能为空")
    return normalized[:180]


def create_asset(
    database: DatabaseSession,
    principal: Principal,
    *,
    name: str,
    media_type: str,
    content: bytes,
) -> Asset:
    kind = asset_kind_for(content, media_type)
    asset = Asset(
        workspace_id=principal.workspace_id,
        owner_id=principal.user_id,
        kind=kind,
        name=normalize_asset_name(name),
        content_type=media_type,
        size_bytes=len(content),
        sha256=hashlib.sha256(content).hexdigest(),
        content=content,
    )
    database.add(asset)
    return asset


def markdown_asset_ids(markdown: str) -> set[UUID]:
    ids: set[UUID] = set()
    for match in ASSET_MARKDOWN_PATTERN.finditer(markdown):
        try:
            ids.add(UUID(match.group(1)))
        except ValueError:
            continue
    return ids


def asset_markdown_url(asset_id: UUID) -> str:
    return f"/api/assets/{asset_id}/content"


def _has_authorized_memory_reference(
    database: DatabaseSession,
    principal: Principal,
    asset_id: UUID,
) -> bool:
    marker = asset_markdown_url(asset_id)
    statement = select(
        exists().where(
            Memory.workspace_id == principal.workspace_id,
            Memory.visibility == "WORKSPACE",
            Memory.timeline_visible.is_(True),
            Memory.deleted_at.is_(None),
            Memory.body.contains(marker),
        )
    )
    return bool(database.scalar(statement))


def get_authorized_asset(
    database: DatabaseSession,
    principal: Principal,
    asset_id: UUID,
) -> Asset | None:
    asset = database.scalar(
        select(Asset).where(
            Asset.id == asset_id,
            Asset.workspace_id == principal.workspace_id,
            Asset.deleted_at.is_(None),
        )
    )
    if asset is None:
        return None
    if asset.owner_id == principal.user_id:
        return asset
    if _has_authorized_memory_reference(database, principal, asset.id):
        return asset
    return None


def cleanup_unreferenced_assets_for_deleted_markdown(
    database: DatabaseSession,
    principal: Principal,
    markdown_values: list[str],
) -> None:
    candidate_ids: set[UUID] = set()
    for markdown in markdown_values:
        candidate_ids.update(markdown_asset_ids(markdown))
    if not candidate_ids:
        return

    deleted_at = datetime.now(UTC)
    for asset_id in candidate_ids:
        marker = asset_markdown_url(asset_id)
        still_referenced = database.scalar(
            select(
                exists().where(
                    Memory.workspace_id == principal.workspace_id,
                    Memory.author_id == principal.user_id,
                    Memory.deleted_at.is_(None),
                    Memory.body.contains(marker),
                )
            )
        )
        if still_referenced:
            continue
        asset = database.scalar(
            select(Asset).where(
                Asset.id == asset_id,
                Asset.workspace_id == principal.workspace_id,
                Asset.owner_id == principal.user_id,
                Asset.deleted_at.is_(None),
            )
        )
        if asset is not None:
            asset.deleted_at = deleted_at
