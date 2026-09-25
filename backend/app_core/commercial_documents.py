from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
import server as legacy

router = APIRouter(prefix="/api/system/commercial-documents", tags=["system-commercial-documents"])
DOCS_DIR = Path(__file__).resolve().parents[2] / "docs" / "commercial"
ALLOWED = {
    "terms-of-service.md": "Terms of Service",
    "data-processing-agreement.md": "Data Processing Agreement",
    "security-model.md": "Security Model",
    "subprocessors.md": "Subprocessor Register",
    "data-retention-deletion.md": "Data Retention & Deletion",
    "backup-restore.md": "Backup & Restore",
    "incident-response.md": "Incident Response",
    "photo-storage.md": "Photograph Storage Standard",
    "commercial-launch-checklist.md": "Commercial Launch Checklist",
}

def require_system_admin(user: dict = Depends(legacy.get_current_user)):
    if not legacy.is_system_admin(user):
        raise HTTPException(status_code=403, detail="System administrator access required")
    return user

@router.get("")
async def list_commercial_documents(user: dict = Depends(require_system_admin)):
    return [{"filename": filename, "title": title} for filename, title in ALLOWED.items()]

@router.get("/{filename}")
async def get_commercial_document(filename: str, user: dict = Depends(require_system_admin)):
    title = ALLOWED.get(filename)
    if not title:
        raise HTTPException(status_code=404, detail="Commercial document not found")
    path = DOCS_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Commercial document not found")
    return {"filename": filename, "title": title, "content": path.read_text(encoding="utf-8")}
