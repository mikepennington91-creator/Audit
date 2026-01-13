# Infinit-Audit - Product Requirements Document

## Project Overview
**Website:** www.infinit-audit.co.uk  
**Purpose:** Food industry auditing system with customizable audit templates

## Original Problem Statement
Build an auditing system called Infinit-Audit for the food industry. Users can create custom audits with:
- Login/authentication screen
- Admin section (admin only)
- Create Audit (audit creators only)
- Groups (response sets and audit types)
- Run Audit (with photo uploads)
- Reports section

## User Personas

### Admin
- Full system access
- User management (CRUD)
- Can create audits, groups, run audits, view reports

### Audit Creator
- Can create response groups and audit types
- Can create and manage audit templates
- Can run audits and view reports
- Cannot access user management

### User (Normal User)
- Can run audits
- Can view reports
- Cannot create audits or manage groups

## Core Requirements (Static)

1. **Authentication**
   - JWT-based authentication
   - Role-based access control (admin, audit_creator, user)
   - Default admin: admin@infinit-audit.co.uk / admin123

2. **Response Groups**
   - Create reusable response sets (Pass/Fail, Yes/No, Accept/Reject)
   - Optional scoring per response option (0-1 scale)
   - Used in audit questions

3. **Audit Types**
   - Categorize audits (GMP, HACCP, Food Safety, etc.)
   - Name and description

4. **Audit Creation**
   - Name, description, audit type selection
   - Pass rate percentage (optional)
   - Private/public visibility
   - Add questions with response sets or custom responses
   - Scoring enablement per question

5. **Run Audit**
   - Select and execute audit templates
   - Location tracking
   - Photo uploads for evidence
   - Notes per question and overall
   - Progress saving
   - Score calculation and pass/fail status

6. **Reports**
   - View completed audits
   - Pass rate statistics
   - Analytics placeholder for future charts

7. **Theme**
   - Light and dark mode toggle
   - Professional, clean design

## What's Been Implemented (January 2026)

### Backend (FastAPI + MongoDB)
- ✅ User authentication (register, login, JWT tokens)
- ✅ User management CRUD (admin only)
- ✅ Response Groups CRUD
- ✅ Audit Types CRUD
- ✅ Audits CRUD with questions
- ✅ Run Audits with answers, photos, scoring
- ✅ Photo upload (base64 storage)
- ✅ Dashboard statistics

### Frontend (React + Tailwind + Shadcn)
- ✅ Login/Register page with branded design
- ✅ Dashboard with stats and quick actions
- ✅ Sidebar navigation
- ✅ Admin page - user management
- ✅ Groups page - response sets and audit types
- ✅ Create Audit page - builder layout
- ✅ Run Audit page - mobile-friendly questionnaire
- ✅ Reports page - completed audits table
- ✅ Theme toggle (light/dark mode)

### Design
- Outfit font for headings, Inter for body
- Teal/Blue primary colors matching logo
- Glassmorphism login card
- Clean, minimalistic interface

## Prioritized Backlog

### P0 - Critical (Done)
- ✅ Authentication system
- ✅ Core CRUD operations
- ✅ Audit creation and execution flow

### P1 - High Priority (Next)
- [ ] PDF export for completed audits
- [ ] Detailed report view with all answers
- [ ] Analytics charts (Recharts integration)
- [ ] Edit existing audits

### P2 - Medium Priority
- [ ] Offline capability (Service Workers)
- [ ] Audit scheduling
- [ ] Email notifications
- [ ] Bulk user import

### P3 - Nice to Have
- [ ] Mobile app (React Native)
- [ ] Multi-language support
- [ ] Custom branding per organization
- [ ] Audit templates marketplace

## Next Tasks
1. Implement PDF export for audit reports
2. Add detailed view for completed audit runs
3. Integrate analytics charts on Reports page
4. Add ability to edit existing audits
5. Implement offline capability with service workers

## Technical Stack
- **Backend:** FastAPI, MongoDB, JWT, bcrypt
- **Frontend:** React, Tailwind CSS, Shadcn/UI, Axios
- **Deployment:** Emergent Platform

## API Endpoints
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user
- `GET/POST/PUT/DELETE /api/users` - User management
- `GET/POST/DELETE /api/response-groups` - Response sets
- `GET/POST/DELETE /api/audit-types` - Audit categories
- `GET/POST/PUT/DELETE /api/audits` - Audit templates
- `GET/POST/PUT /api/run-audits` - Audit execution
- `POST /api/upload-photo` - Photo evidence upload
- `GET /api/dashboard/stats` - Dashboard statistics

---

## Update: January 13, 2026 - Enhancement Phase

### New Features Implemented

1. **UK Timezone Support**
   - All timestamps now use Europe/London timezone
   - Backend uses `zoneinfo.ZoneInfo("Europe/London")` 
   - Frontend displays dates in `en-GB` format with `Europe/London` timeZone

2. **Company Management (Admin)**
   - CRUD operations for companies
   - Assign users to companies
   - Company-based data isolation

3. **Data Isolation by Company**
   - Response groups filtered by company
   - Audit types filtered by company
   - Audits filtered by company (with visibility rules)
   - Users can only see data from their assigned company

4. **Detailed Audit View**
   - Click on completed audit in Reports to see full details
   - Shows all questions with responses
   - Displays comments/notes per question
   - Shows photo evidence
   - Shows pass/fail status and scores

5. **Required Comments on Negative Responses**
   - Auto-detection of negative keywords (fail, no, reject, etc.)
   - Visual indicator when negative response selected without comment
   - Validation prevents submission without required comments
   - `is_negative` flag stored with response options

### API Endpoints Added
- `GET/POST/PUT/DELETE /api/companies` - Company CRUD
- `GET /api/run-audits/{id}/details` - Detailed audit view with enriched answers

### Database Schema Updates
- Users: Added `company_id` field
- Response Groups: Added `company_id`, `is_negative` on options
- Audit Types: Added `company_id`
- Audits: Added `company_id`
- Run Audit Answers: Added `is_negative` flag

---

## Update: January 13, 2026 - Feature Expansion

### New Features Implemented

1. **PDF Export for Audit Reports**
   - Generate branded PDF reports with ReportLab library
   - Includes audit metadata, questions, responses, scores
   - Color-coded pass/fail indicators
   - Company branding with Infinit-Audit footer
   - Download via button in Reports table and detail modal

2. **Bulk User Import via CSV**
   - Download CSV template with example rows
   - Upload CSV to bulk create users
   - Columns: email, name, role, company_id, password
   - Validation with error reporting
   - Skip duplicate emails

3. **Audit Scheduling**
   - Schedule audits for specific dates
   - Assign to specific users
   - Set location and notes
   - Configurable reminder days (0, 1, 2, 3, 7 days)
   - Track status: pending, overdue, completed
   - Dashboard shows pending/overdue counts

4. **Company Compliance Dashboard**
   - Select company from dropdown
   - Shows key metrics: users, completed, pass rate, scheduled
   - 6-month trend chart with pass rates
   - Recent activity list

### API Endpoints Added
- `GET /api/run-audits/{id}/pdf` - Generate PDF report
- `POST /api/users/bulk-import` - Bulk import from CSV
- `GET /api/users/export-template` - Download CSV template
- `GET/POST/DELETE /api/scheduled-audits` - Scheduling CRUD
- `GET /api/scheduled-audits/my-schedule` - User's scheduled audits
- `PUT /api/scheduled-audits/{id}/complete` - Mark as completed
- `GET /api/companies/{id}/dashboard` - Company analytics

### Libraries Added
- Backend: reportlab (PDF generation)
- Frontend: date-fns (date formatting for calendar)

### Next Phase Features
- Email notifications for scheduled audit reminders
- Multi-location audit templates
- Audit template versioning
- Historical trend comparisons
- Mobile app (React Native)
