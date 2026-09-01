import asyncio
import copy
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app_core import hold_disposal as notices
from app_core.notice_files import notice_filename
from date_formats import format_uk_date, format_uk_datetime


class Collection:
    def __init__(self, records=()):
        self.records = {record["id"]: copy.deepcopy(record) for record in records}

    async def find_one(self, query, projection=None):
        return next((copy.deepcopy(record) for record in self.records.values()
                     if all(record.get(key) == value for key, value in query.items())), None)

    async def insert_one(self, record):
        self.records[record["id"]] = copy.deepcopy(record)

    async def insert_one_if_absent(self, record):
        await asyncio.sleep(0)
        if record["id"] in self.records:
            return False
        self.records[record["id"]] = copy.deepcopy(record)
        return True

    async def update_one(self, query, changes):
        await asyncio.sleep(0)
        record = self.records.get(query["id"])
        matched = bool(record and all(record.get(key) == value for key, value in query.items()))
        if matched:
            record.update(changes["$set"])
        return SimpleNamespace(matched_count=int(matched))


@pytest.fixture
def setup(monkeypatch):
    hold = dict(id="hold-1", reference="QA-123", company_id="company-a", notice_type="hold",
                ingredient_name="Chocolate", rm_number="RM12", quantity="180 cases", line_area="Warehouse",
                reason="Investigate", action_required="Keep on hold", event_date="2026-09-01", event_time="08:00")
    db = SimpleNamespace(hold_notices=Collection([hold]), disposal_notices=Collection(),
                         companies=Collection([{"id": "company-a"}]),
                         distribution_lists=Collection([{"id": "list-1", "company_id": "company-a",
                                                        "name": "QA", "recipients": ["qa@example.test"]}]))
    monkeypatch.setattr(notices.legacy, "db", db)
    route = AsyncMock(return_value={"id": "route-1", "key": "recycling", "name": "Recycling",
                                   "color_hex": "#7E22CE", "text_color": "#FFFFFF"})
    monkeypatch.setattr(notices, "resolve_disposal_route", route)
    user = dict(id="user-a", company_id="company-a", role="user", name="QA")
    return hold, db, user, route


def disposal_request(**extra):
    return notices.HoldDisposalCreate(event_date="02/09/2026", event_time="09:30",
                                      reason="Approved for disposal", action_required="Send to recycling",
                                      disposal_route="recycling", **extra)


def test_linked_disposal_preserves_hold_identity_and_original_record(setup):
    hold, db, user, route = setup
    result = asyncio.run(notices.dispose_hold(hold["id"], disposal_request(
        company_id="company-b", reference="CHANGED"), user))
    for key in ("company_id", "reference", "quantity", "rm_number", "ingredient_name", "line_area"):
        assert result[key] == hold[key]
    assert result["source_hold_id"] == hold["id"]
    assert result["event_date"] == "2026-09-02"
    assert result["pdf_filename"] == "Disposal - 020926 - QA-123.pdf"
    assert db.hold_notices.records[hold["id"]] == hold
    route.assert_awaited_once_with("company-a", "recycling")


def test_concurrent_disposals_create_only_one_notice(setup):
    hold, db, user, _ = setup

    async def submit():
        return await asyncio.gather(*[notices.dispose_hold(hold["id"], disposal_request(), user)
                                      for _ in range(10)], return_exceptions=True)

    results = asyncio.run(submit())
    assert len(db.disposal_notices.records) == 1
    assert sum(isinstance(result, dict) for result in results) == 1
    assert all(isinstance(result, dict) or isinstance(result, HTTPException) and result.status_code == 409
               for result in results)


def test_other_company_cannot_dispose_hold(setup):
    hold, db, user, route = setup
    with pytest.raises(HTTPException) as exc:
        asyncio.run(notices.dispose_hold(hold["id"], disposal_request(), {**user, "company_id": "company-b"}))
    assert exc.value.status_code == 404
    assert not db.disposal_notices.records
    route.assert_not_awaited()


def test_system_admin_uses_holds_company(setup):
    hold, _, user, route = setup
    result = asyncio.run(notices.dispose_hold(hold["id"], disposal_request(),
                                             {**user, "role": "system_admin", "company_id": "company-b"}))
    assert result["company_id"] == "company-a"
    route.assert_awaited_once_with("company-a", "recycling")


def test_invalid_route_does_not_change_hold(setup):
    hold, db, user, route = setup
    route.return_value = None
    with pytest.raises(HTTPException) as exc:
        asyncio.run(notices.dispose_hold(hold["id"], disposal_request(), user))
    assert exc.value.status_code == 400
    assert not db.disposal_notices.records
    assert db.hold_notices.records[hold["id"]] == hold


def test_entered_reference_is_used_for_hold(setup):
    hold, _, user, _ = setup
    data = notices.NoticeCreate(**{**hold, "reference": "  12345  "})
    result = asyncio.run(notices.create_hold_notice(data, user))
    assert result["reference"] == "12345"
    assert result["pdf_filename"] == "Hold - 010926 - 12345.pdf"


@pytest.mark.parametrize("changes", [{"event_date": "31/02/2026"}, {"event_time": "24:00"},
                                      {"reference": "bad\r\nheader"}])
def test_invalid_notice_values_are_rejected(setup, changes):
    hold, *_ = setup
    with pytest.raises(ValidationError):
        notices.NoticeCreate(**{**hold, **changes})


def test_download_and_email_use_same_filename(setup, monkeypatch):
    hold, _, user, _ = setup
    monkeypatch.setattr(notices, "_notice_pdf_bytes", AsyncMock(return_value=b"%PDF-test"))
    email = AsyncMock(return_value=SimpleNamespace(sent=True))
    monkeypatch.setattr(notices, "send_email", email)
    response = asyncio.run(notices._pdf_response(hold))
    asyncio.run(notices._email_notice("hold", hold["id"], notices.NoticeEmailRequest(distribution_list_id="list-1"), user))
    expected = "Hold - 010926 - QA-123.pdf"
    assert response.headers["content-disposition"] == f'attachment; filename="{expected}"'
    assert email.call_args.kwargs["attachments"][0].filename == expected


def test_filenames_strip_unsafe_characters():
    filename = notice_filename(dict(notice_type="hold", event_date="2026-09-01", reference='QA/12\\A:\r\n"'))
    assert filename == "Hold - 010926 - QA-12-A.pdf"


def test_uk_dates_and_british_summer_time():
    assert format_uk_date("2026-09-01") == "01/09/2026"
    assert format_uk_date("01/09/2026") == "01/09/2026"
    assert format_uk_datetime("2026-08-31T23:30:00Z") == "01/09/2026 00:30"
    assert format_uk_datetime("2026-12-31T23:30:00Z") == "31/12/2026 23:30"


def test_delivery_and_batch_fields_copy_to_disposal(setup):
    hold, db, user, _ = setup
    fields = dict(our_batch="OUR-6230", vendor_batch="VENDOR-7", date_delivered="2026-08-31", quantity_delivered="200 cases")
    request = notices.NoticeCreate(**{**hold, **fields, "date_delivered": "31/08/2026"})
    created = asyncio.run(notices.create_hold_notice(request, user))
    for key, value in fields.items():
        assert created[key] == value
    disposal = asyncio.run(notices.dispose_hold(created["id"], disposal_request(quantity="30 cases"), user))
    assert disposal["quantity"] == "30 cases"
    assert db.hold_notices.records[created["id"]]["quantity"] == "180 cases"
    for key, value in fields.items():
        assert disposal[key] == value


def test_outcome_tracks_changes_and_uses_discarded_quantity(setup):
    hold, db, user, _ = setup
    result = asyncio.run(notices.update_hold_outcome(hold["id"], notices.HoldOutcomeUpdate(
        expected_version=0, quantity_released="150 cases", quantity_discarded="30 cases",
        root_cause="Damaged outer packaging", corrective_action="Improve handling"), user))
    assert result["outcome_version"] == 1
    assert result["quantity"] == hold["quantity"]
    assert result["outcome_updated_by_id"] == user["id"]
    history = result["outcome_history"][0]
    assert history["changes"]["quantity_released"] == {"before": "", "after": "150 cases"}
    assert history["updated_by_name"] == "QA"
    assert db.hold_notices.records[hold["id"]]["root_cause"] == "Damaged outer packaging"
    disposal = asyncio.run(notices.dispose_hold(hold["id"], disposal_request(), user))
    assert disposal["quantity"] == "30 cases"


def test_outcome_cannot_cross_company_or_overwrite_newer_version(setup):
    hold, db, user, _ = setup
    data = notices.HoldOutcomeUpdate(expected_version=0, quantity_released="0", root_cause="Under investigation")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(notices.update_hold_outcome(hold["id"], data, {**user, "company_id": "other"}))
    assert exc.value.status_code == 404
    first = asyncio.run(notices.update_hold_outcome(hold["id"], data, user))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(notices.update_hold_outcome(hold["id"], data, user))
    assert exc.value.status_code == 409
    assert len(db.hold_notices.records[hold["id"]]["outcome_history"]) == 1
    assert first["quantity_released"] == "0"


def test_concurrent_outcomes_do_not_lose_history(setup):
    hold, db, user, _ = setup
    async def save():
        return await asyncio.gather(*[notices.update_hold_outcome(hold["id"], notices.HoldOutcomeUpdate(
            expected_version=0, root_cause=f"Finding {i}"), user) for i in range(5)], return_exceptions=True)
    results = asyncio.run(save())
    assert sum(isinstance(result, dict) for result in results) == 1
    assert all(isinstance(result, dict) or isinstance(result, HTTPException) and result.status_code == 409 for result in results)
    assert len(db.hold_notices.records[hold["id"]]["outcome_history"]) == 1


def test_outcome_corrections_preserve_previous_values(setup):
    hold, db, user, _ = setup
    asyncio.run(notices.update_hold_outcome(hold["id"], notices.HoldOutcomeUpdate(expected_version=0, quantity_released="15 cases"), user))
    result = asyncio.run(notices.update_hold_outcome(hold["id"], notices.HoldOutcomeUpdate(expected_version=1, quantity_released="150 cases"), user))
    assert len(result["outcome_history"]) == 2
    assert result["outcome_history"][1]["changes"]["quantity_released"] == {"before": "15 cases", "after": "150 cases"}
