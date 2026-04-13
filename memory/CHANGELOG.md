# Infinit-Audit Changelog

## April 13, 2026 - Audit Overview, Scoring & Sign-off

### New Features
1. **Audit Overview Page** (`/audits/:auditId`)
   - Stats cards: Pass Percentage, Audits Completed, Failed Audits
   - Date range calendar filter (react-day-picker range mode)
   - Pass/Fail status filter dropdown
   - Completed audit runs table with view (eye) and download (PDF) icons
   - Detail modal with full question/answer breakdown
   - Shows sign-off info (name, email, signature image) in modal

2. **Pass/Fail Scoring System**
   - Every question has pass/fail tracking
   - Response group options: `is_negative` flag assignable during audit creation via Pass/Fail toggle
   - Text/Number/Alphanumeric questions: manual Pass/Fail toggle during audit run
   - Score calculation: `(pass_count / total_questions) * 100`
   - Auto-flag audit as "fail" if score < pass_rate threshold
   - Backend AnswerSubmit model: added `pass_fail` field ("pass" or "fail")

3. **Audit Sign-off Box**
   - Signature canvas (HTML5 Canvas API with mouse + touch support)
   - Auto-populated user name and email
   - Signature required before submission (validation in submitAudit)
   - Signature stored as base64 PNG in database
   - Displayed in audit detail modals and PDF exports
   - Backend RunAuditSubmit model: added `signature`, `signoff_name`, `signoff_email`

### API Changes
- `GET /api/audits/{audit_id}/runs` - New endpoint with date_from, date_to, pass_status query params
- `PUT /api/run-audits/{run_id}` - Updated to accept signature, signoff_name, signoff_email
- Scoring logic changed from averaging 0-1 scores to counting pass/fail per question
- PDF export updated to include sign-off section with signature image

### Files Changed
- `/app/backend/server.py` - Models, scoring, new endpoint, PDF updates
- `/app/frontend/src/pages/AuditOverview.js` - New page
- `/app/frontend/src/pages/RunAudit.js` - Pass/fail toggle, signature canvas
- `/app/frontend/src/pages/CreateAudit.js` - is_negative toggle on custom responses
- `/app/frontend/src/App.js` - Added route for /audits/:auditId

---

## January 14, 2026 - Offline Capability & UI Improvements
- Full offline PWA support (Service Worker, IndexedDB, auto-sync)
- Bigger logo across app, removed Emergent badge
- Render deployment configuration

## January 13, 2026 - Feature Expansion
- PDF export for audit reports (ReportLab)
- Bulk user import via CSV
- Audit scheduling with status tracking
- Company compliance dashboard

## January 13, 2026 - Enhancement Phase
- UK Timezone support, Company Management, Data isolation
- Detailed audit view, Required comments on negative responses
