import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server as legacy  # noqa: E402
from app_core import quality_operations  # noqa: E402
from app_core.quality_operations import (  # noqa: E402
    QualityEventCreate,
    QualityEventUpdate,
    _same_company,
    build_management_summary_pdf,
)
from main import app  # noqa: E402


def user(user_id="user-1", role="user", company_id="company-1"):
    return {"id": user_id, "name": "Test User", "role": role, "company_id": company_id}


def test_quality_feature_edit_implies_view_access():
    member = user()
    member["feature_access"] = {"quality_edit": True}
    access = legacy.normalise_feature_access(member)
    assert access["quality_edit"] is True
    assert access["quality_view"] is True
    assert legacy.has_feature(member, "quality") is True


def test_quality_routes_are_registered():
    routes = {(method, route.path) for route in app.routes for method in (route.methods or set())}
    assert ("GET", "/api/my-work") in routes
    assert ("POST", "/api/quality-events") in routes
    assert ("POST", "/api/suppliers") in routes
    assert ("POST", "/api/document-signoffs") in routes
    assert ("GET", "/api/management-report/pdf") in routes
    assert ("GET", "/api/run-audits/{run_id}/evidence-pack.pdf") in routes


def test_quality_records_are_tenant_scoped():
    record = {"company_id": "company-1"}
    assert _same_company(record, user(company_id="company-1")) is True
    assert _same_company(record, user(company_id="company-2")) is False
    assert _same_company(record, user(role="system_admin", company_id=None)) is True


class EventCollection:
    def __init__(self, record):
        self.record = record

    async def find_one(self, *_args, **_kwargs):
        return dict(self.record)

    async def update_one(self, _query, update):
        self.record.update(update["$set"])


class EventDatabase:
    def __init__(self, record):
        self.quality_events = EventCollection(record)


def test_quality_editor_can_change_another_users_quality_record(monkeypatch):
    record = {
        "id": "event-1", "company_id": "company-1", "owner_user_id": "owner-1",
        "status": "investigating", "history": [],
    }
    monkeypatch.setattr(quality_operations.legacy, "db", EventDatabase(record))
    result = asyncio.run(quality_operations.update_quality_event(
        "event-1",
        QualityEventUpdate(root_cause="Equipment failure", change_note="Investigation update"),
        user("quality-editor"),
    ))
    assert result["root_cause"] == "Equipment failure"


def test_quality_event_accepts_multiple_suppliers_and_actions():
    event = QualityEventCreate(
        event_type="quality_incident",
        title="Incorrect raw material",
        description="Two supplier materials were involved",
        occurred_date="2026-09-14",
        raw_material_numbers="RM27279 / RM27280",
        finished_product_batch="6257",
        supplier_ids=["supplier-1", "supplier-2"],
        actions=[{
            "action_required": "Review both specifications",
            "assigned_user_id": "user-2",
            "due_date": "2026-09-21",
        }],
    )
    assert event.supplier_ids == ["supplier-1", "supplier-2"]
    assert event.actions[0].action_required == "Review both specifications"


def test_management_summary_pdf_is_valid_pdf():
    data = {
        "period": {"start": "2026-08-01", "end": "2026-08-31"},
        "counts": {"audits_completed": 12, "audit_pass_rate": 91.7, "overdue_actions": 2},
    }
    result = build_management_summary_pdf(data, {"name": "ZRO Group"})
    assert result.startswith(b"%PDF")
    assert len(result) > 1000
