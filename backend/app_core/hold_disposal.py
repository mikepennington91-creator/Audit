from __future__ import annotations

import html
import io
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from starlette.responses import StreamingResponse

import server as legacy
from app_core.disposal_routes import DISPOSAL_ROUTES, resolve_disposal_route
from app_core.email_service import EmailAttachment, send_email
from app_core.factory_notice_pdf import notice_pdf_bytes as _notice_pdf_bytes


router = APIRouter(prefix="/api/hold-disposal", tags=["hold-disposal"])


class DistributionListCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    recipients: list[EmailStr] = Field(min_length=1, max_length=100)
    company_id: Optional[str] = None


class DistributionListUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    recipients: list[EmailStr] = Field(min_length=1, max_length=100)


class NoticeCreate(BaseModel):
    rm_number: str = Field(min_length=1, max_length=120)
    quantity: str = Field(min_length=1, max_length=120)
    ingredient_name: str = Field(min_length=1, max_length=240)
    reason: str = Field(min_length=1, max_length=3000)
    action_required: str = Field(min_length=1, max_length=3000)
    event_date: str = Field(min_length=10, max_length=10)
    event_time: str = Field(min_length=5, max_length=8)
    line_area: str = Field(min_length=1, max_length=240)
    company_id: Optional[str] = None


class DisposalNoticeCreate(NoticeCreate):
    disposal_route: str


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
    return f"{prefix}-{now.strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"


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
) -> dict:
    company_id = _company_scope(user, data.company_id)
    await _validate_company(company_id)

    route = None
    if notice_type == "disposal":
        route = await resolve_disposal_route(company_id, disposal_route or "")
        if not route:
            raise HTTPException(status_code=400, detail="Select a valid disposal route")

    now = legacy.get_uk_time_iso()
    prefix = "DISP" if notice_type == "disposal" else "HOLD"
    record = {
        "id": str(uuid.uuid4()),
        "reference": _notice_reference(prefix),
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
    await collection.insert_one(record)
    return {k: v for k, v in record.items() if k != "_id"}


@router.post("/hold-notices")
async def create_hold_notice(data: NoticeCreate, user: dict = Depends(legacy.get_current_user)):
    return await _create_notice(data, user, notice_type="hold")


@router.post("/disposal-notices")
async def create_disposal_notice(data: DisposalNoticeCreate, user: dict = Depends(legacy.get_current_user)):
    return await _create_notice(data, user, notice_type="disposal", disposal_route=data.disposal_route)


async def _list_notices(notice_type: str, user: dict) -> list[dict]:
    collection = legacy.db.disposal_notices if notice_type == "disposal" else legacy.db.hold_notices
    query = {} if legacy.is_system_admin(user) else {"company_id": user.get("company_id")}
    return await collection.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)


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
    filename = f"{record['reference'].lower()}_{record.get('rm_number', 'notice').replace(' ', '_')}.pdf"
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
    filename = f"{record['reference'].lower()}.pdf"
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
