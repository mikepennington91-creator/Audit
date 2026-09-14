"""Company-scoped corrective-action reference allocation."""

from __future__ import annotations

import re
from contextlib import asynccontextmanager


ACTION_REFERENCE = re.compile(r"^A(\d+)$", re.IGNORECASE)


def action_reference_number(value: object) -> int | None:
    match = ACTION_REFERENCE.fullmatch(str(value or "").strip())
    return int(match.group(1)) if match else None


async def _backfill_locked(db, company_id: str | None) -> int:
    records = await db.corrective_actions.find(
        {"company_id": company_id}, {"_id": 0, "history": 0}
    ).sort("created_at", 1).to_list(10_000)
    highest = max(
        (number for record in records if (number := action_reference_number(record.get("reference"))) is not None),
        default=0,
    )
    for record in records:
        if action_reference_number(record.get("reference")) is not None:
            continue
        highest += 1
        await db.corrective_actions.update_one(
            {"id": record["id"]}, {"$set": {"reference": f"A{highest}"}}
        )
    return highest


async def ensure_action_references(db, company_id: str | None) -> None:
    key = company_id or "unassigned"
    async with db.transaction(f"action-reference:{key}"):
        await _backfill_locked(db, company_id)


@asynccontextmanager
async def allocate_action_reference(db, company_id: str | None):
    """Hold the company sequence lock until the caller inserts its action."""
    key = company_id or "unassigned"
    async with db.transaction(f"action-reference:{key}"):
        highest = await _backfill_locked(db, company_id)
        yield f"A{highest + 1}"
