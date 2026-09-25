# Subprocessor register

Status: verify contracts, regions and exact production configuration before customer publication.

| Supplier | Purpose | Data potentially processed | Action before commercial launch |
|---|---|---|---|
| Supabase | PostgreSQL database, authentication/storage where configured | Account and customer application data | Confirm production region, DPA, transfer safeguards and security terms |
| Render | Backend application hosting | API traffic and application data in transit/processing | Confirm region, DPA and security terms |
| Vercel | Frontend hosting/CDN | Web traffic and limited technical data | Confirm DPA and production configuration |
| Email provider | Transactional/service email | Names, work email addresses and message metadata/content | Confirm actual provider, DPA and region |
| OpenAI (optional feature) | AI-assisted paperwork extraction when enabled | Customer-selected documents/instructions | Confirm API data terms, customer opt-in and processing configuration |

The public privacy notice and DPA must match the suppliers actually used in production. New subprocessors require documented review and customer notice where the contract requires it.
