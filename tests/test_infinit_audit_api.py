"""
Infinit-Audit API Tests
Tests for: Authentication, Dashboard, Audits, Run Audits, Reports, PDF Export
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestHealthAndAuth:
    """Health check and authentication tests"""
    
    def test_health_endpoint(self):
        """Test API health endpoint"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        print("✓ Health endpoint working")
    
    def test_root_endpoint(self):
        """Test API root endpoint"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert "Infinit-Audit" in data["message"]
        print("✓ Root endpoint working")
    
    def test_login_success(self):
        """Test admin login with valid credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@infinit-audit.co.uk",
            "password": "admin123"
        })
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["email"] == "admin@infinit-audit.co.uk"
        assert data["user"]["role"] == "admin"
        print("✓ Admin login successful")
    
    def test_login_invalid_credentials(self):
        """Test login with invalid credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "wrong@example.com",
            "password": "wrongpass"
        })
        assert response.status_code == 401
        print("✓ Invalid credentials rejected correctly")
    
    def test_get_me_authenticated(self):
        """Test getting current user info"""
        # First login
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@infinit-audit.co.uk",
            "password": "admin123"
        })
        token = login_response.json()["token"]
        
        # Get user info
        response = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["email"] == "admin@infinit-audit.co.uk"
        assert data["role"] == "admin"
        print("✓ Get current user info working")


class TestDashboard:
    """Dashboard statistics tests"""
    
    @pytest.fixture
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@infinit-audit.co.uk",
            "password": "admin123"
        })
        return response.json()["token"]
    
    def test_dashboard_stats(self, auth_token):
        """Test dashboard statistics endpoint"""
        response = requests.get(
            f"{BASE_URL}/api/dashboard/stats",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "total_audits" in data
        assert "total_runs" in data
        assert "completed_runs" in data
        assert "pass_rate" in data
        assert "total_users" in data
        print(f"✓ Dashboard stats: {data['total_audits']} audits, {data['total_runs']} runs, {data['pass_rate']}% pass rate")


class TestAudits:
    """Audit template CRUD tests"""
    
    @pytest.fixture
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@infinit-audit.co.uk",
            "password": "admin123"
        })
        return response.json()["token"]
    
    def test_get_audits(self, auth_token):
        """Test getting list of audits"""
        response = requests.get(
            f"{BASE_URL}/api/audits",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Got {len(data)} audit templates")
    
    def test_create_audit(self, auth_token):
        """Test creating a new audit template"""
        audit_data = {
            "name": "TEST_API_Audit_Template",
            "description": "Test audit created by API test",
            "pass_rate": 80,
            "is_private": False,
            "questions": [
                {
                    "text": "Is the area clean?",
                    "enable_scoring": True,
                    "required": True,
                    "order": 0,
                    "custom_responses": [
                        {"label": "Yes", "value": "yes", "score": 1.0, "is_negative": False},
                        {"label": "No", "value": "no", "score": 0.0, "is_negative": True}
                    ]
                }
            ]
        }
        response = requests.post(
            f"{BASE_URL}/api/audits",
            headers={"Authorization": f"Bearer {auth_token}"},
            json=audit_data
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "TEST_API_Audit_Template"
        assert len(data["questions"]) == 1
        print(f"✓ Created audit template: {data['id']}")
        return data["id"]


class TestRunAudits:
    """Run audit tests"""
    
    @pytest.fixture
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@infinit-audit.co.uk",
            "password": "admin123"
        })
        return response.json()["token"]
    
    def test_get_run_audits(self, auth_token):
        """Test getting list of run audits"""
        response = requests.get(
            f"{BASE_URL}/api/run-audits",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Got {len(data)} run audits")
    
    def test_get_completed_run_audits(self, auth_token):
        """Test getting completed run audits"""
        response = requests.get(
            f"{BASE_URL}/api/run-audits?completed=true",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # All should be completed
        for run in data:
            assert run["completed"] == True
        print(f"✓ Got {len(data)} completed run audits")


class TestReportsAndPDF:
    """Reports and PDF export tests"""
    
    @pytest.fixture
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@infinit-audit.co.uk",
            "password": "admin123"
        })
        return response.json()["token"]
    
    def test_pdf_export(self, auth_token):
        """Test PDF export for a completed audit"""
        # First get a completed run audit
        response = requests.get(
            f"{BASE_URL}/api/run-audits?completed=true",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        runs = response.json()
        
        if len(runs) > 0:
            run_id = runs[0]["id"]
            # Test PDF export
            pdf_response = requests.get(
                f"{BASE_URL}/api/run-audits/{run_id}/pdf",
                headers={"Authorization": f"Bearer {auth_token}"}
            )
            assert pdf_response.status_code == 200
            assert pdf_response.headers.get("content-type") == "application/pdf"
            assert len(pdf_response.content) > 0
            print(f"✓ PDF export working - {len(pdf_response.content)} bytes")
        else:
            pytest.skip("No completed audits to test PDF export")
    
    def test_run_audit_details(self, auth_token):
        """Test getting detailed run audit info"""
        # First get a completed run audit
        response = requests.get(
            f"{BASE_URL}/api/run-audits?completed=true",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        runs = response.json()
        
        if len(runs) > 0:
            run_id = runs[0]["id"]
            details_response = requests.get(
                f"{BASE_URL}/api/run-audits/{run_id}/details",
                headers={"Authorization": f"Bearer {auth_token}"}
            )
            assert details_response.status_code == 200
            data = details_response.json()
            assert "enriched_answers" in data
            assert "questions" in data
            print(f"✓ Run audit details working")
        else:
            pytest.skip("No completed audits to test details")


class TestResponseGroups:
    """Response groups tests"""
    
    @pytest.fixture
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@infinit-audit.co.uk",
            "password": "admin123"
        })
        return response.json()["token"]
    
    def test_get_response_groups(self, auth_token):
        """Test getting response groups"""
        response = requests.get(
            f"{BASE_URL}/api/response-groups",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Got {len(data)} response groups")


class TestAuditTypes:
    """Audit types tests"""
    
    @pytest.fixture
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@infinit-audit.co.uk",
            "password": "admin123"
        })
        return response.json()["token"]
    
    def test_get_audit_types(self, auth_token):
        """Test getting audit types"""
        response = requests.get(
            f"{BASE_URL}/api/audit-types",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Got {len(data)} audit types")


class TestCompanies:
    """Company management tests"""
    
    @pytest.fixture
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@infinit-audit.co.uk",
            "password": "admin123"
        })
        return response.json()["token"]
    
    def test_get_companies(self, auth_token):
        """Test getting companies list"""
        response = requests.get(
            f"{BASE_URL}/api/companies",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Got {len(data)} companies")


class TestScheduledAudits:
    """Scheduled audits tests"""
    
    @pytest.fixture
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@infinit-audit.co.uk",
            "password": "admin123"
        })
        return response.json()["token"]
    
    def test_get_scheduled_audits(self, auth_token):
        """Test getting scheduled audits"""
        response = requests.get(
            f"{BASE_URL}/api/scheduled-audits",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Got {len(data)} scheduled audits")
    
    def test_get_my_schedule(self, auth_token):
        """Test getting user's scheduled audits"""
        response = requests.get(
            f"{BASE_URL}/api/scheduled-audits/my-schedule",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Got {len(data)} scheduled audits for current user")


class TestUsers:
    """User management tests (admin only)"""
    
    @pytest.fixture
    def auth_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@infinit-audit.co.uk",
            "password": "admin123"
        })
        return response.json()["token"]
    
    def test_get_users(self, auth_token):
        """Test getting users list"""
        response = requests.get(
            f"{BASE_URL}/api/users",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0  # At least admin user
        print(f"✓ Got {len(data)} users")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
