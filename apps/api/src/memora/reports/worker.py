from collections import Counter
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from memora.audit.models import AuditEvent
from memora.billing.service import InsufficientCreditsError, consume_credits
from memora.identity.dependencies import Principal
from memora.identity.models import User
from memora.reports.models import GeneratedReport, ReportSource, ReportSubscription
from memora.reports.service import (
    build_report_sections,
    deterministic_summary,
    select_report_evidence,
)
from memora.reports.subscriptions import cadence_delta, next_run_after
from memora.settings import Settings
from memora.visuals.service import task_credit_costs
from memora.workspaces.models import WorkspaceMembership

PRESET_TITLES = {
    "MISSED": "我错过了什么",
    "MEETING": "会前简报",
    "ONBOARDING": "新人入组",
    "HANDOVER": "交接报告",
    "KNOWLEDGE_GAPS": "知识缺口",
}


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _mark_subscription_error(
    engine: Engine,
    subscription_id: UUID,
    *,
    now: datetime,
    error_code: str,
) -> None:
    with Session(engine) as database:
        subscription = database.get(ReportSubscription, subscription_id)
        if subscription is None:
            return
        subscription.last_run_at = now
        subscription.last_error_code = error_code
        subscription.next_run_at = next_run_after(now, subscription.cadence)
        database.commit()


def process_due_report_subscription(
    engine: Engine,
    settings: Settings,
    *,
    now: datetime | None = None,
) -> bool:
    current_time = _as_utc(now or datetime.now(UTC))
    with Session(engine) as database:
        subscription = database.scalar(
            select(ReportSubscription)
            .where(
                ReportSubscription.status == "ACTIVE",
                ReportSubscription.next_run_at <= current_time,
            )
            .order_by(ReportSubscription.next_run_at.asc(), ReportSubscription.id.asc())
            .with_for_update(skip_locked=True)
        )
        if subscription is None:
            return False
        membership = database.scalar(
            select(WorkspaceMembership).where(
                WorkspaceMembership.workspace_id == subscription.workspace_id,
                WorkspaceMembership.user_id == subscription.user_id,
            )
        )
        user = database.get(User, subscription.user_id)
        if membership is None or user is None or user.status != "ACTIVE":
            subscription.status = "PAUSED"
            subscription.last_error_code = "MEMBERSHIP_UNAVAILABLE"
            database.commit()
            return True
        principal = Principal(
            user_id=user.id,
            workspace_id=subscription.workspace_id,
            email=user.email,
            display_name=user.display_name,
            role=membership.role,
        )
        created_to = current_time
        created_from = (
            _as_utc(subscription.last_run_at)
            if subscription.last_run_at is not None
            else current_time - cadence_delta(subscription.cadence)
        )
        evidence = select_report_evidence(
            database,
            principal,
            scope=subscription.scope,
            subject_author_id=subscription.subject_author_id,
            topic=subscription.topic,
            created_from=created_from,
            created_to=created_to,
            limit=30,
        )
        summary = deterministic_summary(
            evidence,
            topic=subscription.topic,
            created_from=created_from,
            created_to=created_to,
        )
        sections = build_report_sections(
            evidence,
            topic=subscription.topic,
            created_from=created_from,
            created_to=created_to,
        )
        counts = Counter(item.author.id for item in evidence)
        authors = {item.author.id: item.author.display_name for item in evidence}
        report_id = uuid4()
        scheduled_key = _as_utc(subscription.next_run_at).isoformat()
        try:
            consume_credits(
                database,
                subscription.user_id,
                task_credit_costs(settings)["report"],
                idempotency_key=f"report-subscription:{subscription.id}:{scheduled_key}",
                reference_type="REPORT_SUBSCRIPTION",
                reference_id=str(subscription.id),
            )
        except InsufficientCreditsError:
            database.rollback()
            _mark_subscription_error(
                engine,
                subscription.id,
                now=current_time,
                error_code="INSUFFICIENT_CREDITS",
            )
            return True
        report = GeneratedReport(
            id=report_id,
            workspace_id=subscription.workspace_id,
            created_by_user_id=subscription.user_id,
            subject_author_id=subscription.subject_author_id,
            scope=subscription.scope,
            status="GENERATED" if evidence else "NO_EVIDENCE",
            model_status="DISABLED",
            visibility=subscription.visibility,
            preset=subscription.preset,
            topic=subscription.topic,
            title=f"{PRESET_TITLES[subscription.preset]} · {subscription.topic}",
            summary=summary,
            sections=[
                {
                    "kind": section.kind,
                    "title": section.title,
                    "content": section.content,
                    "citation_memory_ids": [str(memory_id) for memory_id in section.memory_ids],
                }
                for section in sections
            ],
            contributors=[
                {
                    "author_id": str(author_id),
                    "display_name": authors[author_id],
                    "record_count": count,
                }
                for author_id, count in sorted(counts.items(), key=lambda item: authors[item[0]])
            ],
            created_from=created_from,
            created_to=created_to,
        )
        database.add(report)
        database.flush()
        for item in evidence:
            database.add(
                ReportSource(
                    report_id=report.id,
                    memory_id=item.memory.id,
                    author_id_at_generation=item.author.id,
                    memory_created_at=item.memory.created_at,
                )
            )
        subscription.last_report_id = report.id
        subscription.last_run_at = current_time
        subscription.last_error_code = None
        subscription.next_run_at = next_run_after(current_time, subscription.cadence)
        database.add(
            AuditEvent(
                workspace_id=subscription.workspace_id,
                actor_id=subscription.user_id,
                action="SCHEDULED_REPORT_GENERATED",
                resource_type="REPORT",
                resource_id=report.id,
            )
        )
        database.commit()
        return True
