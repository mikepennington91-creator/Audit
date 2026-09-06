from __future__ import annotations

import asyncio
import base64
import io
import re
import uuid
from datetime import date, timedelta
from typing import Any, Dict, List, Literal, Optional
from xml.sax.saxutils import escape

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, inch
from reportlab.platypus import Image as RLImage
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

import server as legacy
from app_core.audit_reports import _get_accessible_run
from app_core.email_service import public_app_url
from app_core.notifications import create_notification
from app_core.pdf_support import pdf_content_disposition


router = APIRouter(prefix="/api", tags=["quality-operations"])


def _scope(user: dict) -> dict:
    return {} if legacy.is_system_admin(user) else {"company_id": user.get("company_id")}


def _same_company(record: dict, user: dict) -> bool:
    return legacy.is_system_admin(user) or (
        bool(user.get("company_id")) and record.get("company_id") == user.get("company_id")
    )


def _require_admin(user: dict) -> None:
    if not legacy.is_admin(user):
        raise HTTPException(status_code=403, detail="Administrator access is required")


def _parse_date(value: Optional[str], label: str, *, required: bool = False) -> Optional[str]:
    if not value:
        if required:
            raise HTTPException(status_code=400, detail=f"{label} is required")
        return None
    try:
        return date.fromisoformat(str(value)[:10]).isoformat()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Enter a valid {label.lower()}") from exc


def _clean_optional(value: Optional[str]) -> Optional[str]:
    cleaned = str(value or "").strip()
    return cleaned or None


class SupplierCertificate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    reference: Optional[str] = Field(default=None, max_length=200)
    expiry_date: Optional[str] = None


class SupplierCreate(BaseModel):
    name: str = Field(min_length=1, max_length=250)
    category: str = Field(min_length=1, max_length=150)
    contact_name: Optional[str] = Field(default=None, max_length=200)
    contact_email: Optional[str] = Field(default=None, max_length=320)
    risk_rating: Literal["low", "medium", "high", "critical"] = "medium"
    approval_status: Literal["pending", "approved", "conditional", "suspended", "rejected"] = "pending"
    questionnaire_status: Literal["not_sent", "sent", "returned", "approved", "rejected"] = "not_sent"
    performance_score: Optional[float] = Field(default=None, ge=0, le=100)
    last_audit_date: Optional[str] = None
    audit_result: Optional[Literal["pass", "conditional", "fail"]] = None
    approval_expiry: Optional[str] = None
    next_review_date: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=5000)
    certificates: List[SupplierCertificate] = Field(default_factory=list, max_length=50)

    @field_validator("name", "category")
    @classmethod
    def clean_required(cls, value: str) -> str:
        return value.strip()


class SupplierUpdate(SupplierCreate):
    change_reason: str = Field(min_length=3, max_length=1000)


class QualityEventCreate(BaseModel):
    event_type: Literal["incident", "complaint", "ncr", "quality_incident", "foreign_body", "ccp_failure"]
    title: str = Field(min_length=1, max_length=250)
    description: str = Field(min_length=1, max_length=10000)
    occurred_date: str
    severity: Literal["low", "medium", "high", "critical"] = "medium"
    location: Optional[str] = Field(default=None, max_length=250)
    product_name: Optional[str] = Field(default=None, max_length=250)
    batch_code: Optional[str] = Field(default=None, max_length=200)
    supplier_id: Optional[str] = None
    owner_user_id: Optional[str] = None
    due_date: Optional[str] = None
    immediate_action: Optional[str] = Field(default=None, max_length=10000)
    root_cause_category: Optional[str] = Field(default=None, max_length=150)
    root_cause: Optional[str] = Field(default=None, max_length=10000)
    corrective_action: Optional[str] = Field(default=None, max_length=10000)
    evidence: List[str] = Field(default_factory=list, max_length=20)

    @field_validator("title", "description")
    @classmethod
    def clean_required(cls, value: str) -> str:
        return value.strip()

    @field_validator("evidence")
    @classmethod
    def validate_evidence(cls, values: List[str]) -> List[str]:
        for value in values:
            if not value.startswith("data:image/") or "," not in value:
                raise ValueError("Evidence must be an image")
            if len(value) > 3_000_000:
                raise ValueError("Each evidence image must be smaller than 2 MB")
        return values


class QualityEventUpdate(BaseModel):
    immediate_action: Optional[str] = Field(default=None, max_length=10000)
    root_cause_category: Optional[str] = Field(default=None, max_length=150)
    root_cause: Optional[str] = Field(default=None, max_length=10000)
    corrective_action: Optional[str] = Field(default=None, max_length=10000)
    evidence: Optional[List[str]] = Field(default=None, max_length=20)
    change_note: str = Field(min_length=3, max_length=2000)

    @field_validator("evidence")
    @classmethod
    def validate_evidence(cls, values: Optional[List[str]]) -> Optional[List[str]]:
        return QualityEventCreate.validate_evidence(values or []) if values is not None else None


class QualityEventAssignment(BaseModel):
    owner_user_id: str
    due_date: Optional[str] = None
    reason: str = Field(min_length=3, max_length=1000)


class QualityEventStatus(BaseModel):
    status: Literal["open", "investigating", "awaiting_review", "closed", "cancelled"]
    comment: str = Field(min_length=3, max_length=3000)


class ActionLink(BaseModel):
    action_id: str


class DocumentSignoffCreate(BaseModel):
    template_id: str
    user_ids: List[str] = Field(min_length=1, max_length=250)
    due_date: str
    message: Optional[str] = Field(default=None, max_length=2000)


class DocumentSignoffDecision(BaseModel):
    declaration: str = Field(min_length=3, max_length=2000)


class ManagementReportSchedule(BaseModel):
    enabled: bool = True
    frequency: Literal["weekly", "monthly"] = "monthly"
    recipient_user_ids: List[str] = Field(min_length=1, max_length=50)
    weekday: int = Field(default=0, ge=0, le=6)
    month_day: int = Field(default=1, ge=1, le=28)
    report_days: int = Field(default=30, ge=7, le=366)


def _event_history(event: str, user: dict, comment: Optional[str] = None) -> dict:
    return {
        "event": event,
        "user_id": user.get("id"),
        "user_name": user.get("name"),
        "comment": _clean_optional(comment),
        "at": legacy.get_uk_time_iso(),
    }


async def _company_user(user_id: str, user: dict) -> dict:
    target = await legacy.db.users.find_one({"id": user_id}, {"_id": 0, "password": 0})
    if not target or not _same_company(target, user):
        raise HTTPException(status_code=400, detail="Select a valid user from this company")
    return target


async def _quality_event(event_id: str, user: dict) -> dict:
    event = await legacy.db.quality_events.find_one({"id": event_id}, {"_id": 0})
    if not event or not _same_company(event, user):
        raise HTTPException(status_code=404, detail="Quality record not found")
    return event


async def _supplier(supplier_id: str, user: dict) -> dict:
    supplier = await legacy.db.suppliers.find_one({"id": supplier_id}, {"_id": 0})
    if not supplier or not _same_company(supplier, user):
        raise HTTPException(status_code=404, detail="Supplier not found")
    return supplier


@router.get("/suppliers")
async def list_suppliers(
    status: Optional[str] = None,
    risk: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(200, ge=1, le=500),
    user: dict = Depends(legacy.require_feature("quality")),
):
    query = _scope(user)
    if status:
        query["approval_status"] = status
    if risk:
        query["risk_rating"] = risk
    records = await legacy.db.suppliers.find(query, {"_id": 0, "history": 0}).sort("name", 1).to_list(limit)
    if search:
        needle = search.strip().lower()
        records = [item for item in records if needle in f"{item.get('name', '')} {item.get('category', '')}".lower()]
    today = legacy.get_uk_time().date().isoformat()
    for record in records:
        expiries = [item.get("expiry_date") for item in record.get("certificates", []) if item.get("expiry_date")]
        record["expired_certificate_count"] = sum(value < today for value in expiries)
        record["next_certificate_expiry"] = min(expiries) if expiries else None
    return records


@router.post("/suppliers", status_code=201)
async def create_supplier(
    data: SupplierCreate,
    user: dict = Depends(legacy.require_feature("quality_edit")),
):
    approval_expiry = _parse_date(data.approval_expiry, "Approval expiry")
    next_review = _parse_date(data.next_review_date, "Next review date")
    last_audit = _parse_date(data.last_audit_date, "Last audit date")
    certificates = []
    for item in data.certificates:
        certificate = item.model_dump()
        certificate["expiry_date"] = _parse_date(item.expiry_date, "Certificate expiry")
        certificates.append(certificate)
    now = legacy.get_uk_time_iso()
    record = {
        "id": str(uuid.uuid4()), "company_id": user.get("company_id"),
        **data.model_dump(exclude={"certificates", "approval_expiry", "next_review_date", "last_audit_date"}),
        "approval_expiry": approval_expiry, "next_review_date": next_review,
        "last_audit_date": last_audit,
        "certificates": certificates,
        "created_by_id": user["id"], "created_by_name": user.get("name"),
        "created_at": now, "updated_at": now,
        "history": [_event_history("created", user, f"Status: {data.approval_status}")],
    }
    await legacy.db.suppliers.insert_one(record)
    return record


@router.put("/suppliers/{supplier_id}")
async def update_supplier(
    supplier_id: str,
    data: SupplierUpdate,
    user: dict = Depends(legacy.require_feature("quality_edit")),
):
    record = await _supplier(supplier_id, user)
    certificates = []
    for item in data.certificates:
        certificate = item.model_dump()
        certificate["expiry_date"] = _parse_date(item.expiry_date, "Certificate expiry")
        certificates.append(certificate)
    changes = data.model_dump(exclude={"change_reason", "certificates", "approval_expiry", "next_review_date", "last_audit_date"})
    changes.update({
        "approval_expiry": _parse_date(data.approval_expiry, "Approval expiry"),
        "next_review_date": _parse_date(data.next_review_date, "Next review date"),
        "last_audit_date": _parse_date(data.last_audit_date, "Last audit date"),
        "certificates": certificates,
        "updated_at": legacy.get_uk_time_iso(),
        "updated_by_id": user["id"], "updated_by_name": user.get("name"),
        "history": [*(record.get("history") or []), _event_history("updated", user, data.change_reason)],
    })
    await legacy.db.suppliers.update_one({"id": supplier_id}, {"$set": changes})
    return {**record, **changes}


@router.get("/quality-events")
async def list_quality_events(
    event_type: Optional[str] = None,
    status: Optional[str] = None,
    owner: Optional[str] = None,
    limit: int = Query(200, ge=1, le=500),
    user: dict = Depends(legacy.require_feature("quality")),
):
    query = _scope(user)
    if event_type:
        query["event_type"] = event_type
    if status:
        query["status"] = status
    if owner == "me":
        query["owner_user_id"] = user["id"]
    return await legacy.db.quality_events.find(query, {"_id": 0, "evidence": 0}).sort("occurred_date", -1).to_list(limit)


@router.get("/quality-events/{event_id}")
async def get_quality_event(
    event_id: str,
    user: dict = Depends(legacy.require_feature("quality")),
):
    return await _quality_event(event_id, user)


@router.post("/quality-events", status_code=201)
async def create_quality_event(
    data: QualityEventCreate,
    user: dict = Depends(legacy.require_feature("quality_edit")),
):
    owner = await _company_user(data.owner_user_id, user) if data.owner_user_id else None
    supplier = await _supplier(data.supplier_id, user) if data.supplier_id else None
    now = legacy.get_uk_time_iso()
    record = {
        "id": str(uuid.uuid4()), "company_id": user.get("company_id"),
        **data.model_dump(exclude={"occurred_date", "due_date", "supplier_id", "owner_user_id"}),
        "occurred_date": _parse_date(data.occurred_date, "Occurrence date", required=True),
        "due_date": _parse_date(data.due_date, "Due date"),
        "supplier_id": (supplier or {}).get("id"), "supplier_name": (supplier or {}).get("name"),
        "owner_user_id": (owner or {}).get("id"), "owner_user_name": (owner or {}).get("name"),
        "status": "open", "linked_action_ids": [],
        "created_by_id": user["id"], "created_by_name": user.get("name"),
        "created_at": now, "updated_at": now,
        "history": [_event_history("created", user)],
    }
    await legacy.db.quality_events.insert_one(record)
    if owner:
        await create_notification(
            user_id=owner["id"], company_id=user.get("company_id"),
            notification_type="quality_event_assigned", title="Quality record assigned",
            message=f"{data.title} has been assigned to you.",
            link=f"/quality?event={record['id']}", metadata={"quality_event_id": record["id"]},
        )
    return record


@router.put("/quality-events/{event_id}")
async def update_quality_event(
    event_id: str,
    data: QualityEventUpdate,
    user: dict = Depends(legacy.require_feature("quality_edit")),
):
    record = await _quality_event(event_id, user)
    if record.get("owner_user_id") != user.get("id") and not legacy.is_admin(user):
        raise HTTPException(status_code=403, detail="Only the assigned owner or an administrator can update this record")
    if record.get("status") in {"closed", "cancelled"}:
        raise HTTPException(status_code=409, detail="Closed quality records cannot be edited")
    changes = {key: value for key, value in data.model_dump(exclude={"change_note"}).items() if value is not None}
    changes.update({
        "updated_at": legacy.get_uk_time_iso(),
        "history": [*(record.get("history") or []), _event_history("updated", user, data.change_note)],
    })
    await legacy.db.quality_events.update_one({"id": event_id}, {"$set": changes})
    return {**record, **changes}


@router.put("/quality-events/{event_id}/assign")
async def assign_quality_event(
    event_id: str,
    data: QualityEventAssignment,
    user: dict = Depends(legacy.require_feature("quality_edit")),
):
    _require_admin(user)
    record = await _quality_event(event_id, user)
    owner = await _company_user(data.owner_user_id, user)
    changes = {
        "owner_user_id": owner["id"], "owner_user_name": owner.get("name"),
        "due_date": _parse_date(data.due_date, "Due date"), "updated_at": legacy.get_uk_time_iso(),
        "history": [*(record.get("history") or []), _event_history("reassigned", user, data.reason)],
    }
    await legacy.db.quality_events.update_one({"id": event_id}, {"$set": changes})
    await create_notification(
        user_id=owner["id"], company_id=record.get("company_id"),
        notification_type="quality_event_assigned", title="Quality record assigned",
        message=f"{record.get('title')} has been assigned to you.",
        link=f"/quality?event={event_id}", metadata={"quality_event_id": event_id},
    )
    return {**record, **changes}


@router.put("/quality-events/{event_id}/status")
async def change_quality_event_status(
    event_id: str,
    data: QualityEventStatus,
    user: dict = Depends(legacy.require_feature("quality_edit")),
):
    record = await _quality_event(event_id, user)
    is_owner = record.get("owner_user_id") == user.get("id")
    if data.status in {"closed", "cancelled"} and not legacy.is_admin(user):
        raise HTTPException(status_code=403, detail="Only an administrator can close or cancel a quality record")
    if not is_owner and not legacy.is_admin(user):
        raise HTTPException(status_code=403, detail="Only the assigned owner or an administrator can change this status")
    if data.status == "awaiting_review" and not (record.get("root_cause") and record.get("corrective_action")):
        raise HTTPException(status_code=409, detail="Root cause and corrective action are required before review")
    changes = {
        "status": data.status, "updated_at": legacy.get_uk_time_iso(),
        "closed_at": legacy.get_uk_time_iso() if data.status == "closed" else record.get("closed_at"),
        "closed_by_id": user["id"] if data.status == "closed" else record.get("closed_by_id"),
        "closed_by_name": user.get("name") if data.status == "closed" else record.get("closed_by_name"),
        "history": [*(record.get("history") or []), _event_history(f"status_{data.status}", user, data.comment)],
    }
    await legacy.db.quality_events.update_one({"id": event_id}, {"$set": changes})
    return {**record, **changes}


@router.post("/quality-events/{event_id}/actions")
async def link_quality_action(
    event_id: str,
    data: ActionLink,
    user: dict = Depends(legacy.require_feature("quality_edit")),
):
    record = await _quality_event(event_id, user)
    if not legacy.is_admin(user) and record.get("owner_user_id") != user.get("id"):
        raise HTTPException(status_code=403, detail="Only the assigned owner or an administrator can link actions")
    action = await legacy.db.corrective_actions.find_one({"id": data.action_id}, {"_id": 0, "history": 0})
    if not action or not _same_company(action, user):
        raise HTTPException(status_code=400, detail="Select a valid corrective action")
    action_ids = list(dict.fromkeys([*(record.get("linked_action_ids") or []), action["id"]]))
    changes = {
        "linked_action_ids": action_ids, "updated_at": legacy.get_uk_time_iso(),
        "history": [*(record.get("history") or []), _event_history("action_linked", user, action.get("title") or action["id"])],
    }
    await legacy.db.quality_events.update_one({"id": event_id}, {"$set": changes})
    return {"linked_action_ids": action_ids}


@router.get("/document-signoffs")
async def list_document_signoffs(user: dict = Depends(legacy.get_current_user)):
    query = _scope(user) if legacy.is_admin(user) else {"user_id": user["id"]}
    records = await legacy.db.document_signoffs.find(query, {"_id": 0}).sort("due_date", 1).to_list(2000)
    today = legacy.get_uk_time().date().isoformat()
    for record in records:
        if record.get("status") == "assigned" and record.get("due_date", "") < today:
            record["status"] = "overdue"
    return records


@router.post("/document-signoffs", status_code=201)
async def assign_document_signoffs(
    data: DocumentSignoffCreate,
    user: dict = Depends(legacy.require_feature("documents_edit")),
):
    _require_admin(user)
    template = await legacy.db.traceability_templates.find_one({"id": data.template_id}, {"_id": 0, "fields": 0})
    if not template or (not legacy.is_system_admin(user) and template.get("company_id") not in {None, user.get("company_id")}):
        raise HTTPException(status_code=400, detail="Select a valid controlled document")
    due_date = _parse_date(data.due_date, "Due date", required=True)
    created = []
    for user_id in list(dict.fromkeys(data.user_ids)):
        target = await _company_user(user_id, user)
        existing = await legacy.db.document_signoffs.find_one({
            "template_id": template["id"], "document_version": template.get("version"),
            "user_id": target["id"], "status": "assigned",
        })
        if existing:
            continue
        now = legacy.get_uk_time_iso()
        record = {
            "id": str(uuid.uuid4()), "company_id": target.get("company_id"),
            "template_id": template["id"], "document_title": template.get("title"),
            "document_reference": template.get("document_reference"), "document_version": template.get("version"),
            "user_id": target["id"], "user_name": target.get("name"), "user_email": target.get("email"),
            "due_date": due_date, "message": _clean_optional(data.message), "status": "assigned",
            "created_by_id": user["id"], "created_by_name": user.get("name"), "created_at": now,
        }
        await legacy.db.document_signoffs.insert_one(record)
        await create_notification(
            user_id=target["id"], company_id=target.get("company_id"),
            notification_type="document_signoff_assigned", title="Document acknowledgement required",
            message=f"Please read and acknowledge {template.get('title')} version {template.get('version')} by {legacy.format_uk_date(due_date)}.",
            link="/quality?tab=documents", metadata={"document_signoff_id": record["id"]},
        )
        created.append(record)
    return {"created": created, "count": len(created)}


@router.put("/document-signoffs/{signoff_id}/acknowledge")
async def acknowledge_document_signoff(
    signoff_id: str,
    data: DocumentSignoffDecision,
    user: dict = Depends(legacy.get_current_user),
):
    record = await legacy.db.document_signoffs.find_one({"id": signoff_id}, {"_id": 0})
    if not record or record.get("user_id") != user.get("id"):
        raise HTTPException(status_code=404, detail="Document acknowledgement not found")
    if record.get("status") == "acknowledged":
        raise HTTPException(status_code=409, detail="This document has already been acknowledged")
    changes = {
        "status": "acknowledged", "declaration": data.declaration.strip(),
        "acknowledged_at": legacy.get_uk_time_iso(), "acknowledged_version": record.get("document_version"),
    }
    await legacy.db.document_signoffs.update_one({"id": signoff_id}, {"$set": changes})
    return {"message": "Document acknowledgement recorded", **changes}


@router.get("/management-report/schedule")
async def get_management_report_schedule(user: dict = Depends(legacy.get_current_user)):
    _require_admin(user)
    record = await legacy.db.management_report_schedules.find_one(_scope(user), {"_id": 0})
    return record or {
        "enabled": False, "frequency": "monthly", "recipient_user_ids": [],
        "weekday": 0, "month_day": 1, "report_days": 30,
    }


@router.put("/management-report/schedule")
async def save_management_report_schedule(
    data: ManagementReportSchedule,
    user: dict = Depends(legacy.get_current_user),
):
    _require_admin(user)
    recipients = []
    for user_id in list(dict.fromkeys(data.recipient_user_ids)):
        target = await _company_user(user_id, user)
        if not target.get("email"):
            raise HTTPException(status_code=400, detail=f"{target.get('name')} does not have an email address")
        recipients.append({"id": target["id"], "name": target.get("name"), "email": target["email"]})
    company_key = user.get("company_id") or "system"
    record = {
        "id": f"management-report-{company_key}", "company_id": user.get("company_id"),
        **data.model_dump(), "recipients": recipients,
        "updated_by_id": user["id"], "updated_by_name": user.get("name"), "updated_at": legacy.get_uk_time_iso(),
    }
    existing = await legacy.db.management_report_schedules.find_one({"id": record["id"]})
    if existing:
        await legacy.db.management_report_schedules.update_one({"id": record["id"]}, {"$set": record})
    else:
        await legacy.db.management_report_schedules.insert_one(record)
    return record


@router.get("/my-work")
async def my_work(user: dict = Depends(legacy.get_current_user)):
    today = legacy.get_uk_time().date().isoformat()
    action_query = {"assigned_user_id": user["id"], "status": {"$in": ["open", "awaiting_review", "effectiveness_pending"]}}
    schedules, actions, training, signoffs, quality = await asyncio.gather(
        legacy.db.scheduled_audits.find({"assigned_to": user["id"], "status": {"$in": ["pending", "overdue"]}}, {"_id": 0}).sort("scheduled_date", 1).to_list(100),
        legacy.db.corrective_actions.find(action_query, {"_id": 0, "history": 0}).sort("due_date", 1).to_list(100),
        legacy.db.training_records.find({"user_id": user["id"], "status": {"$in": ["assigned", "awaiting_competency"]}}, {"_id": 0}).sort("due_date", 1).to_list(100),
        legacy.db.document_signoffs.find({"user_id": user["id"], "status": "assigned"}, {"_id": 0}).sort("due_date", 1).to_list(100),
        legacy.db.quality_events.find({"owner_user_id": user["id"], "status": {"$in": ["open", "investigating", "awaiting_review"]}}, {"_id": 0, "evidence": 0, "history": 0}).sort("due_date", 1).to_list(100),
    )
    items = []
    mappings = [
        (schedules, "audit", "audit_name", "scheduled_date", "/schedule"),
        (actions, "action", "title", "due_date", "/actions?action="),
        (training, "training", "title", "due_date", "/compliance?tab=training"),
        (signoffs, "document", "document_title", "due_date", "/quality?tab=documents"),
        (quality, "quality", "title", "due_date", "/quality?event="),
    ]
    for records, item_type, title_key, due_key, link in mappings:
        for record in records:
            due = record.get(due_key)
            items.append({
                "id": record.get("id"), "type": item_type,
                "title": record.get(title_key) or item_type.title(), "due_date": due,
                "status": "overdue" if due and due < today and record.get("status") != "awaiting_review" else record.get("status", "open"),
                "link": f"{link}{record.get('id')}" if link.endswith("=") else link,
            })
    items.sort(key=lambda item: (item.get("due_date") or "9999-12-31", item["title"]))
    return {
        "items": items,
        "counts": {
            "total": len(items), "overdue": sum(item["status"] == "overdue" for item in items),
            **{kind: sum(item["type"] == kind for item in items) for kind in ("audit", "action", "training", "document", "quality")},
        },
    }


def _normalise_cause(value: Optional[str]) -> str:
    cleaned = re.sub(r"\s+", " ", str(value or "Uncategorised")).strip()
    return cleaned[:150] or "Uncategorised"


@router.get("/quality-insights")
async def quality_insights(user: dict = Depends(legacy.require_feature("quality"))):
    events, actions, suppliers = await asyncio.gather(
        legacy.db.quality_events.find(_scope(user), {"_id": 0, "evidence": 0, "history": 0}).to_list(5000),
        legacy.db.corrective_actions.find(_scope(user), {"_id": 0, "history": 0}).to_list(5000),
        legacy.db.suppliers.find(_scope(user), {"_id": 0, "history": 0}).to_list(2000),
    )
    causes: Dict[str, int] = {}
    types: Dict[str, int] = {}
    products: Dict[str, int] = {}
    for event in events:
        cause = _normalise_cause(event.get("root_cause_category"))
        causes[cause] = causes.get(cause, 0) + 1
        kind = str(event.get("event_type") or "other").replace("_", " ").title()
        types[kind] = types.get(kind, 0) + 1
        if event.get("product_name"):
            product = str(event["product_name"]).strip()[:150]
            products[product] = products.get(product, 0) + 1
    recurring_actions: Dict[str, int] = {}
    for action in actions:
        key = _normalise_cause(action.get("question_text") or action.get("non_conformance"))
        recurring_actions[key] = recurring_actions.get(key, 0) + 1
    today = legacy.get_uk_time().date().isoformat()
    return {
        "counts": {
            "open_quality_records": sum(item.get("status") not in {"closed", "cancelled"} for item in events),
            "critical_records": sum(item.get("severity") == "critical" and item.get("status") != "closed" for item in events),
            "unapproved_suppliers": sum(item.get("approval_status") != "approved" for item in suppliers),
            "expired_supplier_approvals": sum(bool(item.get("approval_expiry") and item["approval_expiry"] < today) for item in suppliers),
        },
        "root_causes": sorted(({"name": key, "count": value} for key, value in causes.items()), key=lambda item: item["count"], reverse=True)[:12],
        "event_types": sorted(({"name": key, "count": value} for key, value in types.items()), key=lambda item: item["count"], reverse=True),
        "affected_products": sorted(({"name": key, "count": value} for key, value in products.items()), key=lambda item: item["count"], reverse=True)[:12],
        "recurring_findings": sorted(({"name": key, "count": value} for key, value in recurring_actions.items() if value > 1), key=lambda item: item["count"], reverse=True)[:12],
    }


async def _management_data(user: dict, days: int) -> dict:
    _require_admin(user)
    start = legacy.get_uk_time().date() - timedelta(days=days - 1)
    scope = _scope(user)
    runs, actions, events, suppliers, training, signoffs = await asyncio.gather(
        legacy.db.run_audits.find({**scope, "completed": True}, {"_id": 0, "answers": 0, "signature": 0}).to_list(5000),
        legacy.db.corrective_actions.find(scope, {"_id": 0, "history": 0}).to_list(5000),
        legacy.db.quality_events.find(scope, {"_id": 0, "history": 0, "evidence": 0}).to_list(5000),
        legacy.db.suppliers.find(scope, {"_id": 0, "history": 0}).to_list(2000),
        legacy.db.training_records.find(scope, {"_id": 0}).to_list(5000),
        legacy.db.document_signoffs.find(scope, {"_id": 0}).to_list(5000),
    )
    def recent(item: dict, *fields: str) -> bool:
        value = next((item.get(field) for field in fields if item.get(field)), None)
        return bool(value and str(value)[:10] >= start.isoformat())
    period_runs = [item for item in runs if recent(item, "completed_at", "closed_at")]
    period_events = [item for item in events if recent(item, "occurred_date", "created_at")]
    passed = sum(item.get("pass_status") == "pass" for item in period_runs)
    today = legacy.get_uk_time().date().isoformat()
    return {
        "period": {"start": start.isoformat(), "end": today, "days": days},
        "counts": {
            "audits_completed": len(period_runs), "audits_passed": passed,
            "audit_pass_rate": round(passed / len(period_runs) * 100, 1) if period_runs else 0,
            "new_quality_records": len(period_events),
            "critical_quality_records": sum(item.get("severity") == "critical" for item in period_events),
            "open_actions": sum(item.get("status") not in {"closed", "archived"} for item in actions),
            "overdue_actions": sum(item.get("status") == "open" and item.get("due_date") and item["due_date"] < today for item in actions),
            "training_overdue": sum(item.get("status") not in {"completed", "superseded"} and item.get("due_date") and item["due_date"] < today for item in training),
            "documents_overdue": sum(item.get("status") == "assigned" and item.get("due_date") and item["due_date"] < today for item in signoffs),
            "suppliers_not_approved": sum(item.get("approval_status") != "approved" for item in suppliers),
        },
        "failed_audits": [item for item in period_runs if item.get("pass_status") == "fail"][:20],
        "quality_records": period_events[:30],
        "overdue_actions": [item for item in actions if item.get("status") == "open" and item.get("due_date") and item["due_date"] < today][:30],
    }


def build_management_summary_pdf(data: dict, company: Optional[dict]) -> bytes:
    """Build the compact attachment used by scheduled management emails."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=1.5 * cm, leftMargin=1.5 * cm, topMargin=1.5 * cm, bottomMargin=1.5 * cm)
    styles = getSampleStyleSheet()
    story = legacy.build_company_pdf_header(company, "Quality & Compliance Management Summary", styles)
    story.append(Paragraph(
        f"Reporting period: {escape(legacy.format_uk_date(data['period']['start']))} to {escape(legacy.format_uk_date(data['period']['end']))}",
        styles["Normal"],
    ))
    story.append(Spacer(1, 0.2 * inch))
    rows = [["Measure", "Result"]] + [[key.replace("_", " ").title(), str(value)] for key, value in data["counts"].items()]
    table = Table(rows, colWidths=[4.7 * inch, 1.4 * inch], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor("#17877d")), ("TEXTCOLOR", (0, 0), (-1, 0), HexColor("#ffffff")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("GRID", (0, 0), (-1, -1), 0.4, HexColor("#d7e2e0")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f5f8f7")]),
        ("PADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(table)
    story.append(Spacer(1, 0.25 * inch))
    story.append(Paragraph("Open Infinit Audit for the underlying records, evidence and approval history.", styles["Normal"]))
    doc.build(story)
    return buffer.getvalue()


@router.get("/management-report")
async def management_report(
    days: int = Query(30, ge=7, le=366),
    user: dict = Depends(legacy.get_current_user),
):
    return await _management_data(user, days)


@router.get("/management-report/pdf")
async def management_report_pdf(
    days: int = Query(30, ge=7, le=366),
    user: dict = Depends(legacy.get_current_user),
):
    data = await _management_data(user, days)
    company = await legacy.db.companies.find_one({"id": user.get("company_id")}, {"_id": 0}) if user.get("company_id") else None
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=1.4 * cm, leftMargin=1.4 * cm, topMargin=1.4 * cm, bottomMargin=1.4 * cm)
    styles = getSampleStyleSheet()
    story = legacy.build_company_pdf_header(company, "Quality & Compliance Management Report", styles)
    story.append(Paragraph(
        f"Reporting period: {escape(legacy.format_uk_date(data['period']['start']))} to {escape(legacy.format_uk_date(data['period']['end']))}",
        styles["Normal"],
    ))
    story.append(Spacer(1, 0.18 * inch))
    count_rows = [["Measure", "Result"]] + [[key.replace("_", " ").title(), str(value)] for key, value in data["counts"].items()]
    table = Table(count_rows, colWidths=[4.7 * inch, 1.4 * inch], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HexColor("#17877d")), ("TEXTCOLOR", (0, 0), (-1, 0), HexColor("#ffffff")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("GRID", (0, 0), (-1, -1), 0.4, HexColor("#d7e2e0")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#ffffff"), HexColor("#f5f8f7")]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("PADDING", (0, 0), (-1, -1), 7),
    ]))
    story.append(table)
    sections = [
        ("Failed audits", data["failed_audits"], lambda item: [item.get("audit_name", "Audit"), legacy.format_uk_date(item.get("completed_at")), item.get("auditor_name", "-")]),
        ("Quality records raised", data["quality_records"], lambda item: [item.get("title", "Record"), str(item.get("event_type", "")).replace("_", " ").title(), item.get("severity", "-").title()]),
        ("Overdue corrective actions", data["overdue_actions"], lambda item: [item.get("title") or item.get("non_conformance", "Action"), legacy.format_uk_date(item.get("due_date")), item.get("assigned_user_name") or item.get("assigned_department", "-")]),
    ]
    for heading, records, row_builder in sections:
        story.append(Spacer(1, 0.18 * inch)); story.append(Paragraph(heading, styles["Heading2"]))
        if not records:
            story.append(Paragraph("No records for this period.", styles["Normal"])); continue
        rows = [["Record", "Date / type", "Owner / severity"]] + [[Paragraph(escape(str(cell or "-")), styles["BodyText"]) for cell in row_builder(item)] for item in records]
        detail = Table(rows, colWidths=[3.2 * inch, 1.45 * inch, 1.45 * inch], repeatRows=1)
        detail.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), HexColor("#e8f3f2")), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.35, HexColor("#d7e2e0")), ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("PADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(detail)
    doc.build(story); buffer.seek(0)
    filename = f"management_report_{data['period']['end']}.pdf"
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": pdf_content_disposition(filename)})


def _add_photo(story: list, photo_data: str, styles) -> None:
    if not isinstance(photo_data, str) or not photo_data.startswith("data:image") or "," not in photo_data:
        return
    try:
        raw = base64.b64decode(photo_data.split(",", 1)[1])
        image = RLImage(io.BytesIO(raw)); image._restrictSize(5.6 * inch, 3.5 * inch)
        story.extend([image, Spacer(1, 0.08 * inch)])
    except Exception:
        story.append(Paragraph("An evidence image could not be rendered.", styles["Italic"]))


@router.get("/run-audits/{run_id}/evidence-pack.pdf")
async def audit_evidence_pack(
    run_id: str,
    user: dict = Depends(legacy.require_feature("audits")),
):
    run, audit = await _get_accessible_run(run_id, user)
    if not run.get("completed") and not run.get("closed_at"):
        raise HTTPException(status_code=409, detail="Only completed audits can be exported")
    actions = await legacy.db.corrective_actions.find({"run_id": run_id}, {"_id": 0}).to_list(500)
    company_id = run.get("company_id") or (audit or {}).get("company_id")
    company = await legacy.db.companies.find_one({"id": company_id}, {"_id": 0}) if company_id else None
    question_map = {item.get("id"): item for item in (audit or {}).get("questions", [])}
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=1.3 * cm, leftMargin=1.3 * cm, topMargin=1.3 * cm, bottomMargin=1.3 * cm)
    styles = getSampleStyleSheet()
    small = ParagraphStyle("EvidenceSmall", parent=styles["BodyText"], fontSize=8.5, leading=11)
    story = legacy.build_company_pdf_header(company, f"Audit Evidence Pack: {run.get('audit_name', 'Audit')}", styles)
    meta = [
        ["Started by", run.get("auditor_name", "-")], ["Completed by", run.get("completed_by_name") or run.get("signoff_name", "-")],
        ["Started", legacy.format_uk_datetime(run.get("started_at"))], ["Completed", legacy.format_uk_datetime(run.get("completed_at") or run.get("closed_at"))],
        ["Result", str(run.get("pass_status") or run.get("status") or "-").replace("_", " ").title()], ["Score", f"{run.get('total_score', 0)}%"],
    ]
    table = Table(meta, colWidths=[1.5 * inch, 4.7 * inch]); table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.35, HexColor("#d7e2e0")), ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("PADDING", (0, 0), (-1, -1), 6)])); story.append(table)
    story.append(Spacer(1, 0.18 * inch)); story.append(Paragraph("Audit responses and evidence", styles["Heading2"]))
    for index, answer in enumerate(run.get("answers") or [], 1):
        question = question_map.get(answer.get("question_id"), {})
        story.append(Paragraph(f"{index}. {escape(str(question.get('text') or answer.get('question_text') or 'Audit question'))}", styles["Heading3"]))
        story.append(Paragraph(f"Response: {escape(str(answer.get('response_label') or answer.get('response_value') or '-'))}", small))
        if answer.get("notes"): story.append(Paragraph(f"Comment: {escape(str(answer['notes']))}", small))
        for photo in answer.get("photos") or []: _add_photo(story, photo, styles)
    story.append(PageBreak()); story.append(Paragraph("Corrective actions and approval history", styles["Heading1"]))
    if not actions: story.append(Paragraph("No corrective actions were linked to this audit run.", styles["Normal"]))
    for action in actions:
        story.append(Paragraph(escape(str(action.get("title") or action.get("non_conformance") or "Corrective action")), styles["Heading2"]))
        action_rows = [["Status", str(action.get("status", "open")).replace("_", " ").title()], ["Owner", action.get("assigned_user_name") or action.get("assigned_department") or "-"], ["Approver", action.get("reviewer_user_name") or action.get("created_by_name") or "-"], ["Due", legacy.format_uk_date(action.get("due_date"))], ["Action taken", action.get("action_taken") or "Not completed"]]
        action_table = Table([[Paragraph(escape(str(a)), small), Paragraph(escape(str(b)), small)] for a, b in action_rows], colWidths=[1.4 * inch, 4.8 * inch]); action_table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.3, HexColor("#d7e2e0")), ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("PADDING", (0, 0), (-1, -1), 5)])); story.append(action_table)
        for entry in action.get("history") or []:
            story.append(Paragraph(f"{escape(legacy.format_uk_datetime(entry.get('at') or entry.get('created_at')))} — {escape(str(entry.get('user_name') or 'System'))}: {escape(str(entry.get('message') or entry.get('event') or 'Updated'))} {escape(str(entry.get('comment') or ''))}", small))
        story.append(Spacer(1, 0.15 * inch))
    doc.build(story); buffer.seek(0)
    filename = f"audit_evidence_pack_{run_id[:8]}.pdf"
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": pdf_content_disposition(filename)})


@router.get("/audits/{audit_id}/qr.pdf")
async def audit_qr_sheet(
    audit_id: str,
    user: dict = Depends(legacy.require_feature("audits_edit")),
):
    audit = await legacy.db.audits.find_one({"id": audit_id}, {"_id": 0, "questions": 0})
    if not audit or (not legacy.is_system_admin(user) and audit.get("company_id") not in {None, user.get("company_id")}):
        raise HTTPException(status_code=404, detail="Audit not found")
    target = f"{public_app_url()}/run-audit?audit={audit_id}"
    qr = QrCodeWidget(target)
    x1, y1, x2, y2 = qr.getBounds()
    qr_size = 3.6 * inch
    scale = qr_size / max(x2 - x1, y2 - y1)
    qr_drawing = Drawing(qr_size, qr_size, transform=[scale, 0, 0, scale, -x1 * scale, -y1 * scale])
    qr_drawing.add(qr)
    company = await legacy.db.companies.find_one({"id": audit.get("company_id")}, {"_id": 0}) if audit.get("company_id") else None
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=1.5 * cm, leftMargin=1.5 * cm, topMargin=1.5 * cm, bottomMargin=1.5 * cm)
    styles = getSampleStyleSheet()
    centre = ParagraphStyle("QRCentre", parent=styles["BodyText"], alignment=1, fontSize=12, leading=16)
    story = legacy.build_company_pdf_header(company, "Scan to Start Audit", styles)
    story.extend([Spacer(1, 0.25 * inch), Paragraph(f"<b>{escape(str(audit.get('name') or 'Audit'))}</b>", centre), Spacer(1, 0.2 * inch)])
    qr_table = Table([[qr_drawing]], colWidths=[6.2 * inch])
    qr_table.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER")]))
    story.extend([qr_table, Spacer(1, 0.2 * inch), Paragraph("Open the camera on a company device and scan this code. Sign-in and normal permissions are still required.", centre)])
    doc.build(story)
    buffer.seek(0)
    return StreamingResponse(buffer, media_type="application/pdf", headers={"Content-Disposition": pdf_content_disposition(f"audit_qr_{audit_id[:8]}.pdf")})
