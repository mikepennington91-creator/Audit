from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import server as legacy


router = APIRouter(prefix="/api", tags=["schedules"])

RECURRENCE_MONTHS = {
    "monthly": 1,
    "quarterly": 3,
    "six_monthly": 6,
    "annually": 12,
}
RECURRENCE_OPTIONS = {"none", "weekly", "fortnightly", "start_up", *RECURRENCE_MONTHS}
RISK_FREQUENCY = {
    "no_risk": "annually",
    "very_low_risk": "quarterly",
    "low_risk": "monthly",
    "medium_risk": "weekly",
    "high_risk": "start_up",
    "very_high_risk": "start_up",
}


class ScheduleSeriesUpdate(BaseModel):
    assigned_to: Optional[str] = None
    scheduled_date: Optional[str] = None
    recurrence: Optional[str] = None
    risk_level: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None
    reminder_days: Optional[int] = Field(default=None, ge=0, le=365)


class ScheduleSeriesStatus(BaseModel):
    status: str
    reason: str = Field(min_length=1, max_length=1000)


class ScheduleSkip(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)

SCHEDULE_MANAGER_ROLES = [
    legacy.UserRole.SYSTEM_ADMIN,
    legacy.UserRole.COMPANY_ADMIN,
    legacy.UserRole.ADMIN,
    legacy.UserRole.AUDIT_CREATOR,
]


def scheduled_date(value: str | None) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def schedule_window(schedule: Dict[str, Any]) -> tuple[Optional[date], Optional[date]]:
    """Return the calendar window in which a run satisfies an occurrence."""
    anchor = scheduled_date(schedule.get("scheduled_date"))
    if not anchor:
        return None, None
    if (schedule.get("recurrence") or "none") != "none":
        start = anchor - timedelta(days=anchor.weekday())
        return start, start + timedelta(days=6)
    return anchor, anchor


def add_months(value: date, months: int) -> date:
    """Move a date by calendar months, clamping to the destination month end."""
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    if month == 12:
        next_month = date(year + 1, 1, 1)
    else:
        next_month = date(year, month + 1, 1)
    month_end = (next_month - timedelta(days=1)).day
    return date(year, month, min(value.day, month_end))


def next_occurrence_date(value: date, recurrence: str, occurrences: int = 1) -> Optional[date]:
    if recurrence == "weekly":
        return value + timedelta(days=7 * occurrences)
    if recurrence == "fortnightly":
        return value + timedelta(days=14 * occurrences)
    months = RECURRENCE_MONTHS.get(recurrence)
    return add_months(value, months * occurrences) if months else None


def run_completion_date(run: Dict[str, Any]) -> Optional[date]:
    value = run.get("completed_at") or run.get("updated_at")
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.date()
    except (TypeError, ValueError):
        return scheduled_date(str(value))


def run_satisfies_schedule(run: Dict[str, Any], schedule: Dict[str, Any]) -> bool:
    if not run.get("completed") or run.get("audit_id") != schedule.get("audit_id"):
        return False
    if run.get("company_id") != schedule.get("company_id"):
        return False
    completed_on = run_completion_date(run)
    window_start, window_end = schedule_window(schedule)
    return bool(completed_on and window_start and window_end and window_start <= completed_on <= window_end)


async def _create_next_recurring_occurrence(schedule: Dict[str, Any]) -> None:
    if schedule.get("series_status", "active") != "active":
        return
    current_date = scheduled_date(schedule.get("scheduled_date"))
    if not current_date:
        return
    anchor_date = scheduled_date(schedule.get("recurrence_anchor_date")) or current_date
    occurrence_number = int(schedule.get("occurrence_number") or 0) + 1
    next_date = next_occurrence_date(
        anchor_date,
        schedule.get("recurrence") or "none",
        occurrence_number,
    )
    if not next_date:
        return
    series_id = schedule.get("series_id") or schedule["id"]
    next_id = str(legacy.uuid.uuid5(
        legacy.uuid.NAMESPACE_URL,
        f"infinit-audit-schedule:{series_id}:{next_date.isoformat()}",
    ))
    next_occurrence = {
        **schedule,
        "id": next_id,
        "series_id": series_id,
        "recurrence_anchor_date": anchor_date.isoformat(),
        "occurrence_number": occurrence_number,
        "scheduled_date": next_date.isoformat(),
        "status": "pending",
        "created_at": legacy.get_uk_time_iso(),
        "completed_run_id": None,
        "completed_at": None,
        "reminder_email_status": None,
        "reminder_last_attempt_at": None,
        "reminder_sent_at": None,
        "overdue_escalation_sent_at": None,
    }
    await legacy.db.scheduled_audits.insert_one_if_absent(next_occurrence)


async def complete_matching_schedules(run: Dict[str, Any]) -> int:
    """Complete same-company occurrences covered by a completed audit run."""
    if not run.get("completed") or not run.get("audit_id") or not run.get("company_id"):
        return 0
    schedules_collection = getattr(legacy.db, "scheduled_audits", None)
    if schedules_collection is None:
        return 0
    candidates = await schedules_collection.find(
        {
            "audit_id": run["audit_id"],
            "company_id": run["company_id"],
            "status": {"$in": ["pending", "overdue"]},
        },
        {"_id": 0},
    ).to_list(500)
    matching = [schedule for schedule in candidates if run_satisfies_schedule(run, schedule)]
    for schedule in matching:
        await legacy.db.scheduled_audits.update_one(
            {"id": schedule["id"]},
            {"$set": {
                "status": "completed",
                "completed_run_id": run["id"],
                "completed_at": run.get("completed_at") or legacy.get_uk_time_iso(),
            }},
        )
        await _create_next_recurring_occurrence(schedule)
    return len(matching)


def schedule_access_allowed(
    schedule: Dict[str, Any],
    user: Dict[str, Any],
    assigned_user: Optional[Dict[str, Any]] = None,
) -> bool:
    if legacy.is_system_admin(user):
        return True
    if schedule.get("assigned_to") == user.get("id"):
        return True
    if user.get("role") not in [
        legacy.UserRole.COMPANY_ADMIN,
        legacy.UserRole.ADMIN,
        legacy.UserRole.AUDIT_CREATOR,
    ]:
        return False
    company_id = schedule.get("company_id")
    if company_id is None and assigned_user:
        company_id = assigned_user.get("company_id")
    return company_id == user.get("company_id")


async def _get_assigned_user(user_id: str) -> Optional[Dict[str, Any]]:
    return await legacy.db.users.find_one(
        {"id": user_id}, {"_id": 0, "password": 0}
    )


async def _get_accessible_schedule(schedule_id: str, user: Dict[str, Any]) -> Dict[str, Any]:
    schedule = await legacy.db.scheduled_audits.find_one(
        {"id": schedule_id}, {"_id": 0}
    )
    if not schedule:
        raise HTTPException(status_code=404, detail="Scheduled audit not found")
    assigned_user = await _get_assigned_user(str(schedule.get("assigned_to") or ""))
    if not schedule_access_allowed(schedule, user, assigned_user):
        # Keep missing and inaccessible IDs indistinguishable across companies.
        raise HTTPException(status_code=404, detail="Scheduled audit not found")
    return schedule


async def _company_user_ids(user: Dict[str, Any]) -> List[str]:
    if legacy.is_system_admin(user):
        users = await legacy.db.users.find({}, {"_id": 0, "password": 0}).to_list(5000)
    else:
        users = await legacy.db.users.find(
            {"company_id": user.get("company_id")}, {"_id": 0, "password": 0}
        ).to_list(5000)
    return [item["id"] for item in users if item.get("id")]


@router.get("/schedule-assignees")
async def get_schedule_assignees(
    user: dict = Depends(legacy.require_role(SCHEDULE_MANAGER_ROLES, "audits_edit")),
):
    query = {} if legacy.is_system_admin(user) else {"company_id": user.get("company_id")}
    users = await legacy.db.users.find(
        query, {"_id": 0, "password": 0}
    ).sort("name", 1).to_list(5000)
    return [
        {
            "id": item["id"],
            "name": item.get("name") or item.get("email") or "User",
            "email": item.get("email"),
            "company_id": item.get("company_id"),
        }
        for item in users
        if item.get("id") and item.get("email")
    ]


@router.post("/scheduled-audits", response_model=legacy.ScheduledAuditResponse)
async def create_scheduled_audit(
    schedule_data: legacy.ScheduledAuditCreate,
    user: dict = Depends(legacy.require_role(SCHEDULE_MANAGER_ROLES, "audits_edit")),
):
    audit = await legacy.db.audits.find_one(
        {"id": schedule_data.audit_id}, {"_id": 0}
    )
    if not audit:
        raise HTTPException(status_code=404, detail="Audit not found")

    assigned_user = await _get_assigned_user(schedule_data.assigned_to)
    if not assigned_user:
        raise HTTPException(status_code=404, detail="Assigned user not found")

    assigned_company_id = assigned_user.get("company_id")
    audit_company_id = audit.get("company_id")

    if not legacy.is_system_admin(user):
        if assigned_company_id != user.get("company_id"):
            raise HTTPException(
                status_code=403,
                detail="Cannot schedule audits for users from another company",
            )
        if audit_company_id not in {None, user.get("company_id")}:
            raise HTTPException(status_code=404, detail="Audit not found")

    # A company-owned audit may only be assigned inside that same company, even
    # when the scheduler is a system administrator. Global templates are allowed.
    if audit_company_id is not None and audit_company_id != assigned_company_id:
        raise HTTPException(
            status_code=400,
            detail="The selected audit and assigned user belong to different companies",
        )

    # Private templates are only usable by their creator. This prevents a
    # scheduled user receiving work they cannot subsequently open in the app.
    if audit.get("is_private") and audit.get("created_by") != assigned_user.get("id"):
        raise HTTPException(
            status_code=400,
            detail="Private audits can only be scheduled for their creator",
        )

    due_date = scheduled_date(schedule_data.scheduled_date)
    if not due_date:
        raise HTTPException(status_code=400, detail="Scheduled date must be valid")
    if due_date < legacy.get_uk_time().date():
        raise HTTPException(status_code=400, detail="Scheduled date cannot be in the past")

    reminder_days = int(schedule_data.reminder_days)
    if reminder_days < 0 or reminder_days > 365:
        raise HTTPException(status_code=400, detail="Reminder days must be between 0 and 365")

    recurrence = str(schedule_data.recurrence or "none").lower()
    if recurrence not in RECURRENCE_OPTIONS:
        raise HTTPException(status_code=400, detail="Select a valid recurrence interval")
    risk_level = str(schedule_data.risk_level or "no_risk").lower()
    if risk_level not in RISK_FREQUENCY:
        raise HTTPException(status_code=400, detail="Select a valid risk level")

    now = legacy.get_uk_time_iso()
    schedule_id = str(legacy.uuid.uuid4())
    schedule_doc = {
        "id": schedule_id,
        "audit_id": audit["id"],
        "audit_name": audit["name"],
        "assigned_to": assigned_user["id"],
        "assigned_to_name": assigned_user.get("name") or assigned_user.get("email") or "User",
        "assigned_to_email": assigned_user.get("email") or "",
        "company_id": assigned_company_id,
        "scheduled_date": due_date.isoformat(),
        "location": schedule_data.location,
        "notes": schedule_data.notes,
        "reminder_days": reminder_days,
        "status": "pending",
        "created_by": user["id"],
        "created_at": now,
        "completed_run_id": None,
        "recurrence": recurrence,
        "risk_level": risk_level,
        "recommended_recurrence": RISK_FREQUENCY[risk_level],
        "series_id": schedule_id,
        "series_status": "active",
        "recurrence_anchor_date": due_date.isoformat(),
        "occurrence_number": 0,
        "reminder_email_status": None,
        "reminder_last_attempt_at": None,
        "reminder_sent_at": None,
        "overdue_escalation_sent_at": None,
    }
    await legacy.db.scheduled_audits.insert_one(schedule_doc)
    return legacy.ScheduledAuditResponse(**schedule_doc)


@router.get("/scheduled-audits", response_model=List[legacy.ScheduledAuditResponse])
async def get_scheduled_audits(
    status: Optional[str] = None,
    user: dict = Depends(legacy.require_feature("audits")),
):
    if status and status not in {"pending", "overdue", "completed", "skipped", "paused", "cancelled"}:
        raise HTTPException(status_code=400, detail="Unknown scheduled audit status")

    if legacy.is_system_admin(user):
        query: Dict[str, Any] = {}
    elif user.get("role") == legacy.UserRole.USER:
        query = {"assigned_to": user["id"]}
    else:
        company_user_ids = await _company_user_ids(user)
        query = {"assigned_to": {"$in": company_user_ids}}

    if status:
        query["status"] = status

    schedules = await legacy.db.scheduled_audits.find(
        query, {"_id": 0}
    ).sort("scheduled_date", 1).to_list(5000)

    today = legacy.get_uk_time().date()
    results = []
    for schedule in schedules:
        _, due_date = schedule_window(schedule)
        if schedule.get("status") == "pending" and due_date and due_date < today:
            schedule["status"] = "overdue"
            await legacy.db.scheduled_audits.update_one(
                {"id": schedule["id"]}, {"$set": {"status": "overdue"}}
            )
        # A status filter for "pending" must not return a row that became overdue
        # during this read pass.
        if status and schedule.get("status") != status:
            continue
        results.append(legacy.ScheduledAuditResponse(**schedule))
    return results


@router.get("/scheduled-audits/my-schedule", response_model=List[legacy.ScheduledAuditResponse])
async def get_my_scheduled_audits(
    user: dict = Depends(legacy.require_feature("audits")),
):
    schedules = await legacy.db.scheduled_audits.find(
        {"assigned_to": user["id"], "status": {"$in": ["pending", "overdue"]}},
        {"_id": 0},
    ).sort("scheduled_date", 1).to_list(500)

    today = legacy.get_uk_time().date()
    results = []
    for schedule in schedules:
        _, due_date = schedule_window(schedule)
        if schedule.get("status") == "pending" and due_date and due_date < today:
            schedule["status"] = "overdue"
            await legacy.db.scheduled_audits.update_one(
                {"id": schedule["id"]}, {"$set": {"status": "overdue"}}
            )
        results.append(legacy.ScheduledAuditResponse(**schedule))
    return results


@router.put("/scheduled-audits/{schedule_id}/complete")
async def complete_scheduled_audit(
    schedule_id: str,
    run_id: str,
    user: dict = Depends(legacy.require_feature("audits")),
):
    schedule = await _get_accessible_schedule(schedule_id, user)
    run = await legacy.db.run_audits.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Audit run not found")
    if not run.get("completed"):
        raise HTTPException(status_code=409, detail="The audit run has not been completed")
    if not run_satisfies_schedule(run, schedule):
        raise HTTPException(
            status_code=400,
            detail="The audit run must be for this audit and company within the scheduled period",
        )

    await complete_matching_schedules(run)
    return {"message": "Scheduled audit marked as completed"}


@router.get("/scheduled-audits/series/{series_id}")
async def get_schedule_series(
    series_id: str,
    user: dict = Depends(legacy.require_feature("audits")),
):
    occurrences = await legacy.db.scheduled_audits.find(
        {"$or": [{"series_id": series_id}, {"id": series_id}]}, {"_id": 0}
    ).sort("scheduled_date", 1).to_list(1000)
    if not occurrences:
        raise HTTPException(status_code=404, detail="Schedule series not found")
    if not schedule_access_allowed(occurrences[0], user, await _get_assigned_user(occurrences[0].get("assigned_to", ""))):
        raise HTTPException(status_code=404, detail="Schedule series not found")
    return {"series_id": series_id, "occurrences": occurrences}


@router.put("/scheduled-audits/series/{series_id}")
async def update_schedule_series(
    series_id: str,
    data: ScheduleSeriesUpdate,
    user: dict = Depends(legacy.require_role(SCHEDULE_MANAGER_ROLES, "audits_edit")),
):
    series = await get_schedule_series(series_id, user)
    current = series["occurrences"][-1]
    changes = data.model_dump(exclude_unset=True)
    if "recurrence" in changes and changes["recurrence"] not in RECURRENCE_OPTIONS:
        raise HTTPException(status_code=400, detail="Select a valid recurrence interval")
    if "risk_level" in changes:
        if changes["risk_level"] not in RISK_FREQUENCY:
            raise HTTPException(status_code=400, detail="Select a valid risk level")
        changes["recommended_recurrence"] = RISK_FREQUENCY[changes["risk_level"]]
    if "scheduled_date" in changes:
        parsed = scheduled_date(changes["scheduled_date"])
        if not parsed or parsed < legacy.get_uk_time().date():
            raise HTTPException(status_code=400, detail="Enter a valid future scheduled date")
        changes["scheduled_date"] = parsed.isoformat()
        changes["recurrence_anchor_date"] = parsed.isoformat()
        changes["occurrence_number"] = 0
    if "assigned_to" in changes:
        assignee = await _get_assigned_user(changes["assigned_to"])
        if not assignee or (not legacy.is_system_admin(user) and assignee.get("company_id") != current.get("company_id")):
            raise HTTPException(status_code=400, detail="Select a valid user from your company")
        audit = await legacy.db.audits.find_one({"id": current.get("audit_id")}, {"_id": 0})
        if audit and audit.get("company_id") is not None and audit.get("company_id") != assignee.get("company_id"):
            raise HTTPException(status_code=400, detail="The audit and assigned user must belong to the same company")
        changes.update({
            "assigned_to_name": assignee.get("name") or assignee.get("email") or "User",
            "assigned_to_email": assignee.get("email") or "",
            "company_id": assignee.get("company_id"),
        })
    changes.update({"updated_at": legacy.get_uk_time_iso(), "updated_by": user["id"]})
    result = await legacy.db.scheduled_audits.update_many(
        {"$or": [{"series_id": series_id}, {"id": series_id}], "status": {"$in": ["pending", "overdue", "paused"]}},
        {"$set": changes},
    )
    return {"message": "Schedule series updated", "updated": result.modified_count}


@router.put("/scheduled-audits/series/{series_id}/status")
async def set_schedule_series_status(
    series_id: str,
    data: ScheduleSeriesStatus,
    user: dict = Depends(legacy.require_role(SCHEDULE_MANAGER_ROLES, "audits_edit")),
):
    if data.status not in {"active", "paused", "ended"}:
        raise HTTPException(status_code=400, detail="Status must be active, paused or ended")
    await get_schedule_series(series_id, user)
    occurrence_status = "pending" if data.status == "active" else ("paused" if data.status == "paused" else "cancelled")
    await legacy.db.scheduled_audits.update_many(
        {"$or": [{"series_id": series_id}, {"id": series_id}], "status": {"$in": ["pending", "overdue", "paused"]}},
        {"$set": {
            "series_status": data.status,
            "status": occurrence_status,
            "series_status_reason": data.reason.strip(),
            "series_status_changed_at": legacy.get_uk_time_iso(),
            "series_status_changed_by": user["id"],
        }},
    )
    return {"message": f"Schedule series {data.status}"}


@router.post("/scheduled-audits/{schedule_id}/skip")
async def skip_scheduled_audit(
    schedule_id: str,
    data: ScheduleSkip,
    user: dict = Depends(legacy.require_role(SCHEDULE_MANAGER_ROLES, "audits_edit")),
):
    schedule = await _get_accessible_schedule(schedule_id, user)
    if schedule.get("status") not in {"pending", "overdue"}:
        raise HTTPException(status_code=409, detail="Only an open occurrence can be skipped")
    await _create_next_recurring_occurrence(schedule)
    await legacy.db.scheduled_audits.update_one(
        {"id": schedule_id},
        {"$set": {"status": "skipped", "skip_reason": data.reason.strip(), "skipped_at": legacy.get_uk_time_iso(), "skipped_by": user["id"]}},
    )
    return {"message": "Audit occurrence skipped"}


@router.post("/scheduled-audits/series/{series_id}/trigger")
async def trigger_start_up_audit(
    series_id: str,
    user: dict = Depends(legacy.require_role(SCHEDULE_MANAGER_ROLES, "audits_edit")),
):
    series = await get_schedule_series(series_id, user)
    source = series["occurrences"][-1]
    if source.get("recurrence") != "start_up" or source.get("series_status", "active") != "active":
        raise HTTPException(status_code=409, detail="Only an active start-up series can be triggered")
    now = legacy.get_uk_time_iso()
    occurrence = {
        **source,
        "id": str(legacy.uuid.uuid4()),
        "scheduled_date": legacy.get_uk_time().date().isoformat(),
        "status": "pending",
        "occurrence_number": int(source.get("occurrence_number") or 0) + 1,
        "created_at": now,
        "completed_run_id": None,
        "completed_at": None,
        "reminder_email_status": None,
        "reminder_sent_at": None,
    }
    await legacy.db.scheduled_audits.insert_one(occurrence)
    return occurrence


@router.delete("/scheduled-audits/{schedule_id}")
async def delete_scheduled_audit(
    schedule_id: str,
    user: dict = Depends(legacy.require_role(SCHEDULE_MANAGER_ROLES, "audits_edit")),
):
    await _get_accessible_schedule(schedule_id, user)
    result = await legacy.db.scheduled_audits.delete_one({"id": schedule_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Scheduled audit not found")
    return {"message": "Scheduled audit deleted"}
