from __future__ import annotations

import html
import io
import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field, field_validator
from starlette.responses import StreamingResponse

import server as legacy
from app_core.disposal_routes import DISPOSAL_ROUTES, resolve_disposal_route
from app_core.email_service import EmailAttachment, send_email
from app_core.factory_notice_pdf import notice_pdf_bytes as _notice_pdf_bytes
from app_core.notice_files import notice_filename
from date_formats import parse_date


router = APIRouter(prefix="/api/hold-disposal", tags=["hold-disposal"])


class DistributionListCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    recipients: list[EmailStr] = Field(min_length=1, max_length=100)
    company_id: Optional[str] = None


class DistributionListUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    recipients: list[EmailStr] = Field(min_length=1, max_length=100)


class NoticeEvent(BaseModel):
    event_date: str = Field(min_length=10, max_length=10)
    event_time: str = Field(min_length=5, max_length=8)

    @field_validator("event_date")
    @classmethod
    def valid_date(cls, value):
        return parse_date(value).isoformat()

    @field_validator("event_time")
    @classmethod
    def valid_time(cls, value):
        if not re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?", value):
            raise ValueError("Enter a valid 24-hour time")
        return value


class NoticeCreate(NoticeEvent):
    reference: Optional[str] = Field(default=None, max_length=60)
    rm_number: str = Field(min_length=1, max_length=120)
    quantity: str = Field(min_length=1, max_length=120)
    ingredient_name: str = Field(min_length=1, max_length=240)
    reason: str = Field(min_length=1, max_length=3000)
    action_required: str = Field(min_length=1, max_length=3000)
    line_area: str = Field(min_length=1, max_length=240)
    company_id: Optional[str] = None
    our_batch: str = Field(default="", max_length=120)
    vendor_batch: str = Field(default="", max_length=120)
    date_delivered: Optional[str] = None
    quantity_delivered: str = Field(default="", max_length=120)

    @field_validator("date_delivered")
    @classmethod
    def valid_delivery_date(cls, value):
        return parse_date(value).isoformat() if value else None

    @field_validator("reference")
    @classmethod
    def valid_reference(cls, value):
        if value is not None and any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError("Reference must not contain control characters")
        return (value.strip() or None) if value is not None else None


class DisposalNoticeCreate(NoticeCreate):
    disposal_route: str


class HoldDisposalCreate(NoticeEvent):
    disposal_route: str
    quantity: Optional[str] = Field(default=None, min_length=1, max_length=120)
    reason: str = Field(min_length=1, max_length=3000)
    action_required: str = Field(min_length=1, max_length=3000)


OUTCOME_FIELDS = ("quantity_released", "quantity_discarded", "root_cause", "corrective_action")


class HoldOutcomeUpdate(BaseModel):
    expected_version: int = Field(ge=0)
    quantity_released: str = Field(default="", max_length=120)
    quantity_discarded: str = Field(default="", max_length=120)
    root_cause: str = Field(default="", max_length=3000)
    corrective_action: str = Field(default="", max_length=3000)


class NoticeEmailRequest(BaseModel):
    distribution_list_id: str
    message: Optional[str] = Field(default=None, max_length=2000)


def _company_scope(user: dict, requested_company_id: Optional[str] = None) -> Optional[str]:
    if legacy.is_system_admin(user):
        return requested_company_id or user.get("company_id")
    if not user.get("company_id"):
        raise HTTPException(status_code=400, detail="Your account must be assigned to a company")
    return user["company_id"]


def _same_company(record: dict, user: dict) -> bool:
    if legacy.is_system_admin(user):
        return True
    company_id = record.get("company_id")
    if company_id:
        return company_id == user.get("company_id")
    return record.get("created_by_id") == user.get("id")


async def _validate_company(company_id: Optional[str]) -> None:
    if company_id and not await legacy.db.companies.find_one({"id": company_id}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Company not found")


def _notice_reference(prefix: str) -> str:
    now = legacy.get_uk_time()
    return f"{prefix}-{now.strftime('%d%m%y')}-{uuid.uuid4().hex[:6].upper()}"


def _notice_payload(record: dict) -> dict:
    return {**{k: v for k, v in record.items() if k != "_id"},
            "outcome_version": record.get("outcome_version", 0), "pdf_filename": notice_filename(record)}


def _normalised_recipients(recipients) -> list[str]:
    values = []
    seen = set()
    for recipient in recipients:
        email = str(recipient).strip().lower()
        if email and email not in seen:
            seen.add(email)
            values.append(email)
    return values


@router.get("/distribution-lists")
async def list_distribution_lists(user: dict = Depends(legacy.get_current_user)):
    query = {} if legacy.is_system_admin(user) else {"company_id": user.get("company_id")}
    return await legacy.db.distribution_lists.find(query, {"_id": 0}).sort("name", 1).to_list(1000)


@router.post("/distribution-lists")
async def create_distribution_list(data: DistributionListCreate, user: dict = Depends(legacy.get_current_user)):
    company_id = _company_scope(user, data.company_id)
    await _validate_company(company_id)
    recipients = _normalised_recipients(data.recipients)
    if not recipients:
        raise HTTPException(status_code=400, detail="Add at least one email address")
    existing = await legacy.db.distribution_lists.find_one({
        "company_id": company_id,
        "name": {"$ieq": data.name.strip()},
    })
    if existing:
        raise HTTPException(status_code=400, detail="A distribution list with this name already exists")
    now = legacy.get_uk_time_iso()
    record = {
        "id": str(uuid.uuid4()),
        "company_id": company_id,
        "name": data.name.strip(),
        "recipients": recipients,
        "created_by_id": user.get("id"),
        "created_by_name": user.get("name"),
        "created_at": now,
        "updated_at": now,
    }
    await legacy.db.distribution_lists.insert_one(record)
    return {k: v for k, v in record.items() if k != "_id"}


@router.put("/distribution-lists/{list_id}")
async def update_distribution_list(list_id: str, data: DistributionListUpdate, user: dict = Depends(legacy.get_current_user)):
    record = await legacy.db.distribution_lists.find_one({"id": list_id}, {"_id": 0})
    if not record or not _same_company(record, user):
        raise HTTPException(status_code=404, detail="Distribution list not found")
    recipients = _normalised_recipients(data.recipients)
    if not recipients:
        raise HTTPException(status_code=400, detail="Add at least one email address")
    await legacy.db.distribution_lists.update_one(
        {"id": list_id},
        {"$set": {
            "name": data.name.strip(),
            "recipients": recipients,
            "updated_at": legacy.get_uk_time_iso(),
        }},
    )
    return await legacy.db.distribution_lists.find_one({"id": list_id}, {"_id": 0})


@router.delete("/distribution-lists/{list_id}")
async def delete_distribution_list(list_id: str, user: dict = Depends(legacy.get_current_user)):
    record = await legacy.db.distribution_lists.find_one({"id": list_id}, {"_id": 0})
    if not record or not _same_company(record, user):
        raise HTTPException(status_code=404, detail="Distribution list not found")
    await legacy.db.distribution_lists.delete_one({"id": list_id})
    return {"message": "Distribution list deleted"}


async def _create_notice(
    data: NoticeCreate,
    user: dict,
    *,
    notice_type: str,
    disposal_route: Optional[str] = None,
    source_hold: Optional[dict] = None,
) -> dict:
    company_id = source_hold.get("company_id") if source_hold else _company_scope(user, data.company_id)
    await _validate_company(company_id)

    route = None
    if notice_type == "disposal":
        route = await resolve_disposal_route(company_id, disposal_route or "")
        if not route:
            raise HTTPException(status_code=400, detail="Select a valid disposal route")

    now = legacy.get_uk_time_iso()
    prefix = "DISP" if notice_type == "disposal" else "HOLD"
    record = {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"infinit-audit/hold-disposal/{source_hold['id']}")) if source_hold else str(uuid.uuid4()),
        "reference": source_hold["reference"] if source_hold else data.reference or _notice_reference(prefix),
        "source_hold_id": source_hold["id"] if source_hold else None,
        "notice_type": notice_type,
        "company_id": company_id,
        "rm_number": data.rm_number.strip(),
        "quantity": data.quantity.strip(),
        "ingredient_name": data.ingredient_name.strip(),
        "reason": data.reason.strip(),
        "action_required": data.action_required.strip(),
        "event_date": data.event_date,
        "event_time": data.event_time,
        "line_area": data.line_area.strip(),
        "our_batch": data.our_batch.strip(),
        "vendor_batch": data.vendor_batch.strip(),
        "date_delivered": data.date_delivered,
        "quantity_delivered": data.quantity_delivered.strip(),
        "disposal_route": route.get("key") if route else None,
        "disposal_route_id": route.get("id") if route else None,
        "disposal_route_label": route.get("name") if route else None,
        "disposal_route_color": route.get("color_hex") if route else None,
        "disposal_route_text_color": route.get("text_color") if route else None,
        "created_by_id": user.get("id"),
        "created_by_name": user.get("name"),
        "created_at": now,
        "last_emailed_at": None,
        "last_distribution_list_id": None,
    }
    collection = legacy.db.disposal_notices if notice_type == "disposal" else legacy.db.hold_notices
    if source_hold:
        if not await collection.insert_one_if_absent(record):
            raise HTTPException(status_code=409, detail="A disposal notice has already been raised for this hold")
    else:
        await collection.insert_one(record)
    return _notice_payload(record)


@router.post("/hold-notices")
async def create_hold_notice(data: NoticeCreate, user: dict = Depends(legacy.get_current_user)):
    return await _create_notice(data, user, notice_type="hold")


@router.post("/disposal-notices")
async def create_disposal_notice(data: DisposalNoticeCreate, user: dict = Depends(legacy.get_current_user)):
    return await _create_notice(data, user, notice_type="disposal", disposal_route=data.disposal_route)


@router.post("/hold-notices/{notice_id}/disposal")
async def dispose_hold(notice_id: str, data: HoldDisposalCreate, user: dict = Depends(legacy.require_feature("traceability"))):
    hold = await _get_notice("hold", notice_id, user)
    # Take identity, quantity and tenant from the saved hold, never the client.
    copied = NoticeCreate(
        **{key: hold[key] for key in ("rm_number", "ingredient_name", "line_area")},
        **{key: hold.get(key) or "" for key in ("our_batch", "vendor_batch", "quantity_delivered")},
        date_delivered=hold.get("date_delivered"),
        quantity=data.quantity or hold.get("quantity_discarded") or hold["quantity"],
        **data.model_dump(exclude={"disposal_route", "quantity"}),
    )
    return await _create_notice(copied, user, notice_type="disposal", disposal_route=data.disposal_route, source_hold=hold)


@router.put("/hold-notices/{notice_id}/outcome")
async def update_hold_outcome(notice_id: str, data: HoldOutcomeUpdate,
                              user: dict = Depends(legacy.require_feature("traceability"))):
    hold = await _get_notice("hold", notice_id, user)
    version = hold.get("outcome_version", 0)
    if data.expected_version != version:
        raise HTTPException(status_code=409, detail="This hold was updated by another user. Close and reopen it before saving.")
    values = {field: getattr(data, field).strip() for field in OUTCOME_FIELDS}
    changes = {field: {"before": hold.get(field) or "", "after": value}
               for field, value in values.items() if (hold.get(field) or "") != value}
    if not changes:
        return _notice_payload(hold)
    now = legacy.get_uk_time_iso()
    history = list(hold.get("outcome_history") or [])
    history.append({"id": str(uuid.uuid4()), "updated_at": now, "updated_by_id": user.get("id"),
                    "updated_by_name": user.get("name"), "changes": changes})
    update = {**values, "outcome_version": version + 1, "outcome_history": history,
              "outcome_updated_at": now, "outcome_updated_by_name": user.get("name"),
              "outcome_updated_by_id": user.get("id")}
    # Match the stored version too so two concurrent saves cannot lose history.
    result = await legacy.db.hold_notices.update_one(
        {"id": notice_id, "outcome_version": hold.get("outcome_version")}, {"$set": update})
    if not result.matched_count:
        raise HTTPException(status_code=409, detail="This hold was updated by another user. Close and reopen it before saving.")
    return _notice_payload({**hold, **update})


async def _list_notices(notice_type: str, user: dict) -> list[dict]:
    collection = legacy.db.disposal_notices if notice_type == "disposal" else legacy.db.hold_notices
    query = {} if legacy.is_system_admin(user) else {"company_id": user.get("company_id")}
    records = await collection.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return [_notice_payload(record) for record in records]


@router.get("/hold-notices")
async def list_hold_notices(user: dict = Depends(legacy.get_current_user)):
    return await _list_notices("hold", user)


@router.get("/disposal-notices")
async def list_disposal_notices(user: dict = Depends(legacy.get_current_user)):
    return await _list_notices("disposal", user)


async def _get_notice(notice_type: str, notice_id: str, user: dict) -> dict:
    collection = legacy.db.disposal_notices if notice_type == "disposal" else legacy.db.hold_notices
    record = await collection.find_one({"id": notice_id}, {"_id": 0})
    if not record or not _same_company(record, user):
        raise HTTPException(status_code=404, detail="Notice not found")
    return record


async def _pdf_response(record: dict) -> StreamingResponse:
    content = await _notice_pdf_bytes(record)
    filename = notice_filename(record)
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/hold-notices/{notice_id}/pdf")
async def download_hold_notice(notice_id: str, user: dict = Depends(legacy.get_current_user)):
    return await _pdf_response(await _get_notice("hold", notice_id, user))


@router.get("/disposal-notices/{notice_id}/pdf")
async def download_disposal_notice(notice_id: str, user: dict = Depends(legacy.get_current_user)):
    return await _pdf_response(await _get_notice("disposal", notice_id, user))


async def _email_notice(notice_type: str, notice_id: str, request: NoticeEmailRequest, user: dict) -> dict:
    record = await _get_notice(notice_type, notice_id, user)
    distribution = await legacy.db.distribution_lists.find_one({"id": request.distribution_list_id}, {"_id": 0})
    if not distribution or not _same_company(distribution, user):
        raise HTTPException(status_code=404, detail="Distribution list not found")

    content = await _notice_pdf_bytes(record)
    filename = notice_filename(record)
    notice_name = "Disposal Notice" if notice_type == "disposal" else "Hold Notice"
    message_text = (request.message or "").strip()
    sent = 0
    failed = []
    for recipient in distribution.get("recipients", []):
        text_body = (
            f"{notice_name} {record['reference']}\n\n"
            f"Material: {record.get('ingredient_name')}\n"
            f"RM number: {record.get('rm_number')}\n"
            f"Quantity: {record.get('quantity')}\n"
            f"Line / area: {record.get('line_area')}\n"
        )
        if notice_type == "disposal":
            text_body += f"Disposal route: {record.get('disposal_route_label')}\n"
        if message_text:
            text_body += f"\nMessage:\n{message_text}\n"

        html_body = (
            f"<p><strong>{html.escape(notice_name)} {html.escape(record['reference'])}</strong></p>"
            f"<p><strong>Material:</strong> {html.escape(record.get('ingredient_name') or '')}<br>"
            f"<strong>RM number:</strong> {html.escape(record.get('rm_number') or '')}<br>"
            f"<strong>Quantity:</strong> {html.escape(record.get('quantity') or '')}<br>"
            f"<strong>Line / area:</strong> {html.escape(record.get('line_area') or '')}"
        )
        if notice_type == "disposal":
            html_body += f"<br><strong>Disposal route:</strong> {html.escape(record.get('disposal_route_label') or '')}"
        html_body += "</p>"
        if message_text:
            html_body += f"<p><strong>Message:</strong><br>{html.escape(message_text).replace(chr(10), '<br>')}</p>"

        result = await send_email(
            to_email=recipient,
            subject=f"Infinit Audit {notice_name}: {record['reference']}",
            text_body=text_body,
            html_body=html_body,
            attachments=[EmailAttachment(filename, content, "application", "pdf")],
            template=f"{notice_type}_notice",
        )
        if result.sent:
            sent += 1
        else:
            failed.append(recipient)

    if sent == 0:
        raise HTTPException(status_code=502, detail="The notice PDF was generated but no emails could be delivered")

    collection = legacy.db.disposal_notices if notice_type == "disposal" else legacy.db.hold_notices
    await collection.update_one({"id": notice_id}, {"$set": {
        "last_emailed_at": legacy.get_uk_time_iso(),
        "last_distribution_list_id": distribution["id"],
        "last_distribution_list_name": distribution.get("name"),
    }})
    return {
        "message": f"Sent to {sent} recipient{'s' if sent != 1 else ''}",
        "sent": sent,
        "failed": failed,
        "distribution_list": distribution.get("name"),
    }


@router.post("/hold-notices/{notice_id}/email")
async def email_hold_notice(notice_id: str, request: NoticeEmailRequest, user: dict = Depends(legacy.get_current_user)):
    return await _email_notice("hold", notice_id, request, user)


@router.post("/disposal-notices/{notice_id}/email")
async def email_disposal_notice(notice_id: str, request: NoticeEmailRequest, user: dict = Depends(legacy.get_current_user)):
    return await _email_notice("disposal", notice_id, request, user)
