from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from memora.database import Base


class Subscription(Base):
    __tablename__ = "subscriptions"
    __table_args__ = (
        CheckConstraint(
            "plan_code IN ('PLUS', 'PRO', 'ULTRA')",
            name="ck_subscriptions_plan_code",
        ),
        CheckConstraint(
            "status IN ('ACTIVE', 'PAST_DUE', 'CANCELLED')",
            name="ck_subscriptions_status",
        ),
        CheckConstraint(
            "credits_granted >= 0 AND credits_used >= 0 AND credits_reserved >= 0 "
            "AND credits_used + credits_reserved <= credits_granted",
            name="ck_subscriptions_credit_bounds",
        ),
    )

    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    plan_code: Mapped[str] = mapped_column(String(20), default="PLUS")
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    period_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    period_ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    credits_granted: Mapped[int] = mapped_column(BigInteger, default=0)
    credits_used: Mapped[int] = mapped_column(BigInteger, default=0)
    credits_reserved: Mapped[int] = mapped_column(BigInteger, default=0)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class CreditLedgerEntry(Base):
    __tablename__ = "credit_ledger_entries"
    __table_args__ = (
        CheckConstraint("balance_after >= 0", name="ck_credit_ledger_balance_nonnegative"),
        UniqueConstraint(
            "user_id",
            "idempotency_key",
            name="uq_credit_ledger_user_idempotency",
        ),
        Index("ix_credit_ledger_user_created", "user_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    delta: Mapped[int] = mapped_column(BigInteger)
    balance_after: Mapped[int] = mapped_column(BigInteger)
    reason: Mapped[str] = mapped_column(String(40))
    idempotency_key: Mapped[str] = mapped_column(String(160))
    reference_type: Mapped[str | None] = mapped_column(String(40))
    reference_id: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CreditReservation(Base):
    __tablename__ = "credit_reservations"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_credit_reservations_amount_positive"),
        CheckConstraint(
            "status IN ('RESERVED', 'SETTLED', 'RELEASED', 'EXPIRED')",
            name="ck_credit_reservations_status",
        ),
        UniqueConstraint(
            "user_id",
            "idempotency_key",
            name="uq_credit_reservations_user_idempotency",
        ),
        Index("ix_credit_reservations_user_status", "user_id", "status"),
        Index("ix_credit_reservations_expiry", "status", "expires_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )
    amount: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(20), default="RESERVED")
    idempotency_key: Mapped[str] = mapped_column(String(160))
    reference_type: Mapped[str] = mapped_column(String(40))
    reference_id: Mapped[str] = mapped_column(String(120))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
