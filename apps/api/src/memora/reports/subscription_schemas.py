from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

ReportPreset = Literal["MISSED", "MEETING", "ONBOARDING", "HANDOVER", "KNOWLEDGE_GAPS"]
SubscriptionScope = Literal["PERSONAL", "MEMBER", "WORKSPACE", "PROJECT"]
ReportCadence = Literal["DAILY", "WEEKLY", "MONTHLY"]


class CreateReportSubscriptionRequest(BaseModel):
    preset: ReportPreset
    scope: SubscriptionScope
    topic: str | None = Field(default=None, max_length=500)
    subject_author_id: UUID | None = None
    visibility: Literal["PRIVATE", "WORKSPACE"] = "PRIVATE"
    cadence: ReportCadence = "WEEKLY"
    next_run_at: datetime | None = None

    @model_validator(mode="after")
    def validate_scope(self) -> "CreateReportSubscriptionRequest":
        if self.scope == "MEMBER" and self.subject_author_id is None:
            raise ValueError("成员报告订阅必须指定成员")
        if self.scope != "MEMBER" and self.subject_author_id is not None:
            raise ValueError("只有成员报告订阅可以指定成员")
        if self.scope == "PERSONAL" and self.visibility == "WORKSPACE":
            raise ValueError("个人报告订阅不能自动共享")
        if self.next_run_at is not None and self.next_run_at.tzinfo is None:
            raise ValueError("下次执行时间必须包含时区")
        if self.topic is not None:
            self.topic = self.topic.strip() or None
        return self


class UpdateReportSubscriptionRequest(BaseModel):
    status: Literal["ACTIVE", "PAUSED"] | None = None
    cadence: ReportCadence | None = None
    next_run_at: datetime | None = None

    @model_validator(mode="after")
    def validate_update(self) -> "UpdateReportSubscriptionRequest":
        if self.next_run_at is not None and self.next_run_at.tzinfo is None:
            raise ValueError("下次执行时间必须包含时区")
        if self.status is None and self.cadence is None and self.next_run_at is None:
            raise ValueError("至少提供一项订阅修改")
        return self


class ReportSubscriptionResponse(BaseModel):
    id: UUID
    preset: ReportPreset
    scope: SubscriptionScope
    topic: str
    subject_author_id: UUID | None
    visibility: Literal["PRIVATE", "WORKSPACE"]
    cadence: ReportCadence
    status: Literal["ACTIVE", "PAUSED"]
    next_run_at: datetime
    last_run_at: datetime | None
    last_report_id: UUID | None
    last_error_code: str | None
    created_at: datetime
    updated_at: datetime
