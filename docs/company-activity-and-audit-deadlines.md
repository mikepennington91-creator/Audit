# Company activity and weekly audits

Company administrators can delete completed/closed audit runs from an audit's report list and completed documents from Documents. A reason is mandatory. Deletion is permanent; the actor, record identity, company, timestamp and reason remain in Company Activity. Corrective actions retain their own records when the parent audit run is deleted. Audit templates with existing runs cannot be deleted until those runs are removed.

Company Activity is a read-only, paginated list with event-type and UK-date filters. It records account, template and company-configuration changes, document/hold/disposal creation and deletion, and audit deletion. Audit starts, answer saves, audit completion and document completion are excluded. Passwords, answers and document values are never copied into the log. History begins when this release is deployed; past events are not fabricated. Database triggers make each tracked change and its event atomic and reject updates/deletes to history.

## Audit week

- Calendar weeks start Monday, using Europe/London including daylight-saving changes.
- Each started audit is due on that week's Friday. Weekend starts belong to the same calendar week and close the following Monday.
- From Thursday 23:00, the starter receives one reminder. Failed deliveries retry during Friday. The email links directly to the run; it is a required workflow reminder.
- At Monday 00:00, outstanding runs become closed incomplete. Saved answers remain readable and downloadable, the report is flagged **Not completed in time**, and the record does not count as completed or passed.
- Users with audit access in the same company can view and continue open audits. The starter remains unchanged; the authenticated final submitter is stored as the finisher and signatory. Stale saves return 409 instead of overwriting a colleague's work.
- Existing open runs follow the same rule, including closure of previous weeks' unfinished runs on the first worker pass. Offline work becomes shared only once it reaches the server.

## Deployment and scheduling

`backend/supabase_schema.sql` is applied on backend startup and installs the activity triggers/index. No manual per-record migration is required. Legacy run company IDs are recovered from the audit template on access.

The existing reminder loop processes deadlines every `REMINDER_CHECK_SECONDS` (default 900 seconds). The `Audit deadlines` GitHub Actions workflow also wakes the Render service and invokes `/api/internal/jobs/scheduled-audit-reminders` in both GMT/BST windows, with Friday/Monday recovery passes. This keeps overnight processing available when the free web service sleeps. Scheduled jobs run from `main` after merge; runner/hosting delays can postpone the background pass, but API saves enforce Monday closure independently.

GitHub job authentication uses signed, short-lived OIDC tokens. The backend pins the issuer, audience, repository ID, main branch and exact workflow path; pull-request workflows cannot invoke the job. The existing `X-Job-Secret` option remains available for other authorised schedulers. SMTP must remain configured. Failed due reminders cause a failed workflow check rather than silently reporting success.

Concurrent workers and audit writers share transaction-scoped PostgreSQL advisory locks. Successful reminders are marked persistently. SMTP cannot participate in the database transaction: a process crash immediately after email acceptance may cause a duplicate retry.

## Verification

Python regression tests cover deadlines/DST, tenant boundaries, handover identity, stale writes, Monday closure, deletion reasons, report filtering and signed-job identity. Node/PGlite tests run the actual SQL triggers, including immutability, excluded lifecycle events and rollback when log insertion fails. Frontend tests cover required deletion reasons and UK dates.
