#!/usr/bin/env python3
"""
Infinit-Audit Backend API Testing Suite
Tests all CRUD operations for users, groups, audits, and run audits
"""

import requests
import sys
import json
from datetime import datetime
from typing import Dict, Any, Optional

class InfinitAuditTester:
    def __init__(self, base_url="https://auditmate-3.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.token = None
        self.admin_token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.created_resources = {
            'users': [],
            'response_groups': [],
            'audit_types': [],
            'audits': [],
            'run_audits': []
        }

    def log(self, message: str, level: str = "INFO"):
        """Log test messages"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {level}: {message}")

    def run_test(self, name: str, method: str, endpoint: str, expected_status: int, 
                 data: Optional[Dict] = None, token: Optional[str] = None) -> tuple[bool, Dict]:
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        
        # Use provided token or default admin token
        auth_token = token or self.admin_token
        if auth_token:
            headers['Authorization'] = f'Bearer {auth_token}'

        self.tests_run += 1
        self.log(f"Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=30)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=30)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=30)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=30)
            else:
                raise ValueError(f"Unsupported method: {method}")

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                self.log(f"✅ {name} - Status: {response.status_code}", "PASS")
            else:
                self.log(f"❌ {name} - Expected {expected_status}, got {response.status_code}", "FAIL")
                if response.text:
                    self.log(f"Response: {response.text[:200]}", "ERROR")

            try:
                response_data = response.json() if response.text else {}
            except:
                response_data = {}

            return success, response_data

        except Exception as e:
            self.log(f"❌ {name} - Error: {str(e)}", "ERROR")
            return False, {}

    def test_health_check(self):
        """Test basic health endpoints"""
        self.log("=== HEALTH CHECK TESTS ===")
        
        # Test root endpoint
        self.run_test("Root Endpoint", "GET", "", 200)
        
        # Test health endpoint
        self.run_test("Health Check", "GET", "health", 200)

    def test_authentication(self):
        """Test authentication endpoints"""
        self.log("=== AUTHENTICATION TESTS ===")
        
        # Test admin login
        success, response = self.run_test(
            "Admin Login",
            "POST",
            "auth/login",
            200,
            data={"email": "admin@infinit-audit.co.uk", "password": "admin123"}
        )
        
        if success and 'token' in response:
            self.admin_token = response['token']
            self.log("✅ Admin token obtained successfully")
        else:
            self.log("❌ Failed to get admin token - stopping tests", "CRITICAL")
            return False

        # Test user registration
        test_user_data = {
            "email": f"test_user_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "TestPass123!",
            "name": "Test User",
            "role": "user"
        }
        
        success, response = self.run_test(
            "User Registration",
            "POST",
            "auth/register",
            200,
            data=test_user_data
        )
        
        if success and 'user' in response:
            self.created_resources['users'].append(response['user']['id'])
            if 'token' in response:
                self.token = response['token']

        # Test /auth/me endpoint
        self.run_test("Get Current User", "GET", "auth/me", 200)
        
        return True

    def test_user_management(self):
        """Test user management endpoints (admin only)"""
        self.log("=== USER MANAGEMENT TESTS ===")
        
        # Get all users
        success, users = self.run_test("Get All Users", "GET", "users", 200)
        
        if success and isinstance(users, list):
            self.log(f"Found {len(users)} users in system")

        # Create a new user via admin
        new_user_data = {
            "email": f"admin_created_{datetime.now().strftime('%H%M%S')}@test.com",
            "password": "AdminPass123!",
            "name": "Admin Created User",
            "role": "audit_creator"
        }
        
        success, response = self.run_test(
            "Admin Create User",
            "POST",
            "auth/register",
            200,
            data=new_user_data
        )
        
        if success and 'user' in response:
            user_id = response['user']['id']
            self.created_resources['users'].append(user_id)
            
            # Test user update
            update_data = {"name": "Updated Name", "role": "user"}
            self.run_test(
                "Update User",
                "PUT",
                f"users/{user_id}",
                200,
                data=update_data
            )

    def test_response_groups(self):
        """Test response groups CRUD operations"""
        self.log("=== RESPONSE GROUPS TESTS ===")
        
        # Create Pass/Fail response group
        pass_fail_data = {
            "name": "Pass/Fail",
            "options": [
                {"label": "Pass", "value": "pass", "score": 1.0},
                {"label": "Fail", "value": "fail", "score": 0.0}
            ],
            "enable_scoring": True
        }
        
        success, response = self.run_test(
            "Create Pass/Fail Response Group",
            "POST",
            "response-groups",
            200,
            data=pass_fail_data
        )
        
        if success and 'id' in response:
            group_id = response['id']
            self.created_resources['response_groups'].append(group_id)
            
            # Test get specific response group
            self.run_test(
                "Get Response Group",
                "GET",
                f"response-groups/{group_id}",
                200
            )

        # Create Yes/No response group
        yes_no_data = {
            "name": "Yes/No",
            "options": [
                {"label": "Yes", "value": "yes"},
                {"label": "No", "value": "no"}
            ],
            "enable_scoring": False
        }
        
        success, response = self.run_test(
            "Create Yes/No Response Group",
            "POST",
            "response-groups",
            200,
            data=yes_no_data
        )
        
        if success and 'id' in response:
            self.created_resources['response_groups'].append(response['id'])

        # Get all response groups
        self.run_test("Get All Response Groups", "GET", "response-groups", 200)

    def test_audit_types(self):
        """Test audit types CRUD operations"""
        self.log("=== AUDIT TYPES TESTS ===")
        
        # Create audit types
        audit_types = [
            {"name": "Food Safety", "description": "General food safety inspection"},
            {"name": "HACCP", "description": "Hazard Analysis Critical Control Points"},
            {"name": "GMP", "description": "Good Manufacturing Practices"}
        ]
        
        for audit_type_data in audit_types:
            success, response = self.run_test(
                f"Create Audit Type: {audit_type_data['name']}",
                "POST",
                "audit-types",
                200,
                data=audit_type_data
            )
            
            if success and 'id' in response:
                self.created_resources['audit_types'].append(response['id'])

        # Get all audit types
        self.run_test("Get All Audit Types", "GET", "audit-types", 200)

    def test_audits(self):
        """Test audits CRUD operations"""
        self.log("=== AUDITS TESTS ===")
        
        # Create a comprehensive audit
        audit_data = {
            "name": "Kitchen Hygiene Inspection",
            "description": "Comprehensive kitchen hygiene and safety audit",
            "audit_type_id": self.created_resources['audit_types'][0] if self.created_resources['audit_types'] else None,
            "pass_rate": 85.0,
            "is_private": False,
            "questions": [
                {
                    "text": "Are all surfaces clean and sanitized?",
                    "response_group_id": self.created_resources['response_groups'][0] if self.created_resources['response_groups'] else None,
                    "enable_scoring": True,
                    "required": True,
                    "order": 0
                },
                {
                    "text": "Is proper hand washing procedure followed?",
                    "custom_responses": [
                        {"label": "Excellent", "value": "excellent", "score": 1.0},
                        {"label": "Good", "value": "good", "score": 0.8},
                        {"label": "Poor", "value": "poor", "score": 0.3}
                    ],
                    "enable_scoring": True,
                    "required": True,
                    "order": 1
                },
                {
                    "text": "Additional observations?",
                    "response_group_id": self.created_resources['response_groups'][1] if len(self.created_resources['response_groups']) > 1 else None,
                    "enable_scoring": False,
                    "required": False,
                    "order": 2
                }
            ]
        }
        
        success, response = self.run_test(
            "Create Comprehensive Audit",
            "POST",
            "audits",
            200,
            data=audit_data
        )
        
        if success and 'id' in response:
            audit_id = response['id']
            self.created_resources['audits'].append(audit_id)
            
            # Test get specific audit
            self.run_test(
                "Get Audit Details",
                "GET",
                f"audits/{audit_id}",
                200
            )
            
            # Test audit update
            update_data = {
                "name": "Updated Kitchen Hygiene Inspection",
                "pass_rate": 90.0
            }
            self.run_test(
                "Update Audit",
                "PUT",
                f"audits/{audit_id}",
                200,
                data=update_data
            )

        # Get all audits
        self.run_test("Get All Audits", "GET", "audits", 200)

    def test_run_audits(self):
        """Test run audits functionality"""
        self.log("=== RUN AUDITS TESTS ===")
        
        if not self.created_resources['audits']:
            self.log("No audits available for run audit tests", "WARNING")
            return

        audit_id = self.created_resources['audits'][0]
        
        # Start a run audit
        run_data = {
            "audit_id": audit_id,
            "location": "Test Kitchen A"
        }
        
        success, response = self.run_test(
            "Start Run Audit",
            "POST",
            "run-audits",
            200,
            data=run_data
        )
        
        if success and 'id' in response:
            run_id = response['id']
            self.created_resources['run_audits'].append(run_id)
            
            # Submit answers
            submit_data = {
                "answers": [
                    {
                        "question_id": "dummy_question_1",
                        "response_value": "pass",
                        "response_label": "Pass",
                        "score": 1.0,
                        "notes": "All surfaces properly cleaned",
                        "photos": []
                    }
                ],
                "notes": "Overall good condition",
                "completed": True
            }
            
            self.run_test(
                "Submit Run Audit",
                "PUT",
                f"run-audits/{run_id}",
                200,
                data=submit_data
            )
            
            # Get run audit details
            self.run_test(
                "Get Run Audit Details",
                "GET",
                f"run-audits/{run_id}",
                200
            )

        # Get all run audits
        self.run_test("Get All Run Audits", "GET", "run-audits", 200)
        
        # Get completed run audits
        self.run_test("Get Completed Run Audits", "GET", "run-audits?completed=true", 200)

    def test_dashboard_stats(self):
        """Test dashboard statistics endpoint"""
        self.log("=== DASHBOARD STATS TESTS ===")
        
        success, stats = self.run_test("Get Dashboard Stats", "GET", "dashboard/stats", 200)
        
        if success:
            expected_fields = ['total_audits', 'total_runs', 'completed_runs', 'passed_runs', 'pass_rate', 'total_users']
            for field in expected_fields:
                if field in stats:
                    self.log(f"✅ Stats field '{field}': {stats[field]}")
                else:
                    self.log(f"❌ Missing stats field: {field}", "WARNING")

    def test_photo_upload(self):
        """Test photo upload functionality"""
        self.log("=== PHOTO UPLOAD TESTS ===")
        
        # Create a simple test image (1x1 pixel PNG)
        import base64
        
        # Minimal PNG data (1x1 transparent pixel)
        png_data = base64.b64decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU8'
            'AAABJRU5ErkJggg=='
        )
        
        try:
            files = {'file': ('test.png', png_data, 'image/png')}
            headers = {}
            if self.admin_token:
                headers['Authorization'] = f'Bearer {self.admin_token}'
            
            response = requests.post(
                f"{self.base_url}/upload-photo",
                files=files,
                headers=headers,
                timeout=30
            )
            
            if response.status_code == 200:
                self.tests_passed += 1
                self.log("✅ Photo Upload - Status: 200", "PASS")
            else:
                self.log(f"❌ Photo Upload - Expected 200, got {response.status_code}", "FAIL")
                
        except Exception as e:
            self.log(f"❌ Photo Upload - Error: {str(e)}", "ERROR")
        
        self.tests_run += 1

    def test_new_features(self):
        """Test new features: PDF export, bulk import, scheduling, company dashboard"""
        self.log("=== NEW FEATURES TESTS ===")
        
        # Test company management first
        self.test_companies()
        
        # Test PDF export (requires completed run audit)
        self.test_pdf_export()
        
        # Test bulk user import
        self.test_bulk_import()
        
        # Test audit scheduling
        self.test_audit_scheduling()
        
        # Test company dashboard
        self.test_company_dashboard()

    def test_companies(self):
        """Test company CRUD operations"""
        self.log("=== COMPANY MANAGEMENT TESTS ===")
        
        # Create a test company
        company_data = {
            "name": "Test Company Ltd",
            "description": "A test company for audit testing"
        }
        
        success, response = self.run_test(
            "Create Company",
            "POST",
            "companies",
            200,
            data=company_data
        )
        
        if success and 'id' in response:
            company_id = response['id']
            self.created_resources.setdefault('companies', []).append(company_id)
            
            # Test get specific company
            self.run_test(
                "Get Company Details",
                "GET",
                f"companies/{company_id}",
                200
            )
            
            # Test company update
            update_data = {"name": "Updated Test Company Ltd"}
            self.run_test(
                "Update Company",
                "PUT",
                f"companies/{company_id}",
                200,
                data=update_data
            )

        # Get all companies
        self.run_test("Get All Companies", "GET", "companies", 200)

    def test_pdf_export(self):
        """Test PDF export functionality"""
        self.log("=== PDF EXPORT TESTS ===")
        
        if not self.created_resources['run_audits']:
            self.log("No completed run audits available for PDF export test", "WARNING")
            return
        
        run_id = self.created_resources['run_audits'][0]
        
        # Test PDF export
        try:
            headers = {}
            if self.admin_token:
                headers['Authorization'] = f'Bearer {self.admin_token}'
            
            response = requests.get(
                f"{self.base_url}/run-audits/{run_id}/pdf",
                headers=headers,
                timeout=30
            )
            
            if response.status_code == 200 and response.headers.get('content-type') == 'application/pdf':
                self.tests_passed += 1
                self.log("✅ PDF Export - Status: 200, Content-Type: application/pdf", "PASS")
            else:
                self.log(f"❌ PDF Export - Status: {response.status_code}, Content-Type: {response.headers.get('content-type')}", "FAIL")
                
        except Exception as e:
            self.log(f"❌ PDF Export - Error: {str(e)}", "ERROR")
        
        self.tests_run += 1

    def test_bulk_import(self):
        """Test bulk user import functionality"""
        self.log("=== BULK IMPORT TESTS ===")
        
        # Test download template
        try:
            headers = {}
            if self.admin_token:
                headers['Authorization'] = f'Bearer {self.admin_token}'
            
            response = requests.get(
                f"{self.base_url}/users/export-template",
                headers=headers,
                timeout=30
            )
            
            if response.status_code == 200 and 'text/csv' in response.headers.get('content-type', ''):
                self.tests_passed += 1
                self.log("✅ Download CSV Template - Status: 200, Content-Type: text/csv", "PASS")
            else:
                self.log(f"❌ Download CSV Template - Status: {response.status_code}", "FAIL")
                
        except Exception as e:
            self.log(f"❌ Download CSV Template - Error: {str(e)}", "ERROR")
        
        self.tests_run += 1
        
        # Test bulk import with sample CSV
        import io
        csv_content = """email,name,role,company_id,password
test_bulk1@example.com,Test Bulk User 1,user,,TempPass123!
test_bulk2@example.com,Test Bulk User 2,audit_creator,,SecurePass456!"""
        
        try:
            files = {'file': ('test_users.csv', io.StringIO(csv_content).getvalue().encode(), 'text/csv')}
            headers = {}
            if self.admin_token:
                headers['Authorization'] = f'Bearer {self.admin_token}'
            
            response = requests.post(
                f"{self.base_url}/users/bulk-import",
                files=files,
                headers=headers,
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                if result.get('success', 0) > 0:
                    self.tests_passed += 1
                    self.log(f"✅ Bulk Import - {result.get('success')} users imported successfully", "PASS")
                else:
                    self.log(f"❌ Bulk Import - No users imported: {result}", "FAIL")
            else:
                self.log(f"❌ Bulk Import - Status: {response.status_code}", "FAIL")
                
        except Exception as e:
            self.log(f"❌ Bulk Import - Error: {str(e)}", "ERROR")
        
        self.tests_run += 1

    def test_audit_scheduling(self):
        """Test audit scheduling functionality"""
        self.log("=== AUDIT SCHEDULING TESTS ===")
        
        if not self.created_resources['audits'] or not self.created_resources['users']:
            self.log("No audits or users available for scheduling test", "WARNING")
            return
        
        # Create a scheduled audit
        from datetime import datetime, timedelta
        future_date = (datetime.now() + timedelta(days=7)).isoformat()
        
        schedule_data = {
            "audit_id": self.created_resources['audits'][0],
            "assigned_to": self.created_resources['users'][0],
            "scheduled_date": future_date,
            "location": "Test Location",
            "notes": "Test scheduling",
            "reminder_days": 1
        }
        
        success, response = self.run_test(
            "Create Scheduled Audit",
            "POST",
            "scheduled-audits",
            200,
            data=schedule_data
        )
        
        if success and 'id' in response:
            schedule_id = response['id']
            self.created_resources.setdefault('scheduled_audits', []).append(schedule_id)
            
            # Test get scheduled audits
            self.run_test(
                "Get Scheduled Audits",
                "GET",
                "scheduled-audits",
                200
            )
            
            # Test get my schedule
            self.run_test(
                "Get My Schedule",
                "GET",
                "scheduled-audits/my-schedule",
                200
            )

    def test_company_dashboard(self):
        """Test company dashboard functionality"""
        self.log("=== COMPANY DASHBOARD TESTS ===")
        
        if not self.created_resources.get('companies'):
            self.log("No companies available for dashboard test", "WARNING")
            return
        
        company_id = self.created_resources['companies'][0]
        
        # Test company dashboard
        success, dashboard = self.run_test(
            "Get Company Dashboard",
            "GET",
            f"companies/{company_id}/dashboard",
            200
        )
        
        if success:
            expected_fields = ['company', 'stats', 'trends', 'recent_activity']
            for field in expected_fields:
                if field in dashboard:
                    self.log(f"✅ Dashboard field '{field}' present")
                else:
                    self.log(f"❌ Missing dashboard field: {field}", "WARNING")

    def cleanup_resources(self):
        """Clean up created test resources"""
        self.log("=== CLEANUP ===")
        
        # Delete scheduled audits
        for schedule_id in self.created_resources.get('scheduled_audits', []):
            self.run_test(
                f"Delete Scheduled Audit {schedule_id}",
                "DELETE",
                f"scheduled-audits/{schedule_id}",
                200
            )
        
        # Delete run audits (no endpoint available, skip)
        
        # Delete audits
        for audit_id in self.created_resources['audits']:
            self.run_test(
                f"Delete Audit {audit_id}",
                "DELETE",
                f"audits/{audit_id}",
                200
            )
        
        # Delete audit types
        for type_id in self.created_resources['audit_types']:
            self.run_test(
                f"Delete Audit Type {type_id}",
                "DELETE",
                f"audit-types/{type_id}",
                200
            )
        
        # Delete response groups
        for group_id in self.created_resources['response_groups']:
            self.run_test(
                f"Delete Response Group {group_id}",
                "DELETE",
                f"response-groups/{group_id}",
                200
            )
        
        # Delete companies
        for company_id in self.created_resources.get('companies', []):
            self.run_test(
                f"Delete Company {company_id}",
                "DELETE",
                f"companies/{company_id}",
                200
            )
        
        # Delete users (except admin)
        for user_id in self.created_resources['users']:
            self.run_test(
                f"Delete User {user_id}",
                "DELETE",
                f"users/{user_id}",
                200
            )

    def run_all_tests(self):
        """Run all test suites"""
        self.log("🚀 Starting Infinit-Audit Backend API Tests")
        self.log(f"Base URL: {self.base_url}")
        
        try:
            # Core functionality tests
            self.test_health_check()
            
            if not self.test_authentication():
                return False
            
            self.test_user_management()
            self.test_response_groups()
            self.test_audit_types()
            self.test_audits()
            self.test_run_audits()
            self.test_dashboard_stats()
            self.test_photo_upload()
            self.test_new_features()
            
            # Cleanup
            self.cleanup_resources()
            
        except KeyboardInterrupt:
            self.log("Tests interrupted by user", "WARNING")
        except Exception as e:
            self.log(f"Unexpected error: {str(e)}", "ERROR")
        
        # Print final results
        self.log("=" * 50)
        self.log(f"📊 FINAL RESULTS: {self.tests_passed}/{self.tests_run} tests passed")
        
        if self.tests_passed == self.tests_run:
            self.log("🎉 ALL TESTS PASSED!", "SUCCESS")
            return True
        else:
            failed = self.tests_run - self.tests_passed
            self.log(f"❌ {failed} tests failed", "FAIL")
            return False

def main():
    """Main test execution"""
    tester = InfinitAuditTester()
    success = tester.run_all_tests()
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())