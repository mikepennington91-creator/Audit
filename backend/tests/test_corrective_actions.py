import os
import sys
import asyncio
from datetime import timedelta
from pathlib import Path


os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import (  # noqa: E402
    AnswerSubmit,
    CorrectiveActionReassign,
    CorrectiveActionUpdate,
    corrective_action_status,
    get_uk_time,
    has_feature,
    normalise_feature_access,
)
from fastapi import HTTPException  # noqa: E402
from app_core import actions  # noqa: E402


def test_actions_are_universal_without_polluting_feature_toggle_map():
    member = {"role": "user", "feature_access": {}}
    admin = {"role": "company_admin", "feature_access": {}}

    # Actions are intentionally available to every signed-in user; row-level
    # action queries determine which assigned work they may actually see.
    assert has_feature(member, "actions") is True
    assert has_feature(admin, "actions") is True

    # Actions are not a configurable module toggle, so the normalised feature
    # map should contain only the explicit audit/traceability/document keys.
    assert "actions" not in normalise_feature_access(member)
    assert "actions" not in normalise_feature_access(admin)


def test_corrective_action_status_marks_overdue_and_completed():
    yesterday = (get_uk_time().date() - timedelta(days=1)).isoformat()
    tomorrow = (get_uk_time().date() + timedelta(days=1)).isoformat()

    assert corrective_action_status({"status": "open", "due_date": yesterday}) == "overdue"
    assert corrective_action_status({"status": "open", "due_date": tomorrow}) == "open"
    assert corrective_action_status({"status": "completed", "due_date": yesterday}) == "completed"


def test_audit_answer_preserves_legacy_corrective_action_fields():
    # Department ownership remains readable for historical audit records even
    # though newly submitted corrective actions now require a registered user.
    answer = AnswerSubmit(
        question_id="question-1",
        response_value="fail",
        response_label="Fail",
        notes="Guard damaged",
        is_negative=True,
        action_required="Replace the guard",
        assigned_department="Engineering",
        action_assignee_type="department",
        action_due_date="2026-08-30",
    )

    assert answer.action_required == "Replace the guard"
    assert answer.assigned_department == "Engineering"
    assert answer.action_due_date == "2026-08-30"


class ActionCollection:
    def __init__(self, action):
        self.action = action

    async def find_one(self, *_args, **_kwargs):
        return dict(self.action)


class ActionDatabase:
    def __init__(self, action):
        self.corrective_actions = ActionCollection(action)


def action_record():
    return {
        "id": "action-1",
        "company_id": "company-1",
        "assigned_user_id": "owner",
        "created_by_id": "raiser",
        "reviewer_user_id": "reviewer",
        "status": "open",
        "archived": False,
        "history": [],
    }


def assert_forbidden(coro):
    try:
        asyncio.run(coro)
    except HTTPException as exc:
        assert exc.status_code == 403
    else:
        raise AssertionError("Expected a 403 response")


def test_non_admin_action_owner_cannot_reassign(monkeypatch):
    monkeypatch.setattr(actions.legacy, "db", ActionDatabase(action_record()))
    assert_forbidden(actions.reassign_corrective_action(
        "action-1",
        CorrectiveActionReassign(assigned_user_id="other", reason="Workload"),
        {"id": "owner", "name": "Owner", "role": "user", "company_id": "company-1"},
    ))


def test_non_admin_action_raiser_cannot_change_approver(monkeypatch):
    monkeypatch.setattr(actions.legacy, "db", ActionDatabase(action_record()))
    assert_forbidden(actions.change_action_reviewer(
        "action-1",
        actions.ActionReviewerUpdate(reviewer_user_id="other"),
        {"id": "raiser", "name": "Raiser", "role": "user", "company_id": "company-1"},
    ))


def test_non_owner_cannot_submit_someone_elses_action(monkeypatch):
    monkeypatch.setattr(actions.legacy, "db", ActionDatabase(action_record()))
    assert_forbidden(actions.submit_corrective_action_for_review(
        "action-1",
        CorrectiveActionUpdate(action_taken="Work completed"),
        {"id": "reviewer", "name": "Reviewer", "role": "user", "company_id": "company-1"},
    ))
