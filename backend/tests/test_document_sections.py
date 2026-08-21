"""
Test suite for the new Documents (Traceability) header/table section upgrade:
- Templates support section (header|table), dropdown field type with dropdown_options, date field type
- Document submit supports table_rows in addition to field_values
- PDF export renders header + table
- Template edit increments version and preserves section/dropdown_options
"""
import pytest
import requests
import os

def _load_backend_url():
    url = os.environ.get('REACT_APP_BACKEND_URL')
    if not url:
        try:
            with open('/app/frontend/.env') as f:
                for line in f:
                    if line.startswith('REACT_APP_BACKEND_URL='):
                        url = line.split('=', 1)[1].strip()
                        break
        except Exception:
            pass
    assert url, "REACT_APP_BACKEND_URL not set"
    return url.rstrip('/')

BASE_URL = _load_backend_url()

ADMIN_EMAIL = "admin@infinit-audit.co.uk"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.text}"
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def template_payload():
    return {
        "title": "TEST_HeaderTable_Template",
        "document_reference": "TEST-HT-001",
        "fields": [
            {"label": "Supervisor Name", "field_type": "text", "section": "header", "required": True, "order": 0},
            {"label": "Production Date", "field_type": "date", "section": "header", "required": True, "order": 1},
            {"label": "Product", "field_type": "text", "section": "table", "required": True, "order": 2},
            {"label": "Quantity", "field_type": "number", "section": "table", "required": True, "min_value": 0, "max_value": 10000, "order": 3},
            {"label": "Status", "field_type": "dropdown", "section": "table", "required": True,
             "dropdown_options": ["Pass", "Fail", "Rework"], "order": 4},
        ]
    }


class TestTemplateHeaderTable:

    def test_create_template_with_sections(self, auth_headers, template_payload):
        r = requests.post(f"{BASE_URL}/api/traceability/templates", json=template_payload, headers=auth_headers)
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["title"] == template_payload["title"]
        assert t["version"] == 1
        assert len(t["fields"]) == 5

        header_fields = [f for f in t["fields"] if f["section"] == "header"]
        table_fields = [f for f in t["fields"] if f["section"] == "table"]
        assert len(header_fields) == 2
        assert len(table_fields) == 3

        # Date field preserved
        date_f = next(f for f in header_fields if f["label"] == "Production Date")
        assert date_f["field_type"] == "date"

        # Dropdown options preserved
        dd = next(f for f in table_fields if f["label"] == "Status")
        assert dd["field_type"] == "dropdown"
        assert dd["dropdown_options"] == ["Pass", "Fail", "Rework"]

        # Verify GET reads back same shape
        rg = requests.get(f"{BASE_URL}/api/traceability/templates/{t['id']}", headers=auth_headers)
        assert rg.status_code == 200
        fetched = rg.json()
        assert len(fetched["fields"]) == 5
        assert any(f["field_type"] == "dropdown" and f["dropdown_options"] == ["Pass", "Fail", "Rework"] for f in fetched["fields"])

        pytest.template_id = t["id"]

    def test_update_template_increments_version_preserves_sections(self, auth_headers, template_payload):
        tid = pytest.template_id
        # Add a new table column
        new_fields = list(template_payload["fields"]) + [
            {"label": "Notes", "field_type": "blank", "section": "table", "required": False, "order": 5}
        ]
        upd = {"title": "TEST_HeaderTable_v2", "document_reference": "TEST-HT-001", "fields": new_fields}
        r = requests.put(f"{BASE_URL}/api/traceability/templates/{tid}", json=upd, headers=auth_headers)
        assert r.status_code == 200, r.text
        updated = r.json()
        assert updated["version"] == 2
        assert updated["title"] == "TEST_HeaderTable_v2"
        assert len(updated["fields"]) == 6
        # dropdown options still there
        assert any(f["field_type"] == "dropdown" and f.get("dropdown_options") == ["Pass", "Fail", "Rework"]
                   for f in updated["fields"])


class TestDocumentFillHeaderTable:

    @pytest.fixture(scope="class")
    def created_doc(self, auth_headers):
        tid = pytest.template_id
        r = requests.post(f"{BASE_URL}/api/traceability/documents",
                          json={"template_id": tid}, headers=auth_headers)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["completed"] is False
        assert doc.get("table_rows") == []
        return doc

    def test_submit_with_header_and_table_rows(self, auth_headers, created_doc):
        doc = created_doc
        fields = doc["fields"]
        header_fields = [f for f in fields if f["section"] == "header"]
        table_fields = [f for f in fields if f["section"] == "table"]

        sup = next(f for f in header_fields if f["label"] == "Supervisor Name")
        dt = next(f for f in header_fields if f["label"] == "Production Date")
        prod = next(f for f in table_fields if f["label"] == "Product")
        qty = next(f for f in table_fields if f["label"] == "Quantity")
        status = next(f for f in table_fields if f["label"] == "Status")

        submit = {
            "field_values": [
                {"field_id": sup["id"], "value": "John Doe"},
                {"field_id": dt["id"], "value": "2026-01-15"},
            ],
            "table_rows": [
                {prod["id"]: "Widget A", qty["id"]: 100, status["id"]: "Pass"},
                {prod["id"]: "Widget B", qty["id"]: 50, status["id"]: "Fail"},
                {prod["id"]: "Widget C", qty["id"]: 75, status["id"]: "Rework"},
            ],
            "completed": True
        }
        r = requests.put(f"{BASE_URL}/api/traceability/documents/{doc['id']}", json=submit, headers=auth_headers)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["completed"] is True
        assert u["completed_at"] is not None
        assert len(u["field_values"]) == 2
        assert len(u["table_rows"]) == 3
        # verify persistence via GET
        rg = requests.get(f"{BASE_URL}/api/traceability/documents/{doc['id']}", headers=auth_headers)
        assert rg.status_code == 200
        fetched = rg.json()
        assert len(fetched["table_rows"]) == 3
        assert fetched["table_rows"][0][prod["id"]] == "Widget A"
        assert fetched["table_rows"][1][status["id"]] == "Fail"

        pytest.completed_doc_id = doc["id"]

    def test_pdf_export_with_table(self, auth_headers):
        doc_id = pytest.completed_doc_id
        r = requests.get(f"{BASE_URL}/api/traceability/documents/{doc_id}/pdf", headers=auth_headers)
        assert r.status_code == 200, r.text[:500]
        assert r.headers.get("content-type") == "application/pdf"
        assert r.content.startswith(b"%PDF")
        assert len(r.content) > 1000
        print(f"PDF exported: {len(r.content)} bytes")


class TestCleanup:
    def test_delete_template(self, auth_headers):
        tid = pytest.template_id
        r = requests.delete(f"{BASE_URL}/api/traceability/templates/{tid}", headers=auth_headers)
        assert r.status_code == 200


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
