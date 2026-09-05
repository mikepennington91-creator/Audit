from __future__ import annotations

import html
import uuid
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import server as legacy
from app_core.email_service import public_app_url, send_email
from app_core.notifications import create_notification, mark_action_notifications_read
from app_core.preferences import email_preference_enabled


router = APIRouter(prefix="/api", tags=["actions"])


class ActionReviewDecision(BaseModel):
    approved: bool
    comment: Optional[str] = None


class ActionEffectivenessDecision(BaseModel):
    effective: bool
    evidence: str


class CorrectiveActionCreate(BaseModel):
    title: str
    non_conformance: str
    action_required: str
    assigned_user_id: str
    reviewer_user_id: Optional[str] = None
    due_date: str


class ActionReviewerUpdate(BaseModel):
    reviewer_user_id: str


def action_display_status(action: Dict[str, Any]) -> str:
    stored = action.get("status") or "open"
    if stored in {"completed", "awaiting_review", "effectiveness_pending"}:
        return stored
    return legacy.corrective_action_status(action)


def action_payload(action: Dict[str, Any]) -> Dict[str, Any]:
    return {
        **action,
        "status": action_display_status(action),
        "reviewer_user_id": action_reviewer_id(action),
        "reviewer_user_name": action.get("reviewer_user_name") or action.get("created_by_name"),
    }


async def _action_owner(action: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    owner_id = action.get("assigned_user_id")
    if not owner_id:
        return None
    return await legacy.db.users.find_one({"id": owner_id}, {"_id": 0, "password": 0})


def action_reviewer_id(action: Dict[str, Any]) -> Optional[str]:
    """Use the action raiser as reviewer for records created before reviewer fields existed."""
    return action.get("reviewer_user_id") or action.get("created_by_id")


async def _action_reviewer(action: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    reviewer_id = action_reviewer_id(action)
    if not reviewer_id:
        return None
    return await legacy.db.users.find_one(
        {"id": reviewer_id}, {"_id": 0, "password": 0}
    )


async def _company_user(user_id: str, action_company_id: Optional[str], actor: dict) -> dict:
    selected = await legacy.db.users.find_one(
        {"id": user_id}, {"_id": 0, "password": 0}
    )
    if not selected:
        raise HTTPException(status_code=400, detail="Select a valid user")
    if (
        not legacy.is_system_admin(actor)
        and selected.get("company_id") != action_company_id
    ):
        raise HTTPException(status_code=400, detail="Select a valid user from your company")
    return selected


async def _record_assignment_delivery(action: Dict[str, Any], status: str) -> None:
    await legacy.db.corrective_actions.update_one(
        {"id": action["id"]},
        {"$set": {
            "last_assignment_email_user_id": action.get("assigned_user_id"),
            "last_assignment_email_status": status,
            "last_assignment_email_at": legacy.get_uk_time_iso(),
        }},
    )


async def send_action_assignment_email(action: Dict[str, Any], *, force: bool = False) -> None:
    owner = await _action_owner(action)
    if not owner:
        return
    action_url = f"{public_app_url()}/actions?action={action['id']}"
    if force or action.get("last_assignment_notification_user_id") != owner.get("id"):
        await create_notification(
            user_id=owner["id"],
            company_id=action.get("company_id"),
            notification_type="action_assigned",
            title="Corrective action assigned",
            message=f"{action.get('audit_name', 'Action')}: {action.get('action_required', '')}",
            link=f"/actions?action={action['id']}",
            metadata={"action_id": action["id"]},
        )
        await legacy.db.corrective_actions.update_one(
            {"id": action["id"]},
            {"$set": {"last_assignment_notification_user_id": owner.get("id")}},
        )
    if (
        not force
        and action.get("last_assignment_email_user_id") == owner.get("id")
    ):
        return
    if not email_preference_enabled(owner, "email_action_assigned"):
        await _record_assignment_delivery(action, "preference_disabled")
        return
    result = await send_email(
        to_email=owner.get("email") or action.get("assigned_user_email"),
        subject=f"Corrective action assigned: {action.get('audit_name', 'Audit')}",
        text_body=(
            f"Hi {owner.get('name', '')},\n\n"
            "A corrective action has been assigned to you in Infinit Audit.\n\n"
            f"Audit: {action.get('audit_name', 'N/A')}\n"
            f"Action required: {action.get('action_required', 'N/A')}\n"
            f"Due date: {legacy.format_uk_date(action.get('due_date'))}\n\n"
            f"Open Infinit Audit: {action_url}"
        ),
        html_body=(
            f"<p>Hi {html.escape(owner.get('name') or '')},</p>"
            "<p>A corrective action has been assigned to you in Infinit Audit.</p>"
            f"<p><strong>Audit:</strong> {html.escape(str(action.get('audit_name') or 'N/A'))}<br>"
            f"<strong>Action required:</strong> {html.escape(str(action.get('action_required') or 'N/A'))}<br>"
            f"<strong>Due date:</strong> {html.escape(legacy.format_uk_date(action.get('due_date')))}</p>"
            f"<p><a href=\"{html.escape(action_url, quote=True)}\">Open corrective actions</a></p>"
        ),
        template="action_assigned",
    )
    await _record_assignment_delivery(action, result.status)


async def _send_review_ready_email(action: Dict[str, Any], reviewer: Dict[str, Any]) -> None:
    if not email_preference_enabled(reviewer, "email_action_review"):
        return
    action_url = f"{public_app_url()}/actions?action={action['id']}"
    await send_email(
        to_email=reviewer.get("email") or action.get("reviewer_user_email"),
        subject=f"Corrective action ready for review: {action.get('audit_name', 'Audit')}",
        text_body=(
            f"Hi {reviewer.get('name', '')},\n\n"
            "A corrective action you raised, or have been nominated to approve, is waiting for your review and sign-off.\n\n"
            f"Audit: {action.get('audit_name', 'N/A')}\n"
            f"Action required: {action.get('action_required', 'N/A')}\n"
            f"Action taken: {action.get('action_taken', 'N/A')}\n\n"
            f"Review the action: {action_url}"
        ),
        html_body=(
            f"<p>Hi {html.escape(reviewer.get('name') or '')},</p>"
            "<p>A corrective action is waiting for your review and sign-off.</p>"
            "<div style=\"margin:22px 0;padding:18px;border:1px solid #dbe5e4;border-radius:10px;background:#f7faf9\">"
            f"<p style=\"margin:0 0 8px\"><strong>Audit</strong><br>{html.escape(str(action.get('audit_name') or 'N/A'))}</p>"
            f"<p style=\"margin:0 0 8px\"><strong>Action required</strong><br>{html.escape(str(action.get('action_required') or 'N/A'))}</p>"
            f"<p style=\"margin:0\"><strong>Action taken</strong><br>{html.escape(str(action.get('action_taken') or 'N/A'))}</p>"
            "</div>"
            f"<p><a href=\"{html.escape(action_url, quote=True)}\" style=\"display:inline-block;background:#17877d;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600\">Review corrective action</a></p>"
        ),
        template="action_review_ready",
    )


def _validate_action_owner_inputs(submit_data: legacy.RunAuditSubmit) -> None:
    if not submit_data.completed:
        return
    for answer in submit_data.answers:
        if not answer.is_negative:
            continue
        owner_id = (answer.assigned_user_id or "").strip()
        if not owner_id:
            raise HTTPException(
                status_code=400,
                detail="Every corrective action must have a registered user as its action owner",
            )
        # Department ownership is retained only for historical records. New
        # actions use one accountable registered user so review/sign-off and
        # notifications always have a real destination.
        answer.assigned_department = None
        answer.action_assignee_type = "user"


@router.put("/run-audits/{run_id}", response_model=legacy.RunAuditResponse)
async def update_run_audit(
    run_id: str,
    submit_data: legacy.RunAuditSubmit,
    user: dict = Depends(legacy.require_feature("audits")),
):
    _validate_action_owner_inputs(submit_data)
    from app_core.audit_reports import _get_accessible_run
    from app_core.audit_deadlines import close_if_expired
    async with legacy.db.transaction("audit:" + run_id):
        run, _ = await _get_accessible_run(run_id, user)
        run = await close_if_expired(run)
        closed = run.get("closed_at")
        if not closed:
            result = await legacy.update_run_audit(run_id, submit_data, user)
    if closed:
        raise HTTPException(status_code=409, detail="This audit was automatically closed: not completed in time")

    if submit_data.completed:
        from app_core.schedules import complete_matching_schedules

        await complete_matching_schedules({
            **result.model_dump(),
            # RunAuditResponse intentionally omits tenant metadata from its API
            # payload, but schedule matching must retain the stored company scope.
            "company_id": run.get("company_id"),
        })
        actions = await legacy.db.corrective_actions.find(
            {"run_id": run_id}, {"_id": 0}
        ).to_list(1000)
        for action in actions:
            await send_action_assignment_email(action)
    return result


@router.get("/actions")
async def get_corrective_actions(
    status: Optional[str] = None,
    assigned_to_me: bool = False,
    include_archived: bool = False,
    limit: int = 100,
    user: dict = Depends(legacy.require_feature("actions")),
) -> List[Dict[str, Any]]:
    limit = max(1, min(int(limit), 500))
    allowed_statuses = {"open", "overdue", "awaiting_review", "effectiveness_pending", "completed"}
    if status and status not in allowed_statuses:
        raise HTTPException(status_code=400, detail="Unknown action status")

    if legacy.is_system_admin(user):
        query = {}
    elif user["role"] in [
        legacy.UserRole.COMPANY_ADMIN,
        legacy.UserRole.ADMIN,
        legacy.UserRole.AUDIT_CREATOR,
    ]:
        query = {"company_id": user.get("company_id")}
    else:
        query = {
            "$or": [
                {"assigned_user_id": user["id"]},
                {"reviewer_user_id": user["id"]},
                {"created_by_id": user["id"]},
            ]
        }
    if assigned_to_me:
        query = {"assigned_user_id": user["id"]}

    actions = await legacy.db.corrective_actions.find(
        query, {"_id": 0, "history": 0}
    ).sort("due_date", 1).to_list(5000)
    results = []
    for action in actions:
        item = action_payload(action)
        if item.get("archived", False) and not include_archived:
            continue
        if status and item["status"] != status:
            continue
        results.append(item)
        if len(results) >= limit:
            break
    return results


@router.post("/actions", status_code=201)
async def create_corrective_action(
    create: CorrectiveActionCreate,
    user: dict = Depends(legacy.require_feature("actions")),
):
    title = create.title.strip()
    non_conformance = create.non_conformance.strip()
    action_required = create.action_required.strip()
    if not title or not non_conformance or not action_required:
        raise HTTPException(
            status_code=400,
            detail="Title, issue / non-conformance and action required are all required",
        )
    try:
        due_date = date.fromisoformat(create.due_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Enter a valid due date")
    if due_date < legacy.get_uk_time().date():
        raise HTTPException(status_code=400, detail="Corrective action due dates cannot be in the past")

    company_id = user.get("company_id")
    owner = await _company_user(create.assigned_user_id, company_id, user)
    reviewer = await _company_user(create.reviewer_user_id or user["id"], company_id, user)
    now = legacy.get_uk_time_iso()
    action_id = str(uuid.uuid4())
    action = {
        "id": action_id,
        "company_id": company_id or owner.get("company_id"),
        "run_id": "",
        "audit_id": "",
        "audit_name": title,
        "question_id": "",
        "question_text": "Manually raised corrective action",
        "response_label": "Manual",
        "non_conformance": non_conformance,
        "action_required": action_required,
        "assigned_user_id": owner["id"],
        "assigned_user_name": owner["name"],
        "assigned_user_email": owner.get("email"),
        "assigned_department": None,
        "reviewer_user_id": reviewer["id"],
        "reviewer_user_name": reviewer["name"],
        "reviewer_user_email": reviewer.get("email"),
        "due_date": create.due_date,
        "status": "open",
        "review_status": None,
        "action_taken": None,
        "created_by_id": user["id"],
        "created_by_name": user["name"],
        "completed_by_id": None,
        "completed_by_name": None,
        "completed_at": None,
        "created_at": now,
        "updated_at": now,
        "archived": False,
        "extension_request": None,
        "history": [
            legacy.action_history_entry(
                "created",
                user,
                f"Action raised by {user['name']} and assigned to {owner['name']}",
            )
        ],
    }
    await legacy.db.corrective_actions.insert_one(action)
    await send_action_assignment_email(action)
    saved = await legacy.db.corrective_actions.find_one({"id": action_id}, {"_id": 0})
    return action_payload(saved)


@router.put("/actions/{action_id}/reviewer")
async def change_action_reviewer(
    action_id: str,
    update: ActionReviewerUpdate,
    user: dict = Depends(legacy.require_feature("actions")),
):
    action = await legacy.get_accessible_corrective_action(action_id, user)
    if action.get("archived") or action.get("status") in {"completed", "effectiveness_pending"}:
        raise HTTPException(status_code=400, detail="Archived or completed actions cannot change approver")
    if user.get("id") != action.get("created_by_id") and not legacy.is_action_admin(user):
        raise HTTPException(status_code=403, detail="Only the action raiser or an administrator can change the approver")
    reviewer = await _company_user(update.reviewer_user_id, action.get("company_id"), user)
    old_name = action.get("reviewer_user_name") or action.get("created_by_name") or "Unknown"
    history = list(action.get("history") or [])
    history.append(
        legacy.action_history_entry(
            "reviewer_changed",
            user,
            f"Approver changed from {old_name} to {reviewer['name']}",
        )
    )
    await legacy.db.corrective_actions.update_one(
        {"id": action_id},
        {"$set": {
            "reviewer_user_id": reviewer["id"],
            "reviewer_user_name": reviewer["name"],
            "reviewer_user_email": reviewer.get("email"),
            "history": history,
            "updated_at": legacy.get_uk_time_iso(),
        }},
    )
    updated = await legacy.db.corrective_actions.find_one({"id": action_id}, {"_id": 0})
    if updated.get("status") == "awaiting_review":
        await create_notification(
            user_id=reviewer["id"],
            company_id=updated.get("company_id"),
            notification_type="action_review_required",
            title="Corrective action ready for review",
            message=f"{updated.get('audit_name', 'Action')}: review and sign off the completed action.",
            link=f"/actions?action={action_id}",
            metadata={"action_id": action_id},
        )
        await _send_review_ready_email(updated, reviewer)
    return action_payload(updated)


@router.get("/actions/counts")
async def corrective_action_counts(
    include_archived: bool = False,
    assigned_to_me: bool = False,
    user: dict = Depends(legacy.require_feature("actions")),
):
    if legacy.is_system_admin(user):
        query = {}
    elif user["role"] in [legacy.UserRole.COMPANY_ADMIN, legacy.UserRole.ADMIN, legacy.UserRole.AUDIT_CREATOR]:
        query = {"company_id": user.get("company_id")}
    else:
        query = {"$or": [
            {"assigned_user_id": user["id"]},
            {"reviewer_user_id": user["id"]},
            {"created_by_id": user["id"]},
        ]}
    if assigned_to_me:
        query = {"assigned_user_id": user["id"]}
    actions = await legacy.db.corrective_actions.find(
        query, {"_id": 0, "history": 0, "action_taken": 0}
    ).to_list(5000)
    counts = {"all": 0, "open": 0, "overdue": 0, "awaiting_review": 0, "effectiveness_pending": 0, "completed": 0}
    for action in actions:
        if bool(action.get("archived")) != include_archived:
            continue
        status = action_display_status(action)
        counts["all"] += 1
        counts[status] += 1
    return counts


@router.get("/actions/{action_id}")
async def get_corrective_action(
    action_id: str,
    user: dict = Depends(legacy.require_feature("actions")),
):
    action = await legacy.get_accessible_corrective_action(action_id, user)
    return action_payload(action)


@router.put("/actions/{action_id}/reassign")
async def reassign_corrective_action(
    action_id: str,
    update: legacy.CorrectiveActionReassign,
    user: dict = Depends(legacy.require_feature("actions")),
):
    action = await legacy.get_accessible_corrective_action(action_id, user)
    if action.get("archived") or action.get("status") in {"completed", "awaiting_review", "effectiveness_pending"}:
        raise HTTPException(
            status_code=400,
            detail="Archived, completed or review-pending actions cannot be reassigned",
        )
    is_owner = action.get("assigned_user_id") == user.get("id")
    if not is_owner and not legacy.is_action_admin(user):
        raise HTTPException(
            status_code=403,
            detail="Only the current action owner or an administrator can reassign this action",
        )
    reason = update.reason.strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required for reassignment")

    new_owner = await legacy.db.users.find_one(
        {"id": update.assigned_user_id}, {"_id": 0, "password": 0}
    )
    if not new_owner:
        raise HTTPException(status_code=400, detail="Select a valid action owner")
    if (
        not legacy.is_system_admin(user)
        and new_owner.get("company_id") != action.get("company_id")
    ):
        raise HTTPException(status_code=400, detail="Select a valid user from your company")

    old_name = action.get("assigned_user_name") or action.get("assigned_department") or "Unassigned"
    history = list(action.get("history") or [])
    history.append(
        legacy.action_history_entry(
            "reassigned",
            user,
            f"Reassigned from {old_name} to {new_owner['name']}: {reason}",
            from_user_id=action.get("assigned_user_id"),
            from_user_name=old_name,
            to_user_id=new_owner["id"],
            to_user_name=new_owner["name"],
            reason=reason,
        )
    )
    now = legacy.get_uk_time_iso()
    changes = {
        "assigned_user_id": new_owner["id"],
        "assigned_user_name": new_owner["name"],
        "assigned_user_email": new_owner.get("email"),
        "assigned_department": None,
        "history": history,
        "updated_at": now,
        "last_assignment_email_user_id": None,
        "last_assignment_email_status": None,
        "last_assignment_email_at": None,
    }
    await legacy.db.corrective_actions.update_one(
        {"id": action_id}, {"$set": changes}
    )
    await legacy.sync_action_to_audit(
        action,
        assigned_user_id=new_owner["id"],
        assigned_user_name=new_owner["name"],
        assigned_user_email=new_owner.get("email"),
        assigned_department=None,
    )
    updated = await legacy.db.corrective_actions.find_one(
        {"id": action_id}, {"_id": 0}
    )
    await send_action_assignment_email(updated, force=True)
    updated = await legacy.db.corrective_actions.find_one(
        {"id": action_id}, {"_id": 0}
    )
    return action_payload(updated)


@router.put("/actions/{action_id}")
async def submit_corrective_action_for_review(
    action_id: str,
    update: legacy.CorrectiveActionUpdate,
    user: dict = Depends(legacy.require_feature("actions")),
):
    action = await legacy.get_accessible_corrective_action(action_id, user)
    if action.get("archived"):
        raise HTTPException(status_code=400, detail="Archived actions cannot be completed")
    if action.get("status") in {"completed", "effectiveness_pending"}:
        raise HTTPException(status_code=409, detail="This action has already been signed off")
    if action.get("status") == "awaiting_review":
        raise HTTPException(status_code=409, detail="This action is already awaiting owner review")
    owner = await _action_owner(action)
    if not owner:
        raise HTTPException(
            status_code=409,
            detail="This legacy action has no registered owner. Reassign it to a user before completion.",
        )
    reviewer = await _action_reviewer(action)
    if not reviewer:
        raise HTTPException(
            status_code=409,
            detail="This action has no valid approver. Ask the action raiser or an administrator to select one.",
        )

    action_taken = update.action_taken.strip()
    if not action_taken:
        raise HTTPException(status_code=400, detail="Action taken is required before completion")

    now = legacy.get_uk_time_iso()
    history = list(action.get("history") or [])
    history.append(
        legacy.action_history_entry(
            "completion_submitted",
            user,
            f"Action completion submitted for review by {user['name']}",
        )
    )
    changes = {
        "action_taken": action_taken,
        "status": "awaiting_review",
        "review_status": "pending",
        "reviewed_by_id": None,
        "reviewed_by_name": None,
        "reviewed_at": None,
        "review_comment": None,
        "completed_by_id": user["id"],
        "completed_by_name": user["name"],
        "completed_at": now,
        "history": history,
        "updated_at": now,
    }
    await legacy.db.corrective_actions.update_one(
        {"id": action_id}, {"$set": changes}
    )
    await legacy.sync_action_to_audit(
        action,
        action_status="awaiting_review",
        action_taken=action_taken,
        action_completed_by=user["name"],
        action_completed_at=now,
    )

    await create_notification(
        user_id=reviewer["id"],
        company_id=action.get("company_id"),
        notification_type="action_review_required",
        title="Corrective action ready for review",
        message=f"{action.get('audit_name', 'Audit')}: review and sign off the completed action.",
        link=f"/actions?action={action_id}",
        metadata={"action_id": action_id},
    )
    updated = await legacy.db.corrective_actions.find_one(
        {"id": action_id}, {"_id": 0}
    )
    await _send_review_ready_email(updated, reviewer)
    return action_payload(updated)


@router.put("/actions/{action_id}/review")
async def review_corrective_action(
    action_id: str,
    decision: ActionReviewDecision,
    user: dict = Depends(legacy.require_feature("actions")),
):
    action = await legacy.db.corrective_actions.find_one(
        {"id": action_id}, {"_id": 0}
    )
    if not action:
        raise HTTPException(status_code=404, detail="Corrective action not found")
    if action_reviewer_id(action) != user.get("id"):
        raise HTTPException(
            status_code=403,
            detail="Only the nominated approver can review and sign off this action",
        )
    if action.get("archived"):
        raise HTTPException(status_code=400, detail="Archived actions cannot be reviewed")
    if action.get("status") != "awaiting_review":
        raise HTTPException(status_code=409, detail="This action is not awaiting review")

    comment = (decision.comment or "").strip() or None
    if not decision.approved and not comment:
        raise HTTPException(status_code=400, detail="A comment is required when rejecting an action")

    now = legacy.get_uk_time_iso()
    history = list(action.get("history") or [])
    if decision.approved:
        history.append(
            legacy.action_history_entry(
                "review_approved",
                user,
                "Action reviewed and signed off",
                comment=comment,
            )
        )
        changes = {
            "status": "effectiveness_pending",
            "review_status": "approved",
            "reviewed_by_id": user["id"],
            "reviewed_by_name": user["name"],
            "reviewed_at": now,
            "review_comment": comment,
            "effectiveness_status": "pending",
            "effectiveness_due_date": (legacy.get_uk_time().date() + timedelta(days=7)).isoformat(),
            "history": history,
            "updated_at": now,
        }
        await legacy.db.corrective_actions.update_one(
            {"id": action_id}, {"$set": changes}
        )
        await legacy.sync_action_to_audit(
            action,
            action_status="effectiveness_pending",
            action_taken=action.get("action_taken"),
            action_completed_by=action.get("completed_by_name"),
            action_completed_at=action.get("completed_at"),
        )
    else:
        history.append(
            legacy.action_history_entry(
                "review_rejected",
                user,
                f"Action completion rejected: {comment}",
                comment=comment,
            )
        )
        submitter_id = action.get("completed_by_id")
        submitter_name = action.get("completed_by_name")
        changes = {
            "status": "open",
            "review_status": "rejected",
            "reviewed_by_id": user["id"],
            "reviewed_by_name": user["name"],
            "reviewed_at": now,
            "review_comment": comment,
            "completed_by_id": None,
            "completed_by_name": None,
            "completed_at": None,
            "history": history,
            "updated_at": now,
        }
        await legacy.db.corrective_actions.update_one(
            {"id": action_id}, {"$set": changes}
        )
        await legacy.sync_action_to_audit(
            action,
            action_status="open",
            action_taken=action.get("action_taken"),
            action_completed_by=None,
            action_completed_at=None,
        )
        if submitter_id and submitter_id != user.get("id"):
            await create_notification(
                user_id=submitter_id,
                company_id=action.get("company_id"),
                notification_type="action_review_rejected",
                title="Corrective action needs more work",
                message=f"{action.get('audit_name', 'Audit')}: {comment}",
                link=f"/actions?action={action_id}",
                metadata={"action_id": action_id, "reviewer": user.get("name"), "submitter": submitter_name},
            )

    await mark_action_notifications_read(user["id"], action_id)
    updated = await legacy.db.corrective_actions.find_one(
        {"id": action_id}, {"_id": 0}
    )
    return action_payload(updated)


@router.put("/actions/{action_id}/effectiveness")
async def verify_action_effectiveness(
    action_id: str,
    decision: ActionEffectivenessDecision,
    user: dict = Depends(legacy.require_feature("actions")),
):
    action = await legacy.db.corrective_actions.find_one({"id": action_id}, {"_id": 0})
    if not action:
        raise HTTPException(status_code=404, detail="Corrective action not found")
    if action.get("status") != "effectiveness_pending":
        raise HTTPException(status_code=409, detail="This action is not awaiting effectiveness verification")
    if action_reviewer_id(action) != user.get("id") and not legacy.is_admin(user):
        raise HTTPException(status_code=403, detail="Only the approver or an administrator can verify effectiveness")
    evidence = decision.evidence.strip()
    if not evidence:
        raise HTTPException(status_code=400, detail="Effectiveness evidence is required")
    now = legacy.get_uk_time_iso()
    history = list(action.get("history") or [])
    if decision.effective:
        status = "completed"
        message = "Effectiveness verified; action closed"
        event = "effectiveness_verified"
    else:
        status = "open"
        message = "Action found ineffective and reopened"
        event = "effectiveness_failed"
    history.append(legacy.action_history_entry(event, user, message, comment=evidence))
    changes = {
        "status": status,
        "effectiveness_status": "effective" if decision.effective else "ineffective",
        "effectiveness_evidence": evidence,
        "effectiveness_verified_by_id": user["id"],
        "effectiveness_verified_by_name": user.get("name"),
        "effectiveness_verified_at": now,
        "history": history,
        "updated_at": now,
    }
    if not decision.effective:
        changes.update({
            "due_date": (legacy.get_uk_time().date() + timedelta(days=7)).isoformat(),
            "review_status": "rework_required",
            "completed_at": None,
        })
    await legacy.db.corrective_actions.update_one({"id": action_id}, {"$set": changes})
    await legacy.sync_action_to_audit(
        action,
        action_status=status,
        action_taken=action.get("action_taken"),
        action_completed_by=action.get("completed_by_name") if decision.effective else None,
        action_completed_at=action.get("completed_at") if decision.effective else None,
    )
    if not decision.effective and action.get("assigned_user_id"):
        await create_notification(
            user_id=action["assigned_user_id"],
            company_id=action.get("company_id"),
            notification_type="action_ineffective",
            title="Corrective action reopened",
            message=f"{action.get('audit_name', 'Audit')}: {evidence}",
            link=f"/actions?action={action_id}",
            metadata={"action_id": action_id},
        )
    updated = await legacy.db.corrective_actions.find_one({"id": action_id}, {"_id": 0})
    return action_payload(updated)
