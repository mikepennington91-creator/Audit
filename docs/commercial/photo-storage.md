# Photograph and evidence storage standard

## Purpose
Photographs are evidence, not marketing assets. Infinit Audit therefore optimises images for readable audit evidence while avoiding unnecessary storage and bandwidth.

## Current application behaviour
Audit photographs and Quality Operations evidence are resized in the browser to a maximum longest edge of 1600 pixels and encoded as compressed JPEG at approximately 72% quality before they are persisted. This materially reduces typical modern phone photographs before they reach the application.

The current audit upload endpoint stores the compressed image as base64 inside the application database. Quality Operations evidence is also currently embedded in its record as a data URL. This is acceptable for controlled pilot use but is **not the intended long-term commercial storage architecture**, because base64 increases payload size and consumes PostgreSQL database disk.

## Commercial target architecture
Before high-volume customer onboarding, evidence files should be moved to private object storage (Supabase Storage or another approved S3-compatible service). PostgreSQL should retain only metadata: photo ID, company ID, record ID/type, object key, MIME type, byte size, uploader and timestamps.

Object keys must be tenant scoped, e.g. `companies/{company_id}/evidence/{record_type}/{record_id}/{uuid}.jpg`. Buckets must not be publicly listable. Access must be authorised against the signed-in user's company and permissions.

## Image standard
- Accept image uploads only.
- Maximum source upload accepted by the application: 20 MB.
- Maximum stored longest edge: 1600 px by default.
- JPEG quality target: 72–80%.
- Do not upscale smaller images.
- Re-encoding should remove unnecessary EXIF metadata.
- Preserve visual orientation.
- Generate thumbnails only where they materially improve list performance.
- Keep the original only where a customer has a documented evidential requirement for original files.

## Capacity
Supabase Pro currently includes 100 GB of file storage. Storage above quota is usage billed. Commercial monitoring should alert before 70%, 85% and 95% of the planned storage allowance.

## Migration
Existing base64 images should be migrated record-by-record to private object storage, verified by checksum/read-back, then replaced in PostgreSQL with an object reference. Database copies should only be removed after successful verification and a backup.
