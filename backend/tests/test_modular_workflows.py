import os
import sys
from datetime import timedelta
from pathlib import Path


os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server as legacy  # noqa: E402
from app_core.account_auth import _hash_reset_token  # noqa: E402
from app_core.actions import action_display_status  # noqa: E402
from app_core.email_service import _branded_html  # noqa: E402
from app_core.report_email import _audit_run_access_allowed  # noqa: E402
from app_core.schedules import schedule_access_allowed, scheduled_date  # noqa: E402
from app_core.user_lifecycle import _temporary_password  # noqa: E402
from main import app  # noqa: E402


def _user(user_id="user-1", role=legacy.UserRole.USER, company_id="company-1"):
    return {"id": user_id, "role": role, "company_id": company_id}


def test_schedule_date_is_calendar_based_and_accepts_legacy_iso_values():
    assert scheduled_date("2026-08-30") is not None
    assert scheduled_date("2026-08-30T23:00:00+00:00").isoformat() == "2026-08-30"
    assert scheduled_date("not-a-date") is None


def test_schedule_access_is_company_scoped_for_managers_and_keeps_assignee_access():
    schedule = {"id": "s1", "assigned_to": "user-1", "company_id": "company-1"}
    assigned_user = _user()

    assert schedule_access_allowed(schedule, _user("user-1"), assigned_user) is True
    assert schedule_access_allowed(
        schedule,
        _user("manager-1", legacy.UserRole.COMPANY_ADMIN, "company-1"),
        assigned_user,
    ) is True
    assert schedule_access_allowed(
        schedule,
        _user("manager-2", legacy.UserRole.COMPANY_ADMIN, "company-2"),
        assigned_user,
    ) is False
    assert schedule_access_allowed(
        schedule,
        _user("system", legacy.UserRole.SYSTEM_ADMIN, None),
        assigned_user,
    ) is True


def test_legacy_schedule_without_company_id_uses_assigned_users_company_for_access():
    legacy_schedule = {"id": "s1", "assigned_to": "user-1"}
    assigned_user = _user("user-1", legacy.UserRole.USER, "company-1")

    assert schedule_access_allowed(
        legacy_schedule,
        _user("manager-1", legacy.UserRole.ADMIN, "company-1"),
        assigned_user,
    ) is True
    assert schedule_access_allowed(
        legacy_schedule,
        _user("manager-2", legacy.UserRole.ADMIN, "company-2"),
        assigned_user,
    ) is False


def test_audit_report_email_access_does_not_cross_company_boundaries():
    run = {"id": "run-1", "auditor_id": "auditor-1", "company_id": "company-1"}

    assert _audit_run_access_allowed(run, _user("auditor-1")) is True
    assert _audit_run_access_allowed(
        run,
        _user("manager-1", legacy.UserRole.COMPANY_ADMIN, "company-1"),
    ) is True
    assert _audit_run_access_allowed(
        run,
        _user("manager-2", legacy.UserRole.COMPANY_ADMIN, "company-2"),
    ) is False
    assert _audit_run_access_allowed(
        run,
        _user("system", legacy.UserRole.SYSTEM_ADMIN, None),
    ) is True


def test_action_display_status_preserves_review_and_completed_states():
    yesterday = (legacy.get_uk_time().date() - timedelta(days=1)).isoformat()

    assert action_display_status({"status": "awaiting_review", "due_date": yesterday}) == "awaiting_review"
    assert action_display_status({"status": "completed", "due_date": yesterday}) == "completed"
    assert action_display_status({"status": "open", "due_date": yesterday}) == "overdue"


def test_password_reset_tokens_are_stored_as_hashes_not_raw_values():
    raw = "sample-reset-token-value"
    digest = _hash_reset_token(raw)

    assert digest != raw
    assert len(digest) == 64
    assert digest == _hash_reset_token(raw)


def test_temporary_password_has_required_character_mix():
    password = _temporary_password()

    assert len(password) >= 14
    assert any(character.isupper() for character in password)
    assert any(character.islower() for character in password)
    assert any(character.isdigit() for character in password)
    assert any(character in "!@#$%" for character in password)


def test_branded_email_shell_contains_logo_and_privacy_link():
    markup = _branded_html("Test message", "<p>Hello</p>")

    assert "Infinit Audit" in markup
    assert "<img" in markup
    assert "/privacy" in markup
    assert "Test message" in markup


def test_modular_entrypoint_has_single_replacement_route_for_critical_endpoints():
    def route_count(method, path):
        return sum(
            1
            for route in app.router.routes
            if path == getattr(route, "path", None)
            and method in (getattr(route, "methods", None) or set())
        )

    assert route_count("POST", "/api/auth/login") == 1
    assert route_count("GET", "/api/auth/me") == 1
    assert route_count("POST", "/api/users") == 1
    assert route_count("GET", "/api/users") == 1
    assert route_count("POST", "/api/users/bulk-import") == 1
    assert route_count("DELETE", "/api/run-audits/{run_id}") == 1
    assert route_count("PUT", "/api/run-audits/{run_id}") == 1
    assert route_count("GET", "/api/actions") == 1
    assert route_count("POST", "/api/scheduled-audits") == 1
    assert route_count("GET", "/api/scheduled-audits") == 1
    assert route_count("DELETE", "/api/scheduled-audits/{schedule_id}") == 1
    assert route_count("GET", "/api/traceability/documents/{doc_id}") == 1


def test_new_account_notification_and_email_routes_are_registered():
    routes = {
        (method, getattr(route, "path", None))
        for route in app.router.routes
        for method in (getattr(route, "methods", None) or set())
    }

    assert ("POST", "/api/auth/password-reset/request") in routes
    assert ("POST", "/api/auth/password-reset/confirm") in routes
    assert ("POST", "/api/auth/change-temporary-password") in routes
    assert ("GET", "/api/notifications/unread-count") in routes
    assert ("POST", "/api/reports/audit-runs/{run_id}/email") in routes
    assert ("GET", "/api/schedule-assignees") in routes
