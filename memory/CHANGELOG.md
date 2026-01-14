# Infinit-Audit Changelog

## [1.3.0] - January 14, 2026

### Added
- **Full Offline Support (PWA)**
  - Service Worker (`/app/frontend/public/service-worker.js`) for caching app assets
  - IndexedDB utilities (`/app/frontend/src/utils/offlineDB.js`) for offline data storage
  - Offline context provider (`/app/frontend/src/context/OfflineContext.js`) for state management
  - Visual offline indicators in sidebar
  - Automatic sync when connectivity restores
  - Audits can be completed offline and synced later

- **Render Deployment Configuration**
  - `render.yaml` blueprint for one-click deployment
  - `backend/Dockerfile` with WeasyPrint dependencies
  - `DEPLOYMENT.md` comprehensive deployment guide
  - Support for free tier hosting ($0/month)

### Changed
- **UI Improvements**
  - Login page logo: h-16 → h-24
  - Sidebar logo: h-9 → h-14
  - Mobile header logo: h-8 → h-12
  - Removed Emergent badge from index.html
  - Updated app metadata and manifest.json

### Fixed
- ESLint warnings for unescaped entities

---

## [1.2.0] - January 13, 2026

### Added
- PDF Export for audit reports (WeasyPrint/ReportLab)
- Bulk user import via CSV
- Audit scheduling with reminders
- Company compliance dashboard
- UK timezone support

### Changed
- Data isolation by company
- Required comments on negative responses

---

## [1.1.0] - January 13, 2026

### Added
- Company management (Admin)
- Detailed audit view modal
- Data isolation by company

---

## [1.0.0] - January 2026

### Added
- Initial MVP release
- JWT authentication with 3 roles
- Response Groups and Audit Types
- Audit template creation
- Run audits with photo upload
- Reports section
- Light/dark theme toggle
