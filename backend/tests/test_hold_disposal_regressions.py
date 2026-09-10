"""Regression coverage for PR #31's concurrent seeding and PDF overflow."""

import asyncio
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server as legacy
import app_core.factory_notice_pdf as factory_notice_pdf
from app_core.disposal_routes import ensure_default_disposal_routes
from app_core.factory_notice_pdf import DISPOSAL_BLUE, _boxed_section, notice_pdf_bytes
from app_core.hold_disposal import NoticeUpdate, get_hold_notice, update_hold_notice
from database import PostgresCollection


class PrimaryKeyPool:
    """Model the DB primary key, yielding at reads/writes to force overlap."""

    def __init__(self):
        self.records = {}
        self.fail_on = None

    async def fetch(self, sql, collection, company_id):
        records = [
            {"data": json.dumps(record)}
            for (name, _), record in self.records.items()
            if name == collection and record["company_id"] == company_id
        ]
        await asyncio.sleep(0)
        return records

    async def fetchrow(self, sql, collection, record_id, payload):
        assert "ON CONFLICT (collection, id) DO NOTHING" in sql
        await asyncio.sleep(0)
        record = json.loads(payload)
        if record["key"] == self.fail_on:
            self.fail_on = None
            raise RuntimeError("interrupted seed")
        key = (collection, record_id)
        if key in self.records:
            return None
        self.records[key] = record
        return {"id": record_id}


class NoticeCollection:
    def __init__(self, record):
        self.record = record.copy()

    async def find_one(self, query, *_args):
        return self.record.copy() if query.get("id") == self.record.get("id") else None

    async def update_one(self, query, update):
        current_version = self.record.get("record_version")
        if query.get("id") != self.record.get("id") or query.get("record_version") != current_version:
            return SimpleNamespace(matched_count=0)
        self.record.update(update["$set"])
        return SimpleNamespace(matched_count=1)


def notice_update(**changes):
    values = {
        "reference": "HOLD-TEST",
        "rm_number": "RM100",
        "quantity": "50 kg",
        "ingredient_name": "Chocolate",
        "reason": "Packaging damage with further investigation detail",
        "action_required": "Inspect and segregate affected stock",
        "event_date": "2026-09-07",
        "event_time": "09:15",
        "line_area": "Warehouse",
        "our_batch": "B100",
        "vendor_batch": "V200",
        "date_delivered": "2026-09-06",
        "quantity_delivered": "500 kg",
        "expected_version": 0,
        "change_reason": "Added investigation details",
    }
    return NoticeUpdate(**{**values, **changes})


def setup_routes(monkeypatch):
    pool = PrimaryKeyPool()
    collection = PostgresCollection(SimpleNamespace(pool=pool, connection=pool, write=lambda method, *args: getattr(pool, method)(*args)), "disposal_routes")
    monkeypatch.setattr(legacy, "db", SimpleNamespace(disposal_routes=collection))
    return pool


def test_concurrent_first_visits_seed_one_set_per_company(monkeypatch):
    pool = setup_routes(monkeypatch)

    async def visits():
        return await asyncio.gather(*[
            ensure_default_disposal_routes(company)
            for company in ["company-a", "company-b"] * 10
        ])

    results = asyncio.run(visits())
    assert len(pool.records) == 8
    assert all(len(result) == 4 for result in results)
    assert all(len({record["key"] for record in result}) == 4 for result in results)


def test_partial_seed_recovers_and_preserves_legacy_edits(monkeypatch):
    pool = setup_routes(monkeypatch)
    saved = {
        "id": "legacy-random-id", "company_id": "company-a", "key": "sugarich",
        "name": "Renamed route", "color_hex": "#123456", "updated_at": "saved",
    }
    pool.records[("disposal_routes", saved["id"])] = saved.copy()
    pool.fail_on = "general_waste"
    with pytest.raises(RuntimeError, match="interrupted seed"):
        asyncio.run(ensure_default_disposal_routes("company-a"))
    assert len(pool.records) == 2
    result = asyncio.run(ensure_default_disposal_routes("company-a"))
    assert len(result) == 4
    assert next(record for record in result if record["key"] == "sugarich") == saved
    assert asyncio.run(ensure_default_disposal_routes("company-a")) == result


def test_conflicting_seed_does_not_overwrite_saved_configuration():
    pool = PrimaryKeyPool()
    collection = PostgresCollection(SimpleNamespace(pool=pool, connection=pool, write=lambda method, *args: getattr(pool, method)(*args)), "disposal_routes")
    saved = {"id": "stable-id", "key": "sugarich", "name": "Custom name"}
    assert asyncio.run(collection.insert_one_if_absent(saved)) is True
    assert asyncio.run(collection.insert_one_if_absent({**saved, "name": "Default"})) is False
    assert pool.records[("disposal_routes", "stable-id")] == saved


def test_notice_can_be_viewed_in_app_within_company(monkeypatch):
    record = {
        "id": "hold-1", "company_id": "company-a", "created_by_id": "creator-1",
        "notice_type": "hold", "reference": "HOLD-TEST",
    }
    collection = NoticeCollection(record)
    monkeypatch.setattr(legacy, "db", SimpleNamespace(hold_notices=collection))
    result = asyncio.run(get_hold_notice(
        "hold-1", {"id": "viewer-1", "role": "user", "company_id": "company-a"}
    ))
    assert result["reference"] == "HOLD-TEST"
    assert result["record_version"] == 0


def test_notice_cannot_be_viewed_across_companies(monkeypatch):
    record = {
        "id": "hold-1", "company_id": "company-a", "created_by_id": "creator-1",
        "notice_type": "hold", "reference": "HOLD-TEST",
    }
    monkeypatch.setattr(legacy, "db", SimpleNamespace(hold_notices=NoticeCollection(record)))
    with pytest.raises(legacy.HTTPException) as error:
        asyncio.run(get_hold_notice(
            "hold-1", {"id": "viewer-2", "role": "user", "company_id": "company-b"}
        ))
    assert error.value.status_code == 404


def test_user_without_traceability_edit_cannot_edit_notice(monkeypatch):
    record = {
        "id": "hold-1", "company_id": "company-a", "created_by_id": "creator-1",
        "notice_type": "hold", "reference": "HOLD-TEST", "record_version": 0,
    }
    monkeypatch.setattr(legacy, "db", SimpleNamespace(hold_notices=NoticeCollection(record)))
    with pytest.raises(legacy.HTTPException) as error:
        asyncio.run(update_hold_notice(
            "hold-1", notice_update(),
            {"id": "viewer-1", "role": "user", "company_id": "company-a", "feature_access": {"traceability_view": True}},
        ))
    assert error.value.status_code == 403


def test_editor_can_edit_notice_created_by_another_user(monkeypatch):
    record = {
        "id": "hold-1", "company_id": "company-a", "created_by_id": "creator-1",
        "created_by_name": "Creator", "notice_type": "hold", "reference": "HOLD-TEST",
        "rm_number": "RM100", "quantity": "40 kg", "ingredient_name": "Chocolate",
        "reason": "Packaging damage", "action_required": "Segregate stock",
        "event_date": "2026-09-07", "event_time": "09:15", "line_area": "Warehouse",
        "our_batch": "B100", "vendor_batch": "V200", "date_delivered": "2026-09-06",
        "quantity_delivered": "500 kg", "record_version": 0, "edit_history": [],
    }
    collection = NoticeCollection(record)
    monkeypatch.setattr(legacy, "db", SimpleNamespace(hold_notices=collection))
    result = asyncio.run(update_hold_notice(
        "hold-1", notice_update(change_reason="QA editor confirmed quantity"),
        {"id": "editor-1", "name": "QA Editor", "role": "user", "company_id": "company-a",
         "feature_access": {"traceability_view": True, "traceability_edit": True}},
    ))
    assert result["record_version"] == 1
    assert result["edit_history"][0]["updated_by_name"] == "QA Editor"


def test_creator_edit_records_reason_and_field_history(monkeypatch):
    record = {
        "id": "hold-1", "company_id": "company-a", "created_by_id": "creator-1",
        "created_by_name": "Creator", "notice_type": "hold", "reference": "HOLD-TEST",
        "rm_number": "RM100", "quantity": "40 kg", "ingredient_name": "Chocolate",
        "reason": "Packaging damage", "action_required": "Segregate stock",
        "event_date": "2026-09-07", "event_time": "09:15", "line_area": "Warehouse",
        "our_batch": "B100", "vendor_batch": "V200", "date_delivered": "2026-09-06",
        "quantity_delivered": "500 kg", "record_version": 0, "edit_history": [],
    }
    collection = NoticeCollection(record)
    monkeypatch.setattr(legacy, "db", SimpleNamespace(hold_notices=collection))
    result = asyncio.run(update_hold_notice(
        "hold-1", notice_update(),
        {"id": "creator-1", "name": "Creator", "role": "user", "company_id": "company-a",
         "feature_access": {"traceability_view": True, "traceability_edit": True}},
    ))
    assert result["quantity"] == "50 kg"
    assert result["record_version"] == 1
    assert result["edit_history"][0]["reason"] == "Added investigation details"
    assert result["edit_history"][0]["changes"]["quantity"] == {"before": "40 kg", "after": "50 kg"}


def test_admin_can_edit_notice_created_by_another_user(monkeypatch):
    record = {
        "id": "hold-1", "company_id": "company-a", "created_by_id": "creator-1",
        "created_by_name": "Creator", "notice_type": "hold", "reference": "HOLD-TEST",
        "rm_number": "RM100", "quantity": "40 kg", "ingredient_name": "Chocolate",
        "reason": "Packaging damage", "action_required": "Segregate stock",
        "event_date": "2026-09-07", "event_time": "09:15", "line_area": "Warehouse",
        "our_batch": "B100", "vendor_batch": "V200", "date_delivered": "2026-09-06",
        "quantity_delivered": "500 kg", "record_version": 0, "edit_history": [],
    }
    collection = NoticeCollection(record)
    monkeypatch.setattr(legacy, "db", SimpleNamespace(hold_notices=collection))
    result = asyncio.run(update_hold_notice(
        "hold-1", notice_update(change_reason="Admin added confirmed quantity"),
        {"id": "admin-1", "name": "Administrator", "role": "company_admin", "company_id": "company-a"},
    ))
    assert result["record_version"] == 1
    assert result["edit_history"][0]["updated_by_name"] == "Administrator"


@pytest.mark.parametrize("value", ["Short reason", "Reason with wrapping text. " * 110, "W" * 3000])
def test_box_expands_to_fit_paragraph(value):
    box = _boxed_section("REASON", value, getSampleStyleSheet(), min_height=inch)
    _, height = box.wrap(500, 800)
    paragraph = box._cellvalues[0][1][0]
    _, text_height = paragraph.wrap(5.08 * inch - 16, 100000)
    assert height >= max(inch, text_height + 16)


@pytest.mark.parametrize("notice_type", ["hold", "disposal"])
@pytest.mark.parametrize("value", ["Short text", "Detailed factory investigation. " * 93, "W" * 3000])
def test_valid_notice_text_can_render_across_pages(notice_type, value):
    record = {
        "notice_type": notice_type, "reference": "NOTICE-TEST",
        "ingredient_name": "Test material", "reason": value,
        "action_required": value, "disposal_route": "sugarich",
    }
    pdf = asyncio.run(notice_pdf_bytes(record))
    assert pdf.startswith(b"%PDF-")
    assert pdf.rstrip().endswith(b"%%EOF")


def test_disposal_pdf_banner_is_always_blue(monkeypatch):
    captured = []
    original_banner = factory_notice_pdf._banner

    def capture_banner(company, notice_type, colour, text_colour, styles):
        captured.append((notice_type, colour, text_colour))
        return original_banner(company, notice_type, colour, text_colour, styles)

    monkeypatch.setattr(factory_notice_pdf, "_banner", capture_banner)
    record = {
        "notice_type": "disposal", "reference": "DISPOSAL-TEST",
        "ingredient_name": "Test material", "reason": "Routine disposal",
        "action_required": "Remove through approved route",
        "disposal_route": "general_waste", "disposal_route_color": "#DC2626",
        "disposal_route_text_color": "#FFFFFF",
    }

    asyncio.run(notice_pdf_bytes(record))

    assert captured[0] == ("disposal", DISPOSAL_BLUE, "#FFFFFF")
