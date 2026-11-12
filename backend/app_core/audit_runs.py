from __future__ import annotations

import uuid
import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import server as legacy
from app_core.audit_reports import _get_accessible_run, audit_run_access_allowed
from app_core.audit_deadlines import close_if_expired, run_payload
from app_core.company_activity import DeletionReason, delete_with_reason


router = APIRouter(prefix="/api", tags=["audit-runs"])


class DemoAuditDateUpdate(BaseModel):
    started_at: datetime
    completed_at: datetime


@router.get("/demo-audit-dates/status")
async def demo_audit_dates_status(user: dict = Depends(legacy.get_current_user)):
    """Expose availability only to system administrators."""
    if not legacy.is_system_admin(user):
        raise HTTPException(status_code=403, detail="System administrator required")
    return {"enabled": os.environ.get("DEMO_AUDIT_DATES_ENABLED", "").lower() in {"1", "true", "yes"}}


@router.put("/run-audits/{run_id}/demo-dates")
async def set_demo_audit_dates(
    run_id: str,
    data: DemoAuditDateUpdate,
    user: dict = Depends(legacy.get_current_user),
):
    """Temporarily enabled, system-admin-only demonstration data backdating.

    Real timestamps are preserved separately and the demo flag is permanent.
    """
    if not legacy.is_system_admin(user):
        raise HTTPException(status_code=403, detail="System administrator required")
    if os.environ.get("DEMO_AUDIT_DATES_ENABLED", "").lower() not in {"1", "true", "yes"}:
        raise HTTPException(status_code=404, detail="Demo date editing is disabled")
    if data.started_at.tzinfo is None or data.completed_at.tzinfo is None:
        raise HTTPException(status_code=422, detail="Dates must include timezone offsets")
    start = data.started_at.astimezone(timezone.utc)
    end = data.completed_at.astimezone(timezone.utc)
    if end < start:
        raise HTTPException(status_code=422, detail="Completion cannot precede start")
    if end > datetime.now(timezone.utc):
        raise HTTPException(status_code=422, detail="Demo completion cannot be in the future")
    async with legacy.db.transaction("audit:" + run_id):
        run = await legacy.db.run_audits.find_one({"id": run_id}, {"_id": 0})
        if not run:
            raise HTTPException(status_code=404, detail="Audit not found")
        if not run.get("completed") or run.get("closed_at"):
            raise HTTPException(status_code=409, detail="Only completed audits can be dated for demonstration")
        if not run.get("demo_record") and not run.get("demo_original_timestamps"):
            originals = {
                "started_at": run.get("started_at"),
                "completed_at": run.get("completed_at"),
                "recorded_at": legacy.get_uk_time_iso(),
            }
        else:
            originals = run.get("demo_original_timestamps") or {}
        uk = ZoneInfo("Europe/London")
        update = {
            "demo_record": True,
            "demo_original_timestamps": originals,
            "demo_date_changed_by": user.get("id"),
            "demo_date_changed_at": legacy.get_uk_time_iso(),
            "started_at": start.astimezone(uk).isoformat(),
            "completed_at": end.astimezone(uk).isoformat(),
        }
        await legacy.db.run_audits.update_one({"id": run_id}, {"$set": update})
    return {"id": run_id, **update}


class AuditCancellation(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=1000)


def _can_manage_run(user: dict, run: dict) -> bool:
    if legacy.is_system_admin(user):
        return True
    if run.get("auditor_id") == user.get("id"):
        return True
    return legacy.is_admin(user) and run.get("company_id") == user.get("company_id")


async def _cancel_audit_run(
    run_id: str,
    data: AuditCancellation | None = None,
    user: dict = Depends(legacy.get_current_user),
):
    run, _ = await _get_accessible_run(run_id, user)
    if not run:
        raise HTTPException(status_code=404, detail="Audit run not found")
    if not _can_manage_run(user, run):
        raise HTTPException(status_code=403, detail="You cannot cancel this audit")
    if run.get("completed") or run.get("closed_at"):
        if not data or not data.reason or not data.reason.strip():
            raise HTTPException(status_code=400, detail="A deletion reason is required")
        return await delete_with_reason(legacy.db.run_audits, run, DeletionReason(reason=data.reason), user)

    cancellation = {
        "id": str(uuid.uuid4()),
        "run_id": run["id"],
        "audit_id": run.get("audit_id"),
        "audit_name": run.get("audit_name"),
        "company_id": run.get("company_id") or user.get("company_id"),
        "auditor_id": run.get("auditor_id"),
        "auditor_name": run.get("auditor_name"),
        "started_at": run.get("started_at"),
        "cancelled_at": legacy.get_uk_time_iso(),
        "cancelled_by_id": user.get("id"),
        "cancelled_by_name": user.get("name"),
        "reason": (data.reason if data else None) or "Cancelled by auditor",
    }
    await legacy.db.audit_cancellations.insert_one(cancellation)
    from database import activity_reason
    token = activity_reason.set(cancellation["reason"])
    try:
        await legacy.db.run_audits.delete_one({"id": run_id})
    finally:
        activity_reason.reset(token)
    return {
        "message": "Audit cancelled",
        "status": "cancelled",
        "cancellation_id": cancellation["id"],
    }


@router.delete("/run-audits/{run_id}")
async def cancel_audit_run(run_id: str, data: AuditCancellation | None = None,
                           user: dict = Depends(legacy.require_feature("audits"))):
    async with legacy.db.transaction("audit:" + run_id):
        return await _cancel_audit_run(run_id, data, user)


@router.get("/run-audits")
async def get_run_audits(completed: bool | None = None,
                         user: dict = Depends(legacy.require_feature("audits")),
                         limit: int = 100):
    limit = max(1, min(int(limit), 500))
    query = {} if legacy.is_system_admin(user) else {"$or": [{"company_id": user.get("company_id")}, {"company_id": None}]}
    if not legacy.is_system_admin(user) and not user.get("company_id"):
        query["auditor_id"] = user["id"]
    if completed is not None:
        query["completed"] = completed
    if completed is False:
        query["closed_at"] = None
    runs = await legacy.db.run_audits.find(query, {"_id": 0}).sort("started_at", -1).to_list(limit)
    visible = []
    for run in runs:
        audit = await legacy.db.audits.find_one({"id": run.get("audit_id")}) if not run.get("company_id") else None
        if not audit_run_access_allowed(run, user, audit):
            continue
        if not run.get("completed") and not run.get("closed_at"):
            async with legacy.db.transaction("audit:" + run["id"]):
                current = await legacy.db.run_audits.find_one({"id": run["id"]})
                if not current:
                    continue
                run = await close_if_expired(current)
        if completed is False and (run.get("completed") or run.get("closed_at")):
            continue
        visible.append(run_payload(run))
    return visible


@router.get("/run-audits/{run_id}")
async def get_run_audit(run_id: str, user: dict = Depends(legacy.require_feature("audits"))):
    async with legacy.db.transaction("audit:" + run_id):
        run, _ = await _get_accessible_run(run_id, user)
        return run_payload(await close_if_expired(run))
