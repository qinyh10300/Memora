import { api } from "@/lib/api";

import type {
  Asset,
  AssetMediaType,
  DocumentStatus,
  DraftDocumentAttachment,
  DraftImageAttachment,
  DraftImageInput,
} from "@/features/shared/contracts";
import { nextId, readFileAsDataUrl } from "@/features/shared/utils";

export const MAX_DRAFT_IMAGES = 3;
export const MAX_DRAFT_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_DRAFT_IMAGE_TOTAL_BYTES = 16 * 1024 * 1024;
export const MAX_DRAFT_DOCUMENTS = 3;
export const MAX_DRAFT_PDF_BYTES = 20 * 1024 * 1024;
export const ACCEPTED_DRAFT_IMAGE_TYPES = new Set<DraftImageInput["media_type"]>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
export const ACCEPTED_ASSET_TYPES = new Set<AssetMediaType>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
]);
export const IMAGE_ONLY_INSTRUCTION = "请读取这些图片，提取其中的文字，并整理到右侧 Markdown。";

function base64FromDataUrl(value: string) {
  const commaIndex = value.indexOf(",");
  if (commaIndex < 0) throw new Error("file_read_failed");
  return value.slice(commaIndex + 1);
}

async function uploadAsset(file: File, data: string): Promise<Asset> {
  const { data: asset, response } = await api.POST("/assets", {
    body: {
      name: file.name || "未命名附件",
      media_type: file.type as AssetMediaType,
      data,
    },
  });
  if (!asset || !response.ok) throw new Error("asset_upload_failed");
  return asset;
}

export async function readImageAttachment(file: File): Promise<DraftImageAttachment> {
  const previewUrl = await readFileAsDataUrl(file);
  const data = base64FromDataUrl(previewUrl);
  const asset = await uploadAsset(file, data);
  if (!asset.markdown_url) throw new Error("asset_upload_failed");
  return {
    id: nextId("image"),
    assetId: asset.id,
    markdownUrl: asset.markdown_url,
    name: asset.name,
    media_type: asset.media_type as DraftImageInput["media_type"],
    data,
    previewUrl,
  };
}

export async function readDocumentAttachment(file: File): Promise<DraftDocumentAttachment> {
  const dataUrl = await readFileAsDataUrl(file);
  const asset = await uploadAsset(file, base64FromDataUrl(dataUrl));
  if (!asset.document) throw new Error("document_job_missing");
  return {
    id: nextId("attachment"),
    assetId: asset.id,
    name: asset.name,
    mediaType: asset.media_type,
    sizeBytes: asset.size_bytes,
    document: asset.document,
  };
}

export async function getDocumentStatus(assetId: string): Promise<DocumentStatus> {
  const { data, response } = await api.GET("/assets/{asset_id}/document", {
    params: { path: { asset_id: assetId } },
  });
  if (!data || !response.ok) throw new Error("document_status_failed");
  return data;
}

export async function cancelDocumentParse(assetId: string): Promise<DocumentStatus> {
  const { data, response } = await api.POST("/assets/{asset_id}/document/cancel", {
    params: { path: { asset_id: assetId } },
  });
  if (!data || !response.ok) throw new Error("document_cancel_failed");
  return data;
}

export async function retryDocumentParse(assetId: string): Promise<DocumentStatus> {
  const { data, response } = await api.POST("/assets/{asset_id}/document/retry", {
    params: { path: { asset_id: assetId } },
  });
  if (!data || !response.ok) throw new Error("document_retry_failed");
  return data;
}

export function appendMarkdownImage(markdown: string, image: DraftImageAttachment) {
  const alt = image.name.replace(/[\]\n\r]/g, " ").trim() || "图片";
  const imageMarkdown = `![${alt}](${image.markdownUrl})`;
  return markdown.trim() ? `${markdown.replace(/\s*$/, "")}\n\n${imageMarkdown}` : imageMarkdown;
}
