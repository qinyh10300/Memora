from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from memora.retrieval.schemas import EvidenceCitationResponse

PositionStatus = Literal[
    "CANDIDATE",
    "CONFIRMED",
    "REVISED",
    "WITHDRAWN",
    "NO_RECORDED_POSITION",
]


class CreateAlignmentRequest(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    context: str = Field(default="", max_length=3000)
    participant_ids: list[UUID] = Field(default_factory=list, max_length=100)
    created_from: datetime | None = None
    created_to: datetime | None = None

    @field_validator("title", "context")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def validate_range(self) -> "CreateAlignmentRequest":
        if (self.created_from is None) != (self.created_to is None):
            raise ValueError("对齐议题的时间范围需要同时提供开始和结束")
        if self.created_from is not None and self.created_to is not None:
            if self.created_from.tzinfo is None or self.created_to.tzinfo is None:
                raise ValueError("对齐议题时间范围必须包含时区")
            if self.created_from >= self.created_to:
                raise ValueError("开始时间必须早于结束时间")
        return self


class UpdateAlignmentPositionRequest(BaseModel):
    action: Literal["CONFIRM", "REVISE", "WITHDRAW"]
    text: str | None = Field(default=None, max_length=4000)

    @model_validator(mode="after")
    def validate_action(self) -> "UpdateAlignmentPositionRequest":
        if self.action == "REVISE" and not (self.text or "").strip():
            raise ValueError("修正观点时必须填写内容")
        return self


class PublishDecisionRequest(BaseModel):
    decision: str = Field(min_length=1, max_length=6000)
    rationale: str = Field(min_length=1, max_length=6000)
    alternatives: list[str] = Field(default_factory=list, max_length=20)
    review_at: datetime | None = None
    supersedes_id: UUID | None = None

    @field_validator("decision", "rationale")
    @classmethod
    def normalize_required(cls, value: str) -> str:
        return value.strip()

    @field_validator("alternatives")
    @classmethod
    def normalize_alternatives(cls, values: list[str]) -> list[str]:
        return [value.strip() for value in values if value.strip()]


class AlignmentPositionResponse(BaseModel):
    id: UUID
    user_id: UUID
    display_name: str
    status: PositionStatus
    text: str | None
    is_current_user: bool
    citations: list[EvidenceCitationResponse]
    confirmed_at: datetime | None
    updated_at: datetime


class DecisionRecordResponse(BaseModel):
    id: UUID
    decision: str
    rationale: str
    alternatives: list[str]
    position_snapshot: list[dict[str, object]]
    review_at: datetime | None
    memory_id: UUID
    supersedes_id: UUID | None
    published_by_user_id: UUID
    created_at: datetime


class AlignmentTopicResponse(BaseModel):
    id: UUID
    title: str
    context: str
    status: Literal["OPEN", "DECIDED", "ARCHIVED"]
    summary_status: Literal["CONSENSUS", "DIFFERENCES", "INSUFFICIENT_EVIDENCE"]
    is_owner: bool
    can_publish_decision: bool
    evidence_from: datetime
    evidence_to: datetime
    positions: list[AlignmentPositionResponse]
    decisions: list[DecisionRecordResponse]
    created_at: datetime
    updated_at: datetime
