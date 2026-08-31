from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException

import server as legacy


router = APIRouter(prefix="/api", tags=["audit-reports"])


async def _company_user_ids(company_id: Optional[str]) -> set[str]:
    if not company_id:
        return set()
    users = await legacy.db.users.find(
        {"company_id": company_id}, {"_id": 0, "password": 0}
    ).to_list(5000)
    return {str(item.get("id")) for item in users if item.get("id")}


def _run_visible_to_user(
    run: Dict[str, Any], user: Dict[str, Any], company_user_ids: set[str]
) -> bool:
    """Apply the Audits — View permission within the user's tenant.

    Older audit-run documents pre-date the company_id field, so their auditor ID
    is used as a migration-safe tenant fallback.
    """
    if legacy.is_system_admin(user):
        return True
    if run.get("auditor_id") == user.get("id"):
        return True

    company_id = user.get("company_id")
    if not company_id:
        return False

    stored_company = run.get("company_id")
    if stored_company is not None:
        return stored_company == company_id
    return str(run.get("auditor_id") or "") in company_user_ids


async def _get_accessible_audit_run(run_id: str, user: dict) -> dict:
    run = await legacy.db.run_audits.find_one({"id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Audit run not found")

    company_user_ids = await _company_user_ids(user.get("company_id"))
    if not _run_visible_to_user(run, user, company_user_ids):
        # Keep tenant boundaries opaque: do not reveal that another company's
        # run exists.
        raise HTTPException(status_code=404, detail="Audit run not found")
    return run


async def _audit_pdf_response(run: dict, user: dict):
    """Generate the legacy PDF after the modular tenant/view check has passed."""
    pdf_user = dict(user)
    elevated_roles = {
        legacy.UserRole.SYSTEM_ADMIN,
        legacy.UserRole.COMPANY_ADMIN,
        legacy.UserRole.ADMIN,
        legacy.UserRole.AUDIT_CREATOR,
    }
    if run.get("auditor_id") != user.get("id") and user.get("role") not in elevated_roles:
        # The legacy PDF builder still contains the historical role check. The
        # modular endpoint has already performed the stronger tenant-aware
        # Audits — View check above, so elevate only the internal builder call.
        pdf_user["role"] = legacy.UserRole.COMPANY_ADMIN
    return await legacy.export_audit_pdf(run["id"], pdf_user)


def _audit_template_visible(audit: dict, user: dict) -> bool:
    if legacy.is_system_admin(user):
        return True
    audit_company = audit.get("company_id")
    if audit_company not in {None, user.get("company_id")}:
        return False
    if not audit.get("is_private"):
        return True
    if audit.get("created_by") == user.get("id"):
        return True
    return user.get("role") in {
        legacy.UserRole.COMPANY_ADMIN,
        legacy.UserRole.ADMIN,
        legacy.UserRole.AUDIT_CREATOR,
    }


@router.get("/audits/{audit_id}/runs")
async def get_audit_runs_overview(
    audit_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    pass_status: Optional[str] = None,
    user: dict = Depends(legacy.require_feature("audits")),
):
    audit = await legacy.db.audits.find_one({"id": audit_id}, {"_id": 0})
    if not audit or not _audit_template_visible(audit, user):
        raise HTTPException(status_code=404, detail="Audit not found")

    runs = await legacy.db.run_audits.find(
        {"audit_id": audit_id, "completed": True}, {"_id": 0}
    ).sort("completed_at", -1).to_list(5000)

    company_user_ids = await _company_user_ids(user.get("company_id"))
    visible_runs = [
        run for run in runs if _run_visible_to_user(run, user, company_user_ids)
    ]

    all_visible = visible_runs
    if date_from:
        visible_runs = [
            run for run in visible_runs
            if str(run.get("completed_at") or "") >= date_from
        ]
    if date_to:
        visible_runs = [
            run for run in visible_runs
            if str(run.get("completed_at") or "") <= date_to
        ]
    if pass_status and pass_status != "all":
        if pass_status not in {"pass", "fail"}:
            raise HTTPException(status_code=400, detail="Unknown audit status")
        visible_runs = [
            run for run in visible_runs if run.get("pass_status") == pass_status
        ]

    passed = sum(1 for run in all_visible if run.get("pass_status") == "pass")
    failed = sum(1 for run in all_visible if run.get("pass_status") == "fail")
    total = len(all_visible)

    public_runs = [
        {key: value for key, value in run.items() if key not in {"_id", "signature"}}
        for run in visible_runs
    ]
    return {
        "audit": audit,
        "stats": {
            "total_completed": total,
            "passed": passed,
            "failed": failed,
            "pass_percentage": round((passed / total * 100) if total else 0, 1),
        },
        "runs": public_runs,
    }


@router.get("/run-audits/{run_id}/details")
async def get_audit_run_details(
    run_id: str,
    user: dict = Depends(legacy.require_feature("audits")),
):
    run = await _get_accessible_audit_run(run_id, user)
    audit = await legacy.db.audits.find_one({"id": run.get("audit_id")}, {"_id": 0})
    if not audit:
        raise HTTPException(status_code=404, detail="Audit template not found")

    question_map = {question.get("id"): question for question in audit.get("questions", [])}
    enriched_answers = []
    for answer in run.get("answers", []):
        question = question_map.get(answer.get("question_id"), {})
        enriched_answers.append(
            {
                **answer,
                "question_text": question.get("text", "Question not found"),
                "question_required": question.get("required", True),
            }
        )

    return {
        **run,
        "audit_description": audit.get("description"),
        "audit_pass_rate": audit.get("pass_rate"),
        "questions": audit.get("questions", []),
        "enriched_answers": enriched_answers,
    }


@router.get("/run-audits/{run_id}/pdf")
async def download_audit_run_pdf(
    run_id: str,
    user: dict = Depends(legacy.require_feature("audits")),
):
    run = await _get_accessible_audit_run(run_id, user)
    if not run.get("completed"):
        raise HTTPException(status_code=409, detail="Only completed audits can be downloaded")
    return await _audit_pdf_response(run, user)
