from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

import server as legacy
from app_core.company_activity import DeletionReason, delete_with_reason
from app_core.report_email import _document_access_allowed, _get_accessible_document


router = APIRouter(prefix="/api", tags=["documents"])


def _template_access_allowed(template: dict, user: dict, *, write: bool = False) -> bool:
    if legacy.is_system_admin(user):
        return True
    company_id = template.get("company_id")
    if write:
        return company_id is not None and company_id == user.get("company_id")
    return company_id is None or company_id == user.get("company_id")


async def _get_accessible_template(template_id: str, user: dict, *, write: bool = False) -> dict:
    template = await legacy.db.traceability_templates.find_one({"id": template_id}, {"_id": 0})
    if not template or not _template_access_allowed(template, user, write=write):
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.get("/traceability/templates/{template_id}")
async def get_traceability_template(
    template_id: str,
    user: dict = Depends(legacy.require_feature("documents")),
):
    return await _get_accessible_template(template_id, user)


@router.put("/traceability/templates/{template_id}")
async def update_traceability_template(
    template_id: str,
    data: legacy.TraceabilityTemplateUpdate,
    user: dict = Depends(legacy.require_role(
        [legacy.UserRole.SYSTEM_ADMIN, legacy.UserRole.COMPANY_ADMIN, legacy.UserRole.ADMIN, legacy.UserRole.AUDIT_CREATOR],
        "documents_edit",
    )),
):
    await _get_accessible_template(template_id, user, write=True)
    return await legacy.update_traceability_template(template_id, data, user)


@router.delete("/traceability/templates/{template_id}")
async def delete_traceability_template(
    template_id: str,
    user: dict = Depends(legacy.require_role(
        [legacy.UserRole.SYSTEM_ADMIN, legacy.UserRole.COMPANY_ADMIN, legacy.UserRole.ADMIN],
        "documents_edit",
    )),
):
    await _get_accessible_template(template_id, user, write=True)
    return await legacy.delete_traceability_template(template_id, user)


@router.post("/traceability/documents")
async def create_traceability_document(
    data: dict,
    user: dict = Depends(legacy.require_feature("documents")),
):
    template_id = str(data.get("template_id") or "")
    if not template_id:
        raise HTTPException(status_code=400, detail="Template is required")
    await _get_accessible_template(template_id, user)
    return await legacy.create_traceability_document(data, user)


@router.get("/traceability/documents")
async def get_traceability_documents(
    template_id: str | None = None,
    user: dict = Depends(legacy.require_feature("documents")),
):
    query = {}
    if not legacy.is_system_admin(user):
        query["company_id"] = user.get("company_id")
    if user.get("role") == legacy.UserRole.USER:
        query["completed_by"] = user["id"]
    if template_id:
        await _get_accessible_template(template_id, user)
        query["template_id"] = template_id
    return await legacy.db.traceability_documents.find(
        query, {"_id": 0}
    ).sort("created_at", -1).to_list(1000)


@router.get("/traceability/documents/{doc_id}")
async def get_traceability_document(
    doc_id: str,
    user: dict = Depends(legacy.require_feature("documents")),
):
    return await _get_accessible_document(doc_id, user)


@router.put("/traceability/documents/{doc_id}")
async def update_traceability_document(
    doc_id: str,
    data: legacy.TraceabilityDocumentSubmit,
    user: dict = Depends(legacy.require_feature("documents")),
):
    document = await _get_accessible_document(doc_id, user)
    if document.get("completed"):
        raise HTTPException(status_code=409, detail="Completed documents cannot be edited")
    return await legacy.update_traceability_document(doc_id, data, user)


@router.get("/traceability/documents/{doc_id}/pdf")
async def export_traceability_document_pdf(
    doc_id: str,
    user: dict = Depends(legacy.require_feature("documents")),
):
    await _get_accessible_document(doc_id, user)
    return await legacy.export_traceability_document_pdf(doc_id, user)


@router.post("/traceability/documents/batch-pdf")
async def batch_export_traceability_pdf(
    data: dict,
    user: dict = Depends(legacy.require_feature("documents")),
):
    document_ids = data.get("document_ids") or []
    if not isinstance(document_ids, list) or not document_ids:
        raise HTTPException(status_code=400, detail="Select at least one document")
    if len(document_ids) > 100:
        raise HTTPException(status_code=400, detail="A maximum of 100 documents can be exported at once")
    for document_id in document_ids:
        await _get_accessible_document(str(document_id), user, completed=True)
    return await legacy.batch_export_traceability_pdf({"document_ids": document_ids}, user)


@router.delete("/traceability/documents/{doc_id}")
async def delete_traceability_document(
    doc_id: str, data: DeletionReason,
    user: dict = Depends(legacy.require_feature("documents")),
):
    document = await legacy.db.traceability_documents.find_one({"id": doc_id})
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return await delete_with_reason(legacy.db.traceability_documents, document, data, user)
