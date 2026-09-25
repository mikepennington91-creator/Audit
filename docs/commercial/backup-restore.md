# Backup and restore policy

## Current platform baseline
The production PostgreSQL database is hosted on Supabase Pro. Supabase Pro provides daily backups with 7-day retention as part of the current plan. Provider capabilities and billing must be rechecked before making contractual promises.

## Objectives
Before general commercial sale, define and publish internal RPO and RTO targets. Do not promise an SLA/RPO/RTO to customers until restore testing demonstrates it can be met.

## Controls
- Confirm automated backups are healthy at least monthly.
- Restrict backup/restore access to authorised administrators.
- Keep infrastructure configuration and application source in version control.
- Back up object-storage configuration/metadata and understand the storage provider's durability/versioning options.
- Document dependencies required to rebuild Vercel/Render/Supabase services.

## Restore testing
Perform a non-production restore test at least quarterly once paying customers are onboarded. Record date, operator, backup used, restore duration, integrity checks, issues and corrective actions.

## Disaster recovery sequence
1. Contain the incident and prevent further writes if required.
2. Identify last known-good point.
3. Restore to an isolated/non-production target where possible.
4. Validate user/company counts, critical records, file references and application health.
5. Authorise production recovery.
6. Communicate customer impact where required.
7. Record lessons and actions.
