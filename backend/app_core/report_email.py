from __future__ import annotations

import csv
import html
import io
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


class TraceabilityCsvEmailRequest(ReportEmailRequest):
    report_type: str
    lookup_code: Optional[str] = Field(default=None, max_length=200)
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
    if legacy.is_system_admin(user):
        return True
    if document.get("company_id") != user.get("company_id"):
        return False
    if user.get("role") == legacy.UserRole.USER:
        return document.get("completed_by") == user.get("id")
    return True


async def _get_accessible_document(document_id: str, user: dict, *, completed: bool = False) -> dict:
    document = await legacy.db.traceability_documents.find_one({"id": document_id}, {"_id": 0})
    if not document or not _document_access_allowed(document, user):
        raise HTTPException(status_code=404, detail="Document not found")
    if completed and not document.get("completed"):
        raise HTTPException(status_code=409, detail="Only completed documents can be emailed")
    return document


def _audit_run_access_allowed(run: dict, user: dict) -> bool:
    if legacy.is_system_admin(user):
        return True
    if run.get("auditor_id") == user.get("id"):
        return True
    if user.get("role") in [
        legacy.UserRole.COMPANY_ADMIN,
        legacy.UserRole.ADMIN,
        legacy.UserRole.AUDIT_CREATOR,
    ]:
        return run.get("company_id") == user.get("company_id")
    return False


async def _get_accessible_audit_run(run_id: str, user: dict) -> dict:
    run = await legacy.db.run_audits.find_one({"id": run_id}, {"_id": 0})
    if not run or not _audit_run_access_allowed(run, user):
        # Do not reveal whether a run ID belongs to another company.
        raise HTTPException(status_code=404, detail="Audit run not found")
    return run


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


def _csv_bytes(rows: list[dict], columns: list[tuple[str, str]]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=[label for label, _ in columns], extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({label: row.get(key, "") for label, key in columns})
    return output.getvalue().encode("utf-8-sig")


def _between(value: str | None, date_from: str | None, date_to: str | None) -> bool:
    if not value:
        return False
    day = str(value)[:10]
    if date_from and day < date_from:
        return False
    if date_to and day > date_to:
        return False
    return True


async def _build_traceability_csv(request: TraceabilityCsvEmailRequest, user: dict) -> tuple[str, str, bytes]:
    records = await legacy._get_traceability_records(user)
    raw = records.get("rawIntakes", [])
    finished = records.get("finishedBatches", [])
    usage = records.get("materialUsage", [])
    report_type = request.report_type.strip().lower()

    if report_type == "raw_intakes":
        rows = raw
        columns = [
            ("Intake Date", "intakeDate"), ("Supplier Name", "supplierName"),
            ("Material Name", "materialName"), ("Best Before Date", "bestBeforeDate"),
            ("Sweetdreams Batch Code", "sweetdreamsBatchCode"), ("Supplier Batch Code", "supplierBatchCode"),
            ("Pallet Number", "palletNumber"), ("Number of Cases", "numberOfCases"),
            ("Total Weight KG", "totalWeightKg"), ("Item Type", "itemType"),
            ("Packaging Type", "packagingType"), ("Packaging SKU", "packagingSku"),
            ("Units per Pallet", "unitsPerPallet"),
        ]
        return "raw_material_intakes.csv", "Raw Material Intake report", _csv_bytes(rows, columns)

    if report_type == "finished_goods_trace":
        code = (request.lookup_code or "").strip().lower()
        if not code:
            raise HTTPException(status_code=400, detail="Enter a finished batch code")
        matching_usage = [row for row in usage if str(row.get("finishedBatchCode") or "").lower() == code]
        rows = []
        for row in matching_usage:
            intake = next((item for item in raw if str(item.get("sweetdreamsBatchCode") or "").lower() == str(row.get("sweetdreamsBatchCode") or "").lower() and str(item.get("palletNumber") or "") == str(row.get("palletNumber") or "")), None)
            rows.append({**row, "materialName": (intake or {}).get("materialName", "Unknown"), "supplierName": (intake or {}).get("supplierName", "-"), "itemType": (intake or {}).get("itemType", "-")})
        columns = [
            ("Usage Date", "usageDate"), ("Sweetdreams Batch", "sweetdreamsBatchCode"),
            ("Pallet", "palletNumber"), ("Material", "materialName"), ("Supplier", "supplierName"),
            ("Item Type", "itemType"), ("Used KG", "quantityUsedKg"), ("Waste KG", "quantityWastedKg"),
            ("Units Used", "unitsUsed"), ("Units Wasted", "unitsWasted"),
        ]
        return "finished_goods_trace.csv", "Finished Goods Trace report", _csv_bytes(rows, columns)

    if report_type == "raw_material_trace":
        code = (request.lookup_code or "").strip().lower()
        if not code:
            raise HTTPException(status_code=400, detail="Enter a Sweetdreams batch code")
        matching_usage = [row for row in usage if str(row.get("sweetdreamsBatchCode") or "").lower() == code]
        rows = []
        for row in matching_usage:
            batch = next((item for item in finished if str(item.get("finishedBatchCode") or "").lower() == str(row.get("finishedBatchCode") or "").lower()), None)
            rows.append({**row, "finishedProduct": (batch or {}).get("finishedProduct", "Unknown"), "productionDate": (batch or {}).get("productionDate", "-")})
        columns = [
            ("Usage Date", "usageDate"), ("Finished Batch", "finishedBatchCode"),
            ("Finished Product", "finishedProduct"), ("Production Date", "productionDate"),
            ("Pallet", "palletNumber"), ("Used KG", "quantityUsedKg"), ("Waste KG", "quantityWastedKg"),
            ("Units Used", "unitsUsed"), ("Units Wasted", "unitsWasted"),
        ]
        return "raw_material_trace.csv", "Raw Material Trace report", _csv_bytes(rows, columns)

    if report_type in {"date_trace_finished", "date_trace_raw"}:
        if not request.date_from or not request.date_to:
            raise HTTPException(status_code=400, detail="Select a start and end date")
        if request.date_from > request.date_to:
            raise HTTPException(status_code=400, detail="Start date cannot be after end date")
        if report_type == "date_trace_finished":
            rows = [row for row in finished if _between(row.get("productionDate"), request.date_from, request.date_to)]
            columns = [
                ("Production Date", "productionDate"), ("Finished Product", "finishedProduct"),
                ("Batch Code", "finishedBatchCode"), ("Pallet", "palletLabel"),
                ("Units Produced", "unitsProduced"), ("Line", "lineNumber"), ("Best Before", "bestBeforeDate"),
            ]
            return "date_trace_finished.csv", "Finished Product Date Trace report", _csv_bytes(rows, columns)
        rows = [row for row in raw if _between(row.get("intakeDate"), request.date_from, request.date_to)]
        columns = [
            ("Intake Date", "intakeDate"), ("Material", "materialName"),
            ("Sweetdreams Batch", "sweetdreamsBatchCode"), ("Pallet", "palletNumber"),
            ("Supplier", "supplierName"), ("Item Type", "itemType"), ("Total Weight KG", "totalWeightKg"),
        ]
        return "date_trace_raw.csv", "Raw Material Date Trace report", _csv_bytes(rows, columns)

    raise HTTPException(status_code=400, detail="Unknown traceability report type")


@router.post("/reports/audit-runs/{run_id}/email")
async def email_audit_report(
    run_id: str,
    request: ReportEmailRequest,
    user: dict = Depends(legacy.require_feature("audits")),
):
    run = await _get_accessible_audit_run(run_id, user)
    response = await legacy.export_audit_pdf(run_id, user)
    content = await _streaming_response_bytes(response)
    filename = _response_filename(response, f"audit_report_{run_id[:8]}.pdf")
    audit_name = run.get("audit_name") or "Audit"
    return await _deliver_attachment(
        request=request, user=user, subject=f"Infinit Audit report: {audit_name}",
        item_name=f"the audit report for {audit_name}",
        attachment=EmailAttachment(filename, content, "application", "pdf"), template="audit_report_attachment",
    )


@router.post("/reports/actions/{action_id}/email")
async def email_action_report(
    action_id: str,
    request: ReportEmailRequest,
    user: dict = Depends(legacy.require_feature("actions")),
):
    response = await legacy.export_corrective_action_pdf(action_id, user)
    content = await _streaming_response_bytes(response)
    filename = _response_filename(response, f"action_report_{action_id[:8]}.pdf")
    action = await legacy.db.corrective_actions.find_one({"id": action_id}, {"_id": 0})
    audit_name = (action or {}).get("audit_name") or "Audit"
    return await _deliver_attachment(
        request=request, user=user, subject=f"Infinit Audit corrective action: {audit_name}",
        item_name="a corrective action report", attachment=EmailAttachment(filename, content, "application", "pdf"),
        template="action_report_attachment",
    )


# Keep the static /batch route before /{document_id}; FastAPI resolves matching
# routes in declaration order.
@router.post("/reports/documents/batch/email")
async def email_document_batch(
    request: BatchDocumentEmailRequest,
    user: dict = Depends(legacy.require_feature("documents")),
):
    for document_id in request.document_ids:
        await _get_accessible_document(document_id, user, completed=True)
    response = await legacy.batch_export_traceability_pdf({"document_ids": request.document_ids}, user)
    content = await _streaming_response_bytes(response)
    filename = _response_filename(response, "batch_documents.pdf")
    return await _deliver_attachment(
        request=request, user=user, subject="Infinit Audit documents",
        item_name=f"{len(request.document_ids)} Infinit Audit document(s)",
        attachment=EmailAttachment(filename, content, "application", "pdf"), template="document_batch_attachment",
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
        request=request, user=user, subject=f"Infinit Audit document: {title}", item_name=title,
        attachment=EmailAttachment(filename, content, "application", "pdf"), template="document_attachment",
    )


@router.post("/reports/traceability/email")
async def email_traceability_export(
    request: TraceabilityEmailRequest,
    user: dict = Depends(legacy.require_feature("traceability")),
):
    export_data = legacy.TraceabilityBulkExport(data_types=request.data_types, date_from=request.date_from, date_to=request.date_to)
    response = await legacy.export_traceability_excel(export_data, user)
    content = await _streaming_response_bytes(response)
    filename = _response_filename(response, "traceability_export.xlsx")
    return await _deliver_attachment(
        request=request, user=user, subject="Infinit Audit traceability export", item_name="a traceability Excel export",
        attachment=EmailAttachment(filename, content, "application", "vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        template="traceability_export_attachment",
    )


@router.post("/reports/traceability/csv/email")
async def email_traceability_csv_report(
    request: TraceabilityCsvEmailRequest,
    user: dict = Depends(legacy.require_feature("traceability")),
):
    filename, item_name, content = await _build_traceability_csv(request, user)
    return await _deliver_attachment(
        request=request, user=user, subject=f"Infinit Audit: {item_name}", item_name=item_name,
        attachment=EmailAttachment(filename, content, "text", "csv"), template="traceability_csv_attachment",
    )
