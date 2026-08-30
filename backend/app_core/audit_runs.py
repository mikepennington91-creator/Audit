from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import server as legacy


router = APIRouter(prefix="/api", tags=["audit-runs"])


class AuditCancellation(BaseModel):
    reason: Optional[str] = Field(default="Cancelled by auditor", max_length=500)


def _can_manage_run(user: dict, run: dict) -> bool:
    if legacy.is_system_admin(user):
        return True
    if run.get("auditor_id") == user.get("id"):
        return True
    return legacy.is_admin(user) and run.get("company_id") == user.get("company_id")


@router.delete("/run-audits/{run_id}")
async def cancel_audit_run(
    run_id: str,
    data: AuditCancellation | None = None,
    user: dict = Depends(legacy.get_current_user),
):
    run = await legacy.db.run_audits.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Audit run not found")
    if not _can_manage_run(user, run):
        raise HTTPException(status_code=403, detail="You cannot cancel this audit")
    if run.get("completed"):
        raise HTTPException(status_code=400, detail="Completed audits cannot be cancelled")

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
    await legacy.db.run_audits.delete_one({"id": run_id})
    return {
        "message": "Audit cancelled",
        "status": "cancelled",
        "cancellation_id": cancellation["id"],
    }
