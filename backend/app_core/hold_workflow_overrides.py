from __future__ import annotations

import math
import uuid

from fastapi import APIRouter, Depends, Query, Response

import server as legacy
from app_core.hold_disposal import (
    HoldDisposalCreate,
    NoticeCreate,
    _create_notice,
    _get_notice,
    _notice_payload,
)
from app_core.disposal_routes import resolve_disposal_route


router = APIRouter(prefix="/api/hold-disposal", tags=["hold-disposal-workflow"])


@router.get("/hold-notices")
async def list_hold_notices_paginated(
    response: Response,
    page: int | None = Query(default=None, ge=1),
    page_size: int | None = Query(default=None, ge=1, le=100),
    user: dict = Depends(legacy.get_current_user),
):
    """Return a small hold page when requested, while preserving the legacy full-list contract."""
    query = {} if legacy.is_system_admin(user) else {"company_id": user.get("company_id")}
    collection = legacy.db.hold_notices

    if page is None or page_size is None:
        records = await collection.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
        response.headers["X-Total-Count"] = str(len(records))
        response.headers["X-Total-Pages"] = "1"
        response.headers["X-Page"] = "1"
        return [_notice_payload(record) for record in records]

    total = await collection.count_documents(query)
    total_pages = max(1, math.ceil(total / page_size))
    safe_page = min(page, total_pages)
    records = await (
        collection.find(query, {"_id": 0})
        .sort("created_at", -1)
        .skip((safe_page - 1) * page_size)
        .limit(page_size)
        .to_list(page_size)
    )
    response.headers["X-Total-Count"] = str(total)
    response.headers["X-Total-Pages"] = str(total_pages)
    response.headers["X-Page"] = str(safe_page)
    response.headers["X-Page-Size"] = str(page_size)
    return [_notice_payload(record) for record in records]


@router.post("/hold-notices/{notice_id}/disposal")
async def dispose_hold_and_record_outcome(
    notice_id: str,
    data: HoldDisposalCreate,
    user: dict = Depends(legacy.require_feature("traceability_edit")),
):
    """Create the linked disposal and automatically update the hold outcome/CAPA state."""
    hold = await _get_notice("hold", notice_id, user)
    copied = NoticeCreate(
        **{key: hold[key] for key in ("rm_number", "ingredient_name", "line_area")},
        **{key: hold.get(key) or "" for key in ("our_batch", "vendor_batch", "quantity_delivered")},
        date_delivered=hold.get("date_delivered"),
        quantity=data.quantity or hold.get("quantity_discarded") or hold["quantity"],
        **data.model_dump(exclude={"disposal_route", "quantity"}),
    )
    disposal = await _create_notice(
        copied,
        user,
        notice_type="disposal",
        disposal_route=data.disposal_route,
        source_hold=hold,
    )

    route = await resolve_disposal_route(hold.get("company_id"), data.disposal_route)
    route_label = (route or {}).get("name") or disposal.get("disposal_route_label") or data.disposal_route
    quantity_disposed = disposal.get("quantity") or copied.quantity
    now = legacy.get_uk_time_iso()
    version = hold.get("outcome_version", 0)
    history = list(hold.get("outcome_history") or [])
    changes = {
        "quantity_discarded": {"before": hold.get("quantity_discarded") or "", "after": quantity_disposed},
        "disposal_outcome": {"before": hold.get("disposal_outcome") or "", "after": f"Product disposed to {route_label}"},
        "capa_required": {"before": bool(hold.get("capa_required")), "after": True},
    }
    history.append({
        "id": str(uuid.uuid4()),
        "updated_at": now,
        "updated_by_id": user.get("id"),
        "updated_by_name": user.get("name"),
        "source": "disposal_notice",
        "changes": changes,
    })
    await legacy.db.hold_notices.update_one(
        {"id": notice_id},
        {"$set": {
            "quantity_discarded": quantity_disposed,
            "disposal_outcome": f"Product disposed to {route_label}",
            "disposal_route": disposal.get("disposal_route"),
            "disposal_route_label": route_label,
            "linked_disposal_id": disposal.get("id"),
            "capa_required": True,
            "corrective_action": "",
            "preventative_action": "",
            "outcome_version": version + 1,
            "outcome_history": history,
            "outcome_updated_at": now,
            "outcome_updated_by_name": user.get("name"),
            "outcome_updated_by_id": user.get("id"),
        }},
    )
    return disposal
