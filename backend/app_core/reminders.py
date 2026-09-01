from __future__ import annotations

import asyncio
import html
import logging
import os
from datetime import date, timedelta
from typing import Dict, Optional

from fastapi import APIRouter, Header, HTTPException

import server as legacy
from app_core.email_service import email_is_configured, public_app_url, send_email
from app_core.preferences import email_preference_enabled
from app_core.audit_deadlines import process_open_audits


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


async def reminder_loop() -> None:
    interval_seconds = max(300, int(os.environ.get("REMINDER_CHECK_SECONDS", "900")))
    while True:
        try:
            await process_open_audits()
            await process_scheduled_audit_reminders()
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
    return {"open_audits": open_audits, "scheduled": await process_scheduled_audit_reminders()}


def secrets_compare(left: str, right: str) -> bool:
    import hmac

    return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))
