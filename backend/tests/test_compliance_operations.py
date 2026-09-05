import os
import sys
from datetime import date
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app_core.compliance_operations import calculate_reconciliation
from app_core.schedules import RISK_FREQUENCY, next_occurrence_date
from main import app


def test_mock_recall_reconciliation_includes_waste_and_carryover():
    accounted, percentage = calculate_reconciliation(100, 90, 5, 4)
    assert accounted == 99
    assert percentage == 99


def test_risk_frequencies_use_expected_labels_and_cadence():
    assert RISK_FREQUENCY == {
        "no_risk": "annually",
        "very_low_risk": "quarterly",
        "low_risk": "monthly",
        "medium_risk": "weekly",
        "high_risk": "start_up",
        "very_high_risk": "start_up",
    }


def test_month_end_recurrence_is_calendar_aware():
    assert next_occurrence_date(date(2026, 1, 31), "monthly") == date(2026, 2, 28)
    assert next_occurrence_date(date(2026, 1, 31), "six_monthly") == date(2026, 7, 31)


def test_compliance_routes_are_registered():
    routes = {(method, route.path) for route in app.routes for method in (route.methods or set())}
    assert ("GET", "/api/compliance/summary") in routes
    assert ("POST", "/api/email-deliveries/{event_id}/resend") in routes
    assert ("PUT", "/api/actions/{action_id}/effectiveness") in routes
    assert ("PUT", "/api/scheduled-audits/series/{series_id}/status") in routes
