from __future__ import annotations

import html
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from starlette.responses import StreamingResponse

import server as legacy
from app_core.email_service import EmailAttachment, send_email


router = APIRouter(prefix="/api", tags=["report-email"])


class ReportEmailRequest(BaseModel):
    recipient: EmailStr
    message: Optional[str] = Field(default=None, max_length=2000)


class BatchDocumentEmailRequest(ReportEmailRequest):
    document_ids: list[str] = Field(min_length=1, max_length=100)


class TraceabilityEmailRequest(ReportEmailRequest):
    data_types: list[str] = Field(default_factory=lambda: ["raw", "finished", "usage"])
    date_from: Optional[str] = None
    date_to: Optional[str] = None


async def _streaming_response_bytes(response: StreamingResponse) -> bytes:
    chunks = []
    async for chunk in response.body_iterator:
        if isinstance(chunk, str):
            chunk = chunk.encode("utf-8")
        chunks.append(chunk)
    return b"".join(chunks)


def _response_filename(response: StreamingResponse, fallback: str) -> str:
    disposition = response.headers.get("content-disposition", "")
    match = re.search(r'filename="?([^";]+)', disposition, flags=re.IGNORECASE)
    return match.group(1) if match else fallback


def _message_bodies(user: dict, custom_message: Optional[str], item_name: str) -> tuple[str, str]:
    sender = user.get("name") or user.get("email") or "an Infinit Audit user"
    note = (custom_message or "").strip()
    text = f"{sender} sent you {item_name} from Infinit Audit."
    if note:
        text += f"\n\nMessage:\n{note}"
    html_body = f"<p><strong>{html.escape(str(sender))}</strong> sent you {html.escape(item_name)} from Infinit Audit.</p>"
    if note:
        html_body += f"<p><strong>Message:</strong><br>{html.escape(note).replace(chr(10), '<br>')}</p>"
    return text, html_body


def _document_access_allowed(document: dict, user: dict) -> bool:
    """Mirror the intended document-list visibility, not the legacy ID-only fetch."""
    if legacy.is_system_admin(user):
        return True
    if document.get("company_id") != user.get("company_id"):
        return False
    if user.get("role") == legacy.UserRole.USER:
        return document.get("completed_by") == user.get("id")
    return True


async def _get_accessible_document(document_id: str, user: dict, *, completed: bool = False) -> dict:
    document = await legacy.db.traceability_documents.find_one({"id": document_id}, {"_id": 0})
    # Deliberately return the same 404 for missing and inaccessible IDs so this
    # endpoint cannot be used to probe another company's document identifiers.
    if not document or not _document_access_allowed(document, user):
        raise HTTPException(status_code=404, detail="Document not found")
    if completed and not document.get("completed"):
        raise HTTPException(status_code=409, detail="Only completed documents can be emailed")
    return document


async def _deliver_attachment(
    *,
    request: ReportEmailRequest,
    user: dict,
    subject: str,
    item_name: str,
    attachment: EmailAttachment,
    template: str,
):
    text_body, html_body = _message_bodies(user, request.message, item_name)
    result = await send_email(
        to_email=str(request.recipient),
        subject=subject,
        text_body=text_body,
        html_body=html_body,
        attachments=[attachment],
        template=template,
    )
    if not result.sent:
        if result.status == "disabled":
            raise HTTPException(status_code=503, detail="Email has not been configured on the server yet")
        raise HTTPException(status_code=502, detail="The report was generated but the email could not be delivered")
    return {"message": f"Emailed to {request.recipient}"}


@router.post("/reports/audit-runs/{run_id}/email")
async def email_audit_report(
    run_id: str,
    request: ReportEmailRequest,
    user: dict = Depends(legacy.require_feature("audits")),
):
    response = await legacy.export_audit_pdf(run_id, user)
    content = await _streaming_response_bytes(response)
    filename = _response_filename(response, f"audit_report_{run_id[:8]}.pdf")
    run = await legacy.db.run_audits.find_one({"id": run_id}, {"_id": 0})
    audit_name = (run or {}).get("audit_name") or "Audit"
    return await _deliver_attachment(
        request=request,
        user=user,
        subject=f"Infinit Audit report: {audit_name}",
        item_name=f"the audit report for {audit_name}",
        attachment=EmailAttachment(filename, content, "application", "pdf"),
        template="audit_report_attachment",
    )


@router.post("/reports/actions/{action_id}/email")
async def email_action_report(
    action_id: str,
    request: ReportEmailRequest,
    user: dict = Depends(legacy.require_feature("actions")),
):
    # The legacy PDF exporter calls get_accessible_corrective_action, which
    # performs the action/company access check before returning any bytes.
    response = await legacy.export_corrective_action_pdf(action_id, user)
    content = await _streaming_response_bytes(response)
    filename = _response_filename(response, f"action_report_{action_id[:8]}.pdf")
    action = await legacy.db.corrective_actions.find_one({"id": action_id}, {"_id": 0})
    audit_name = (action or {}).get("audit_name") or "Audit"
    return await _deliver_attachment(
        request=request,
        user=user,
        subject=f"Infinit Audit corrective action: {audit_name}",
        item_name="a corrective action report",
        attachment=EmailAttachment(filename, content, "application", "pdf"),
        template="action_report_attachment",
    )


@router.post("/reports/documents/{document_id}/email")
async def email_document_report(
    document_id: str,
    request: ReportEmailRequest,
    user: dict = Depends(legacy.require_feature("documents")),
):
    document = await _get_accessible_document(document_id, user, completed=True)
    response = await legacy.export_traceability_document_pdf(document_id, user)
    content = await _streaming_response_bytes(response)
    filename = _response_filename(response, f"document_{document_id[:8]}.pdf")
    title = document.get("template_title") or "Document"
    return await _deliver_attachment(
        request=request,
        user=user,
        subject=f"Infinit Audit document: {title}",
        item_name=title,
        attachment=EmailAttachment(filename, content, "application", "pdf"),
        template="document_attachment",
    )


@router.post("/reports/documents/batch/email")
async def email_document_batch(
    request: BatchDocumentEmailRequest,
    user: dict = Depends(legacy.require_feature("documents")),
):
    # Validate every requested document before handing IDs to the legacy batch
    # PDF generator. No inaccessible ID is silently ignored.
    for document_id in request.document_ids:
        await _get_accessible_document(document_id, user, completed=True)

    response = await legacy.batch_export_traceability_pdf({"document_ids": request.document_ids}, user)
    content = await _streaming_response_bytes(response)
    filename = _response_filename(response, "batch_documents.pdf")
    return await _deliver_attachment(
        request=request,
        user=user,
        subject="Infinit Audit documents",
        item_name=f"{len(request.document_ids)} Infinit Audit document(s)",
        attachment=EmailAttachment(filename, content, "application", "pdf"),
        template="document_batch_attachment",
    )


@router.post("/reports/traceability/email")
async def email_traceability_export(
    request: TraceabilityEmailRequest,
    user: dict = Depends(legacy.require_feature("traceability")),
):
    export_data = legacy.TraceabilityBulkExport(
        data_types=request.data_types,
        date_from=request.date_from,
        date_to=request.date_to,
    )
    # The existing Excel exporter scopes records to the current user's company.
    response = await legacy.export_traceability_excel(export_data, user)
    content = await _streaming_response_bytes(response)
    filename = _response_filename(response, "traceability_export.xlsx")
    return await _deliver_attachment(
        request=request,
        user=user,
        subject="Infinit Audit traceability export",
        item_name="a traceability Excel export",
        attachment=EmailAttachment(
            filename,
            content,
            "application",
            "vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ),
        template="traceability_export_attachment",
    )
