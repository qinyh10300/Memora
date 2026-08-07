from typing import cast

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from memora.billing.models import CreditLedgerEntry, Subscription
from memora.billing.schemas import (
    CreditLedgerEntryResponse,
    PlanCode,
    PlanResponse,
    SubscriptionResponse,
    UpgradeSubscriptionRequest,
)
from memora.billing.service import (
    PLAN_BY_CODE,
    PLAN_SPECS,
    CreditReason,
    PlanDowngradeError,
    SubscriptionStatus,
    credits_remaining,
    get_or_create_subscription,
    upgrade_subscription,
)
from memora.database import DatabaseSession
from memora.identity.dependencies import CurrentPrincipal

router = APIRouter(prefix="/billing", tags=["billing"])


def subscription_response_for(subscription: Subscription) -> SubscriptionResponse:
    plan_code = cast(PlanCode, subscription.plan_code)
    return SubscriptionResponse(
        plan_code=plan_code,
        plan_name=PLAN_BY_CODE[plan_code].name,
        status=cast(SubscriptionStatus, subscription.status),
        period_started_at=subscription.period_started_at,
        period_ends_at=subscription.period_ends_at,
        credits_granted=subscription.credits_granted,
        credits_used=subscription.credits_used,
        credits_reserved=subscription.credits_reserved,
        credits_remaining=credits_remaining(subscription),
    )


@router.get("/plans", response_model=list[PlanResponse])
def list_plans(
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> list[PlanResponse]:
    subscription = get_or_create_subscription(database, principal.user_id)
    database.commit()
    return [
        PlanResponse(
            code=plan.code,
            name=plan.name,
            credits_per_period=plan.credits_per_period,
            description=plan.description,
            features=list(plan.features),
            is_current=plan.code == subscription.plan_code,
        )
        for plan in PLAN_SPECS
    ]


@router.get("/subscription", response_model=SubscriptionResponse)
def get_subscription(
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> SubscriptionResponse:
    subscription = get_or_create_subscription(database, principal.user_id)
    database.commit()
    database.refresh(subscription)
    return subscription_response_for(subscription)


@router.post("/subscription/upgrade", response_model=SubscriptionResponse)
def upgrade_current_subscription(
    payload: UpgradeSubscriptionRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> SubscriptionResponse:
    try:
        subscription = upgrade_subscription(database, principal.user_id, payload.plan_code)
    except PlanDowngradeError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    database.commit()
    database.refresh(subscription)
    return subscription_response_for(subscription)


@router.get("/credits", response_model=list[CreditLedgerEntryResponse])
def list_credit_ledger(
    principal: CurrentPrincipal,
    database: DatabaseSession,
    limit: int = Query(default=20, ge=1, le=100),
) -> list[CreditLedgerEntryResponse]:
    get_or_create_subscription(database, principal.user_id)
    database.commit()
    entries = database.scalars(
        select(CreditLedgerEntry)
        .where(CreditLedgerEntry.user_id == principal.user_id)
        .order_by(CreditLedgerEntry.created_at.desc(), CreditLedgerEntry.id.desc())
        .limit(limit)
    ).all()
    return [
        CreditLedgerEntryResponse(
            id=entry.id,
            delta=entry.delta,
            balance_after=entry.balance_after,
            reason=cast(CreditReason, entry.reason),
            reference_type=entry.reference_type,
            reference_id=entry.reference_id,
            created_at=entry.created_at,
        )
        for entry in entries
    ]
