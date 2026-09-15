from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app_core import multi_audit_actions


class _Users:
    async def find_one(self, query, projection=None):
        if query.get("id") == "owner-1":
            return {
                "id": "owner-1",
                "name": "Action Owner",
                "email": "owner@example.com",
                "company_id": "company-1",
            }
        return None


@pytest.mark.asyncio
async def test_validate_additional_actions_accepts_complete_registered_owner(monkeypatch):
    monkeypatch.setattr(multi_audit_actions.legacy, "db", SimpleNamespace(users=_Users()))
    monkeypatch.setattr(multi_audit_actions.legacy, "is_system_admin", lambda user: False)
    monkeypatch.setattr(
        multi_audit_actions.legacy,
        "get_uk_time",
        lambda: SimpleNamespace(date=lambda: __import__("datetime").date(2026, 9, 15)),
    )
    actions = await multi_audit_actions._validate_additional_actions(
        {"company_id": "company-1"},
        [{
            "id": "extra-1",
            "action_required": "Deep clean affected area",
            "assigned_user_id": "owner-1",
            "due_date": "2026-09-16",
        }],
        {"id": "raiser-1", "company_id": "company-1"},
    )
    assert actions[0]["owner"]["id"] == "owner-1"
    assert actions[0]["action_required"] == "Deep clean affected area"


@pytest.mark.asyncio
async def test_validate_additional_actions_rejects_incomplete_action(monkeypatch):
    monkeypatch.setattr(multi_audit_actions.legacy, "db", SimpleNamespace(users=_Users()))
    with pytest.raises(HTTPException) as exc:
        await multi_audit_actions._validate_additional_actions(
            {"company_id": "company-1"},
            [{"id": "extra-1", "action_required": "", "assigned_user_id": "", "due_date": ""}],
            {"id": "raiser-1", "company_id": "company-1"},
        )
    assert exc.value.status_code == 400
