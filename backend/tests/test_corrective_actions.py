import os
import sys
from datetime import timedelta
from pathlib import Path


os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import (  # noqa: E402
    AnswerSubmit,
    corrective_action_status,
    get_uk_time,
    normalise_feature_access,
)


def test_actions_default_off_for_members_and_on_for_admins():
    member_access = normalise_feature_access({"role": "user", "feature_access": {}})
    admin_access = normalise_feature_access({"role": "company_admin", "feature_access": {}})

    assert member_access["actions"] is False
    assert admin_access["actions"] is True


def test_corrective_action_status_marks_overdue_and_completed():
    yesterday = (get_uk_time().date() - timedelta(days=1)).isoformat()
    tomorrow = (get_uk_time().date() + timedelta(days=1)).isoformat()

    assert corrective_action_status({"status": "open", "due_date": yesterday}) == "overdue"
    assert corrective_action_status({"status": "open", "due_date": tomorrow}) == "open"
    assert corrective_action_status({"status": "completed", "due_date": yesterday}) == "completed"


def test_audit_answer_preserves_corrective_action_fields():
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
