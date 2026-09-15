from __future__ import annotations

import uuid
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import server as legacy
from app_core.action_references import allocate_action_reference
from app_core.actions import _validate_action_owner_inputs, send_action_assignment_email


router = APIRouter(prefix="/api", tags=["audit corrective actions"])


class AdditionalAuditAction(BaseModel):
    id: str
    action_required: str = ""
    assigned_user_id: str = ""
    due_date: str = ""


class AdditionalAuditActionsUpdate(BaseModel):
    actions: List[AdditionalAuditAction] = []


async def _accessible_open_run(run_id: str, user: dict) -> dict:
    run = await legacy.db.run_audits.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Audit run not found")
    if not legacy.is_system_admin(user) and run.get("company_id") != user.get("company_id"):
        raise HTTPException(status_code=403, detail="Access denied")
    return run


async def _validate_additional_actions(run: dict, actions: List[dict], user: dict) -> List[dict]:
    validated = []
    for action in actions:
        required = (action.get("action_required") or "").strip()
        owner_id = (action.get("assigned_user_id") or "").strip()
        due = (action.get("due_date") or "").strip()
        if not required or not owner_id or not due:
            raise HTTPException(
                status_code=400,
                detail="Action required, registered action owner and due date must be completed for every corrective action",
            )
        try:
            parsed_due = date.fromisoformat(due)
        except ValueError:
            raise HTTPException(status_code=400, detail="Enter a valid corrective action due date")
        if parsed_due < legacy.get_uk_time().date():
            raise HTTPException(status_code=400, detail="Corrective action due dates cannot be in the past")
        owner = await legacy.db.users.find_one({"id": owner_id}, {"_id": 0, "password": 0})
        if not owner:
            raise HTTPException(status_code=400, detail="The selected action owner no longer exists")
        if not legacy.is_system_admin(user) and owner.get("company_id") != run.get("company_id"):
            raise HTTPException(status_code=403, detail="Actions can only be assigned within your company")
        validated.append({**action, "action_required": required, "due_date": due, "owner": owner})
    return validated


@router.get("/run-audits/{run_id}/questions/{question_id}/additional-actions")
async def get_additional_audit_actions(
    run_id: str,
    question_id: str,
    user: dict = Depends(legacy.require_feature("audits")),
):
    await _accessible_open_run(run_id, user)
    draft = await legacy.db.audit_additional_action_drafts.find_one(
        {"run_id": run_id, "question_id": question_id}, {"_id": 0}
    )
    return {"actions": (draft or {}).get("actions", [])}


@router.put("/run-audits/{run_id}/questions/{question_id}/additional-actions")
async def save_additional_audit_actions(
    run_id: str,
    question_id: str,
    update: AdditionalAuditActionsUpdate,
    user: dict = Depends(legacy.require_feature("audits")),
):
    run = await _accessible_open_run(run_id, user)
    if run.get("completed") or run.get("closed_at"):
        raise HTTPException(status_code=409, detail="This audit can no longer be edited")
    actions = [action.model_dump() for action in update.actions]
    await legacy.db.audit_additional_action_drafts.update_one(
        {"run_id": run_id, "question_id": question_id},
        {"$set": {
            "run_id": run_id,
            "question_id": question_id,
            "company_id": run.get("company_id"),
            "actions": actions,
            "updated_by_id": user.get("id"),
            "updated_at": legacy.get_uk_time_iso(),
        }},
        upsert=True,
    )
    return {"actions": actions}


async def _create_additional_action_records(run: dict, submit_data: legacy.RunAuditSubmit, user: dict) -> None:
    drafts = await legacy.db.audit_additional_action_drafts.find(
        {"run_id": run["id"]}, {"_id": 0}
    ).to_list(1000)
    if not drafts:
        return

    audit = await legacy.db.audits.find_one({"id": run["audit_id"]}, {"_id": 0}) or {}
    question_map = {q.get("id"): q for q in audit.get("questions", [])}
    answer_map = {answer.question_id: answer for answer in submit_data.answers}

    for draft in drafts:
        question_id = draft["question_id"]
        answer = answer_map.get(question_id)
        if not answer or not answer.is_negative:
            continue
        validated = await _validate_additional_actions(run, draft.get("actions", []), user)
        for item in validated:
            owner = item.pop("owner")
            action_id = str(uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"infinit-audit:{run['id']}:{question_id}:additional:{item['id']}",
            ))
            if await legacy.db.corrective_actions.find_one({"id": action_id}, {"_id": 0}):
                continue
            now = legacy.get_uk_time_iso()
            action = {
                "id": action_id,
                "company_id": run.get("company_id") or owner.get("company_id"),
                "run_id": run["id"],
                "audit_id": run["audit_id"],
                "audit_name": run.get("audit_name") or audit.get("name") or "Audit",
                "question_id": question_id,
                "question_text": question_map.get(question_id, {}).get("text", "Question not found"),
                "response_label": answer.response_label or "N/A",
                "non_conformance": (answer.notes or "").strip(),
                "action_required": item["action_required"],
                "assigned_user_id": owner["id"],
                "assigned_user_name": owner["name"],
                "assigned_user_email": owner.get("email"),
                "assigned_department": None,
                "due_date": item["due_date"],
                "status": "open",
                "action_taken": None,
                "created_by_id": user["id"],
                "created_by_name": user["name"],
                "reviewer_user_id": user["id"],
                "reviewer_user_name": user["name"],
                "reviewer_user_email": user.get("email"),
                "completed_by_id": None,
                "completed_by_name": None,
                "created_at": now,
                "updated_at": now,
                "completed_at": None,
                "archived": False,
                "history": [],
                "extension_request": None,
                "audit_action_key": item["id"],
            }
            async with allocate_action_reference(legacy.db, action["company_id"]) as reference:
                action["reference"] = reference
                await legacy.db.corrective_actions.insert_one(action)
            await send_action_assignment_email(action)

    await legacy.db.audit_additional_action_drafts.delete_many({"run_id": run["id"]})


@router.put("/run-audits/{run_id}", response_model=legacy.RunAuditResponse)
async def update_run_audit_with_multiple_actions(
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
        if closed:
            result = None
        else:
            if submit_data.completed:
                drafts = await legacy.db.audit_additional_action_drafts.find(
                    {"run_id": run_id}, {"_id": 0}
                ).to_list(1000)
                for draft in drafts:
                    answer = next((a for a in submit_data.answers if a.question_id == draft["question_id"]), None)
                    if answer and answer.is_negative:
                        await _validate_additional_actions(run, draft.get("actions", []), user)
            result = await legacy.update_run_audit(run_id, submit_data, user)

    if closed:
        raise HTTPException(status_code=409, detail="This audit was automatically closed: not completed in time")

    if submit_data.completed:
        await _create_additional_action_records(run, submit_data, user)
        from app_core.schedules import complete_matching_schedules
        await complete_matching_schedules({
            **result.model_dump(),
            "company_id": run.get("company_id"),
        })
        # The legacy update creates the first action for each NC. Additional
        # actions are created above. Email any first actions not already sent.
        actions = await legacy.db.corrective_actions.find({"run_id": run_id}, {"_id": 0}).to_list(1000)
        for action in actions:
            await send_action_assignment_email(action)
    return result
