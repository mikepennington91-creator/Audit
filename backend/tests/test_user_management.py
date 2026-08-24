import os
import sys
from pathlib import Path


os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import admin_scope_query  # noqa: E402


def test_admin_scope_queries_protect_system_and_company_admin_groups():
    assert admin_scope_query({"role": "system_admin"}) == {"role": "system_admin"}
    assert admin_scope_query({"role": "company_admin", "company_id": "company-1"}) == {
        "company_id": "company-1",
        "role": {"$in": ["company_admin", "admin"]},
    }
    assert admin_scope_query({"role": "user", "company_id": "company-1"}) is None
