# Security model

## Scope
Infinit Audit is a multi-tenant quality-management application. Security must assume unrelated customer organisations use the same service.

## Core principles
1. Deny cross-company access by default.
2. Every customer-owned record must have an authoritative company/tenant identifier.
3. Server-side authorisation is mandatory; hiding UI controls is not a security boundary.
4. Least privilege applies to users, administrators, service credentials and suppliers.
5. Production secrets must live in managed environment configuration and never in source control.

## Identity and access
Accounts are password protected. Passwords must be hashed using the application's approved password-hashing implementation. Authentication tokens must be short-lived/revocable as appropriate. Roles and feature permissions are enforced by the backend.

Company administrators may manage users within their own company only. The application must prevent privilege changes that would strand an organisation without an administrator.

## Tenant isolation
All reads, writes, exports, reports, file downloads and background jobs must scope data to the authenticated company unless a specifically authorised system-administration operation is being performed. Automated tests should attempt cross-company access for each sensitive module.

For object storage, paths and policies must include company ID and private access. Public evidence buckets are prohibited.

## Transport and hosting
Production traffic must use HTTPS. Database connections must use TLS. Vercel, Render and Supabase access must use individual accounts/MFA where available and production access should be limited to people who need it.

## Logging
Record security-relevant events including authentication failures where practical, account creation/deletion, permission changes, administrative deletions, important record changes and exports. Logs must not contain passwords, reset secrets or full authentication tokens.

## Vulnerability and dependency management
Dependencies should be reviewed and patched regularly. Critical security fixes should be prioritised. Production dependencies and hosting notices should be monitored.

## Security testing before commercial launch
- Cross-tenant API tests.
- Broken-object-level-authorisation tests.
- File access tests.
- Role/permission regression tests.
- Password reset tests.
- Rate-limit/brute-force review.
- Backup restore test.
- Dependency and secret scan.
