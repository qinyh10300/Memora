from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal, cast
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from memora.billing.models import CreditLedgerEntry, CreditReservation, Subscription

PlanCode = Literal["PLUS", "PRO", "ULTRA"]
SubscriptionStatus = Literal["ACTIVE", "PAST_DUE", "CANCELLED"]
CreditReason = Literal[
    "PERIOD_GRANT",
    "PERIOD_RESET",
    "PLAN_UPGRADE",
    "AI_RESERVATION",
    "AI_RESERVATION_RELEASE",
    "AI_USAGE",
    "REFUND",
]
CreditReservationStatus = Literal["RESERVED", "SETTLED", "RELEASED", "EXPIRED"]
PERIOD_DAYS = 30
RESERVATION_TTL_MINUTES = 30


@dataclass(frozen=True)
class PlanSpec:
    code: PlanCode
    name: str
    credits_per_period: int
    description: str
    features: tuple[str, ...]


PLAN_SPECS: tuple[PlanSpec, ...] = (
    PlanSpec(
        code="PLUS",
        name="Plus",
        credits_per_period=2_000,
        description="适合持续记录与个人知识整理",
        features=("个人与家庭空间", "GPT / Claude / Gemini", "基础框图与知识库"),
    ),
    PlanSpec(
        code="PRO",
        name="Pro",
        credits_per_period=10_000,
        description="适合高频研究与小团队协作",
        features=("包含 Plus 全部能力", "深度调研", "团队共享框图"),
    ),
    PlanSpec(
        code="ULTRA",
        name="Ultra",
        credits_per_period=50_000,
        description="适合密集研究与多空间工作流",
        features=("包含 Pro 全部能力", "最高周期额度", "优先体验新模型能力"),
    ),
)
PLAN_BY_CODE = {plan.code: plan for plan in PLAN_SPECS}
PLAN_RANK = {plan.code: rank for rank, plan in enumerate(PLAN_SPECS)}


class InsufficientCreditsError(RuntimeError):
    pass


class PlanDowngradeError(ValueError):
    pass


def credits_remaining(subscription: Subscription) -> int:
    return max(
        subscription.credits_granted - subscription.credits_used - subscription.credits_reserved,
        0,
    )


def _ledger_entry(
    *,
    user_id: UUID,
    delta: int,
    balance_after: int,
    reason: CreditReason,
    idempotency_key: str,
    reference_type: str | None = None,
    reference_id: str | None = None,
) -> CreditLedgerEntry:
    return CreditLedgerEntry(
        user_id=user_id,
        delta=delta,
        balance_after=balance_after,
        reason=reason,
        idempotency_key=idempotency_key,
        reference_type=reference_type,
        reference_id=reference_id,
    )


def _period_end(started_at: datetime) -> datetime:
    return started_at + timedelta(days=PERIOD_DAYS)


def _refresh_period(
    database: Session,
    subscription: Subscription,
    *,
    now: datetime,
) -> Subscription:
    period_ends_at = subscription.period_ends_at
    if period_ends_at.tzinfo is None:
        period_ends_at = period_ends_at.replace(tzinfo=UTC)
    if period_ends_at > now:
        return subscription
    plan = PLAN_BY_CODE[cast(PlanCode, subscription.plan_code)]
    previous_balance = credits_remaining(subscription)
    subscription.period_started_at = now
    subscription.period_ends_at = _period_end(now)
    subscription.credits_granted = plan.credits_per_period
    subscription.credits_used = 0
    subscription.version += 1
    database.add(
        _ledger_entry(
            user_id=subscription.user_id,
            delta=plan.credits_per_period - previous_balance,
            balance_after=plan.credits_per_period,
            reason="PERIOD_RESET",
            idempotency_key=f"period:{subscription.period_started_at.isoformat()}",
        )
    )
    return subscription


def get_or_create_subscription(
    database: Session,
    user_id: UUID,
    *,
    now: datetime | None = None,
    lock: bool = False,
) -> Subscription:
    resolved_now = now or datetime.now(UTC)
    statement = select(Subscription).where(Subscription.user_id == user_id)
    if lock:
        statement = statement.with_for_update()
    subscription = database.scalar(statement)
    if subscription is None:
        plan = PLAN_BY_CODE["PLUS"]
        subscription = Subscription(
            user_id=user_id,
            plan_code=plan.code,
            status="ACTIVE",
            period_started_at=resolved_now,
            period_ends_at=_period_end(resolved_now),
            credits_granted=plan.credits_per_period,
            credits_used=0,
            credits_reserved=0,
            version=1,
        )
        database.add(subscription)
        database.flush()
        database.add(
            _ledger_entry(
                user_id=user_id,
                delta=plan.credits_per_period,
                balance_after=plan.credits_per_period,
                reason="PERIOD_GRANT",
                idempotency_key="initial-plus-grant",
            )
        )
        return subscription
    return _refresh_period(database, subscription, now=resolved_now)


def upgrade_subscription(
    database: Session,
    user_id: UUID,
    plan_code: PlanCode,
    *,
    now: datetime | None = None,
) -> Subscription:
    subscription = get_or_create_subscription(database, user_id, now=now, lock=True)
    current_code = cast(PlanCode, subscription.plan_code)
    if PLAN_RANK[plan_code] < PLAN_RANK[current_code]:
        raise PlanDowngradeError("当前版本只支持升级套餐")
    if plan_code == current_code:
        return subscription

    previous_balance = credits_remaining(subscription)
    next_plan = PLAN_BY_CODE[plan_code]
    subscription.plan_code = plan_code
    subscription.credits_granted = next_plan.credits_per_period
    subscription.credits_used = min(
        subscription.credits_used,
        next_plan.credits_per_period - subscription.credits_reserved,
    )
    subscription.version += 1
    next_balance = credits_remaining(subscription)
    database.add(
        _ledger_entry(
            user_id=user_id,
            delta=next_balance - previous_balance,
            balance_after=next_balance,
            reason="PLAN_UPGRADE",
            idempotency_key=f"upgrade:{subscription.version}:{plan_code}",
            reference_type="SUBSCRIPTION",
            reference_id=plan_code,
        )
    )
    return subscription


def require_available_credits(
    database: Session,
    user_id: UUID,
    cost: int,
) -> Subscription:
    subscription = get_or_create_subscription(database, user_id, lock=True)
    if subscription.status != "ACTIVE" or credits_remaining(subscription) < cost:
        raise InsufficientCreditsError("credits 余额不足，请升级套餐")
    return subscription


def consume_credits(
    database: Session,
    user_id: UUID,
    cost: int,
    *,
    idempotency_key: str,
    reference_type: str,
    reference_id: str,
) -> Subscription:
    existing = database.scalar(
        select(CreditLedgerEntry).where(
            CreditLedgerEntry.user_id == user_id,
            CreditLedgerEntry.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        return get_or_create_subscription(database, user_id, lock=True)
    subscription = require_available_credits(database, user_id, cost)
    subscription.credits_used += cost
    subscription.version += 1
    database.add(
        _ledger_entry(
            user_id=user_id,
            delta=-cost,
            balance_after=credits_remaining(subscription),
            reason="AI_USAGE",
            idempotency_key=idempotency_key,
            reference_type=reference_type,
            reference_id=reference_id,
        )
    )
    return subscription


def reserve_credits(
    database: Session,
    user_id: UUID,
    amount: int,
    *,
    idempotency_key: str,
    reference_type: str,
    reference_id: str,
    now: datetime | None = None,
) -> CreditReservation:
    if amount <= 0:
        raise ValueError("credit reservation amount must be positive")
    existing = database.scalar(
        select(CreditReservation).where(
            CreditReservation.user_id == user_id,
            CreditReservation.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        return existing
    subscription = require_available_credits(database, user_id, amount)
    resolved_now = now or datetime.now(UTC)
    subscription.credits_reserved += amount
    subscription.version += 1
    reservation = CreditReservation(
        user_id=user_id,
        amount=amount,
        status="RESERVED",
        idempotency_key=idempotency_key,
        reference_type=reference_type,
        reference_id=reference_id,
        expires_at=resolved_now + timedelta(minutes=RESERVATION_TTL_MINUTES),
    )
    database.add(reservation)
    database.flush()
    database.add(
        _ledger_entry(
            user_id=user_id,
            delta=-amount,
            balance_after=credits_remaining(subscription),
            reason="AI_RESERVATION",
            idempotency_key=f"reserve:{reservation.id}",
            reference_type=reference_type,
            reference_id=reference_id,
        )
    )
    return reservation


def settle_credit_reservation(
    database: Session,
    reservation_id: UUID,
    *,
    now: datetime | None = None,
) -> CreditReservation:
    reservation = database.scalar(
        select(CreditReservation).where(CreditReservation.id == reservation_id).with_for_update()
    )
    if reservation is None:
        raise LookupError("credit reservation does not exist")
    if reservation.status == "SETTLED":
        return reservation
    if reservation.status != "RESERVED":
        raise ValueError("credit reservation is no longer active")
    subscription = get_or_create_subscription(database, reservation.user_id, lock=True)
    if subscription.credits_reserved < reservation.amount:
        raise RuntimeError("credit reservation balance is inconsistent")
    subscription.credits_reserved -= reservation.amount
    subscription.credits_used += reservation.amount
    subscription.version += 1
    reservation.status = "SETTLED"
    reservation.settled_at = now or datetime.now(UTC)
    database.add(
        _ledger_entry(
            user_id=reservation.user_id,
            delta=0,
            balance_after=credits_remaining(subscription),
            reason="AI_USAGE",
            idempotency_key=f"settle:{reservation.id}",
            reference_type=reservation.reference_type,
            reference_id=reservation.reference_id,
        )
    )
    return reservation


def release_credit_reservation(
    database: Session,
    reservation_id: UUID,
    *,
    expired: bool = False,
    now: datetime | None = None,
) -> CreditReservation:
    reservation = database.scalar(
        select(CreditReservation).where(CreditReservation.id == reservation_id).with_for_update()
    )
    if reservation is None:
        raise LookupError("credit reservation does not exist")
    if reservation.status in {"RELEASED", "EXPIRED"}:
        return reservation
    if reservation.status != "RESERVED":
        raise ValueError("settled credit reservation cannot be released")
    subscription = get_or_create_subscription(database, reservation.user_id, lock=True)
    if subscription.credits_reserved < reservation.amount:
        raise RuntimeError("credit reservation balance is inconsistent")
    subscription.credits_reserved -= reservation.amount
    subscription.version += 1
    reservation.status = "EXPIRED" if expired else "RELEASED"
    reservation.released_at = now or datetime.now(UTC)
    database.add(
        _ledger_entry(
            user_id=reservation.user_id,
            delta=reservation.amount,
            balance_after=credits_remaining(subscription),
            reason="AI_RESERVATION_RELEASE",
            idempotency_key=f"release:{reservation.id}",
            reference_type=reservation.reference_type,
            reference_id=reservation.reference_id,
        )
    )
    return reservation
