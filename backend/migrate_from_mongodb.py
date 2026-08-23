"""One-off, repeatable migration from MongoDB Atlas to Supabase PostgreSQL."""

from __future__ import annotations

import argparse
import asyncio
import os
from typing import Any

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

from database import PostgresDatabase


COLLECTIONS = (
    "companies",
    "users",
    "response_groups",
    "corrective_actions",
    "audit_types",
    "lines_shifts",
    "audits",
    "run_audits",
    "scheduled_audits",
    "photos",
    "traceability_templates",
    "traceability_documents",
)


async def migrate(apply: bool) -> None:
    load_dotenv()
    mongo_url = os.environ.get("MONGO_URL")
    mongo_database = os.environ.get("DB_NAME", "infinit_audit")
    database_url = os.environ.get("DATABASE_URL")
    if not mongo_url or not database_url:
        raise RuntimeError("MONGO_URL and DATABASE_URL must both be configured")

    source_client = AsyncIOMotorClient(mongo_url)
    source = source_client[mongo_database]
    target = PostgresDatabase(database_url)
    await target.connect()

    try:
        print("Migration plan:")
        source_counts: dict[str, int] = {}
        for name in COLLECTIONS:
            source_counts[name] = await source[name].count_documents({})
            print(f"  {name}: {source_counts[name]} documents")

        if not apply:
            print("\nDry run only. Re-run with --apply to copy these documents.")
            return

        for name in COLLECTIONS:
            copied = 0
            migrated_ids: list[str] = []
            async for source_document in source[name].find({}):
                document: dict[str, Any] = dict(source_document)
                document.pop("_id", None)
                await target.collection(name).upsert_one(document)
                copied += 1
                migrated_ids.append(str(document["id"]))
            target_count = (
                await target.collection(name).count_documents(
                    {"id": {"$in": migrated_ids}}
                )
                if migrated_ids
                else 0
            )
            if target_count != copied:
                raise RuntimeError(
                    f"Validation failed for {name}: copied={copied}, found in PostgreSQL={target_count}"
                )
            print(f"Migrated and verified {name}: {copied} documents")

        print("Migration completed and collection counts verified.")
    finally:
        await target.close()
        source_client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Copy data; without this flag only counts are shown",
    )
    args = parser.parse_args()
    asyncio.run(migrate(args.apply))
