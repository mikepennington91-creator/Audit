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
- Traceability page

## User Personas

### System Admin
- Full system access, user management, company management
### Company Admin
- Company-specific admin, manage users within company
### Audit Creator
- Create response groups, audit types, audit templates, run audits, view reports
### User (Normal User)
- Run audits, view reports

## Core Requirements

1. **Authentication** - JWT-based, role-based access control
2. **Response Groups** - Reusable response sets with scoring and pass/fail per option
3. **Audit Types** - Categorize audits (GMP, HACCP, etc.)
4. **Audit Creation** - Builder with questions, response sets, pass rate threshold, pass/fail per option
5. **Run Audit** - Execute templates, location, photos, notes, pass/fail toggles, signature sign-off
6. **Reports** - Completed audits, stats, PDF export
7. **Audit Overview** - Per-audit stats, date range filter, pass/fail filter, completed runs list
8. **Traceability** - Standalone traceability page (localStorage-based)
9. **Scheduling** - Schedule audits, assign users, track status
10. **Offline Support** - PWA with service worker, IndexedDB

## Technical Stack
- **Backend:** FastAPI, MongoDB (motor), JWT, bcrypt, ReportLab (PDF)
- **Frontend:** React, Tailwind CSS, Shadcn/UI, Axios, react-day-picker
- **Deployment:** Vercel (Frontend), Render (Backend), MongoDB Atlas

## API Endpoints
- Auth: POST /api/auth/register, /api/auth/login, GET /api/auth/me
- Users: CRUD /api/users, POST /api/users/bulk-import, GET /api/users/export-template
- Companies: CRUD /api/companies, GET /api/companies/{id}/dashboard
- Response Groups: CRUD /api/response-groups
- Audit Types: CRUD /api/audit-types
- Lines/Shifts: CRUD /api/lines-shifts
- Audits: CRUD /api/audits, GET /api/audits/{id}/runs (overview with filters)
- Run Audits: CRUD /api/run-audits, GET /api/run-audits/{id}/details, GET /api/run-audits/{id}/pdf
- Scheduling: CRUD /api/scheduled-audits
- Dashboard: GET /api/dashboard/stats
- Photos: POST /api/upload-photo

## What's Been Implemented

### Phase 1 - Core (Jan 2026)
- Authentication, User Management, Company Management
- Response Groups, Audit Types, Lines/Shifts
- Audit Creation & Execution
- Reports with PDF export
- UK Timezone support, Company data isolation
- Negative response comments requirement

### Phase 2 - Enhancement (Jan 2026)
- Bulk user import via CSV
- Audit scheduling with status tracking
- Company compliance dashboard
- Offline PWA support (service worker + IndexedDB)
- Traceability page

### Phase 3 - New Features (Apr 2026)
- **Audit Overview Page** (/audits/:auditId) - Per-audit stats (pass %, completed count, failed count), date range calendar filter, pass/fail status filter, completed runs table with view/download actions
- **Pass/Fail Scoring System** - Each question has pass/fail tracking. Response group options have is_negative flag (set at creation). Text/number/alphanumeric questions have manual Pass/Fail toggle during audit. Score = (pass_count / total_questions) * 100. Auto-flag as fail if below pass_rate threshold
- **Audit Sign-off** - Signature canvas at end of each audit. Auto-logs user name and email. Signature required before submission. Signature stored and displayed in reports/PDF

## Prioritized Backlog

### P1 - High Priority (Next)
- [ ] Email reminders for scheduled audits (requires email service integration)

### P2 - Medium Priority
- [ ] Refactor backend (split server.py into modular routers)
- [ ] Company Dashboard Analytics enhancements

### P3 - Nice to Have
- [ ] Mobile app (React Native)
- [ ] Multi-language support
- [ ] Custom branding per organization
- [ ] Audit templates marketplace
