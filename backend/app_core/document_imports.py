from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import logging
import os
import re
import uuid
from datetime import date, datetime, time
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

import server as legacy
from app_core.documents import _get_accessible_template
from date_formats import parse_date


router = APIRouter(prefix="/api/document-imports", tags=["document-imports"])
logger = logging.getLogger(__name__)

MAX_FILES = 20
MAX_FILE_SIZE = 10 * 1024 * 1024
MAX_BATCH_SIZE = 50 * 1024 * 1024
ALLOWED_TYPES = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
LOW_CONFIDENCE = 0.85


def _company_id(template: dict, user: dict) -> Optional[str]:
    return template.get("company_id") or user.get("company_id")


def _can_access(record: dict, user: dict) -> bool:
    return legacy.is_system_admin(user) or record.get("company_id") == user.get("company_id")


def _clean_filename(value: str) -> str:
    name = re.sub(r"[^A-Za-z0-9._ -]+", "_", value or "scan").strip(" .")
    return name[:180] or "scan"


def _detect_content_type(content: bytes) -> Optional[str]:
    if content.startswith(b"%PDF-"):
        return "application/pdf"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    return None


def _s3_client():
    bucket = os.environ.get("PAPERWORK_STORAGE_BUCKET", "").strip()
    if not bucket:
        return None, None
    try:
        import boto3
        from botocore.config import Config as BotoConfig
    except ImportError:
        logger.error("PAPERWORK_STORAGE_BUCKET is set but boto3 is unavailable")
        return None, None
    options = {
        "service_name": "s3",
        "region_name": os.environ.get("PAPERWORK_STORAGE_REGION", "eu-west-2"),
        "config": BotoConfig(signature_version="s3v4"),
    }
    endpoint = os.environ.get("PAPERWORK_STORAGE_ENDPOINT", "").strip()
    access_key = os.environ.get("PAPERWORK_STORAGE_ACCESS_KEY", "").strip()
    secret_key = os.environ.get("PAPERWORK_STORAGE_SECRET_KEY", "").strip()
    if endpoint:
        options["endpoint_url"] = endpoint
    if access_key and secret_key:
        options["aws_access_key_id"] = access_key
        options["aws_secret_access_key"] = secret_key
    return boto3.client(**options), bucket


async def _store_scan(item_id: str, company_id: Optional[str], filename: str, content_type: str, content: bytes) -> dict:
    client, bucket = _s3_client()
    if client and bucket:
        key = f"{company_id or 'system'}/{item_id}/{_clean_filename(filename)}"
        await asyncio.to_thread(
            client.put_object,
            Bucket=bucket,
            Key=key,
            Body=content,
            ContentType=content_type,
            ServerSideEncryption="AES256",
        )
        return {"storage_backend": "s3", "storage_key": key}
    # Safe deployment fallback. Configure object storage before high-volume use;
    # keeping the bytes in a separate collection prevents list queries loading them.
    return {
        "storage_backend": "database",
        "file_data": base64.b64encode(content).decode("ascii"),
    }


async def _read_scan(item: dict) -> bytes:
    if item.get("storage_backend") == "s3":
        client, bucket = _s3_client()
        if not client or not bucket:
            raise HTTPException(status_code=503, detail="Paperwork scan storage is not configured")
        response = await asyncio.to_thread(client.get_object, Bucket=bucket, Key=item["storage_key"])
        return await asyncio.to_thread(response["Body"].read)
    encoded = item.get("file_data")
    if not encoded:
        raise HTTPException(status_code=404, detail="Source scan is unavailable")
    return base64.b64decode(encoded)


def _value_schema(field: dict) -> dict:
    if field.get("field_type") == "checkbox":
        return {"type": ["boolean", "null"]}
    if field.get("field_type") == "number":
        return {"type": ["number", "string", "null"]}
    return {"type": ["string", "null"]}


def extraction_schema(fields: list[dict]) -> dict:
    header = [field for field in fields if field.get("section") != "table"]
    table = [field for field in fields if field.get("section") == "table"]
    header_properties = {field["id"]: _value_schema(field) for field in header}
    table_properties = {field["id"]: _value_schema(field) for field in table}
    header_confidence = {field["id"]: {"type": "number", "minimum": 0, "maximum": 1} for field in header}
    table_confidence = {field["id"]: {"type": "number", "minimum": 0, "maximum": 1} for field in table}
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "document_quality": {"type": "string", "enum": ["good", "usable", "poor"]},
            "warnings": {"type": "array", "items": {"type": "string"}},
            "header_values": {
                "type": "object", "additionalProperties": False,
                "properties": header_properties, "required": list(header_properties),
            },
            "header_confidence": {
                "type": "object", "additionalProperties": False,
                "properties": header_confidence, "required": list(header_confidence),
            },
            "table_rows": {
                "type": "array",
                "items": {
                    "type": "object", "additionalProperties": False,
                    "properties": {
                        "values": {
                            "type": "object", "additionalProperties": False,
                            "properties": table_properties, "required": list(table_properties),
                        },
                        "confidence": {
                            "type": "object", "additionalProperties": False,
                            "properties": table_confidence, "required": list(table_confidence),
                        },
                    },
                    "required": ["values", "confidence"],
                },
            },
        },
        "required": ["document_quality", "warnings", "header_values", "header_confidence", "table_rows"],
    }


def _field_instructions(fields: list[dict]) -> str:
    descriptions = []
    for field in sorted(fields, key=lambda value: value.get("order", 0)):
        detail = f"{field['id']}: {field['label']} ({field.get('field_type', 'text')}, {field.get('section', 'header')})"
        if field.get("dropdown_options"):
            detail += f"; allowed values: {', '.join(field['dropdown_options'])}"
        if field.get("required"):
            detail += "; required"
        descriptions.append(detail)
    return "\n".join(descriptions)


async def _extract_with_ai(template: dict, filename: str, content_type: str, content: bytes) -> dict:
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="AI extraction is not configured yet. Add OPENAI_API_KEY or use Excel import.")
    try:
        from openai import AsyncOpenAI
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="AI extraction dependencies are not installed") from exc
    encoded = base64.b64encode(content).decode("ascii")
    if content_type == "application/pdf":
        source = {"type": "input_file", "filename": filename, "file_data": f"data:{content_type};base64,{encoded}"}
    else:
        source = {"type": "input_image", "image_url": f"data:{content_type};base64,{encoded}", "detail": "high"}
    prompt = f"""Extract this completed production-paperwork record into the supplied schema.

Template: {template.get('title')}
Document reference: {template.get('document_reference')}
Fields:
{_field_instructions(template.get('fields') or [])}

Rules:
- Copy only information visibly present on the document. Never invent a batch boundary, value, name, signature, date, time or result.
- Use null and low confidence when a value is missing, crossed out without a clear replacement, illegible or ambiguous.
- Dates must be YYYY-MM-DD and times HH:MM. Checkbox values must be true, false or null.
- For dropdowns use only an allowed value; otherwise return null and add a warning.
- Return one table_rows entry per genuinely completed table row. Do not create blank rows.
- Mention blur, glare, cropped pages, corrections, conflicting entries and missing pages in warnings.
- A visible signature may be reported as present text, but do not claim it is authentic.
"""
    client = AsyncOpenAI(api_key=api_key, timeout=90.0, max_retries=2)
    logger.info("paperwork extraction started", extra={"template_id": template.get("id"), "filename": filename})
    response = await client.responses.create(
        model=os.environ.get("OPENAI_DOCUMENT_MODEL", "gpt-4.1"),
        input=[{"role": "user", "content": [{"type": "input_text", "text": prompt}, source]}],
        text={"format": {"type": "json_schema", "name": "paperwork_extraction", "strict": True, "schema": extraction_schema(template.get("fields") or [])}},
        max_output_tokens=8000,
    )
    try:
        result = json.loads(response.output_text)
    except (TypeError, json.JSONDecodeError) as exc:
        logger.exception("paperwork extraction returned invalid JSON")
        raise HTTPException(status_code=502, detail="AI extraction returned an unreadable result. Please retry.") from exc
    logger.info("paperwork extraction completed", extra={"template_id": template.get("id"), "filename": filename})
    return result


def _normalise_value(field: dict, value: Any, warnings: list[str]) -> Any:
    if value is None:
        return ""
    field_type = field.get("field_type")
    if field_type == "checkbox":
        return bool(value)
    if field_type == "date":
        try:
            return parse_date(value).isoformat()
        except (TypeError, ValueError):
            warnings.append(f"{field['label']}: date could not be validated")
            return ""
    if field_type == "time":
        match = re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", str(value).strip())
        if not match:
            warnings.append(f"{field['label']}: time could not be validated")
            return ""
        return match.group(0)
    if field_type == "dropdown":
        text = str(value).strip()
        options = field.get("dropdown_options") or []
        match = next((option for option in options if option.casefold() == text.casefold()), None)
        if match is None:
            warnings.append(f"{field['label']}: value did not match an allowed option")
            return ""
        return match
    return str(value).strip()


def normalise_extraction(template: dict, extracted: dict) -> dict:
    fields = template.get("fields") or []
    header_fields = [field for field in fields if field.get("section") != "table"]
    table_fields = [field for field in fields if field.get("section") == "table"]
    warnings = [str(value).strip() for value in extracted.get("warnings", []) if str(value).strip()]
    header_values = extracted.get("header_values") or {}
    header_confidence = extracted.get("header_confidence") or {}
    field_values = []
    review_flags = []
    confidence = {}
    for field in header_fields:
        value = _normalise_value(field, header_values.get(field["id"]), warnings)
        score = max(0.0, min(1.0, float(header_confidence.get(field["id"], 0))))
        confidence[field["id"]] = score
        field_values.append({"field_id": field["id"], "value": value})
        if score < LOW_CONFIDENCE or (field.get("required") and value in ("", None, False)):
            review_flags.append({"field_id": field["id"], "label": field["label"], "confidence": score})
    table_rows = []
    table_confidence = []
    for row_number, row in enumerate(extracted.get("table_rows") or [], start=1):
        values = {}
        scores = {}
        for field in table_fields:
            value = _normalise_value(field, (row.get("values") or {}).get(field["id"]), warnings)
            score = max(0.0, min(1.0, float((row.get("confidence") or {}).get(field["id"], 0))))
            values[field["id"]] = value
            scores[field["id"]] = score
            if score < LOW_CONFIDENCE or (field.get("required") and value in ("", None, False)):
                review_flags.append({"field_id": field["id"], "label": f"Row {row_number}: {field['label']}", "confidence": score})
        if any(value not in ("", None, False) for value in values.values()):
            table_rows.append(values)
            table_confidence.append(scores)
    return {
        "field_values": field_values,
        "table_rows": table_rows,
        "extraction_confidence": {"header": confidence, "table_rows": table_confidence},
        "review_flags": review_flags,
        "warnings": list(dict.fromkeys(warnings)),
        "document_quality": extracted.get("document_quality") or "poor",
    }


async def _create_imported_draft(template: dict, user: dict, values: dict, source: dict) -> dict:
    now = legacy.get_uk_time_iso()
    document = {
        "id": str(uuid.uuid4()),
        "template_id": template["id"],
        "template_title": template["title"],
        "document_reference": template["document_reference"],
        "version": template["version"],
        "authorised_by": template.get("authorised_by"),
        "fields": template.get("fields") or [],
        "completed_by": user["id"],
        "completed_by_name": user["name"],
        "field_values": values.get("field_values") or [],
        "company_id": _company_id(template, user),
        "completed": False,
        "created_at": now,
        "completed_at": None,
        "table_rows": values.get("table_rows") or [],
        "imported_draft": True,
        "imported_by": user["id"],
        "imported_by_name": user["name"],
        "imported_at": now,
        "import_source": source,
        "extraction_confidence": values.get("extraction_confidence"),
        "import_review_flags": values.get("review_flags") or [],
        "import_warnings": values.get("warnings") or [],
        "document_quality": values.get("document_quality"),
    }
    await legacy.db.traceability_documents.insert_one(document)
    return {key: value for key, value in document.items() if key != "_id"}


async def _get_item(item_id: str, user: dict, *, include_file: bool = False) -> dict:
    projection = {"_id": 0} if include_file else {"_id": 0, "file_data": 0}
    item = await legacy.db.document_import_items.find_one({"id": item_id}, projection)
    if not item or not _can_access(item, user):
        raise HTTPException(status_code=404, detail="Imported paperwork not found")
    return item


@router.get("/config")
async def import_config(user: dict = Depends(legacy.require_feature("documents"))):
    client, bucket = _s3_client()
    return {
        "ai_enabled": bool(os.environ.get("OPENAI_API_KEY", "").strip()),
        "storage_backend": "s3" if client and bucket else "database",
        "max_files": MAX_FILES,
        "max_file_size_mb": MAX_FILE_SIZE // (1024 * 1024),
        "max_batch_size_mb": MAX_BATCH_SIZE // (1024 * 1024),
        "accepted_types": list(ALLOWED_TYPES),
    }


@router.post("/scans")
async def upload_scans(
    template_id: str = Form(...),
    files: list[UploadFile] = File(...),
    user: dict = Depends(legacy.require_feature("documents")),
):
    template = await _get_accessible_template(template_id, user)
    if not files or len(files) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"Upload between 1 and {MAX_FILES} files")
    payloads = []
    total = 0
    for upload in files:
        content = await upload.read(MAX_FILE_SIZE + 1)
        if not content:
            raise HTTPException(status_code=400, detail=f"{upload.filename}: file is empty")
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=413, detail=f"{upload.filename}: file must be {MAX_FILE_SIZE // (1024 * 1024)} MB or smaller")
        content_type = _detect_content_type(content)
        if content_type not in ALLOWED_TYPES:
            raise HTTPException(status_code=400, detail=f"{upload.filename}: upload a genuine PDF, JPG, PNG or WebP file")
        total += len(content)
        if total > MAX_BATCH_SIZE:
            raise HTTPException(status_code=413, detail=f"The upload batch must be {MAX_BATCH_SIZE // (1024 * 1024)} MB or smaller")
        payloads.append((upload.filename or "scan", content_type, content))

    batch_id = str(uuid.uuid4())
    company_id = _company_id(template, user)
    now = legacy.get_uk_time_iso()
    items = []
    for filename, content_type, content in payloads:
        checksum = hashlib.sha256(content).hexdigest()
        existing = await legacy.db.document_import_items.find_one({"company_id": company_id, "content_sha256": checksum}, {"_id": 0, "file_data": 0})
        item_id = str(uuid.uuid4())
        if existing:
            item = {
                "id": item_id, "batch_id": batch_id, "template_id": template_id,
                "company_id": company_id, "filename": _clean_filename(filename),
                "content_type": content_type, "size": len(content), "content_sha256": checksum,
                "status": "duplicate", "duplicate_of": existing.get("id"),
                "uploaded_by": user["id"], "uploaded_by_name": user["name"], "uploaded_at": now,
            }
        else:
            storage = await _store_scan(item_id, company_id, filename, content_type, content)
            item = {
                "id": item_id, "batch_id": batch_id, "template_id": template_id,
                "company_id": company_id, "filename": _clean_filename(filename),
                "content_type": content_type, "size": len(content), "content_sha256": checksum,
                "status": "uploaded", "uploaded_by": user["id"],
                "uploaded_by_name": user["name"], "uploaded_at": now, **storage,
            }
        await legacy.db.document_import_items.insert_one(item)
        items.append({key: value for key, value in item.items() if key not in {"_id", "file_data"}})
    await legacy.db.document_import_batches.insert_one({
        "id": batch_id, "template_id": template_id, "template_title": template["title"],
        "company_id": company_id, "source": "scan", "item_count": len(items),
        "created_by": user["id"], "created_by_name": user["name"], "created_at": now,
    })
    return {"id": batch_id, "template_id": template_id, "template_title": template["title"], "items": items}


@router.post("/items/{item_id}/extract")
async def extract_scan(item_id: str, user: dict = Depends(legacy.require_feature("documents"))):
    item = await _get_item(item_id, user, include_file=True)
    if item.get("status") == "duplicate":
        raise HTTPException(status_code=409, detail="This scan has already been uploaded")
    if item.get("draft_document_id"):
        return await _get_item(item_id, user)
    template = await _get_accessible_template(item["template_id"], user)
    claimed = await legacy.db.document_import_items.update_one(
        {"id": item_id, "status": {"$in": ["uploaded", "failed"]}},
        {"$set": {"status": "extracting", "error": None}},
    )
    if not getattr(claimed, "modified_count", 0):
        current = await _get_item(item_id, user)
        if current.get("draft_document_id"):
            return current
        raise HTTPException(status_code=409, detail="This scan is already being processed")
    try:
        content = await _read_scan(item)
        extracted = await _extract_with_ai(template, item["filename"], item["content_type"], content)
        values = normalise_extraction(template, extracted)
        draft = await _create_imported_draft(template, user, values, {
            "type": "scan", "import_item_id": item_id, "filename": item["filename"],
            "content_sha256": item["content_sha256"],
        })
        update = {
            "status": "review_ready", "draft_document_id": draft["id"],
            "document_quality": values["document_quality"],
            "review_flags": values["review_flags"], "warnings": values["warnings"],
            "extracted_at": legacy.get_uk_time_iso(), "error": None,
        }
        await legacy.db.document_import_items.update_one({"id": item_id}, {"$set": update})
        return {**{key: value for key, value in item.items() if key not in {"_id", "file_data"}}, **update}
    except HTTPException as exc:
        await legacy.db.document_import_items.update_one({"id": item_id}, {"$set": {"status": "failed", "error": str(exc.detail)}})
        raise
    except Exception as exc:
        logger.exception("paperwork extraction failed", extra={"item_id": item_id})
        await legacy.db.document_import_items.update_one({"id": item_id}, {"$set": {"status": "failed", "error": "Extraction failed"}})
        raise HTTPException(status_code=502, detail="AI extraction failed. The scan remains saved and can be retried.") from exc


@router.get("/items/{item_id}/scan")
async def view_scan(item_id: str, user: dict = Depends(legacy.require_feature("documents"))):
    item = await _get_item(item_id, user, include_file=True)
    content = await _read_scan(item)
    return StreamingResponse(
        io.BytesIO(content), media_type=item["content_type"],
        headers={"Content-Disposition": f'inline; filename="{_clean_filename(item["filename"])}"', "Cache-Control": "private, max-age=300"},
    )


@router.get("")
async def list_import_batches(user: dict = Depends(legacy.require_feature("documents"))):
    query = {} if legacy.is_system_admin(user) else {"company_id": user.get("company_id")}
    batches = await legacy.db.document_import_batches.find(query, {"_id": 0}).sort("created_at", -1).to_list(50)
    for batch in batches:
        batch["items"] = await legacy.db.document_import_items.find({"batch_id": batch["id"]}, {"_id": 0, "file_data": 0}).sort("uploaded_at", 1).to_list(MAX_FILES)
    return batches


def _excel_value(value: Any, field: dict) -> Any:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat() if field.get("field_type") == "date" else value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, time):
        return value.strftime("%H:%M")
    if field.get("field_type") == "checkbox":
        return str(value).strip().casefold() in {"yes", "true", "1", "x", "checked"}
    return value


def _validated_excel_value(value: Any, field: dict, location: str) -> Any:
    value = _excel_value(value, field)
    if value in (None, ""):
        return ""
    field_type = field.get("field_type")
    try:
        if field_type == "date":
            return parse_date(value).isoformat()
        if field_type == "time":
            text = value.strftime("%H:%M") if isinstance(value, time) else str(value).strip()
            if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", text):
                raise ValueError
            return text
        if field_type == "number":
            numeric = float(value)
            return int(numeric) if numeric.is_integer() else numeric
        if field_type == "dropdown":
            text = str(value).strip()
            match = next((option for option in field.get("dropdown_options") or [] if option.casefold() == text.casefold()), None)
            if match is None:
                raise ValueError
            return match
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{location}: {field['label']} has an invalid {field_type} value") from exc
    return value


def build_import_workbook(template: dict) -> bytes:
    workbook = Workbook()
    instructions = workbook.active
    instructions.title = "Instructions"
    instructions.sheet_view.showGridLines = False
    instructions["A1"] = "Infinit Audit - Production Paperwork Bulk Import"
    instructions["A1"].font = Font(size=18, bold=True, color="FFFFFF")
    instructions["A1"].fill = PatternFill("solid", fgColor="145B52")
    instructions.merge_cells("A1:F1")
    instructions["A3"] = f"Template: {template['title']}"
    instructions["A4"] = f"Document reference: {template['document_reference']} | Version {template['version']}"
    instructions["A6"] = "1. Enter one paperwork record per row on the Documents sheet."
    instructions["A7"] = "2. Give every record a unique Import ID such as DOC-001."
    instructions["A8"] = "3. If the form has a table, add its rows on Table Rows using the same Import ID."
    instructions["A9"] = "4. Upload this workbook in Infinit Audit. Every record will be created as an unpublished draft."
    instructions["A10"] = "5. Review each draft on screen and press Complete Document only when verified."
    instructions.column_dimensions["A"].width = 110

    metadata = workbook.create_sheet("_Infinit")
    metadata["A1"], metadata["B1"] = "template_id", template["id"]
    metadata["A2"], metadata["B2"] = "template_version", template["version"]
    metadata.sheet_state = "hidden"

    header_fields = sorted([field for field in template.get("fields", []) if field.get("section") != "table"], key=lambda field: field.get("order", 0))
    table_fields = sorted([field for field in template.get("fields", []) if field.get("section") == "table"], key=lambda field: field.get("order", 0))
    documents = workbook.create_sheet("Documents")
    _prepare_import_sheet(documents, [{"id": "__import_id", "label": "Import ID", "required": True}, *header_fields])
    if table_fields:
        rows = workbook.create_sheet("Table Rows")
        _prepare_import_sheet(rows, [
            {"id": "__import_id", "label": "Import ID", "required": True},
            {"id": "__row_number", "label": "Row Number", "field_type": "number", "required": True},
            *table_fields,
        ])
    stream = io.BytesIO()
    workbook.save(stream)
    return stream.getvalue()


def _prepare_import_sheet(sheet, fields: list[dict]) -> None:
    sheet.sheet_view.showGridLines = False
    sheet.freeze_panes = "A3"
    sheet.auto_filter.ref = f"A1:{get_column_letter(len(fields))}501"
    for column, field in enumerate(fields, start=1):
        cell = sheet.cell(1, column, f"{field['label']}{' *' if field.get('required') else ''}")
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="2563EB")
        cell.alignment = Alignment(wrap_text=True)
        sheet.cell(2, column, field["id"])
        sheet.column_dimensions[get_column_letter(column)].width = min(40, max(16, len(field["label"]) + 4))
        if field.get("field_type") in {"dropdown", "checkbox"}:
            options = field.get("dropdown_options") or (["Yes", "No"] if field.get("field_type") == "checkbox" else [])
            if options:
                escaped = ",".join(str(option).replace('"', '""') for option in options)
                # Excel limits inline list-validation formulas to 255 characters.
                if len(escaped) <= 250:
                    validation = DataValidation(type="list", formula1=f'"{escaped}"', allow_blank=not field.get("required"))
                    validation.error = "Choose a value from the list"
                    validation.errorTitle = "Invalid value"
                    sheet.add_data_validation(validation)
                    validation.add(f"{get_column_letter(column)}3:{get_column_letter(column)}501")
        if field.get("field_type") == "date":
            for row in range(3, 502):
                sheet.cell(row, column).number_format = "dd/mm/yyyy"
        if field.get("field_type") == "time":
            for row in range(3, 502):
                sheet.cell(row, column).number_format = "hh:mm"
    sheet.row_dimensions[2].hidden = True


def parse_import_workbook(content: bytes, template: dict) -> list[dict]:
    try:
        workbook = load_workbook(io.BytesIO(content), data_only=True, read_only=False)
    except Exception as exc:
        raise ValueError("The file is not a readable Excel workbook") from exc
    if "_Infinit" not in workbook.sheetnames or "Documents" not in workbook.sheetnames:
        raise ValueError("Use the workbook downloaded for this paperwork template")
    metadata = workbook["_Infinit"]
    if str(metadata["B1"].value or "") != template["id"]:
        raise ValueError("This workbook belongs to a different paperwork template")
    if int(metadata["B2"].value or 0) != int(template["version"]):
        raise ValueError("The paperwork template has changed. Download a fresh import workbook")
    fields_by_id = {field["id"]: field for field in template.get("fields") or []}
    documents = workbook["Documents"]
    field_ids = [documents.cell(2, column).value for column in range(1, documents.max_column + 1)]
    parsed = {}
    for row_number in range(3, documents.max_row + 1):
        values = [documents.cell(row_number, column).value for column in range(1, documents.max_column + 1)]
        if not any(value not in (None, "") for value in values):
            continue
        import_id = str(values[0] or "").strip()
        if not import_id:
            raise ValueError(f"Documents row {row_number}: Import ID is required")
        if import_id in parsed:
            raise ValueError(f"Documents row {row_number}: Import ID {import_id} is duplicated")
        field_values = []
        for field_id, value in zip(field_ids[1:], values[1:]):
            if field_id not in fields_by_id:
                raise ValueError("The workbook field mapping is invalid. Download a fresh copy")
            field_values.append({
                "field_id": field_id,
                "value": _validated_excel_value(value, fields_by_id[field_id], f"Documents row {row_number}"),
            })
        parsed[import_id] = {"import_id": import_id, "field_values": field_values, "table_rows": []}
    if not parsed:
        raise ValueError("The Documents sheet contains no records")

    if "Table Rows" in workbook.sheetnames:
        rows = workbook["Table Rows"]
        row_field_ids = [rows.cell(2, column).value for column in range(1, rows.max_column + 1)]
        ordered_rows: dict[str, list[tuple[int, dict]]] = {import_id: [] for import_id in parsed}
        for row_number in range(3, rows.max_row + 1):
            values = [rows.cell(row_number, column).value for column in range(1, rows.max_column + 1)]
            if not any(value not in (None, "") for value in values):
                continue
            import_id = str(values[0] or "").strip()
            if import_id not in parsed:
                raise ValueError(f"Table Rows row {row_number}: Import ID {import_id or '(blank)'} is not on Documents")
            try:
                sequence = int(values[1])
                if sequence < 1:
                    raise ValueError
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Table Rows row {row_number}: Row Number must be a positive whole number") from exc
            record = {}
            for field_id, value in zip(row_field_ids[2:], values[2:]):
                if field_id not in fields_by_id:
                    raise ValueError("The workbook table mapping is invalid. Download a fresh copy")
                record[field_id] = _validated_excel_value(value, fields_by_id[field_id], f"Table Rows row {row_number}")
            if any(value not in (None, "", False) for value in record.values()):
                ordered_rows[import_id].append((sequence, record))
        for import_id, records in ordered_rows.items():
            sequence_numbers = [sequence for sequence, _ in records]
            if len(sequence_numbers) != len(set(sequence_numbers)):
                raise ValueError(f"Table Rows: Row Number is duplicated for Import ID {import_id}")
            parsed[import_id]["table_rows"] = [record for _, record in sorted(records, key=lambda entry: entry[0])]
    return list(parsed.values())


@router.get("/templates/{template_id}/workbook")
async def download_import_workbook(template_id: str, user: dict = Depends(legacy.require_feature("documents"))):
    template = await _get_accessible_template(template_id, user)
    content = build_import_workbook(template)
    filename = f"{re.sub(r'[^A-Za-z0-9_-]+', '_', template['document_reference']).strip('_') or 'paperwork'}_bulk_import.xlsx"
    return StreamingResponse(
        io.BytesIO(content), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/excel")
async def import_excel_drafts(
    template_id: str = Form(...), file: UploadFile = File(...),
    user: dict = Depends(legacy.require_feature("documents")),
):
    template = await _get_accessible_template(template_id, user)
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Upload an .xlsx workbook")
    content = await file.read(5 * 1024 * 1024 + 1)
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Workbook must be 5 MB or smaller")
    try:
        records = parse_import_workbook(content, template)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if len(records) > 200:
        raise HTTPException(status_code=400, detail="A workbook can contain a maximum of 200 paperwork records")
    batch_id = str(uuid.uuid4())
    company_id = _company_id(template, user)
    now = legacy.get_uk_time_iso()
    items = []
    for record in records:
        values = {"field_values": record["field_values"], "table_rows": record["table_rows"], "warnings": [], "review_flags": [], "document_quality": "not_applicable"}
        draft = await _create_imported_draft(template, user, values, {"type": "excel", "batch_id": batch_id, "import_id": record["import_id"], "filename": _clean_filename(file.filename)})
        item = {
            "id": str(uuid.uuid4()), "batch_id": batch_id, "template_id": template_id,
            "company_id": company_id, "filename": _clean_filename(file.filename),
            "import_id": record["import_id"], "status": "review_ready",
            "draft_document_id": draft["id"], "uploaded_by": user["id"],
            "uploaded_by_name": user["name"], "uploaded_at": now,
        }
        await legacy.db.document_import_items.insert_one(item)
        items.append(item)
    await legacy.db.document_import_batches.insert_one({
        "id": batch_id, "template_id": template_id, "template_title": template["title"],
        "company_id": company_id, "source": "excel", "item_count": len(items),
        "created_by": user["id"], "created_by_name": user["name"], "created_at": now,
    })
    return {"id": batch_id, "template_id": template_id, "template_title": template["title"], "items": items}
