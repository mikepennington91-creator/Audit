from __future__ import annotations

import json
import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

import server as legacy


router = APIRouter(prefix="/api/hold-disposal", tags=["hold-disposal"])

# Kept as a compatibility map for older records/tests. New notices resolve their
# route from the company-scoped disposal_routes collection.
DISPOSAL_ROUTES = {
    "sugarich": "SugaRich",
    "general_waste": "General Waste",
    "recycling": "Recycling",
    "return_to_supplier": "Return to Supplier",
}

DEFAULT_DISPOSAL_ROUTE_CONFIG = [
    {"key": "sugarich", "name": "SugaRich", "color_hex": "#FACC15"},
    {"key": "return_to_supplier", "name": "Return to Supplier", "color_hex": "#16A34A"},
    {"key": "general_waste", "name": "General Waste", "color_hex": "#DC2626"},
    {"key": "recycling", "name": "Recycling", "color_hex": "#7E22CE"},
]

HEX_COLOUR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")


class DisposalRouteCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    color_hex: str = Field(min_length=7, max_length=7)
    company_id: Optional[str] = None

    @field_validator("color_hex")
    @classmethod
    def validate_colour(cls, value: str) -> str:
        value = value.strip().upper()
        if not HEX_COLOUR_RE.fullmatch(value):
            raise ValueError("Colour must be a six-digit hex value such as #DC2626")
        return value


class DisposalRouteUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    color_hex: str = Field(min_length=7, max_length=7)

    @field_validator("color_hex")
    @classmethod
    def validate_colour(cls, value: str) -> str:
        value = value.strip().upper()
        if not HEX_COLOUR_RE.fullmatch(value):
            raise ValueError("Colour must be a six-digit hex value such as #DC2626")
        return value


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")
    return slug or f"route_{uuid.uuid4().hex[:8]}"


def text_colour_for_background(color_hex: str) -> str:
    """Return readable black/white text for a configured disposal colour."""
    value = color_hex.lstrip("#")
    red, green, blue = int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)
    luminance = (0.299 * red) + (0.587 * green) + (0.114 * blue)
    return "#000000" if luminance >= 155 else "#FFFFFF"


def default_route_style(key: Optional[str]) -> dict:
    for route in DEFAULT_DISPOSAL_ROUTE_CONFIG:
        if route["key"] == key:
            return {
                "key": route["key"],
                "name": route["name"],
                "color_hex": route["color_hex"],
                "text_color": text_colour_for_background(route["color_hex"]),
            }
    return {
        "key": key or "disposal",
        "name": DISPOSAL_ROUTES.get(key or "", "Disposal"),
        "color_hex": "#0EA5E9",
        "text_color": "#000000",
    }


def _company_scope(user: dict, requested_company_id: Optional[str] = None) -> Optional[str]:
    if legacy.is_system_admin(user):
        return requested_company_id or user.get("company_id")
    if not user.get("company_id"):
        raise HTTPException(status_code=400, detail="Your account must be assigned to a company")
    return user["company_id"]


async def _validate_company(company_id: Optional[str]) -> None:
    if company_id and not await legacy.db.companies.find_one({"id": company_id}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Company not found")


async def ensure_default_disposal_routes(company_id: Optional[str]) -> list[dict]:
    if not company_id:
        return []
    existing = await legacy.db.disposal_routes.find({"company_id": company_id}, {"_id": 0}).to_list(1000)
    existing_keys = {record["key"] for record in existing}

    now = legacy.get_uk_time_iso()
    for route in DEFAULT_DISPOSAL_ROUTE_CONFIG:
        # Preserve routes created with random IDs by earlier releases, including
        # admin edits. Complete partial initialisation instead of stopping as
        # soon as any route is present.
        if route["key"] in existing_keys:
            continue
        record = {
            "id": str(uuid.uuid5(
                uuid.NAMESPACE_URL,
                json.dumps(["infinit-audit/disposal-route", company_id, route["key"]]),
            )),
            "company_id": company_id,
            "key": route["key"],
            "name": route["name"],
            "color_hex": route["color_hex"],
            "text_color": text_colour_for_background(route["color_hex"]),
            "is_default": True,
            "created_at": now,
            "updated_at": now,
        }
        # Every worker derives the same company/key ID. The database primary
        # key and ON CONFLICT DO NOTHING make this insert atomic without ever
        # resetting another request's saved route name or colour.
        await legacy.db.disposal_routes.insert_one_if_absent(record)
    return await legacy.db.disposal_routes.find({"company_id": company_id}, {"_id": 0}).to_list(1000)


async def resolve_disposal_route(company_id: Optional[str], key: str) -> Optional[dict]:
    if company_id:
        await ensure_default_disposal_routes(company_id)
        route = await legacy.db.disposal_routes.find_one(
            {"company_id": company_id, "key": key}, {"_id": 0}
        )
        if route:
            return route

    # Compatibility for historical/default values if a legacy company record is
    # incomplete. This still snapshots the controlled colour into the notice.
    if key in DISPOSAL_ROUTES:
        return default_route_style(key)
    return None


def route_style_from_notice(record: dict) -> dict:
    if record.get("disposal_route_color"):
        colour = record["disposal_route_color"]
        return {
            "key": record.get("disposal_route"),
            "name": record.get("disposal_route_label") or "Disposal",
            "color_hex": colour,
            "text_color": record.get("disposal_route_text_color") or text_colour_for_background(colour),
        }
    return default_route_style(record.get("disposal_route"))


@router.get("/disposal-routes")
async def list_disposal_routes(
    company_id: Optional[str] = Query(default=None),
    user: dict = Depends(legacy.require_feature("traceability")),
):
    if legacy.is_system_admin(user):
        if company_id:
            await _validate_company(company_id)
            await ensure_default_disposal_routes(company_id)
            query = {"company_id": company_id}
        else:
            companies = await legacy.db.companies.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
            for company in companies:
                await ensure_default_disposal_routes(company.get("id"))
            query = {}
    else:
        company_id = _company_scope(user)
        await ensure_default_disposal_routes(company_id)
        query = {"company_id": company_id}

    routes = await legacy.db.disposal_routes.find(query, {"_id": 0}).sort("name", 1).to_list(2000)
    if legacy.is_system_admin(user) and routes:
        companies = await legacy.db.companies.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(1000)
        names = {company["id"]: company.get("name") for company in companies}
        for route in routes:
            route["company_name"] = names.get(route.get("company_id"))
    return routes


@router.post("/disposal-routes")
async def create_disposal_route(
    data: DisposalRouteCreate,
    user: dict = Depends(legacy.require_role([legacy.UserRole.COMPANY_ADMIN, legacy.UserRole.ADMIN], feature="traceability")),
):
    company_id = _company_scope(user, data.company_id)
    await _validate_company(company_id)
    await ensure_default_disposal_routes(company_id)

    key = _slugify(data.name)
    existing = await legacy.db.disposal_routes.find_one({"company_id": company_id, "key": key}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="A disposal route with this name already exists")

    now = legacy.get_uk_time_iso()
    record = {
        "id": str(uuid.uuid4()),
        "company_id": company_id,
        "key": key,
        "name": data.name.strip(),
        "color_hex": data.color_hex,
        "text_color": text_colour_for_background(data.color_hex),
        "is_default": False,
        "created_by_id": user.get("id"),
        "created_by_name": user.get("name"),
        "created_at": now,
        "updated_at": now,
    }
    await legacy.db.disposal_routes.insert_one(record)
    return {k: v for k, v in record.items() if k != "_id"}


@router.put("/disposal-routes/{route_id}")
async def update_disposal_route(
    route_id: str,
    data: DisposalRouteUpdate,
    user: dict = Depends(legacy.require_role([legacy.UserRole.COMPANY_ADMIN, legacy.UserRole.ADMIN], feature="traceability")),
):
    route = await legacy.db.disposal_routes.find_one({"id": route_id}, {"_id": 0})
    if not route or (not legacy.is_system_admin(user) and route.get("company_id") != user.get("company_id")):
        raise HTTPException(status_code=404, detail="Disposal route not found")

    await legacy.db.disposal_routes.update_one(
        {"id": route_id},
        {"$set": {
            "name": data.name.strip(),
            "color_hex": data.color_hex,
            "text_color": text_colour_for_background(data.color_hex),
            "updated_at": legacy.get_uk_time_iso(),
        }},
    )
    return await legacy.db.disposal_routes.find_one({"id": route_id}, {"_id": 0})


@router.delete("/disposal-routes/{route_id}")
async def delete_disposal_route(
    route_id: str,
    user: dict = Depends(legacy.require_role([legacy.UserRole.COMPANY_ADMIN, legacy.UserRole.ADMIN], feature="traceability")),
):
    route = await legacy.db.disposal_routes.find_one({"id": route_id}, {"_id": 0})
    if not route or (not legacy.is_system_admin(user) and route.get("company_id") != user.get("company_id")):
        raise HTTPException(status_code=404, detail="Disposal route not found")
    if route.get("is_default"):
        raise HTTPException(status_code=400, detail="Default disposal routes can be recoloured or renamed but not deleted")
    await legacy.db.disposal_routes.delete_one({"id": route_id})
    return {"message": "Disposal route deleted"}
