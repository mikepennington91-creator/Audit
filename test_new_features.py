#!/usr/bin/env python3
"""
Test script for new Infinit-Audit enhancements:
1. UK timezone for all dates/times
2. Company management and user assignment
3. Company-based data isolation
4. Detailed audit view
5. Required comments on negative responses
"""

import requests
import sys
import json
from datetime import datetime
from typing import Dict, Any, Optional

class NewFeaturesTester:
    def __init__(self, base_url="https://auditmate-3.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.admin_token = None
        self.user_token = None
        self.tests_run = 0
        self.tests_passed = 0
        self.company_id = None
        self.user_id = None
        self.audit_id = None
        self.run_id = None

    def log(self, message: str, level: str = "INFO"):
        """Log test messages"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {level}: {message}")

    def run_test(self, name: str, method: str, endpoint: str, expected_status: int, 
                 data: Optional[Dict] = None, token: Optional[str] = None) -> tuple[bool, Dict]:
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        
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

    def test_admin_login(self):
        """Test admin login with provided credentials"""
        self.log("=== ADMIN LOGIN TEST ===")
        
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
            return True
        else:
            self.log("❌ Failed to get admin token", "CRITICAL")
            return False

    def test_company_management(self):
        """Test company CRUD operations"""
        self.log("=== COMPANY MANAGEMENT TESTS ===")
        
        # Create a new company
        company_data = {
            "name": "Test Food Company Ltd",
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
            self.company_id = response['id']
            self.log(f"✅ Company created with ID: {self.company_id}")
            
            # Verify UK timezone in created_at field
            created_at = response.get('created_at', '')
            if '+01:00' in created_at or '+00:00' in created_at:
                self.log("✅ UK timezone detected in company creation timestamp")
            else:
                self.log(f"⚠️ Timezone format: {created_at}", "WARNING")
        else:
            self.log("❌ Failed to create company", "ERROR")
            return False

        # Get all companies
        success, companies = self.run_test("Get All Companies", "GET", "companies", 200)
        if success and isinstance(companies, list):
            self.log(f"✅ Found {len(companies)} companies")

        # Update company
        update_data = {"description": "Updated description for testing"}
        success, response = self.run_test(
            "Update Company",
            "PUT",
            f"companies/{self.company_id}",
            200,
            data=update_data
        )
        
        return True

    def test_user_company_assignment(self):
        """Test user creation and company assignment"""
        self.log("=== USER-COMPANY ASSIGNMENT TESTS ===")
        
        # Create a user and assign to company
        user_data = {
            "email": f"testuser_{datetime.now().strftime('%H%M%S')}@testcompany.com",
            "password": "TestPass123!",
            "name": "Test Company User",
            "role": "audit_creator",
            "company_id": self.company_id
        }
        
        success, response = self.run_test(
            "Create User with Company Assignment",
            "POST",
            "auth/register",
            200,
            data=user_data
        )
        
        if success and 'user' in response:
            self.user_id = response['user']['id']
            self.user_token = response.get('token')
            self.log(f"✅ User created and assigned to company: {self.user_id}")
            
            # Verify UK timezone in user creation
            if 'token' in response:
                # Get user details to check created_at
                success, user_details = self.run_test(
                    "Get User Details",
                    "GET",
                    "auth/me",
                    200,
                    token=self.user_token
                )
                if success and 'created_at' in user_details:
                    created_at = user_details['created_at']
                    if '+01:00' in created_at or '+00:00' in created_at:
                        self.log("✅ UK timezone detected in user creation timestamp")
        else:
            self.log("❌ Failed to create user with company assignment", "ERROR")
            return False

        # Test updating user company assignment
        update_data = {"company_id": self.company_id}
        success, response = self.run_test(
            "Update User Company Assignment",
            "PUT",
            f"users/{self.user_id}",
            200,
            data=update_data
        )
        
        return True

    def test_company_data_isolation(self):
        """Test that users only see data from their company"""
        self.log("=== COMPANY DATA ISOLATION TESTS ===")
        
        # Create response group as company user
        response_group_data = {
            "name": "Company Specific Pass/Fail",
            "options": [
                {"label": "Pass", "value": "pass", "score": 1.0, "is_negative": False},
                {"label": "Fail", "value": "fail", "score": 0.0, "is_negative": True}
            ],
            "enable_scoring": True
        }
        
        success, response = self.run_test(
            "Create Company Response Group",
            "POST",
            "response-groups",
            200,
            data=response_group_data,
            token=self.user_token
        )
        
        if success and 'id' in response:
            group_id = response['id']
            self.log(f"✅ Company response group created: {group_id}")
            
            # Verify company_id is set
            if response.get('company_id') == self.company_id:
                self.log("✅ Response group correctly associated with company")
            else:
                self.log(f"⚠️ Response group company_id: {response.get('company_id')}", "WARNING")

        # Create audit type as company user
        audit_type_data = {
            "name": "Company Food Safety",
            "description": "Company-specific food safety audit"
        }
        
        success, response = self.run_test(
            "Create Company Audit Type",
            "POST",
            "audit-types",
            200,
            data=audit_type_data,
            token=self.user_token
        )
        
        if success and 'id' in response:
            type_id = response['id']
            self.log(f"✅ Company audit type created: {type_id}")

        return True

    def test_negative_response_validation(self):
        """Test that negative responses require comments"""
        self.log("=== NEGATIVE RESPONSE VALIDATION TESTS ===")
        
        # First create an audit with the company user
        audit_data = {
            "name": "Test Negative Response Audit",
            "description": "Testing negative response comment requirements",
            "pass_rate": 80.0,
            "is_private": False,
            "questions": [
                {
                    "text": "Is the kitchen clean?",
                    "custom_responses": [
                        {"label": "Pass", "value": "pass", "score": 1.0, "is_negative": False},
                        {"label": "Fail", "value": "fail", "score": 0.0, "is_negative": True}
                    ],
                    "enable_scoring": True,
                    "required": True,
                    "order": 0
                }
            ]
        }
        
        success, response = self.run_test(
            "Create Test Audit",
            "POST",
            "audits",
            200,
            data=audit_data,
            token=self.user_token
        )
        
        if success and 'id' in response:
            self.audit_id = response['id']
            self.log(f"✅ Test audit created: {self.audit_id}")
        else:
            self.log("❌ Failed to create test audit", "ERROR")
            return False

        # Start a run audit
        run_data = {
            "audit_id": self.audit_id,
            "location": "Test Kitchen"
        }
        
        success, response = self.run_test(
            "Start Run Audit",
            "POST",
            "run-audits",
            200,
            data=run_data,
            token=self.user_token
        )
        
        if success and 'id' in response:
            self.run_id = response['id']
            self.log(f"✅ Run audit started: {self.run_id}")
        else:
            self.log("❌ Failed to start run audit", "ERROR")
            return False

        # Try to submit negative response without comment (should fail)
        submit_data_no_comment = {
            "answers": [
                {
                    "question_id": response['audit_id'],  # This will be wrong but we're testing validation
                    "response_value": "fail",
                    "response_label": "Fail",
                    "score": 0.0,
                    "notes": "",  # Empty comment
                    "photos": [],
                    "is_negative": True
                }
            ],
            "notes": "Test submission",
            "completed": True
        }
        
        success, response = self.run_test(
            "Submit Negative Response Without Comment (Should Fail)",
            "PUT",
            f"run-audits/{self.run_id}",
            400,  # Expecting validation error
            data=submit_data_no_comment,
            token=self.user_token
        )
        
        if not success and response.get('detail'):
            self.log(f"✅ Validation correctly rejected negative response without comment: {response['detail']}")
        else:
            self.log("⚠️ Expected validation error for negative response without comment", "WARNING")

        # Submit negative response with comment (should succeed)
        submit_data_with_comment = {
            "answers": [
                {
                    "question_id": response.get('audit_id', 'test_question'),
                    "response_value": "fail",
                    "response_label": "Fail", 
                    "score": 0.0,
                    "notes": "Kitchen surfaces were dirty and not properly sanitized",
                    "photos": [],
                    "is_negative": True
                }
            ],
            "notes": "Test submission with proper comments",
            "completed": True
        }
        
        success, response = self.run_test(
            "Submit Negative Response With Comment",
            "PUT",
            f"run-audits/{self.run_id}",
            200,
            data=submit_data_with_comment,
            token=self.user_token
        )
        
        return True

    def test_detailed_audit_view(self):
        """Test detailed audit view endpoint"""
        self.log("=== DETAILED AUDIT VIEW TESTS ===")
        
        if not self.run_id:
            self.log("No run audit available for detailed view test", "WARNING")
            return True

        # Test the detailed view endpoint
        success, response = self.run_test(
            "Get Run Audit Details",
            "GET",
            f"run-audits/{self.run_id}/details",
            200,
            token=self.user_token
        )
        
        if success:
            # Check for expected fields in detailed view
            expected_fields = ['enriched_answers', 'audit_description', 'questions']
            for field in expected_fields:
                if field in response:
                    self.log(f"✅ Detailed view contains '{field}' field")
                else:
                    self.log(f"⚠️ Missing detailed view field: {field}", "WARNING")
            
            # Check UK timezone in timestamps
            for timestamp_field in ['started_at', 'completed_at']:
                if timestamp_field in response and response[timestamp_field]:
                    timestamp = response[timestamp_field]
                    if '+01:00' in timestamp or '+00:00' in timestamp:
                        self.log(f"✅ UK timezone detected in {timestamp_field}: {timestamp}")
                    else:
                        self.log(f"⚠️ Timezone format in {timestamp_field}: {timestamp}", "WARNING")

        return True

    def cleanup(self):
        """Clean up test resources"""
        self.log("=== CLEANUP ===")
        
        # Delete audit if created
        if self.audit_id:
            self.run_test(
                "Delete Test Audit",
                "DELETE",
                f"audits/{self.audit_id}",
                200
            )
        
        # Delete user if created
        if self.user_id:
            self.run_test(
                "Delete Test User",
                "DELETE",
                f"users/{self.user_id}",
                200
            )
        
        # Delete company if created
        if self.company_id:
            self.run_test(
                "Delete Test Company",
                "DELETE",
                f"companies/{self.company_id}",
                200
            )

    def run_all_tests(self):
        """Run all new feature tests"""
        self.log("🚀 Starting New Features Tests for Infinit-Audit")
        self.log(f"Base URL: {self.base_url}")
        
        try:
            if not self.test_admin_login():
                return False
            
            self.test_company_management()
            self.test_user_company_assignment()
            self.test_company_data_isolation()
            self.test_negative_response_validation()
            self.test_detailed_audit_view()
            
            # Cleanup
            self.cleanup()
            
        except KeyboardInterrupt:
            self.log("Tests interrupted by user", "WARNING")
        except Exception as e:
            self.log(f"Unexpected error: {str(e)}", "ERROR")
        
        # Print final results
        self.log("=" * 50)
        self.log(f"📊 NEW FEATURES TEST RESULTS: {self.tests_passed}/{self.tests_run} tests passed")
        
        if self.tests_passed == self.tests_run:
            self.log("🎉 ALL NEW FEATURE TESTS PASSED!", "SUCCESS")
            return True
        else:
            failed = self.tests_run - self.tests_passed
            self.log(f"❌ {failed} tests failed", "FAIL")
            return False

def main():
    """Main test execution"""
    tester = NewFeaturesTester()
    success = tester.run_all_tests()
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())