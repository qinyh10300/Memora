from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from memora.audit.models import AuditEvent
from memora.database import DatabaseSession
from memora.identity.dependencies import CurrentPrincipal
from memora.reports.subscription_schemas import (
    CreateReportSubscriptionRequest,
    ReportSubscriptionResponse,
    UpdateReportSubscriptionRequest,
)
from memora.reports.subscriptions import (
    create_report_subscription,
    get_owned_report_subscription,
    list_owned_report_subscriptions,
    report_subscription_response,
    update_report_subscription,
)

router = APIRouter(prefix="/report-subscriptions", tags=["reports"])


@router.get("", response_model=list[ReportSubscriptionResponse])
def list_report_subscriptions(
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> list[ReportSubscriptionResponse]:
    return [
        report_subscription_response(subscription)
        for subscription in list_owned_report_subscriptions(database, principal)
    ]


@router.post(
    "",
    response_model=ReportSubscriptionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_subscription(
    payload: CreateReportSubscriptionRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> ReportSubscriptionResponse:
    try:
        subscription = create_report_subscription(database, principal, payload)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error
    database.add(
        AuditEvent(
            workspace_id=principal.workspace_id,
            actor_id=principal.user_id,
            action="REPORT_SUBSCRIPTION_CREATED",
            resource_type="REPORT_SUBSCRIPTION",
            resource_id=subscription.id,
        )
    )
    database.commit()
    database.refresh(subscription)
    return report_subscription_response(subscription)


@router.patch("/{subscription_id}", response_model=ReportSubscriptionResponse)
def patch_subscription(
    subscription_id: UUID,
    payload: UpdateReportSubscriptionRequest,
    principal: CurrentPrincipal,
    database: DatabaseSession,
) -> ReportSubscriptionResponse:
    subscription = get_owned_report_subscription(database, principal, subscription_id)
    if subscription is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="报告订阅不存在")
    update_report_subscription(subscription, payload)
    database.add(
        AuditEvent(
            workspace_id=principal.workspace_id,
            actor_id=principal.user_id,
            action="REPORT_SUBSCRIPTION_UPDATED",
            resource_type="REPORT_SUBSCRIPTION",
            resource_id=subscription.id,
        )
    )
    database.commit()
    database.refresh(subscription)
    return report_subscription_response(subscription)
