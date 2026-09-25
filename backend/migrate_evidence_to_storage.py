"""Migrate legacy database-backed audit photographs to private object storage.

Run from the backend environment after EVIDENCE_STORAGE_* is configured:
    python migrate_evidence_to_storage.py

The migration is idempotent: only photo documents that still contain legacy
base64 data are moved. Existing audit answer URLs remain valid because the
photo API can resolve both legacy data URLs and /api/photos/{id} references.
"""
import asyncio
import os
from dotenv import load_dotenv
from database import PostgresDatabase
from app_core.evidence_storage import legacy_data_url, optimise_image, store_evidence

load_dotenv()
db = PostgresDatabase(os.environ.get("DATABASE_URL", ""))

async def main():
    await db.connect()
    moved = 0
    try:
        photos = await db.photos.find({}, {"_id": 0}).to_list(100000)
        for photo in photos:
            raw = legacy_data_url(photo)
            if not raw:
                continue
            optimised = optimise_image(raw)
            stored = await store_evidence(
                optimised,
                company_id=photo.get("company_id"),
                uploaded_by=photo.get("uploaded_by") or "migration",
                filename=photo.get("filename") or "evidence.jpg",
            )
            await db.photos.update_one({"id": photo["id"]}, {"$set": {
                "storage_backend": stored["storage_backend"],
                "storage_key": stored["storage_key"],
                "content_type": stored["content_type"],
                "size": stored["size"],
                "data": None,
            }})
            moved += 1
            print(f"Migrated {photo['id']}")
        print(f"Completed: {moved} photograph(s) migrated")
    finally:
        await db.close()

if __name__ == "__main__":
    asyncio.run(main())
