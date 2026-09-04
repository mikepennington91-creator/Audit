from __future__ import annotations

import asyncio
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

import server as legacy


router = APIRouter(prefix="/api", tags=["performance"])


def _run_query(user: dict) -> dict:
    if legacy.is_system_admin(user):
        return {}
    if user.get("role") == legacy.UserRole.USER:
        return {"auditor_id": user["id"]}
    return {"company_id": user.get("company_id")}


def _audit_query(user: dict) -> dict:
    if legacy.is_system_admin(user):
        return {}
    company_id = user.get("company_id")
    if company_id:
        return {"$or": [
            {"company_id": company_id, "is_private": False},
            {"created_by": user["id"]},
            {"company_id": None, "is_private": False},
        ]}
    return {"$or": [
        {"is_private": False, "company_id": None},
        {"created_by": user["id"]},
    ]}


@router.get("/dashboard/summary")
async def dashboard_summary(user: dict = Depends(legacy.require_feature("audits"))):
    """Return dashboard counts and only the five rows rendered by the client."""
    run_query = _run_query(user)
    recent_query = {**run_query, "completed": True}
    total_audit_query = _audit_query(user)
    total_user_query = {} if legacy.is_system_admin(user) else {"company_id": user.get("company_id")}

    total_runs, completed_runs, passed_runs, total_audits, total_users, recent = await asyncio.gather(
        legacy.db.run_audits.count_documents(run_query),
        legacy.db.run_audits.count_documents({**run_query, "completed": True}),
        legacy.db.run_audits.count_documents({**run_query, "pass_status": "pass"}),
        legacy.db.audits.count_documents(total_audit_query),
        legacy.db.users.count_documents(total_user_query),
        legacy.db.run_audits.find(
            recent_query,
            {"_id": 0, "answers": 0, "signature": 0, "notes": 0},
        ).sort("completed_at", -1).limit(5).to_list(5),
    )
    return {
        "stats": {
            "total_audits": total_audits,
            "total_runs": total_runs,
            "completed_runs": completed_runs,
            "passed_runs": passed_runs,
            "pass_rate": round((passed_runs / completed_runs * 100) if completed_runs else 0, 1),
            "total_users": total_users,
        },
        "recent_runs": recent,
    }


@router.get("/reports/summary")
async def reports_summary(user: dict = Depends(legacy.require_feature("audits"))):
    """Return report cards without sending every answer from every audit run."""
    audits, audit_types = await asyncio.gather(
        legacy.db.audits.find(
            _audit_query(user), {"_id": 0, "questions": 0}
        ).sort("updated_at", -1).to_list(1000),
        legacy.db.audit_types.find(
            {} if legacy.is_system_admin(user) else {
                "$or": [{"company_id": user.get("company_id")}, {"company_id": None}]
            },
            {"_id": 0},
        ).sort("name", 1).to_list(1000),
    )
    audit_ids = [audit["id"] for audit in audits]
    stats_by_audit: dict[str, dict] = {}
    if audit_ids:
        run_scope = ""
        run_args: list[object] = [audit_ids]
        if not legacy.is_system_admin(user):
            run_args.append(user["id"] if user.get("role") == legacy.UserRole.USER else user.get("company_id"))
            field = "auditor_id" if user.get("role") == legacy.UserRole.USER else "company_id"
            run_scope = f"AND data ->> '{field}' = $2"
        rows = await legacy.db.connection.fetch(
            f"""
            SELECT data ->> 'audit_id' AS audit_id,
                   count(*) AS completed,
                   count(*) FILTER (WHERE data ->> 'pass_status' = 'pass') AS passed,
                   count(*) FILTER (WHERE data ->> 'pass_status' = 'fail') AS failed,
                   max(data ->> 'completed_at') AS last_run
            FROM app_documents
            WHERE collection = 'run_audits'
              AND data ->> 'audit_id' = ANY($1::text[])
              AND data ->> 'completed' = 'true'
              {run_scope}
            GROUP BY data ->> 'audit_id'
            """,
            *run_args,
        )
        for row in rows:
            completed = int(row["completed"])
            passed = int(row["passed"])
            stats_by_audit[row["audit_id"]] = {
                "completed": completed,
                "passed": passed,
                "failed": int(row["failed"]),
                "pass_rate": round((passed / completed * 100) if completed else 0),
                "last_run": row["last_run"],
            }
    for audit in audits:
        audit["stats"] = stats_by_audit.get(audit["id"], {
            "completed": 0, "passed": 0, "failed": 0, "pass_rate": 0, "last_run": None,
        })
    completed = sum(audit["stats"]["completed"] for audit in audits)
    passed = sum(audit["stats"]["passed"] for audit in audits)
    return {
        "audit_types": audit_types,
        "audits": audits,
        "stats": {
            "total_audits": len(audits),
            "completed_runs": completed,
            "passed_runs": passed,
            "pass_rate": round((passed / completed * 100) if completed else 0, 1),
        },
    }


@router.get("/documents/summary")
async def documents_summary(user: dict = Depends(legacy.require_feature("documents"))):
    """Return list-card fields; full form definitions and values load on open."""
    args: list[object] = []
    if legacy.is_system_admin(user):
        template_where = "TRUE"
        document_where = "TRUE"
    else:
        args.append(user.get("company_id"))
        template_where = f"(data ->> 'company_id' = $1 OR data -> 'company_id' IS NULL)"
        document_where = "data ->> 'company_id' = $1"
    if user.get("role") == legacy.UserRole.USER:
        args.append(user["id"])
        document_where += f" AND data ->> 'completed_by' = ${len(args)}"

    template_rows, document_rows = await asyncio.gather(
        legacy.db.connection.fetch(
            f"""
            SELECT (data - 'fields') || jsonb_build_object(
                'field_count', coalesce(jsonb_array_length(data -> 'fields'), 0)
            ) AS data
            FROM app_documents
            WHERE collection = 'traceability_templates' AND {template_where}
            ORDER BY data ->> 'updated_at' DESC NULLS LAST
            LIMIT 250
            """,
            *args[:1],
        ),
        legacy.db.connection.fetch(
            f"""
            SELECT data - ARRAY['field_values', 'table_rows']::text[] AS data
            FROM app_documents
            WHERE collection = 'traceability_documents' AND {document_where}
            ORDER BY data ->> 'created_at' DESC NULLS LAST
            LIMIT 250
            """,
            *args,
        ),
    )

    def decode(rows):
        return [json.loads(row["data"]) if isinstance(row["data"], str) else dict(row["data"]) for row in rows]

    return {"templates": decode(template_rows), "documents": decode(document_rows)}


TRACEABILITY_TYPES = {
    "raw": ("traceability_raw_intakes", "rawIntakes"),
    "finished": ("traceability_finished_batches", "finishedBatches"),
    "usage": ("traceability_material_usage", "materialUsage"),
}


def _traceability_company_id(user: dict) -> Optional[str]:
    return None if legacy.is_system_admin(user) else user.get("company_id")


@router.get("/traceability/config")
async def traceability_config(user: dict = Depends(legacy.require_feature("traceability"))):
    return await legacy._get_traceability_config(user)


@router.get("/traceability/record-counts")
async def traceability_record_counts(user: dict = Depends(legacy.require_feature("traceability"))):
    query = legacy._traceability_company_query(user)
    counts = await asyncio.gather(*[
        legacy.db.collection(collection).count_documents(query)
        for collection, _ in TRACEABILITY_TYPES.values()
    ])
    return {
        response_key: count
        for (_, response_key), count in zip(TRACEABILITY_TYPES.values(), counts)
    }


@router.get("/traceability/records/{record_type}")
async def paged_traceability_records(
    record_type: str,
    limit: int = Query(50, ge=1, le=250),
    offset: int = Query(0, ge=0),
    search: Optional[str] = Query(None, max_length=100),
    release_status: Optional[str] = None,
    user: dict = Depends(legacy.require_feature("traceability")),
):
    if record_type not in TRACEABILITY_TYPES:
        raise HTTPException(status_code=404, detail="Unknown traceability record type")
    collection, _ = TRACEABILITY_TYPES[record_type]
    clauses = ["collection = $1"]
    args: list[object] = [collection]
    company_id = _traceability_company_id(user)
    if not legacy.is_system_admin(user):
        args.append(company_id)
        clauses.append(f"data ->> 'company_id' = ${len(args)}")
    if release_status:
        if record_type != "finished" or release_status not in {"Released", "Quarantine"}:
            raise HTTPException(status_code=400, detail="Unknown release status")
        args.append(release_status)
        clauses.append(f"coalesce(data ->> 'releaseStatus', 'Quarantine') = ${len(args)}")
    if search and search.strip():
        args.append(f"%{search.strip()}%")
        clauses.append(f"data::text ILIKE ${len(args)}")
    where = " AND ".join(clauses)
    args.extend([limit, offset])
    rows = await legacy.db.connection.fetch(
        f"""
        SELECT data, count(*) OVER() AS total
        FROM app_documents
        WHERE {where}
        ORDER BY data ->> 'created_at' DESC NULLS LAST
        LIMIT ${len(args) - 1} OFFSET ${len(args)}
        """,
        *args,
    )
    items = []
    for row in rows:
        value = row["data"]
        items.append(json.loads(value) if isinstance(value, str) else dict(value))
    return {"items": items, "total": int(rows[0]["total"]) if rows else 0}
