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
