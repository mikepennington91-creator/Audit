"""
Test suite for Infinit-Audit Traceability Document features:
- Template CRUD (create/read/update/delete) with version auto-increment
- Document CRUD - fill in from template
- PDF export of completed documents
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://food-compliance-lab.preview.emergentagent.com').rstrip('/')

ADMIN_EMAIL = "admin@infinit-audit.co.uk"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.text}"
    return {"Authorization": f"Bearer {r.json()['token']}"}


# ---------------- Templates ----------------
class TestTraceabilityTemplates:

    def test_list_templates(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/traceability/templates", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        titles = [t.get("title") for t in data]
        print(f"Templates found: {titles}")

    def test_production_line_checklist_exists(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/traceability/templates", headers=auth_headers)
        data = r.json()
        match = [t for t in data if t.get("title") == "Production Line Checklist"]
        assert len(match) >= 1, "Production Line Checklist template should exist (seeded)"
        t = match[0]
        assert t.get("document_reference") == "SD-PLC-001"
        assert len(t.get("fields", [])) == 6

    def test_create_template_full_lifecycle(self, auth_headers):
        payload = {
            "title": "TEST_Traceability_Template",
            "document_reference": "TEST-REF-001",
            "fields": [
                {"label": "Product Name", "field_type": "text", "required": True, "max_length": 100, "order": 0},
                {"label": "Temperature", "field_type": "number", "required": True, "min_value": -10, "max_value": 100, "order": 1},
                {"label": "Start Time", "field_type": "time", "required": True, "order": 2},
                {"label": "Allergens Checked", "field_type": "checkbox", "required": True, "order": 3},
                {"label": "Notes", "field_type": "blank", "required": False, "max_length": 500, "order": 4},
            ]
        }
        r = requests.post(f"{BASE_URL}/api/traceability/templates", json=payload, headers=auth_headers)
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["title"] == payload["title"]
        assert t["document_reference"] == "TEST-REF-001"
        assert t["version"] == 1
        assert t["authorised_by"]
        assert len(t["fields"]) == 5
        assert t["fields"][0]["label"] == "Product Name"
        assert t["fields"][0]["field_type"] == "text"
        assert t["fields"][0]["max_length"] == 100
        assert t["fields"][1]["field_type"] == "number"
        assert t["fields"][1]["min_value"] == -10
        template_id = t["id"]

        # GET by id
        r2 = requests.get(f"{BASE_URL}/api/traceability/templates/{template_id}", headers=auth_headers)
        assert r2.status_code == 200
        assert r2.json()["id"] == template_id

        # UPDATE - version increments
        upd = {"title": "TEST_Traceability_Updated", "document_reference": "TEST-REF-001",
               "fields": payload["fields"]}
        r3 = requests.put(f"{BASE_URL}/api/traceability/templates/{template_id}", json=upd, headers=auth_headers)
        assert r3.status_code == 200, r3.text
        updated = r3.json()
        assert updated["version"] == 2, f"Version should be 2 after update, got {updated['version']}"
        assert updated["title"] == "TEST_Traceability_Updated"

        # UPDATE again to check version 3
        r4 = requests.put(f"{BASE_URL}/api/traceability/templates/{template_id}", json={"title": "TEST_v3"}, headers=auth_headers)
        assert r4.status_code == 200
        assert r4.json()["version"] == 3

        # DELETE
        rd = requests.delete(f"{BASE_URL}/api/traceability/templates/{template_id}", headers=auth_headers)
        assert rd.status_code == 200

        # Verify deleted
        rg = requests.get(f"{BASE_URL}/api/traceability/templates/{template_id}", headers=auth_headers)
        assert rg.status_code == 404

    def test_delete_nonexistent_template(self, auth_headers):
        r = requests.delete(f"{BASE_URL}/api/traceability/templates/nonexistent-id", headers=auth_headers)
        assert r.status_code == 404


# ---------------- Documents ----------------
class TestTraceabilityDocuments:

    @pytest.fixture(scope="class")
    def template(self, auth_headers):
        payload = {
            "title": "TEST_DocFlow_Template",
            "document_reference": "TEST-DOC-001",
            "fields": [
                {"label": "Product", "field_type": "text", "required": True, "max_length": 50, "order": 0},
                {"label": "Temp", "field_type": "number", "required": True, "min_value": 0, "max_value": 50, "order": 1},
                {"label": "Checked", "field_type": "checkbox", "required": True, "order": 2},
            ]
        }
        r = requests.post(f"{BASE_URL}/api/traceability/templates", json=payload, headers=auth_headers)
        assert r.status_code == 200
        t = r.json()
        yield t
        # Cleanup
        requests.delete(f"{BASE_URL}/api/traceability/templates/{t['id']}", headers=auth_headers)

    def test_create_document_from_template(self, auth_headers, template):
        r = requests.post(f"{BASE_URL}/api/traceability/documents",
                          json={"template_id": template["id"]}, headers=auth_headers)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["template_id"] == template["id"]
        assert doc["template_title"] == template["title"]
        assert doc["document_reference"] == template["document_reference"]
        assert doc["version"] == template["version"]
        assert doc["completed"] is False
        assert len(doc["fields"]) == 3

    def test_submit_document(self, auth_headers, template):
        # Create doc
        r = requests.post(f"{BASE_URL}/api/traceability/documents",
                          json={"template_id": template["id"]}, headers=auth_headers)
        doc = r.json()
        doc_id = doc["id"]
        fields = doc["fields"]

        submit = {
            "field_values": [
                {"field_id": fields[0]["id"], "value": "Widget"},
                {"field_id": fields[1]["id"], "value": 25},
                {"field_id": fields[2]["id"], "value": True},
            ],
            "completed": True
        }
        r2 = requests.put(f"{BASE_URL}/api/traceability/documents/{doc_id}", json=submit, headers=auth_headers)
        assert r2.status_code == 200, r2.text
        updated = r2.json()
        assert updated["completed"] is True
        assert updated["completed_at"] is not None
        assert len(updated["field_values"]) == 3

        # GET to verify
        r3 = requests.get(f"{BASE_URL}/api/traceability/documents/{doc_id}", headers=auth_headers)
        assert r3.status_code == 200
        assert r3.json()["completed"] is True

    def test_list_documents(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/traceability/documents", headers=auth_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_list_documents_filtered_by_template(self, auth_headers, template):
        r = requests.get(f"{BASE_URL}/api/traceability/documents",
                         params={"template_id": template["id"]}, headers=auth_headers)
        assert r.status_code == 200
        docs = r.json()
        for d in docs:
            assert d["template_id"] == template["id"]

    def test_pdf_export(self, auth_headers, template):
        # Create and complete a doc
        r = requests.post(f"{BASE_URL}/api/traceability/documents",
                          json={"template_id": template["id"]}, headers=auth_headers)
        doc = r.json()
        fields = doc["fields"]
        submit = {
            "field_values": [
                {"field_id": fields[0]["id"], "value": "PDFTest"},
                {"field_id": fields[1]["id"], "value": 20},
                {"field_id": fields[2]["id"], "value": True},
            ],
            "completed": True
        }
        requests.put(f"{BASE_URL}/api/traceability/documents/{doc['id']}", json=submit, headers=auth_headers)

        r_pdf = requests.get(f"{BASE_URL}/api/traceability/documents/{doc['id']}/pdf", headers=auth_headers)
        assert r_pdf.status_code == 200, r_pdf.text[:500]
        assert r_pdf.headers.get("content-type") == "application/pdf"
        assert len(r_pdf.content) > 500
        assert r_pdf.content.startswith(b"%PDF")
        print(f"PDF exported: {len(r_pdf.content)} bytes")

    def test_document_not_found(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/traceability/documents/nonexistent", headers=auth_headers)
        assert r.status_code == 404


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
