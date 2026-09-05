from __future__ import annotations

import asyncio
import re
import time
import uuid
from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

import server as legacy
from app_core.email_service import email_is_configured, send_email
from app_core.notifications import create_notification
from app_core.schedules import add_months


router = APIRouter(prefix="/api", tags=["compliance-operations"])


def calculate_reconciliation(input_quantity: float, output_quantity: float, waste_quantity: float, carryover_quantity: float) -> tuple[float, float]:
    accounted = output_quantity + waste_quantity + carryover_quantity
    return round(accounted, 3), round(accounted / input_quantity * 100, 2)


def _require_admin(user: dict) -> None:
    if not legacy.is_admin(user):
        raise HTTPException(status_code=403, detail="Administrator access is required")


def _company_query(user: dict) -> dict:
    return {} if legacy.is_system_admin(user) else {"company_id": user.get("company_id")}


def _same_company(record: dict, user: dict) -> bool:
    return legacy.is_system_admin(user) or record.get("company_id") == user.get("company_id")


class TrainingAssignmentCreate(BaseModel):
    user_id: str
    title: str = Field(min_length=1, max_length=250)
    document_template_id: Optional[str] = None
    due_date: str
    refresher_months: Optional[int] = Field(default=None, ge=1, le=60)
    notes: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: str) -> str:
        return value.strip()


class TrainingAcknowledgement(BaseModel):
    acknowledgement: str = Field(min_length=1, max_length=2000)


class CompetencyDecision(BaseModel):
    competent: bool
    evidence: str = Field(min_length=1, max_length=4000)


class MockRecallCreate(BaseModel):
    product_name: str = Field(min_length=1, max_length=250)
    batch_code: str = Field(min_length=1, max_length=150)
    exercise_date: str
    input_quantity: float = Field(gt=0)
    output_quantity: float = Field(ge=0)
    waste_quantity: float = Field(default=0, ge=0)
    carryover_quantity: float = Field(default=0, ge=0)
    unit: str = Field(default="kg", min_length=1, max_length=30)
    destinations: str = Field(min_length=1, max_length=5000)
    traceability_complete: bool
    notes: Optional[str] = Field(default=None, max_length=5000)
    tolerance_lower: float = Field(default=98, ge=0, le=1000)
    tolerance_upper: float = Field(default=102, ge=0, le=1000)


@router.get("/email-deliveries")
async def email_deliveries(
    status: Optional[str] = None,
    template: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    user: dict = Depends(legacy.get_current_user),
):
    _require_admin(user)
    query = _company_query(user)
    if status:
        if status not in {"sent", "failed", "disabled", "skipped"}:
            raise HTTPException(status_code=400, detail="Unknown delivery status")
        query["status"] = status
    if template:
        query["template"] = template
    events = await legacy.db.email_delivery_events.find(
        query, {"_id": 0, "resend_payload": 0}
    ).sort("created_at", -1).to_list(limit)
    return events


@router.post("/email-deliveries/{event_id}/resend")
async def resend_email_delivery(
    event_id: str,
    user: dict = Depends(legacy.get_current_user),
):
    _require_admin(user)
    event = await legacy.db.email_delivery_events.find_one({"id": event_id}, {"_id": 0})
    if not event or not _same_company(event, user):
        raise HTTPException(status_code=404, detail="Email delivery not found")
    payload = event.get("resend_payload")
    if not payload:
        raise HTTPException(
            status_code=409,
            detail="This secure or attachment email cannot be replayed. Generate a fresh email from its original screen.",
        )
    result = await send_email(
        to_email=event.get("recipient") or "",
        subject=payload.get("subject") or event.get("subject") or "Infinit Audit notification",
        text_body=payload.get("text_body") or "",
        html_body=payload.get("html_body"),
        template=f"{event.get('template') or 'generic'}_resend",
    )
    if not result.sent:
        raise HTTPException(status_code=502, detail="The email could not be delivered. Check the delivery log for details.")
    return {"message": "Email resent successfully"}


@router.get("/training-records")
async def list_training_records(user: dict = Depends(legacy.get_current_user)):
    query = _company_query(user) if legacy.is_admin(user) else {"user_id": user["id"]}
    records = await legacy.db.training_records.find(query, {"_id": 0}).sort("due_date", 1).to_list(2000)
    today = legacy.get_uk_time().date().isoformat()
    for record in records:
        if record.get("status") == "assigned" and record.get("due_date", "") < today:
            record["status"] = "overdue"
    return records


@router.post("/training-records", status_code=201)
async def create_training_record(
    data: TrainingAssignmentCreate,
    user: dict = Depends(legacy.get_current_user),
):
    _require_admin(user)
    try:
        due_date = date.fromisoformat(data.due_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Enter a valid training due date") from exc
    trainee = await legacy.db.users.find_one({"id": data.user_id}, {"_id": 0, "password": 0})
    if not trainee or (not legacy.is_system_admin(user) and trainee.get("company_id") != user.get("company_id")):
        raise HTTPException(status_code=400, detail="Select a valid user from your company")
    template = None
    if data.document_template_id:
        template = await legacy.db.traceability_templates.find_one(
            {"id": data.document_template_id}, {"_id": 0, "fields": 0}
        )
        if not template or (template.get("company_id") not in {None, trainee.get("company_id")}):
            raise HTTPException(status_code=400, detail="Select a valid controlled document")
    now = legacy.get_uk_time_iso()
    record = {
        "id": str(uuid.uuid4()),
        "company_id": trainee.get("company_id"),
        "user_id": trainee["id"],
        "user_name": trainee.get("name"),
        "user_email": trainee.get("email"),
        "title": data.title,
        "document_template_id": data.document_template_id,
        "document_title": (template or {}).get("title"),
        "document_reference": (template or {}).get("document_reference"),
        "document_version": (template or {}).get("version"),
        "due_date": due_date.isoformat(),
        "refresher_months": data.refresher_months,
        "notes": data.notes,
        "status": "assigned",
        "acknowledged_at": None,
        "acknowledgement": None,
        "competency_status": "pending",
        "competency_evidence": None,
        "created_by_id": user["id"],
        "created_by_name": user.get("name"),
        "created_at": now,
        "updated_at": now,
    }
    await legacy.db.training_records.insert_one(record)
    await create_notification(
        user_id=trainee["id"],
        company_id=trainee.get("company_id"),
        notification_type="training_assigned",
        title="Training assigned",
        message=f"{data.title} is due by {legacy.format_uk_date(data.due_date)}.",
        link="/compliance?tab=training",
        metadata={"training_id": record["id"]},
    )
    return record


@router.put("/training-records/{record_id}/acknowledge")
async def acknowledge_training(
    record_id: str,
    data: TrainingAcknowledgement,
    user: dict = Depends(legacy.get_current_user),
):
    record = await legacy.db.training_records.find_one({"id": record_id}, {"_id": 0})
    if not record or record.get("user_id") != user.get("id"):
        raise HTTPException(status_code=404, detail="Training assignment not found")
    if record.get("status") in {"completed", "superseded"}:
        raise HTTPException(status_code=409, detail="This training assignment is already closed")
    now = legacy.get_uk_time_iso()
    await legacy.db.training_records.update_one(
        {"id": record_id},
        {"$set": {
            "status": "awaiting_competency",
            "acknowledgement": data.acknowledgement.strip(),
            "acknowledged_at": now,
            "updated_at": now,
        }},
    )
    return {"message": "Training acknowledged and submitted for competency verification"}


@router.put("/training-records/{record_id}/verify")
async def verify_training_competency(
    record_id: str,
    data: CompetencyDecision,
    user: dict = Depends(legacy.get_current_user),
):
    _require_admin(user)
    record = await legacy.db.training_records.find_one({"id": record_id}, {"_id": 0})
    if not record or not _same_company(record, user):
        raise HTTPException(status_code=404, detail="Training assignment not found")
    if not record.get("acknowledged_at"):
        raise HTTPException(status_code=409, detail="The trainee must acknowledge the training first")
    now = legacy.get_uk_time_iso()
    status = "completed" if data.competent else "assigned"
    changes = {
        "status": status,
        "competency_status": "competent" if data.competent else "not_competent",
        "competency_evidence": data.evidence.strip(),
        "verified_by_id": user["id"],
        "verified_by_name": user.get("name"),
        "verified_at": now,
        "completed_at": now if data.competent else None,
        "updated_at": now,
    }
    if data.competent and record.get("refresher_months"):
        months = int(record["refresher_months"])
        changes["refresher_due_date"] = add_months(legacy.get_uk_time().date(), months).isoformat()
    await legacy.db.training_records.update_one({"id": record_id}, {"$set": changes})
    if not data.competent:
        await create_notification(
            user_id=record["user_id"],
            company_id=record.get("company_id"),
            notification_type="training_rework",
            title="Further training required",
            message=f"{record.get('title')}: {data.evidence.strip()}",
            link="/compliance?tab=training",
            metadata={"training_id": record_id},
        )
    return {"message": "Competency recorded", "status": status}


async def _matching_traceability_records(batch_code: str, user: dict) -> List[Dict[str, Any]]:
    args: List[Any] = [f"%{batch_code.strip()}%"]
    company_clause = ""
    if not legacy.is_system_admin(user):
        args.append(user.get("company_id"))
        company_clause = "AND data ->> 'company_id' = $2"
    rows = await legacy.db.connection.fetch(
        f"""
        SELECT collection, data
        FROM app_documents
        WHERE collection = ANY(ARRAY['traceability_raw_intakes','traceability_finished_batches','traceability_material_usage','traceability_dispatches'])
          AND data::text ILIKE $1
          {company_clause}
        ORDER BY data ->> 'created_at' DESC NULLS LAST
        LIMIT 250
        """,
        *args,
    )
    results = []
    for row in rows:
        data = row["data"]
        if isinstance(data, str):
            import json
            data = json.loads(data)
        results.append({"collection": row["collection"], "record": dict(data)})
    return results


@router.get("/mock-recalls/lookup")
async def mock_recall_lookup(
    batch_code: str = Query(min_length=1, max_length=150),
    user: dict = Depends(legacy.require_feature("traceability")),
):
    records = await _matching_traceability_records(batch_code, user)
    counts: Dict[str, int] = {}
    for item in records:
        counts[item["collection"]] = counts.get(item["collection"], 0) + 1
    return {"records": records, "counts": counts, "total": len(records)}


@router.get("/mock-recalls")
async def list_mock_recalls(user: dict = Depends(legacy.require_feature("traceability"))):
    return await legacy.db.mock_recalls.find(_company_query(user), {"_id": 0}).sort(
        "exercise_date", -1
    ).to_list(1000)


@router.post("/mock-recalls", status_code=201)
async def create_mock_recall(
    data: MockRecallCreate,
    user: dict = Depends(legacy.require_feature("traceability_edit")),
):
    if data.tolerance_lower > data.tolerance_upper:
        raise HTTPException(status_code=400, detail="The lower tolerance cannot exceed the upper tolerance")
    try:
        exercise_date = date.fromisoformat(data.exercise_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Enter a valid exercise date") from exc
    accounted, reconciliation = calculate_reconciliation(
        data.input_quantity, data.output_quantity, data.waste_quantity, data.carryover_quantity
    )
    matched = await _matching_traceability_records(data.batch_code, user)
    passed = (
        data.traceability_complete
        and bool(matched)
        and data.tolerance_lower <= reconciliation <= data.tolerance_upper
    )
    now = legacy.get_uk_time_iso()
    record = {
        "id": str(uuid.uuid4()),
        "company_id": user.get("company_id"),
        **data.model_dump(),
        "exercise_date": exercise_date.isoformat(),
        "accounted_quantity": round(accounted, 3),
        "reconciliation_percent": reconciliation,
        "matched_record_count": len(matched),
        "result": "pass" if passed else "fail",
        "created_by_id": user["id"],
        "created_by_name": user.get("name"),
        "created_at": now,
    }
    await legacy.db.mock_recalls.insert_one(record)
    if not passed:
        admins = await legacy.db.users.find(
            {
                "company_id": user.get("company_id"),
                "role": {"$in": [legacy.UserRole.COMPANY_ADMIN, legacy.UserRole.ADMIN]},
            },
            {"_id": 0, "password": 0},
        ).to_list(100)
        for admin in admins:
            await create_notification(
                user_id=admin["id"],
                company_id=user.get("company_id"),
                notification_type="mock_recall_failed",
                title="Mock recall requires investigation",
                message=f"{data.product_name} / {data.batch_code}: {reconciliation}% reconciled.",
                link="/compliance?tab=recalls",
                metadata={"mock_recall_id": record["id"]},
            )
    return record


@router.get("/compliance/summary")
async def compliance_summary(user: dict = Depends(legacy.get_current_user)):
    _require_admin(user)
    scope = _company_query(user)
    today = legacy.get_uk_time().date()
    week_end = today + timedelta(days=6 - today.weekday())
    schedules, actions, training, emails, recalls, runs = await asyncio.gather(
        legacy.db.scheduled_audits.find(scope, {"_id": 0}).to_list(5000),
        legacy.db.corrective_actions.find(scope, {"_id": 0, "history": 0}).to_list(5000),
        legacy.db.training_records.find(scope, {"_id": 0}).to_list(5000),
        legacy.db.email_delivery_events.find(scope, {"_id": 0, "resend_payload": 0}).sort("created_at", -1).to_list(500),
        legacy.db.mock_recalls.find(scope, {"_id": 0}).sort("exercise_date", -1).to_list(500),
        legacy.db.run_audits.find({**scope, "completed": True}, {"_id": 0, "answers": 0, "signature": 0}).sort("completed_at", -1).to_list(500),
    )
    due_this_week = 0
    overdue_schedules = 0
    for schedule in schedules:
        if schedule.get("status") in {"completed", "skipped", "cancelled", "paused"}:
            continue
        try:
            scheduled = date.fromisoformat(str(schedule.get("scheduled_date"))[:10])
        except ValueError:
            continue
        due_this_week += int(today <= scheduled <= week_end)
        overdue_schedules += int(scheduled < today and schedule.get("status") == "overdue")
    open_actions = sum((item.get("status") or "open") in {"open", "awaiting_review", "effectiveness_pending"} for item in actions)
    overdue_actions = sum(legacy.corrective_action_status(item) == "overdue" for item in actions if item.get("status") == "open")
    effectiveness_due = sum(
        item.get("effectiveness_status") == "pending"
        and str(item.get("effectiveness_due_date") or "") <= today.isoformat()
        for item in actions
    )
    overdue_training = sum(
        item.get("status") not in {"completed", "superseded"}
        and str(item.get("due_date") or "") < today.isoformat()
        for item in training
    )
    recurring: Dict[str, dict] = {}
    for action in actions:
        key = action.get("question_id") or re.sub(r"\W+", " ", str(action.get("non_conformance") or "").lower()).strip()[:100]
        if not key:
            continue
        group_key = f"{action.get('audit_id') or action.get('audit_name')}:{key}"
        bucket = recurring.setdefault(group_key, {
            "audit_name": action.get("audit_name"),
            "issue": action.get("question_text") or action.get("non_conformance"),
            "count": 0,
        })
        bucket["count"] += 1
    recurring_findings = sorted(
        [item for item in recurring.values() if item["count"] >= 2],
        key=lambda item: item["count"],
        reverse=True,
    )[:10]
    return {
        "counts": {
            "audits_due_this_week": due_this_week,
            "overdue_schedules": overdue_schedules,
            "open_actions": open_actions,
            "overdue_actions": overdue_actions,
            "effectiveness_due": effectiveness_due,
            "overdue_training": overdue_training,
            "failed_emails": sum(item.get("status") in {"failed", "disabled"} for item in emails),
            "failed_mock_recalls": sum(item.get("result") == "fail" for item in recalls),
        },
        "recurring_findings": recurring_findings,
        "recent_failed_audits": [run for run in runs if run.get("pass_status") == "fail"][:10],
        "recent_failed_emails": [item for item in emails if item.get("status") in {"failed", "disabled"}][:10],
    }


@router.get("/system/health")
async def system_health(user: dict = Depends(legacy.get_current_user)):
    _require_admin(user)
    started = time.perf_counter()
    try:
        await legacy.db.connection.fetchval("SELECT 1")
        database_status = "healthy"
    except Exception:
        database_status = "unavailable"
    latency_ms = round((time.perf_counter() - started) * 1000, 1)
    scope = _company_query(user)
    failed_emails, overdue_schedules, latest_job = await asyncio.gather(
        legacy.db.email_delivery_events.count_documents({**scope, "status": "failed"}),
        legacy.db.scheduled_audits.count_documents({**scope, "status": "overdue"}),
        legacy.db.system_job_events.find({}, {"_id": 0}).sort("created_at", -1).limit(1).to_list(1),
    )
    return {
        "status": "healthy" if database_status == "healthy" else "degraded",
        "database": {"status": database_status, "latency_ms": latency_ms},
        "email": {"configured": email_is_configured(), "failed_deliveries": failed_emails},
        "scheduling": {"overdue_occurrences": overdue_schedules, "latest_job": latest_job[0] if latest_job else None},
        "checked_at": legacy.get_uk_time_iso(),
    }
