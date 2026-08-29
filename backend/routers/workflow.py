from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import server
from server import (
    CorrectiveActionReassign,
    CorrectiveActionUpdate,
    RunAuditSubmit,
    db,
    get_current_user,
    get_uk_time,
    get_uk_time_iso,
    is_admin,
    is_system_admin,
)
from services.email_service import email_configured
from services.notification_service import (
    create_notification,
    notification_preferences,
    send_user_email,
)

router = APIRouter(prefix="/api/workflow", tags=["workflow"])


class ActionSignOffDecision(BaseModel):
    approved: bool
    comment: Optional[str] = None


def _action_owner_id(action: dict) -> Optional[str]:
    # In the current workflow the registered user assigned to an action is its
    # accountable owner. Department-only ownership is no longer accepted for
    # newly submitted audits.
    return action.get("assigned_user_id")


async def _queue_assignment_email(action: dict) -> None:
    owner_id = _action_owner_id(action)
    if not owner_id:
        return
    owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "password": 0})
    if not owner:
        return
    await db.corrective_actions.update_one(
        {"id": action["id"]},
        {"$set": {"assignment_email_pending": True, "assignment_email_queued_at": get_uk_time_iso()}},
    )
    await _try_assignment_email(action, owner)


async def _try_assignment_email(action: dict, owner: dict) -> bool:
    preferences = notification_preferences(owner)
    if not preferences["action_assignment_email"]:
        await db.corrective_actions.update_one(
            {"id": action["id"]},
            {"$set": {"assignment_email_pending": False, "assignment_email_skipped_at": get_uk_time_iso()}},
        )
        return False
    sent = await send_user_email(
        owner,
        preference_key="action_assignment_email",
        subject=f"Corrective action assigned: {action.get('audit_name', 'Infinit Audit')}",
        text_body=(
            f"Hello {owner.get('name', '')},\n\n"
            f"A corrective action has been assigned to you.\n\n"
            f"Audit: {action.get('audit_name', 'N/A')}\n"
            f"Action required: {action.get('action_required', 'N/A')}\n"
            f"Due date: {action.get('due_date', 'N/A')}\n\n"
            "Sign in to Infinit Audit to view and manage the action."
        ),
    )
    if sent:
        await db.corrective_actions.update_one(
            {"id": action["id"]},
            {"$set": {
                "assignment_email_pending": False,
                "assignment_email_sent_at": get_uk_time_iso(),
            }},
        )
    return sent


async def process_pending_action_emails() -> int:
    if not email_configured():
        return 0
    actions = await db.corrective_actions.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    sent_count = 0
    for action in actions:
        if not action.get("assignment_email_pending"):
            continue
        owner_id = _action_owner_id(action)
        if not owner_id:
            continue
        owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "password": 0})
        if owner and await _try_assignment_email(action, owner):
            sent_count += 1
    return sent_count


@router.put("/run-audits/{run_id}")
async def submit_run_audit_workflow(
    run_id: str,
    submit_data: RunAuditSubmit,
    user: dict = Depends(get_current_user),
):
    if submit_data.completed:
        for answer in submit_data.answers:
            if not answer.is_negative:
                continue
            if not (answer.assigned_user_id or "").strip():
                raise HTTPException(
                    status_code=400,
                    detail="Every corrective action must have a registered user as its action owner",
                )
            # Never allow a department value to bypass registered-user ownership.
            answer.assigned_department = None
            answer.action_assignee_type = "user"

    result = await server.update_run_audit(run_id, submit_data, user)
    if submit_data.completed:
        actions = await db.corrective_actions.find({"run_id": run_id}, {"_id": 0}).to_list(1000)
        for action in actions:
            if not action.get("assignment_email_sent_at") and not action.get("assignment_email_pending"):
                await _queue_assignment_email(action)
    return result


@router.put("/actions/{action_id}/reassign")
async def reassign_action_workflow(
    action_id: str,
    update: CorrectiveActionReassign,
    user: dict = Depends(get_current_user),
):
    result = await server.reassign_corrective_action(action_id, update, user)
    action = await db.corrective_actions.find_one({"id": action_id}, {"_id": 0})
    if action:
        await db.corrective_actions.update_one(
            {"id": action_id},
            {"$set": {"assignment_email_sent_at": None, "assignment_email_pending": False}},
        )
        await _queue_assignment_email(action)
    return result


@router.put("/actions/{action_id}/complete")
async def complete_action_workflow(
    action_id: str,
    update: CorrectiveActionUpdate,
    user: dict = Depends(get_current_user),
):
    result = await server.complete_corrective_action(action_id, update, user)
    action = await db.corrective_actions.find_one({"id": action_id}, {"_id": 0})
    if not action:
        return result

    owner_id = _action_owner_id(action)
    if not owner_id:
        raise HTTPException(status_code=409, detail="This action has no registered action owner")
    owner = await db.users.find_one({"id": owner_id}, {"_id": 0, "password": 0})
    if not owner:
        raise HTTPException(status_code=409, detail="The action owner account no longer exists")

    now = get_uk_time_iso()
    signoff_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"infinit-audit:action-signoff:{action_id}:{action.get('completed_at')}"))
    existing = await db.action_signoffs.find_one({"id": signoff_id}, {"_id": 0})
    if not existing:
        await db.action_signoffs.insert_one({
            "id": signoff_id,
            "action_id": action_id,
            "company_id": action.get("company_id"),
            "owner_id": owner_id,
            "owner_name": owner.get("name"),
            "completed_by_id": action.get("completed_by_id"),
            "completed_by_name": action.get("completed_by_name"),
            "action_taken": action.get("action_taken"),
            "status": "pending",
            "created_at": now,
            "reviewed_at": None,
            "reviewed_by_id": None,
            "review_comment": None,
        })
        preferences = notification_preferences(owner)
        if preferences["action_review_in_app"]:
            await create_notification(
                db,
                user_id=owner_id,
                company_id=action.get("company_id"),
                notification_type="action_review",
                title="Corrective action ready for sign-off",
                message=f"{action.get('audit_name', 'Audit')}: review the completed corrective action.",
                link="/actions",
                metadata={"action_id": action_id, "signoff_id": signoff_id},
                created_at=now,
            )
        await send_user_email(
            owner,
            preference_key="action_review_email",
            subject="Corrective action ready for sign-off",
            text_body=(
                f"Hello {owner.get('name', '')},\n\n"
                f"A corrective action for {action.get('audit_name', 'an audit')} has been completed "
                "and is ready for your review and sign-off.\n\nSign in to Infinit Audit to review it."
            ),
        )
    return result


@router.get("/action-signoffs")
async def get_action_signoffs(status: str = "pending", user: dict = Depends(get_current_user)):
    if status not in {"pending", "approved", "rejected", "all"}:
        raise HTTPException(status_code=400, detail="Unknown sign-off status")
    if is_system_admin(user):
        query = {}
    elif is_admin(user):
        query = {"company_id": user.get("company_id")}
    else:
        query = {"owner_id": user["id"]}
    signoffs = await db.action_signoffs.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    if status != "all":
        signoffs = [item for item in signoffs if item.get("status") == status]
    for item in signoffs:
        item["action"] = await db.corrective_actions.find_one({"id": item["action_id"]}, {"_id": 0})
    return signoffs


@router.put("/action-signoffs/{signoff_id}")
async def decide_action_signoff(
    signoff_id: str,
    decision: ActionSignOffDecision,
    user: dict = Depends(get_current_user),
):
    signoff = await db.action_signoffs.find_one({"id": signoff_id}, {"_id": 0})
    if not signoff:
        raise HTTPException(status_code=404, detail="Action sign-off not found")
    if signoff.get("owner_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Only the action owner can sign off this action")
    if signoff.get("status") != "pending":
        raise HTTPException(status_code=409, detail="This action has already been reviewed")

    now = get_uk_time_iso()
    new_status = "approved" if decision.approved else "rejected"
    await db.action_signoffs.update_one(
        {"id": signoff_id},
        {"$set": {
            "status": new_status,
            "reviewed_at": now,
            "reviewed_by_id": user["id"],
            "reviewed_by_name": user["name"],
            "review_comment": (decision.comment or "").strip() or None,
        }},
    )
    action = await db.corrective_actions.find_one({"id": signoff["action_id"]}, {"_id": 0})
    if action:
        await db.corrective_actions.update_one(
            {"id": action["id"]},
            {"$set": {
                "review_status": new_status,
                "reviewed_at": now,
                "reviewed_by_id": user["id"],
                "reviewed_by_name": user["name"],
                "review_comment": (decision.comment or "").strip() or None,
                **({"status": "open", "completed_at": None} if not decision.approved else {}),
            }},
        )
        if not decision.approved:
            await server.sync_action_to_audit(action, action_status="open", action_completed_at=None)
            if action.get("completed_by_id") and action.get("completed_by_id") != user["id"]:
                await create_notification(
                    db,
                    user_id=action["completed_by_id"],
                    company_id=action.get("company_id"),
                    notification_type="action_review_rejected",
                    title="Corrective action requires more work",
                    message=f"{user['name']} rejected the action sign-off. Review the action and comments.",
                    link="/actions",
                    metadata={"action_id": action["id"]},
                    created_at=now,
                )
    return {**signoff, "status": new_status, "reviewed_at": now}


async def process_scheduled_audit_reminders() -> int:
    schedules = await db.scheduled_audits.find({}, {"_id": 0}).sort("scheduled_date", 1).to_list(5000)
    today = get_uk_time().date()
    sent_count = 0
    for schedule in schedules:
        if schedule.get("status") != "pending" or schedule.get("scheduler_reminder_sent_at"):
            continue
        try:
            scheduled_date = datetime.fromisoformat(str(schedule.get("scheduled_date", "")).replace("Z", "+00:00")).date()
        except ValueError:
            try:
                scheduled_date = date.fromisoformat(str(schedule.get("scheduled_date", ""))[:10])
            except ValueError:
                continue
        reminder_days = max(0, int(schedule.get("reminder_days", 1) or 0))
        if scheduled_date > today + timedelta(days=reminder_days) or scheduled_date < today:
            continue
        scheduler = await db.users.find_one({"id": schedule.get("created_by")}, {"_id": 0, "password": 0})
        if not scheduler:
            continue
        if not notification_preferences(scheduler)["scheduled_audit_reminder_email"]:
            continue
        sent = await send_user_email(
            scheduler,
            preference_key="scheduled_audit_reminder_email",
            subject=f"Scheduled audit reminder: {schedule.get('audit_name', 'Audit')}",
            text_body=(
                f"Hello {scheduler.get('name', '')},\n\n"
                f"The audit you scheduled is due on {scheduled_date.strftime('%d/%m/%Y')}.\n"
                f"Audit: {schedule.get('audit_name', 'N/A')}\n"
                f"Assigned to: {schedule.get('assigned_to_name', 'N/A')}\n\n"
                "Sign in to Infinit Audit to review the schedule."
            ),
        )
        if sent:
            await db.scheduled_audits.update_one(
                {"id": schedule["id"]},
                {"$set": {"scheduler_reminder_sent_at": get_uk_time_iso()}},
            )
            sent_count += 1
    return sent_count


@router.post("/process-notifications")
async def process_notifications_now(user: dict = Depends(get_current_user)):
    if not is_admin(user):
        raise HTTPException(status_code=403, detail="Administrator access required")
    action_emails = await process_pending_action_emails()
    audit_reminders = await process_scheduled_audit_reminders()
    return {"action_emails_sent": action_emails, "audit_reminders_sent": audit_reminders}
