"""
Infinit-Audit New Features Tests
Tests for: Lines/Shifts CRUD, Role System, New Question Types
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
SYSTEM_ADMIN_EMAIL = "admin@infinit-audit.co.uk"
SYSTEM_ADMIN_PASSWORD = "admin123"


class TestLinesShiftsCRUD:
    """Lines/Shifts CRUD operations tests"""
    
    @pytest.fixture
    def auth_token(self):
        """Get system admin auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": SYSTEM_ADMIN_EMAIL,
            "password": SYSTEM_ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        return response.json()["token"]
    
    def test_get_lines_shifts(self, auth_token):
        """Test getting list of lines/shifts"""
        response = requests.get(
            f"{BASE_URL}/api/lines-shifts",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Got {len(data)} lines/shifts")
        return data
    
    def test_create_line_shift(self, auth_token):
        """Test creating a new line/shift"""
        line_data = {"title": "TEST_Production_Line_1"}
        response = requests.post(
            f"{BASE_URL}/api/lines-shifts",
            headers={"Authorization": f"Bearer {auth_token}"},
            json=line_data
        )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "TEST_Production_Line_1"
        assert "id" in data
        assert "created_at" in data
        print(f"✓ Created line/shift: {data['id']}")
        return data["id"]
    
    def test_create_and_get_line_shift(self, auth_token):
        """Test creating and then retrieving a line/shift"""
        # Create
        line_data = {"title": "TEST_Morning_Shift"}
        create_response = requests.post(
            f"{BASE_URL}/api/lines-shifts",
            headers={"Authorization": f"Bearer {auth_token}"},
            json=line_data
        )
        assert create_response.status_code == 200
        created = create_response.json()
        line_id = created["id"]
        
        # Get by ID
        get_response = requests.get(
            f"{BASE_URL}/api/lines-shifts/{line_id}",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert get_response.status_code == 200
        fetched = get_response.json()
        assert fetched["title"] == "TEST_Morning_Shift"
        assert fetched["id"] == line_id
        print(f"✓ Created and verified line/shift: {line_id}")
        return line_id
    
    def test_update_line_shift(self, auth_token):
        """Test updating a line/shift"""
        # Create first
        create_response = requests.post(
            f"{BASE_URL}/api/lines-shifts",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"title": "TEST_Original_Title"}
        )
        assert create_response.status_code == 200
        line_id = create_response.json()["id"]
        
        # Update
        update_response = requests.put(
            f"{BASE_URL}/api/lines-shifts/{line_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"title": "TEST_Updated_Title"}
        )
        assert update_response.status_code == 200
        updated = update_response.json()
        assert updated["title"] == "TEST_Updated_Title"
        
        # Verify update persisted
        get_response = requests.get(
            f"{BASE_URL}/api/lines-shifts/{line_id}",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert get_response.status_code == 200
        assert get_response.json()["title"] == "TEST_Updated_Title"
        print(f"✓ Updated line/shift: {line_id}")
        return line_id
    
    def test_delete_line_shift(self, auth_token):
        """Test deleting a line/shift"""
        # Create first
        create_response = requests.post(
            f"{BASE_URL}/api/lines-shifts",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"title": "TEST_To_Delete"}
        )
        assert create_response.status_code == 200
        line_id = create_response.json()["id"]
        
        # Delete
        delete_response = requests.delete(
            f"{BASE_URL}/api/lines-shifts/{line_id}",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert delete_response.status_code == 200
        
        # Verify deleted
        get_response = requests.get(
            f"{BASE_URL}/api/lines-shifts/{line_id}",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert get_response.status_code == 404
        print(f"✓ Deleted line/shift: {line_id}")


class TestRoleSystem:
    """Role system tests - system_admin, company_admin, audit_creator, user"""
    
    @pytest.fixture
    def system_admin_token(self):
        """Get system admin auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": SYSTEM_ADMIN_EMAIL,
            "password": SYSTEM_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return response.json()["token"]
    
    def test_system_admin_role(self, system_admin_token):
        """Test that system admin has correct role"""
        response = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {system_admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["role"] == "system_admin"
        print(f"✓ System admin role verified: {data['role']}")
    
    def test_system_admin_can_access_companies(self, system_admin_token):
        """Test that system admin can access companies endpoint"""
        response = requests.get(
            f"{BASE_URL}/api/companies",
            headers={"Authorization": f"Bearer {system_admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ System admin can access companies: {len(data)} found")
    
    def test_system_admin_can_create_company(self, system_admin_token):
        """Test that system admin can create a company"""
        company_data = {
            "name": "TEST_Company_Ltd",
            "description": "Test company created by API test"
        }
        response = requests.post(
            f"{BASE_URL}/api/companies",
            headers={"Authorization": f"Bearer {system_admin_token}"},
            json=company_data
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "TEST_Company_Ltd"
        assert "id" in data
        print(f"✓ System admin created company: {data['id']}")
        return data["id"]
    
    def test_system_admin_can_access_all_users(self, system_admin_token):
        """Test that system admin can access all users"""
        response = requests.get(
            f"{BASE_URL}/api/users",
            headers={"Authorization": f"Bearer {system_admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0
        print(f"✓ System admin can access all users: {len(data)} found")
    
    def test_create_user_with_different_roles(self, system_admin_token):
        """Test creating users with different roles"""
        import uuid
        unique_id = str(uuid.uuid4())[:8]
        
        roles_to_test = ['user', 'audit_creator', 'company_admin']
        created_users = []
        
        for role in roles_to_test:
            user_data = {
                "email": f"test_{role}_{unique_id}@test.com",
                "password": "TestPass123!",
                "name": f"Test {role.replace('_', ' ').title()}",
                "role": role
            }
            response = requests.post(
                f"{BASE_URL}/api/auth/register",
                json=user_data
            )
            assert response.status_code == 200, f"Failed to create {role}: {response.text}"
            data = response.json()
            assert data["user"]["role"] == role
            created_users.append(data["user"]["id"])
            print(f"✓ Created user with role: {role}")
        
        return created_users


class TestNewQuestionTypes:
    """Tests for new question types: text, number, alphanumeric"""
    
    @pytest.fixture
    def auth_token(self):
        """Get system admin auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": SYSTEM_ADMIN_EMAIL,
            "password": SYSTEM_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return response.json()["token"]
    
    def test_create_audit_with_text_question(self, auth_token):
        """Test creating audit with text input question"""
        audit_data = {
            "name": "TEST_Text_Question_Audit",
            "description": "Audit with text input question",
            "pass_rate": None,
            "is_private": False,
            "questions": [
                {
                    "text": "Describe the condition of the equipment",
                    "question_type": "text",
                    "enable_scoring": False,
                    "required": True,
                    "order": 0
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
        assert data["questions"][0]["question_type"] == "text"
        print(f"✓ Created audit with text question: {data['id']}")
        return data["id"]
    
    def test_create_audit_with_number_question(self, auth_token):
        """Test creating audit with number input question"""
        audit_data = {
            "name": "TEST_Number_Question_Audit",
            "description": "Audit with number input question",
            "pass_rate": None,
            "is_private": False,
            "questions": [
                {
                    "text": "What is the temperature reading?",
                    "question_type": "number",
                    "enable_scoring": False,
                    "required": True,
                    "order": 0
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
        assert data["questions"][0]["question_type"] == "number"
        print(f"✓ Created audit with number question: {data['id']}")
        return data["id"]
    
    def test_create_audit_with_alphanumeric_question(self, auth_token):
        """Test creating audit with alphanumeric input question"""
        audit_data = {
            "name": "TEST_Alphanumeric_Question_Audit",
            "description": "Audit with alphanumeric input question",
            "pass_rate": None,
            "is_private": False,
            "questions": [
                {
                    "text": "Enter the batch code",
                    "question_type": "alphanumeric",
                    "enable_scoring": False,
                    "required": True,
                    "order": 0
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
        assert data["questions"][0]["question_type"] == "alphanumeric"
        print(f"✓ Created audit with alphanumeric question: {data['id']}")
        return data["id"]
    
    def test_create_audit_with_mixed_question_types(self, auth_token):
        """Test creating audit with all question types"""
        audit_data = {
            "name": "TEST_Mixed_Question_Types_Audit",
            "description": "Audit with all question types",
            "pass_rate": 80,
            "is_private": False,
            "questions": [
                {
                    "text": "Is the area clean?",
                    "question_type": "response_group",
                    "enable_scoring": True,
                    "required": True,
                    "order": 0,
                    "custom_responses": [
                        {"label": "Yes", "value": "yes", "score": 1.0, "is_negative": False},
                        {"label": "No", "value": "no", "score": 0.0, "is_negative": True}
                    ]
                },
                {
                    "text": "Describe any issues found",
                    "question_type": "text",
                    "enable_scoring": False,
                    "required": False,
                    "order": 1
                },
                {
                    "text": "Temperature reading (°C)",
                    "question_type": "number",
                    "enable_scoring": False,
                    "required": True,
                    "order": 2
                },
                {
                    "text": "Batch code",
                    "question_type": "alphanumeric",
                    "enable_scoring": False,
                    "required": True,
                    "order": 3
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
        assert len(data["questions"]) == 4
        assert data["questions"][0]["question_type"] == "response_group"
        assert data["questions"][1]["question_type"] == "text"
        assert data["questions"][2]["question_type"] == "number"
        assert data["questions"][3]["question_type"] == "alphanumeric"
        print(f"✓ Created audit with mixed question types: {data['id']}")
        return data["id"]


class TestRunAuditWithLineShift:
    """Tests for running audit with line/shift selection"""
    
    @pytest.fixture
    def auth_token(self):
        """Get system admin auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": SYSTEM_ADMIN_EMAIL,
            "password": SYSTEM_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return response.json()["token"]
    
    def test_start_audit_with_line_shift(self, auth_token):
        """Test starting an audit with line/shift selection"""
        # First get available audits
        audits_response = requests.get(
            f"{BASE_URL}/api/audits",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert audits_response.status_code == 200
        audits = audits_response.json()
        
        if len(audits) == 0:
            pytest.skip("No audits available to test")
        
        audit_id = audits[0]["id"]
        
        # Create a line/shift first
        line_response = requests.post(
            f"{BASE_URL}/api/lines-shifts",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={"title": "TEST_Line_For_Audit"}
        )
        assert line_response.status_code == 200
        line_id = line_response.json()["id"]
        
        # Start audit with line/shift
        run_response = requests.post(
            f"{BASE_URL}/api/run-audits",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "audit_id": audit_id,
                "location": "Test Location",
                "line_shift_id": line_id
            }
        )
        assert run_response.status_code == 200
        run_data = run_response.json()
        assert run_data["line_shift_id"] == line_id
        assert run_data["line_shift_title"] == "TEST_Line_For_Audit"
        print(f"✓ Started audit with line/shift: {run_data['id']}")
        return run_data["id"]
    
    def test_start_audit_without_line_shift(self, auth_token):
        """Test starting an audit without line/shift (optional field)"""
        # Get available audits
        audits_response = requests.get(
            f"{BASE_URL}/api/audits",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert audits_response.status_code == 200
        audits = audits_response.json()
        
        if len(audits) == 0:
            pytest.skip("No audits available to test")
        
        audit_id = audits[0]["id"]
        
        # Start audit without line/shift
        run_response = requests.post(
            f"{BASE_URL}/api/run-audits",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "audit_id": audit_id,
                "location": "Test Location"
            }
        )
        assert run_response.status_code == 200
        run_data = run_response.json()
        assert run_data["line_shift_id"] is None
        assert run_data["line_shift_title"] is None
        print(f"✓ Started audit without line/shift: {run_data['id']}")


class TestCleanup:
    """Cleanup test data"""
    
    @pytest.fixture
    def auth_token(self):
        """Get system admin auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": SYSTEM_ADMIN_EMAIL,
            "password": SYSTEM_ADMIN_PASSWORD
        })
        assert response.status_code == 200
        return response.json()["token"]
    
    def test_cleanup_test_lines_shifts(self, auth_token):
        """Clean up TEST_ prefixed lines/shifts"""
        response = requests.get(
            f"{BASE_URL}/api/lines-shifts",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        if response.status_code == 200:
            lines = response.json()
            deleted = 0
            for line in lines:
                if line["title"].startswith("TEST_"):
                    del_response = requests.delete(
                        f"{BASE_URL}/api/lines-shifts/{line['id']}",
                        headers={"Authorization": f"Bearer {auth_token}"}
                    )
                    if del_response.status_code == 200:
                        deleted += 1
            print(f"✓ Cleaned up {deleted} test lines/shifts")
    
    def test_cleanup_test_audits(self, auth_token):
        """Clean up TEST_ prefixed audits"""
        response = requests.get(
            f"{BASE_URL}/api/audits",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        if response.status_code == 200:
            audits = response.json()
            deleted = 0
            for audit in audits:
                if audit["name"].startswith("TEST_"):
                    del_response = requests.delete(
                        f"{BASE_URL}/api/audits/{audit['id']}",
                        headers={"Authorization": f"Bearer {auth_token}"}
                    )
                    if del_response.status_code == 200:
                        deleted += 1
            print(f"✓ Cleaned up {deleted} test audits")
    
    def test_cleanup_test_companies(self, auth_token):
        """Clean up TEST_ prefixed companies"""
        response = requests.get(
            f"{BASE_URL}/api/companies",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        if response.status_code == 200:
            companies = response.json()
            deleted = 0
            for company in companies:
                if company["name"].startswith("TEST_"):
                    del_response = requests.delete(
                        f"{BASE_URL}/api/companies/{company['id']}",
                        headers={"Authorization": f"Bearer {auth_token}"}
                    )
                    if del_response.status_code == 200:
                        deleted += 1
            print(f"✓ Cleaned up {deleted} test companies")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
