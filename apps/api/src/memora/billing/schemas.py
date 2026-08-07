from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

PlanCode = Literal["PLUS", "PRO", "ULTRA"]


class PlanResponse(BaseModel):
    code: PlanCode
    name: str
    credits_per_period: int = Field(ge=0)
    description: str
    features: list[str]
    is_current: bool


class SubscriptionResponse(BaseModel):
    plan_code: PlanCode
    plan_name: str
    status: Literal["ACTIVE", "PAST_DUE", "CANCELLED"]
    period_started_at: datetime
    period_ends_at: datetime
    credits_granted: int = Field(ge=0)
    credits_used: int = Field(ge=0)
    credits_reserved: int = Field(ge=0)
    credits_remaining: int = Field(ge=0)


class UpgradeSubscriptionRequest(BaseModel):
    plan_code: PlanCode


class CreditLedgerEntryResponse(BaseModel):
    id: UUID
    delta: int
    balance_after: int = Field(ge=0)
    reason: Literal[
        "PERIOD_GRANT",
        "PERIOD_RESET",
        "PLAN_UPGRADE",
        "AI_RESERVATION",
        "AI_RESERVATION_RELEASE",
        "AI_USAGE",
        "REFUND",
    ]
    reference_type: str | None
    reference_id: str | None
    created_at: datetime
