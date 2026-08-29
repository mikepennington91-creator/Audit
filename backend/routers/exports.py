from __future__ import annotations

import re
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from server import get_current_user
from services.email_service import email_configured, send_email

router = APIRouter(prefix="/api", tags=["exports"])


class EmailExportRequest(BaseModel):
    kind: str
    resource_id: Optional[str] = None
    resource_ids: List[str] = Field(default_factory=list)
    recipient_email: Optional[EmailStr] = None
    subject: Optional[str] = None
    message: Optional[str] = None


EXPORT_PATHS = {
    "audit_report": lambda data: ("GET", f"/api/run-audits/{data.resource_id}/pdf", None),
    "action_report": lambda data: ("GET", f"/api/actions/{data.resource_id}/pdf", None),
    "document": lambda data: ("GET", f"/api/traceability/documents/{data.resource_id}/pdf", None),
    "document_batch": lambda data: ("POST", "/api/traceability/documents/batch-pdf", {"document_ids": data.resource_ids}),
}


def _filename_from_disposition(value: str | None, fallback: str) -> str:
    if not value:
        return fallback
    match = re.search(r'filename="?([^";]+)', value)
    return match.group(1) if match else fallback


@router.post("/exports/email")
async def email_export(
    data: EmailExportRequest,
    request: Request,
    user: dict = Depends(get_current_user),
):
    if data.kind not in EXPORT_PATHS:
        raise HTTPException(status_code=400, detail="This report type cannot be emailed")
    if data.kind == "document_batch" and not data.resource_ids:
        raise HTTPException(status_code=400, detail="Select at least one document")
    if data.kind != "document_batch" and not data.resource_id:
        raise HTTPException(status_code=400, detail="A report ID is required")
    if not email_configured():
        raise HTTPException(status_code=503, detail="Email delivery is not configured yet")

    method, path, payload = EXPORT_PATHS[data.kind](data)
    authorization = request.headers.get("Authorization")
    headers = {"Authorization": authorization} if authorization else {}

    # Reuse the application's existing, permission-checked download endpoints so
    # emailing a report has exactly the same access rules as downloading it.
    transport = httpx.ASGITransport(app=request.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://infinit-audit.internal") as client:
        if method == "POST":
            response = await client.post(path, json=payload, headers=headers)
        else:
            response = await client.get(path, headers=headers)
    if response.status_code >= 400:
        try:
            detail = response.json().get("detail", "Unable to generate report")
        except Exception:
            detail = "Unable to generate report"
        raise HTTPException(status_code=response.status_code, detail=detail)

    default_name = f"infinit-audit-{data.kind}.pdf"
    filename = _filename_from_disposition(response.headers.get("content-disposition"), default_name)
    recipient = str(data.recipient_email or user["email"])
    subject = (data.subject or f"Infinit Audit report: {filename}").strip()
    body = (data.message or "Please find the requested Infinit Audit report attached.").strip()
    sent = await send_email(
        recipients=[recipient],
        subject=subject,
        text_body=body,
        attachment=response.content,
        attachment_name=filename,
        attachment_type=response.headers.get("content-type", "application/pdf").split(";", 1)[0],
    )
    if not sent:
        raise HTTPException(status_code=502, detail="The report was generated but the email could not be sent")
    return {"message": f"Report emailed to {recipient}", "filename": filename}
