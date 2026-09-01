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
from app_core.disposal_routes import ensure_default_disposal_routes
from app_core.factory_notice_pdf import _boxed_section, notice_pdf_bytes
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
