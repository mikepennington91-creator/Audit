from __future__ import annotations

import asyncio
import html
import logging
import os
import uuid
from datetime import date, timedelta
from typing import Dict, Optional

from fastapi import APIRouter, Header, HTTPException

import server as legacy
from app_core.email_service import EmailAttachment, email_is_configured, public_app_url, send_email
from app_core.preferences import email_preference_enabled
from app_core.audit_deadlines import process_open_audits
from app_core.notifications import create_notification
from app_core.schedules import schedule_window


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["scheduled-reminders"])


def _scheduled_date(value: str | None) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


async def process_scheduled_audit_reminders() -> Dict[str, int | str]:
    """Send each due audit reminder at most once.

    The worker is safe to call from the in-process loop and from an external
    scheduler. A reminder is only marked as sent after successful SMTP delivery.
    """
    if not email_is_configured():
        return {"processed": 0, "sent": 0, "skipped": 0, "failed": 0, "status": "smtp_not_configured"}

    today = legacy.get_uk_time().date()
    schedules = await legacy.db.scheduled_audits.find(
        {}, {"_id": 0}
    ).sort("scheduled_date", 1).to_list(5000)

    processed = sent = skipped = failed = 0
    for schedule in schedules:
        if schedule.get("status") == "completed" or schedule.get("completed_run_id"):
            continue
        if schedule.get("reminder_email_status") in {"sent", "preference_disabled"}:
            continue

        due_date = _scheduled_date(schedule.get("scheduled_date"))
        if not due_date or due_date < today:
            continue
        reminder_days = max(0, int(schedule.get("reminder_days") or 0))
        reminder_date = due_date - timedelta(days=reminder_days)
        if today < reminder_date:
            continue

        processed += 1
        assigned_user = await legacy.db.users.find_one(
            {"id": schedule.get("assigned_to")}, {"_id": 0, "password": 0}
        )
        if not assigned_user or not assigned_user.get("email"):
            skipped += 1
            await legacy.db.scheduled_audits.update_one(
                {"id": schedule["id"]},
                {"$set": {
                    "reminder_email_status": "missing_recipient",
                    "reminder_last_attempt_at": legacy.get_uk_time_iso(),
                }},
            )
            continue

        if not email_preference_enabled(assigned_user, "email_scheduled_audit_reminder"):
            skipped += 1
            await legacy.db.scheduled_audits.update_one(
                {"id": schedule["id"]},
                {"$set": {
                    "reminder_email_status": "preference_disabled",
                    "reminder_last_attempt_at": legacy.get_uk_time_iso(),
                }},
            )
            continue

        audit_url = f"{public_app_url()}/run-audit"
        display_date = due_date.strftime("%d/%m/%Y")
        result = await send_email(
            to_email=assigned_user["email"],
            subject=f"Audit reminder: {schedule.get('audit_name', 'Scheduled audit')}",
            text_body=(
                f"Hi {assigned_user.get('name', '')},\n\n"
                f"{schedule.get('audit_name', 'An audit')} is assigned to you and is due on {display_date}.\n"
                + (f"Location: {schedule.get('location')}\n" if schedule.get("location") else "")
                + (f"Notes: {schedule.get('notes')}\n" if schedule.get("notes") else "")
                + f"\nOpen Infinit Audit: {audit_url}"
            ),
            html_body=(
                f"<p>Hi {html.escape(assigned_user.get('name') or '')},</p>"
                f"<p><strong>{html.escape(str(schedule.get('audit_name') or 'An audit'))}</strong> "
                f"is assigned to you and is due on <strong>{display_date}</strong>.</p>"
                + (f"<p><strong>Location:</strong> {html.escape(str(schedule.get('location')))}</p>" if schedule.get("location") else "")
                + (f"<p><strong>Notes:</strong> {html.escape(str(schedule.get('notes')))}</p>" if schedule.get("notes") else "")
                + f"<p><a href=\"{html.escape(audit_url, quote=True)}\">Open Infinit Audit</a></p>"
            ),
            template="scheduled_audit_reminder",
        )
        update = {
            "reminder_email_status": result.status,
            "reminder_last_attempt_at": legacy.get_uk_time_iso(),
        }
        if result.sent:
            sent += 1
            update["reminder_sent_at"] = legacy.get_uk_time_iso()
        else:
            failed += 1
        await legacy.db.scheduled_audits.update_one(
            {"id": schedule["id"]}, {"$set": update}
        )

    return {
        "processed": processed,
        "sent": sent,
        "skipped": skipped,
        "failed": failed,
        "status": "ok",
    }


async def process_compliance_escalations() -> Dict[str, int]:
    """Mark and escalate overdue schedule/action exceptions once."""
    today = legacy.get_uk_time().date()
    schedules = await legacy.db.scheduled_audits.find(
        {"status": {"$in": ["pending", "overdue"]}}, {"_id": 0}
    ).to_list(5000)
    escalated_schedules = effectiveness_reviews = overdue_action_escalations = 0
    escalated_training = escalated_documents = supplier_alerts = 0
    for schedule in schedules:
        _, window_end = schedule_window(schedule)
        if not window_end or window_end >= today:
            continue
        if schedule.get("status") == "pending":
            await legacy.db.scheduled_audits.update_one(
                {"id": schedule["id"]}, {"$set": {"status": "overdue"}}
            )
        if schedule.get("overdue_escalation_sent_at"):
            continue
        admins = await legacy.db.users.find(
            {"company_id": schedule.get("company_id"), "role": {"$in": [legacy.UserRole.COMPANY_ADMIN, legacy.UserRole.ADMIN]}},
            {"_id": 0, "password": 0},
        ).to_list(100)
        for admin in admins:
            await create_notification(
                user_id=admin["id"], company_id=schedule.get("company_id"),
                notification_type="scheduled_audit_overdue", title="Scheduled audit overdue",
                message=f"{schedule.get('audit_name', 'Audit')} was due in the week ending {window_end.strftime('%d/%m/%Y')}.",
                link="/schedule", metadata={"schedule_id": schedule["id"]},
            )
            if admin.get("email") and email_is_configured():
                await send_email(
                    to_email=admin["email"], subject=f"Overdue audit: {schedule.get('audit_name', 'Scheduled audit')}",
                    text_body=f"Hi {admin.get('name', '')},\n\nThe scheduled audit is overdue and requires attention.\n\nOpen Infinit Audit: {public_app_url()}/schedule",
                    template="scheduled_audit_overdue",
                )
        await legacy.db.scheduled_audits.update_one(
            {"id": schedule["id"]}, {"$set": {"overdue_escalation_sent_at": legacy.get_uk_time_iso()}}
        )
        escalated_schedules += 1

    actions = await legacy.db.corrective_actions.find(
        {"status": "effectiveness_pending"}, {"_id": 0}
    ).to_list(5000)
    for action in actions:
        due = _scheduled_date(action.get("effectiveness_due_date"))
        if not due or due >= today or action.get("effectiveness_escalation_sent_at"):
            continue
        recipients = {action.get("reviewer_user_id") or action.get("created_by_id")}
        admins = await legacy.db.users.find(
            {"company_id": action.get("company_id"), "role": {"$in": [legacy.UserRole.COMPANY_ADMIN, legacy.UserRole.ADMIN]}},
            {"_id": 0, "password": 0},
        ).to_list(100)
        recipients.update(item.get("id") for item in admins)
        for recipient_id in recipients - {None}:
            await create_notification(
                user_id=recipient_id, company_id=action.get("company_id"),
                notification_type="action_effectiveness_overdue", title="Effectiveness review overdue",
                message=f"{action.get('title') or action.get('audit_name', 'Corrective action')} requires effectiveness evidence.",
                link=f"/actions?action={action['id']}", metadata={"action_id": action["id"]},
            )
        await legacy.db.corrective_actions.update_one(
            {"id": action["id"]}, {"$set": {"effectiveness_escalation_sent_at": legacy.get_uk_time_iso()}}
        )
        effectiveness_reviews += 1

    overdue_actions = await legacy.db.corrective_actions.find(
        {"status": "open"}, {"_id": 0, "history": 0}
    ).to_list(5000)
    for action in overdue_actions:
        due = _scheduled_date(action.get("due_date"))
        if not due or due >= today or action.get("overdue_escalation_sent_at"):
            continue
        recipients = {action.get("assigned_user_id")}
        admins = await legacy.db.users.find(
            {"company_id": action.get("company_id"), "role": {"$in": [legacy.UserRole.COMPANY_ADMIN, legacy.UserRole.ADMIN]}},
            {"_id": 0, "password": 0},
        ).to_list(100)
        recipients.update(item.get("id") for item in admins)
        for recipient_id in recipients - {None}:
            await create_notification(
                user_id=recipient_id, company_id=action.get("company_id"),
                notification_type="corrective_action_overdue", title="Corrective action overdue",
                message=f"{action.get('title') or action.get('non_conformance', 'Corrective action')} was due {due.strftime('%d/%m/%Y')}.",
                link=f"/actions?action={action['id']}", metadata={"action_id": action["id"]},
            )
        await legacy.db.corrective_actions.update_one({"id": action["id"]}, {"$set": {"overdue_escalation_sent_at": legacy.get_uk_time_iso()}})
        overdue_action_escalations += 1

    for collection, item_name, link, counter_name in [
        (legacy.db.training_records, "Training", "/compliance?tab=training", "training"),
        (legacy.db.document_signoffs, "Document acknowledgement", "/quality?tab=documents", "documents"),
    ]:
        records = await collection.find({"status": "assigned"}, {"_id": 0}).to_list(5000)
        for record in records:
            due = _scheduled_date(record.get("due_date"))
            if not due or due >= today or record.get("overdue_escalation_sent_at"):
                continue
            await create_notification(
                user_id=record.get("user_id"), company_id=record.get("company_id"),
                notification_type=f"{counter_name}_overdue", title=f"{item_name} overdue",
                message=f"{record.get('title') or record.get('document_title') or item_name} was due {due.strftime('%d/%m/%Y')}.",
                link=link, metadata={f"{counter_name}_id": record["id"]},
            )
            admins = await legacy.db.users.find(
                {"company_id": record.get("company_id"), "role": {"$in": [legacy.UserRole.COMPANY_ADMIN, legacy.UserRole.ADMIN]}},
                {"_id": 0, "password": 0},
            ).to_list(100)
            for admin in admins:
                await create_notification(
                    user_id=admin["id"], company_id=record.get("company_id"),
                    notification_type=f"{counter_name}_overdue_admin", title=f"{item_name} overdue",
                    message=f"{record.get('user_name', 'A user')} has not completed {record.get('title') or record.get('document_title') or item_name}.",
                    link=link, metadata={f"{counter_name}_id": record["id"]},
                )
            await collection.update_one({"id": record["id"]}, {"$set": {"overdue_escalation_sent_at": legacy.get_uk_time_iso()}})
            if counter_name == "training": escalated_training += 1
            else: escalated_documents += 1

    suppliers = await legacy.db.suppliers.find({}, {"_id": 0, "history": 0}).to_list(5000)
    warning_date = today + timedelta(days=30)
    for supplier in suppliers:
        target = min(filter(None, [supplier.get("approval_expiry"), supplier.get("next_review_date")]), default=None)
        due = _scheduled_date(target)
        alert_key = target
        if not due or due > warning_date or supplier.get("expiry_alert_for") == alert_key:
            continue
        admins = await legacy.db.users.find(
            {"company_id": supplier.get("company_id"), "role": {"$in": [legacy.UserRole.COMPANY_ADMIN, legacy.UserRole.ADMIN]}},
            {"_id": 0, "password": 0},
        ).to_list(100)
        for admin in admins:
            await create_notification(
                user_id=admin["id"], company_id=supplier.get("company_id"),
                notification_type="supplier_review_due", title="Supplier approval requires review",
                message=f"{supplier.get('name', 'Supplier')} is due for review by {due.strftime('%d/%m/%Y')}.",
                link="/quality?tab=suppliers", metadata={"supplier_id": supplier["id"]},
            )
        await legacy.db.suppliers.update_one({"id": supplier["id"]}, {"$set": {"expiry_alert_for": alert_key, "expiry_alert_sent_at": legacy.get_uk_time_iso()}})
        supplier_alerts += 1
    return {
        "overdue_schedules": escalated_schedules,
        # Preserve the original result key for callers that report effectiveness
        # review escalations separately from ordinary overdue actions.
        "effectiveness_reviews": effectiveness_reviews,
        "action_escalations": effectiveness_reviews + overdue_action_escalations,
        "training_escalations": escalated_training, "document_escalations": escalated_documents,
        "supplier_alerts": supplier_alerts,
    }


async def process_management_report_emails() -> Dict[str, int]:
    """Send each configured weekly/monthly management pack once per period."""
    if not email_is_configured():
        return {"sent": 0, "failed": 0, "skipped": 0}
    from app_core.quality_operations import _management_data, build_management_summary_pdf

    today = legacy.get_uk_time().date()
    schedules = await legacy.db.management_report_schedules.find({"enabled": True}, {"_id": 0}).to_list(1000)
    sent = failed = skipped = 0
    for schedule in schedules:
        frequency = schedule.get("frequency", "monthly")
        due = today.weekday() == int(schedule.get("weekday", 0)) if frequency == "weekly" else today.day == int(schedule.get("month_day", 1))
        period_key = f"{today.isocalendar().year}-W{today.isocalendar().week:02d}" if frequency == "weekly" else today.strftime("%Y-%m")
        if not due or schedule.get("last_period_key") == period_key:
            skipped += 1
            continue
        report_user = {
            "id": schedule.get("updated_by_id"), "name": schedule.get("updated_by_name"),
            "company_id": schedule.get("company_id"), "role": legacy.UserRole.COMPANY_ADMIN,
        }
        data = await _management_data(report_user, int(schedule.get("report_days", 30)))
        company = await legacy.db.companies.find_one({"id": schedule.get("company_id")}, {"_id": 0}) if schedule.get("company_id") else None
        attachment = EmailAttachment(
            filename=f"management_report_{data['period']['end']}.pdf",
            content=build_management_summary_pdf(data, company), subtype="pdf",
        )
        all_sent = True
        for recipient in schedule.get("recipients") or []:
            result = await send_email(
                to_email=recipient.get("email", ""),
                subject="Infinit Audit management report",
                text_body=(
                    f"Hi {recipient.get('name', '')},\n\n"
                    f"Your {frequency} quality and compliance management report is attached.\n\n"
                    f"Open Infinit Audit: {public_app_url()}/quality?tab=management"
                ),
                html_body=(
                    f"<p>Hi {html.escape(recipient.get('name') or '')},</p>"
                    f"<p>Your <strong>{html.escape(frequency)}</strong> quality and compliance management report is attached.</p>"
                    f"<p><a href=\"{html.escape(public_app_url() + '/quality?tab=management', quote=True)}\">Open Quality Operations</a></p>"
                ),
                attachments=[attachment], template="management_report",
            )
            all_sent = all_sent and result.sent
            sent += int(result.sent); failed += int(not result.sent)
        if all_sent and schedule.get("recipients"):
            await legacy.db.management_report_schedules.update_one(
                {"id": schedule["id"]}, {"$set": {
                    "last_period_key": period_key, "last_sent_at": legacy.get_uk_time_iso(),
                }},
            )
    return {"sent": sent, "failed": failed, "skipped": skipped}


async def reminder_loop() -> None:
    interval_seconds = max(300, int(os.environ.get("REMINDER_CHECK_SECONDS", "900")))
    while True:
        try:
            started_at = legacy.get_uk_time_iso()
            await process_open_audits()
            reminders = await process_scheduled_audit_reminders()
            escalations = await process_compliance_escalations()
            management_reports = await process_management_report_emails()
            await legacy.db.system_job_events.insert_one({
                "id": str(uuid.uuid4()), "job": "compliance_reminders", "status": "completed",
                "started_at": started_at, "created_at": legacy.get_uk_time_iso(),
                "result": {"reminders": reminders, "escalations": escalations, "management_reports": management_reports},
            })
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Scheduled audit reminder pass failed")
        await asyncio.sleep(interval_seconds)


@router.post("/internal/jobs/scheduled-audit-reminders")
async def run_scheduled_audit_reminders(
    x_job_secret: Optional[str] = Header(default=None, alias="X-Job-Secret"),
    x_github_oidc_token: Optional[str] = Header(default=None, alias="X-GitHub-OIDC-Token"),
):
    expected = os.environ.get("INTERNAL_JOB_SECRET")
    if x_github_oidc_token:
        from app_core.job_auth import verify_job_token
        try:
            await asyncio.to_thread(verify_job_token, x_github_oidc_token)
        except Exception:
            raise HTTPException(status_code=403, detail="Invalid scheduled job identity")
    elif not expected or not x_job_secret or not secrets_compare(x_job_secret, expected):
        raise HTTPException(status_code=403, detail="Access denied")
    open_audits = await process_open_audits()
    scheduled = await process_scheduled_audit_reminders()
    escalations = await process_compliance_escalations()
    management_reports = await process_management_report_emails()
    await legacy.db.system_job_events.insert_one({
        "id": str(uuid.uuid4()), "job": "compliance_reminders", "status": "completed",
        "created_at": legacy.get_uk_time_iso(), "result": {"scheduled": scheduled, "escalations": escalations, "management_reports": management_reports},
    })
    return {"open_audits": open_audits, "scheduled": scheduled, "escalations": escalations, "management_reports": management_reports}


def secrets_compare(left: str, right: str) -> bool:
    import hmac

    return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))
