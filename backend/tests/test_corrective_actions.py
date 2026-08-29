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
    has_feature,
    normalise_feature_access,
)


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
