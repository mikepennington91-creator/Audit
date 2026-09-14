import os
import sys
from pathlib import Path


os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app_core.action_references import action_reference_number  # noqa: E402
from database import _WhereBuilder  # noqa: E402


def test_action_reference_numbers_are_strict_and_case_insensitive():
    assert action_reference_number("A1") == 1
    assert action_reference_number("a204") == 204
    assert action_reference_number("Action 4") is None


def test_database_not_equal_query_includes_missing_values():
    builder = _WhereBuilder()
    sql = builder.build({"assigned_user_id": {"$ne": "user-1"}})
    assert "IS NULL" in sql
    assert "<>" in sql
    assert builder.args == ["user-1"]
