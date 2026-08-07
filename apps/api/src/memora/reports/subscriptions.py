from datetime import UTC, datetime, timedelta
from typing import Literal, cast
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from memora.identity.dependencies import Principal
from memora.identity.models import User
from memora.reports.models import ReportSubscription
from memora.reports.subscription_schemas import (
    CreateReportSubscriptionRequest,
    ReportCadence,
    ReportPreset,
    ReportSubscriptionResponse,
    SubscriptionScope,
    UpdateReportSubscriptionRequest,
)
from memora.workspaces.models import WorkspaceMembership

PRESET_TOPICS: dict[ReportPreset, str] = {
    "MISSED": "重要变化、未跟进事项和需要我补齐的上下文",
    "MEETING": "会议相关进展、分歧、证据缺口和待确认事项",
    "ONBOARDING": "团队背景、当前方向、关键决策和知识缺口",
    "HANDOVER": "当前进展、待办、风险和交接上下文",
    "KNOWLEDGE_GAPS": "证据不足、过期决定和单点知识风险",
}


def cadence_delta(cadence: str) -> timedelta:
    if cadence == "DAILY":
        return timedelta(days=1)
    if cadence == "MONTHLY":
        return timedelta(days=30)
    return timedelta(days=7)


def next_run_after(now: datetime, cadence: str) -> datetime:
    return now + cadence_delta(cadence)


def report_subscription_response(subscription: ReportSubscription) -> ReportSubscriptionResponse:
    return ReportSubscriptionResponse(
        id=subscription.id,
        preset=cast(ReportPreset, subscription.preset),
        scope=cast(SubscriptionScope, subscription.scope),
        topic=subscription.topic,
        subject_author_id=subscription.subject_author_id,
        visibility=cast(Literal["PRIVATE", "WORKSPACE"], subscription.visibility),
        cadence=cast(ReportCadence, subscription.cadence),
        status=cast(Literal["ACTIVE", "PAUSED"], subscription.status),
        next_run_at=subscription.next_run_at,
        last_run_at=subscription.last_run_at,
        last_report_id=subscription.last_report_id,
        last_error_code=subscription.last_error_code,
        created_at=subscription.created_at,
        updated_at=subscription.updated_at,
    )


def list_owned_report_subscriptions(
    database: Session,
    principal: Principal,
) -> list[ReportSubscription]:
    return list(
        database.scalars(
            select(ReportSubscription)
            .where(
                ReportSubscription.workspace_id == principal.workspace_id,
                ReportSubscription.user_id == principal.user_id,
            )
            .order_by(ReportSubscription.created_at.desc(), ReportSubscription.id.desc())
        ).all()
    )


def get_owned_report_subscription(
    database: Session,
    principal: Principal,
    subscription_id: UUID,
) -> ReportSubscription | None:
    return database.scalar(
        select(ReportSubscription).where(
            ReportSubscription.id == subscription_id,
            ReportSubscription.workspace_id == principal.workspace_id,
            ReportSubscription.user_id == principal.user_id,
        )
    )


def create_report_subscription(
    database: Session,
    principal: Principal,
    payload: CreateReportSubscriptionRequest,
) -> ReportSubscription:
    if payload.scope == "MEMBER":
        member = database.scalar(
            select(User)
            .join(WorkspaceMembership, WorkspaceMembership.user_id == User.id)
            .where(
                User.id == payload.subject_author_id,
                WorkspaceMembership.workspace_id == principal.workspace_id,
                User.status == "ACTIVE",
            )
        )
        if member is None:
            raise ValueError("订阅成员不存在")
    now = datetime.now(UTC)
    subscription = ReportSubscription(
        workspace_id=principal.workspace_id,
        user_id=principal.user_id,
        subject_author_id=payload.subject_author_id,
        preset=payload.preset,
        scope=payload.scope,
        topic=payload.topic or PRESET_TOPICS[payload.preset],
        visibility=payload.visibility,
        cadence=payload.cadence,
        status="ACTIVE",
        next_run_at=payload.next_run_at or next_run_after(now, payload.cadence),
    )
    database.add(subscription)
    database.flush()
    return subscription


def update_report_subscription(
    subscription: ReportSubscription,
    payload: UpdateReportSubscriptionRequest,
) -> ReportSubscription:
    if payload.status is not None:
        subscription.status = payload.status
    if payload.cadence is not None:
        subscription.cadence = payload.cadence
        if payload.next_run_at is None:
            subscription.next_run_at = next_run_after(datetime.now(UTC), payload.cadence)
    if payload.next_run_at is not None:
        subscription.next_run_at = payload.next_run_at
    return subscription
