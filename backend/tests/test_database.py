import asyncio
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import PostgresCursor, _WhereBuilder, _apply_projection, _decode_document  # noqa: E402


def build_where(query):
    builder = _WhereBuilder()
    return builder.build(query), builder.args


def test_equality_and_boolean_queries_use_bound_values():
    sql, args = build_where({"company_id": "company-1", "completed": True})
    assert sql == "data ->> 'company_id' = $2 AND data ->> 'completed' = $3"
    assert args == ["company-1", "true"]


def test_or_and_null_match_missing_or_explicit_null():
    sql, args = build_where(
        {"$or": [{"company_id": "company-1"}, {"company_id": None}]}
    )
    assert " OR " in sql
    assert "IS NULL" in sql
    assert "'null'::jsonb" in sql
    assert args == ["company-1"]


def test_in_and_date_range_queries():
    sql, args = build_where(
        {
            "status": {"$in": ["pending", "overdue"]},
            "completed_at": {"$gte": "2026-01-01", "$lte": "2026-02-01"},
        }
    )
    assert "ANY($2::text[])" in sql
    assert ">= $3" in sql
    assert "<= $4" in sql
    assert args == [["pending", "overdue"], "2026-01-01", "2026-02-01"]


def test_case_insensitive_equality_uses_lowercase_comparison():
    sql, args = build_where({"email": {"$ieq": "Mike@Example.COM"}})
    assert sql == "(LOWER(data ->> 'email') = LOWER($2))"
    assert args == ["Mike@Example.COM"]


def test_projection_removes_password_without_mutating_document():
    document = {"id": "user-1", "email": "user@example.com", "password": "secret"}
    projected = _apply_projection(document, {"_id": 0, "password": 0})
    assert projected == {"id": "user-1", "email": "user@example.com"}
    assert document["password"] == "secret"


def test_asyncpg_jsonb_text_is_decoded_to_a_document():
    assert _decode_document('{"id":"audit-1","completed":true}') == {
        "id": "audit-1",
        "completed": True,
    }


def test_exclusion_projection_is_applied_in_postgres_before_transfer():
    class Connection:
        def __init__(self):
            self.sql = ""

        async def fetch(self, sql, *args):
            self.sql = sql
            return [{"data": '{"id":"run-1","answers":[]}'}]

    class Database:
        connection = Connection()

    class Collection:
        name = "run_audits"
        database = Database()

    cursor = PostgresCursor(Collection(), {}, {"_id": 0, "answers": 0, "signature": 0})
    assert asyncio.run(cursor.to_list(5)) == [{"id": "run-1"}]
    assert "data - ARRAY['answers', 'signature']::text[]" in Collection.database.connection.sql
