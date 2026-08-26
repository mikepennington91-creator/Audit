import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402


class FakeDocuments:
    def __init__(self, document):
        self.document = document.copy()
        self.deleted = False

    async def find_one(self, query, projection=None):
        if self.deleted or query.get("id") != self.document.get("id"):
            return None
        return self.document.copy()

    async def update_one(self, query, update):
        if not self.deleted and query.get("id") == self.document.get("id"):
            self.document.update(update["$set"])

    async def delete_one(self, query):
        deleted_count = 0
        if (
            query.get("id") == self.document.get("id")
            and query.get("completed", self.document.get("completed")) == self.document.get("completed")
        ):
            self.deleted = True
            deleted_count = 1
        return type("DeleteResult", (), {"deleted_count": deleted_count})()


class FakeDatabase:
    def __init__(self, document):
        self.traceability_documents = FakeDocuments(document)


def admin(company_id="company-1"):
    return {
        "id": "admin-1",
        "name": "Admin User",
        "role": server.UserRole.COMPANY_ADMIN,
        "company_id": company_id,
    }


def test_admin_can_close_out_in_progress_document(monkeypatch):
    database = FakeDatabase({
        "id": "doc-1",
        "company_id": "company-1",
        "completed": False,
        "field_values": [],
    })
    monkeypatch.setattr(server, "db", database)

    result = asyncio.run(server.close_out_traceability_document("doc-1", admin()))

    assert result["completed"] is True
    assert result["admin_closed_out"] is True
    assert result["closed_out_by"] == "admin-1"
    assert result["closed_out_by_name"] == "Admin User"
    assert result["completed_at"] == result["closed_out_at"]


def test_admin_cannot_delete_completed_document(monkeypatch):
    database = FakeDatabase({"id": "doc-1", "company_id": "company-1", "completed": True})
    monkeypatch.setattr(server, "db", database)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.delete_traceability_document("doc-1", admin()))

    assert exc.value.status_code == 409
    assert database.traceability_documents.deleted is False


def test_company_admin_cannot_manage_another_company_document(monkeypatch):
    database = FakeDatabase({"id": "doc-1", "company_id": "company-2", "completed": False})
    monkeypatch.setattr(server, "db", database)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.close_out_traceability_document("doc-1", admin("company-1")))

    assert exc.value.status_code == 403


def test_admin_can_delete_in_progress_document(monkeypatch):
    database = FakeDatabase({"id": "doc-1", "company_id": "company-1", "completed": False})
    monkeypatch.setattr(server, "db", database)

    result = asyncio.run(server.delete_traceability_document("doc-1", admin()))

    assert result == {"message": "Document deleted"}
    assert database.traceability_documents.deleted is True
