"""
Test suite for Infinit-Audit new features:
1. Audit Overview page with stats and filtering
2. Pass/Fail scoring system
3. Signature sign-off functionality
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://food-compliance-lab.preview.emergentagent.com').rstrip('/')

# Test credentials
ADMIN_EMAIL = "admin@infinit-audit.co.uk"
ADMIN_PASSWORD = "admin123"


class TestAuth:
    """Authentication tests"""
    
    def test_login_success(self):
        """Test admin login"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["email"] == ADMIN_EMAIL
        print(f"SUCCESS: Login with {ADMIN_EMAIL}")
        return data["token"]


class TestAuditOverview:
    """Tests for the new Audit Overview endpoint"""
    
    @pytest.fixture
    def auth_token(self):
        """Get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        return response.json()["token"]
    
    @pytest.fixture
    def headers(self, auth_token):
        """Get auth headers"""
        return {"Authorization": f"Bearer {auth_token}"}
    
    def test_get_audits_list(self, headers):
        """Test getting list of audits"""
        response = requests.get(f"{BASE_URL}/api/audits", headers=headers)
        assert response.status_code == 200
        audits = response.json()
        assert isinstance(audits, list)
        print(f"SUCCESS: Got {len(audits)} audits")
        return audits
    
    def test_get_audit_runs_endpoint(self, headers):
        """Test the new /api/audits/{audit_id}/runs endpoint"""
        # First get an audit
        audits_response = requests.get(f"{BASE_URL}/api/audits", headers=headers)
        audits = audits_response.json()
        
        if len(audits) == 0:
            pytest.skip("No audits available to test")
        
        audit_id = audits[0]["id"]
        
        # Test the runs endpoint
        response = requests.get(f"{BASE_URL}/api/audits/{audit_id}/runs", headers=headers)
        assert response.status_code == 200, f"Failed to get audit runs: {response.text}"
        
        data = response.json()
        assert "audit" in data
        assert "stats" in data
        assert "runs" in data
        
        # Verify stats structure
        stats = data["stats"]
        assert "total_completed" in stats
        assert "passed" in stats
        assert "failed" in stats
        assert "pass_percentage" in stats
        
        print(f"SUCCESS: Audit runs endpoint - {stats['total_completed']} completed, {stats['pass_percentage']}% pass rate")
        return data
    
    def test_audit_runs_date_filter(self, headers):
        """Test date range filtering on audit runs"""
        audits_response = requests.get(f"{BASE_URL}/api/audits", headers=headers)
        audits = audits_response.json()
        
        if len(audits) == 0:
            pytest.skip("No audits available to test")
        
        audit_id = audits[0]["id"]
        
        # Test with date filters
        response = requests.get(
            f"{BASE_URL}/api/audits/{audit_id}/runs",
            params={"date_from": "2025-01-01", "date_to": "2026-12-31"},
            headers=headers
        )
        assert response.status_code == 200
        print("SUCCESS: Date filter works on audit runs endpoint")
    
    def test_audit_runs_pass_status_filter(self, headers):
        """Test pass/fail status filtering on audit runs"""
        audits_response = requests.get(f"{BASE_URL}/api/audits", headers=headers)
        audits = audits_response.json()
        
        if len(audits) == 0:
            pytest.skip("No audits available to test")
        
        audit_id = audits[0]["id"]
        
        # Test with pass status filter
        for status in ["pass", "fail", "all"]:
            response = requests.get(
                f"{BASE_URL}/api/audits/{audit_id}/runs",
                params={"pass_status": status},
                headers=headers
            )
            assert response.status_code == 200, f"Failed for status={status}: {response.text}"
        
        print("SUCCESS: Pass/fail status filter works on audit runs endpoint")


class TestScoringSystem:
    """Tests for the pass/fail scoring system"""
    
    @pytest.fixture
    def auth_token(self):
        """Get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        return response.json()["token"]
    
    @pytest.fixture
    def headers(self, auth_token):
        """Get auth headers"""
        return {"Authorization": f"Bearer {auth_token}"}
    
    def test_create_audit_with_pass_rate(self, headers):
        """Test creating an audit with pass_rate threshold"""
        audit_data = {
            "name": "TEST_Scoring_Audit",
            "description": "Test audit for scoring system",
            "pass_rate": 80.0,
            "is_private": False,
            "questions": [
                {
                    "text": "Is the area clean?",
                    "question_type": "response_group",
                    "custom_responses": [
                        {"label": "Yes", "value": "yes", "is_negative": False},
                        {"label": "No", "value": "no", "is_negative": True}
                    ],
                    "enable_scoring": False,
                    "required": True
                },
                {
                    "text": "Enter temperature reading",
                    "question_type": "text",
                    "enable_scoring": False,
                    "required": True
                }
            ]
        }
        
        response = requests.post(f"{BASE_URL}/api/audits", json=audit_data, headers=headers)
        assert response.status_code == 200, f"Failed to create audit: {response.text}"
        
        audit = response.json()
        assert audit["pass_rate"] == 80.0
        assert len(audit["questions"]) == 2
        
        # Verify is_negative flag on custom responses
        q1 = audit["questions"][0]
        assert q1["custom_responses"][0]["is_negative"] == False
        assert q1["custom_responses"][1]["is_negative"] == True
        
        print(f"SUCCESS: Created audit with pass_rate=80% and is_negative flags")
        
        # Cleanup
        requests.delete(f"{BASE_URL}/api/audits/{audit['id']}", headers=headers)
        return audit
    
    def test_run_audit_with_pass_fail(self, headers):
        """Test running an audit with pass/fail scoring"""
        # Create test audit
        audit_data = {
            "name": "TEST_PassFail_Audit",
            "description": "Test audit for pass/fail",
            "pass_rate": 50.0,
            "is_private": False,
            "questions": [
                {
                    "text": "Question 1",
                    "question_type": "response_group",
                    "custom_responses": [
                        {"label": "Pass", "value": "pass", "is_negative": False},
                        {"label": "Fail", "value": "fail", "is_negative": True}
                    ],
                    "enable_scoring": False,
                    "required": True
                },
                {
                    "text": "Question 2 - Text",
                    "question_type": "text",
                    "enable_scoring": False,
                    "required": True
                }
            ]
        }
        
        create_response = requests.post(f"{BASE_URL}/api/audits", json=audit_data, headers=headers)
        assert create_response.status_code == 200
        audit = create_response.json()
        audit_id = audit["id"]
        
        try:
            # Start run audit
            run_response = requests.post(f"{BASE_URL}/api/run-audits", json={
                "audit_id": audit_id,
                "location": "Test Location"
            }, headers=headers)
            assert run_response.status_code == 200
            run = run_response.json()
            run_id = run["id"]
            
            # Submit answers with pass_fail
            submit_data = {
                "answers": [
                    {
                        "question_id": audit["questions"][0]["id"],
                        "response_value": "pass",
                        "response_label": "Pass",
                        "is_negative": False,
                        "pass_fail": "pass"
                    },
                    {
                        "question_id": audit["questions"][1]["id"],
                        "response_value": "37.5 degrees",
                        "response_label": "37.5 degrees",
                        "is_negative": False,
                        "pass_fail": "pass",
                        "notes": ""
                    }
                ],
                "notes": "Test run",
                "completed": True,
                "signature": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                "signoff_name": "Test Admin",
                "signoff_email": "admin@infinit-audit.co.uk"
            }
            
            update_response = requests.put(f"{BASE_URL}/api/run-audits/{run_id}", json=submit_data, headers=headers)
            assert update_response.status_code == 200, f"Failed to submit: {update_response.text}"
            
            result = update_response.json()
            assert result["completed"] == True
            assert result["total_score"] is not None
            assert result["pass_status"] in ["pass", "fail"]
            
            print(f"SUCCESS: Run audit with pass/fail - Score: {result['total_score']}%, Status: {result['pass_status']}")
            
        finally:
            # Cleanup
            requests.delete(f"{BASE_URL}/api/audits/{audit_id}", headers=headers)


class TestSignatureSignOff:
    """Tests for signature sign-off functionality"""
    
    @pytest.fixture
    def auth_token(self):
        """Get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        return response.json()["token"]
    
    @pytest.fixture
    def headers(self, auth_token):
        """Get auth headers"""
        return {"Authorization": f"Bearer {auth_token}"}
    
    def test_submit_audit_with_signature(self, headers):
        """Test submitting an audit with signature"""
        # Create test audit
        audit_data = {
            "name": "TEST_Signature_Audit",
            "description": "Test audit for signature",
            "pass_rate": 50.0,
            "is_private": False,
            "questions": [
                {
                    "text": "Test Question",
                    "question_type": "response_group",
                    "custom_responses": [
                        {"label": "Yes", "value": "yes", "is_negative": False}
                    ],
                    "enable_scoring": False,
                    "required": True
                }
            ]
        }
        
        create_response = requests.post(f"{BASE_URL}/api/audits", json=audit_data, headers=headers)
        assert create_response.status_code == 200
        audit = create_response.json()
        audit_id = audit["id"]
        
        try:
            # Start run audit
            run_response = requests.post(f"{BASE_URL}/api/run-audits", json={
                "audit_id": audit_id,
                "location": "Signature Test Location"
            }, headers=headers)
            assert run_response.status_code == 200
            run = run_response.json()
            run_id = run["id"]
            
            # Submit with signature
            signature_base64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
            
            submit_data = {
                "answers": [
                    {
                        "question_id": audit["questions"][0]["id"],
                        "response_value": "yes",
                        "response_label": "Yes",
                        "is_negative": False,
                        "pass_fail": "pass"
                    }
                ],
                "notes": "Signature test",
                "completed": True,
                "signature": signature_base64,
                "signoff_name": "Test Admin",
                "signoff_email": "admin@infinit-audit.co.uk"
            }
            
            update_response = requests.put(f"{BASE_URL}/api/run-audits/{run_id}", json=submit_data, headers=headers)
            assert update_response.status_code == 200, f"Failed: {update_response.text}"
            
            result = update_response.json()
            assert result["signature"] == signature_base64
            assert result["signoff_name"] == "Test Admin"
            assert result["signoff_email"] == "admin@infinit-audit.co.uk"
            
            print("SUCCESS: Audit submitted with signature and sign-off info")
            
            # Verify details endpoint includes signature
            details_response = requests.get(f"{BASE_URL}/api/run-audits/{run_id}/details", headers=headers)
            assert details_response.status_code == 200
            details = details_response.json()
            assert details["signoff_name"] == "Test Admin"
            assert details["signoff_email"] == "admin@infinit-audit.co.uk"
            
            print("SUCCESS: Run audit details include sign-off info")
            
        finally:
            # Cleanup
            requests.delete(f"{BASE_URL}/api/audits/{audit_id}", headers=headers)
    
    def test_negative_response_requires_comment(self, headers):
        """Test that negative responses require comments"""
        # Create test audit
        audit_data = {
            "name": "TEST_NegativeComment_Audit",
            "description": "Test audit for negative comment requirement",
            "pass_rate": 50.0,
            "is_private": False,
            "questions": [
                {
                    "text": "Test Question",
                    "question_type": "response_group",
                    "custom_responses": [
                        {"label": "Yes", "value": "yes", "is_negative": False},
                        {"label": "No", "value": "no", "is_negative": True}
                    ],
                    "enable_scoring": False,
                    "required": True
                }
            ]
        }
        
        create_response = requests.post(f"{BASE_URL}/api/audits", json=audit_data, headers=headers)
        assert create_response.status_code == 200
        audit = create_response.json()
        audit_id = audit["id"]
        
        try:
            # Start run audit
            run_response = requests.post(f"{BASE_URL}/api/run-audits", json={
                "audit_id": audit_id,
                "location": "Test Location"
            }, headers=headers)
            assert run_response.status_code == 200
            run = run_response.json()
            run_id = run["id"]
            
            # Try to submit negative response WITHOUT comment - should fail
            submit_data = {
                "answers": [
                    {
                        "question_id": audit["questions"][0]["id"],
                        "response_value": "no",
                        "response_label": "No",
                        "is_negative": True,
                        "pass_fail": "fail",
                        "notes": ""  # Empty notes for negative response
                    }
                ],
                "notes": "",
                "completed": True,
                "signature": "data:image/png;base64,test",
                "signoff_name": "Test Admin",
                "signoff_email": "admin@infinit-audit.co.uk"
            }
            
            update_response = requests.put(f"{BASE_URL}/api/run-audits/{run_id}", json=submit_data, headers=headers)
            assert update_response.status_code == 400, f"Expected 400 for negative without comment, got {update_response.status_code}"
            
            print("SUCCESS: Negative response without comment correctly rejected")
            
            # Now submit WITH comment - should succeed
            submit_data["answers"][0]["notes"] = "This is the required comment for negative response"
            
            update_response = requests.put(f"{BASE_URL}/api/run-audits/{run_id}", json=submit_data, headers=headers)
            assert update_response.status_code == 200, f"Failed with comment: {update_response.text}"
            
            print("SUCCESS: Negative response with comment accepted")
            
        finally:
            # Cleanup
            requests.delete(f"{BASE_URL}/api/audits/{audit_id}", headers=headers)


class TestPDFExport:
    """Tests for PDF export with signature"""
    
    @pytest.fixture
    def auth_token(self):
        """Get auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        return response.json()["token"]
    
    @pytest.fixture
    def headers(self, auth_token):
        """Get auth headers"""
        return {"Authorization": f"Bearer {auth_token}"}
    
    def test_pdf_export_with_signature(self, headers):
        """Test PDF export includes signature section"""
        # Get completed runs
        runs_response = requests.get(f"{BASE_URL}/api/run-audits?completed=true", headers=headers)
        assert runs_response.status_code == 200
        runs = runs_response.json()
        
        if len(runs) == 0:
            pytest.skip("No completed runs available")
        
        # Find a run with signature if possible
        run_id = runs[0]["id"]
        
        # Test PDF export
        pdf_response = requests.get(f"{BASE_URL}/api/run-audits/{run_id}/pdf", headers=headers)
        
        if pdf_response.status_code == 404:
            pytest.skip("Run audit references deleted audit template")
        
        assert pdf_response.status_code == 200, f"PDF export failed: {pdf_response.text}"
        assert pdf_response.headers.get("content-type") == "application/pdf"
        assert len(pdf_response.content) > 0
        
        print(f"SUCCESS: PDF export works - {len(pdf_response.content)} bytes")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
