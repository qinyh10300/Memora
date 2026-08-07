from datetime import datetime
from typing import Any, Literal, Self
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from memora.ai.ports import ImageAspectRatio, ImageQuality, ImageWatermarkMode

VisualMode = Literal["STRUCTURED", "IMAGE"]
VisualKind = Literal["SCIENTIFIC", "MIND_MAP", "FLOWCHART", "TIMELINE"]
VisualVisibility = Literal["PRIVATE", "WORKSPACE"]
VisualProjectStatus = Literal[
    "DRAFT",
    "QUEUED",
    "GENERATING",
    "WAITING_CONFIRMATION",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
]
VisualJobStatus = Literal[
    "QUEUED",
    "RUNNING",
    "WAITING_CONFIGURATION",
    "WAITING_CONFIRMATION",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
]


class ImageModelResponse(BaseModel):
    id: str
    label: str
    description: str
    min_plan: Literal["PLUS", "PRO", "ULTRA"]
    badge: Literal["BEST", "NEW"] | None
    is_default: bool
    configured: bool
    locked: bool


class VisualTemplateResponse(BaseModel):
    id: str
    label: str
    description: str
    mode: VisualMode
    kind: VisualKind
    preview_tone: str


class CreateVisualProjectRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    mode: VisualMode
    kind: VisualKind
    visibility: VisualVisibility = "PRIVATE"

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("作品标题不能为空")
        return normalized

    @model_validator(mode="after")
    def validate_mode_kind(self) -> Self:
        if self.mode == "IMAGE" and self.kind != "SCIENTIFIC":
            raise ValueError("图片模式当前只支持科研视觉")
        if self.mode == "STRUCTURED" and self.kind == "SCIENTIFIC":
            raise ValueError("结构图请选择思维导图、流程图或时间线")
        return self


class GenerateVisualRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4_000)
    model_id: str | None = Field(default=None, min_length=1, max_length=64)
    memory_ids: list[UUID] = Field(default_factory=list, max_length=30)
    aspect_ratio: ImageAspectRatio = "1:1"
    count: int = Field(default=1, ge=1, le=4)
    quality: ImageQuality = "standard"
    scientific_style: bool = True
    watermark_mode: ImageWatermarkMode = "CLEAN_OUTPUT"
    output_language: str = Field(default="auto", min_length=2, max_length=40)

    @field_validator("prompt", "output_language")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("生成设置不能为空")
        return normalized

    @field_validator("memory_ids")
    @classmethod
    def unique_sources(cls, value: list[UUID]) -> list[UUID]:
        if len(value) != len(set(value)):
            raise ValueError("记忆来源不能重复")
        return value


class VisualVersionResponse(BaseModel):
    id: UUID
    version_number: int
    status: Literal["CANDIDATE", "CONFIRMED"]
    model_id: str
    graph: dict[str, Any] | None
    asset_url: str | None
    diagram_id: UUID | None
    sources_available: bool
    created_at: datetime


class VisualJobResponse(BaseModel):
    id: UUID
    project_id: UUID
    status: VisualJobStatus
    stage: str
    progress: int = Field(ge=0, le=100)
    model_id: str
    credit_cost: int = Field(gt=0)
    error_code: str | None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class VisualProjectResponse(BaseModel):
    id: UUID
    title: str
    mode: VisualMode
    kind: VisualKind
    visibility: VisualVisibility
    status: VisualProjectStatus
    owner_id: UUID
    is_owner: bool
    latest_job: VisualJobResponse | None
    versions: list[VisualVersionResponse]
    created_at: datetime
    updated_at: datetime


class VisualGenerationResponse(BaseModel):
    project: VisualProjectResponse
    job: VisualJobResponse
    credits_reserved: int = Field(gt=0)


class ConfirmVisualStructureRequest(BaseModel):
    version_id: UUID
