from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

import server as legacy


router = APIRouter(prefix="/api", tags=["audit-reports"])


def _same_company(resource_company_id: Optional[str], user: dict) -> bool:
    """Return whether a resource belongs to the user's tenant."""
    if legacy.is_system_admin(user):
        return True
    user_company_id = user.get("company_id")
    return bool(resource_company_id and user_company_id and resource_company_id == user_company_id)


def audit_access_allowed(audit: dict, user: dict) -> bool:
    if legacy.is_system_admin(user):
        return True
    if _same_company(audit.get("company_id"), user):
        return True
    # Compatibility for older audits created before company_id was consistently stored.
    return not audit.get("company_id") and audit.get("created_by") == user.get("id")


def audit_run_access_allowed(run: dict, user: dict, audit: Optional[dict] = None) -> bool:
    if legacy.is_system_admin(user):
        return True
    if run.get("auditor_id") == user.get("id"):
        return True
    run_company_id = run.get("company_id") or (audit or {}).get("company_id")
    return _same_company(run_company_id, user)


async def _get_accessible_audit(audit_id: str, user: dict) -> dict:
    audit = await legacy.db.audits.find_one({"id": audit_id}, {"_id": 0})
    if not audit or not audit_access_allowed(audit, user):
        raise HTTPException(status_code=404, detail="Audit not found")
    return audit


async def _get_accessible_run(run_id: str, user: dict) -> tuple[dict, Optional[dict]]:
    run = await legacy.db.run_audits.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Audit run not found")

    audit = await legacy.db.audits.find_one({"id": run.get("audit_id")}, {"_id": 0})
    if not audit_run_access_allowed(run, user, audit):
        raise HTTPException(status_code=404, detail="Audit run not found")
    return run, audit


@router.get("/audits/{audit_id}/runs")
async def get_audit_runs(
    audit_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    pass_status: Optional[str] = None,
    user: dict = Depends(legacy.require_feature("audits")),
):
    """Return completed runs using the same tenant rule as View and PDF."""
    audit = await _get_accessible_audit(audit_id, user)

    query: dict = {"audit_id": audit_id, "completed": True}
    if date_from:
        query.setdefault("completed_at", {})["$gte"] = date_from
    if date_to:
        query.setdefault("completed_at", {})["$lte"] = date_to
    if pass_status and pass_status != "all":
        if pass_status not in {"pass", "fail"}:
            raise HTTPException(status_code=400, detail="Unknown audit status")
        query["pass_status"] = pass_status

    runs = await legacy.db.run_audits.find(
        query, {"_id": 0, "signature": 0}
    ).sort("completed_at", -1).to_list(1000)

    visible_runs = [
        run for run in runs
        if audit_run_access_allowed(run, user, audit)
        or (not run.get("company_id") and audit_access_allowed(audit, user))
    ]

    all_runs = await legacy.db.run_audits.find(
        {"audit_id": audit_id, "completed": True}, {"_id": 0, "signature": 0}
    ).to_list(5000)
    visible_all_runs = [
        run for run in all_runs
        if audit_run_access_allowed(run, user, audit)
        or (not run.get("company_id") and audit_access_allowed(audit, user))
    ]
    passed = sum(1 for run in visible_all_runs if run.get("pass_status") == "pass")
    failed = sum(1 for run in visible_all_runs if run.get("pass_status") == "fail")
    total = len(visible_all_runs)

    return {
        "audit": audit,
        "stats": {
            "total_completed": total,
            "passed": passed,
            "failed": failed,
            "pass_percentage": round((passed / total * 100) if total else 0, 1),
        },
        "runs": visible_runs,
    }


@router.get("/run-audits/{run_id}/details")
async def get_run_audit_details(
    run_id: str,
    user: dict = Depends(legacy.require_feature("audits")),
):
    """View one completed run without applying a second, conflicting permission rule."""
    run, audit = await _get_accessible_run(run_id, user)
    if not run.get("completed"):
        raise HTTPException(status_code=409, detail="Only completed audits can be viewed as reports")

    question_map = {
        question.get("id"): question
        for question in (audit or {}).get("questions", [])
        if question.get("id")
    }
    enriched_answers = []
    for index, answer in enumerate(run.get("answers") or [], start=1):
        question = question_map.get(answer.get("question_id"), {})
        enriched_answers.append({
            **answer,
            "question_text": question.get("text") or answer.get("question_text") or f"Question {index}",
            "question_required": question.get("required", True),
        })

    return {
        **run,
        "audit_description": (audit or {}).get("description"),
        "audit_pass_rate": (audit or {}).get("pass_rate"),
        "questions": (audit or {}).get("questions", []),
        "enriched_answers": enriched_answers,
    }


@router.get("/run-audits/{run_id}/pdf")
async def export_audit_pdf(
    run_id: str,
    user: dict = Depends(legacy.require_feature("audits")),
):
    """Download the same completed run the user is permitted to view."""
    run, audit = await _get_accessible_run(run_id, user)
    if not run.get("completed"):
        raise HTTPException(status_code=409, detail="Only completed audits can be downloaded")
    if not audit:
        raise HTTPException(
            status_code=409,
            detail="The original audit template is no longer available, so this legacy report cannot be rendered as PDF.",
        )

    pdf_user = {**user, "role": legacy.UserRole.SYSTEM_ADMIN}
    return await legacy.export_audit_pdf(run_id, pdf_user)
