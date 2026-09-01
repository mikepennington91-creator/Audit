from __future__ import annotations

import asyncio
import os
from contextlib import suppress

from fastapi import FastAPI, HTTPException, Request
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

import server as legacy
from app_core.account_auth import router as account_router
from app_core.actions import router as actions_router
from app_core.audit_reports import router as audit_reports_router
from app_core.audit_runs import router as audit_runs_router
from app_core.documents import router as documents_router
from app_core.notifications import router as notifications_router
from app_core.reminders import reminder_loop, router as reminders_router
from app_core.report_email import router as report_email_router
from app_core.schedules import router as schedules_router
from app_core.user_lifecycle import router as user_lifecycle_router


app = FastAPI(title="Infinit-Audit API")

# New modular routes are registered first. Selected legacy endpoints are replaced
# below when they need the new workflow or tighter multi-tenant access checks.
app.include_router(user_lifecycle_router)
app.include_router(account_router)
app.include_router(actions_router)
app.include_router(audit_reports_router)
app.include_router(audit_runs_router)
app.include_router(documents_router)
app.include_router(notifications_router)
app.include_router(reminders_router)
app.include_router(report_email_router)
app.include_router(schedules_router)


@app.post("/api/auth/register")
async def public_registration_disabled():
    raise HTTPException(
        status_code=403,
        detail="Public registration is disabled. Ask your Infinit Audit administrator to create your account.",
    )


_TEMP_PASSWORD_EXEMPT_PATHS = {
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/me",
    "/api/auth/change-temporary-password",
    "/api/auth/password-reset/request",
    "/api/auth/password-reset/confirm",
}


@app.middleware("http")
async def enforce_temporary_password_change(request: Request, call_next):
    """Keep first-login sessions restricted to the password-change flow.

    The frontend redirects these users too, but this API boundary prevents a
    temporary-password session from bypassing that requirement with direct API
    calls.
    """
    if request.method == "OPTIONS" or request.url.path in _TEMP_PASSWORD_EXEMPT_PATHS:
        return await call_next(request)

    authorization = request.headers.get("authorization", "")
    if authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        try:
            payload = legacy.jwt.decode(
                token,
                legacy.JWT_SECRET,
                algorithms=[legacy.JWT_ALGORITHM],
            )
            user_id = payload.get("sub")
            if user_id:
                user = await legacy.db.users.find_one(
                    {"id": user_id}, {"_id": 0, "password": 0}
                )
                if user and user.get("must_change_password"):
                    return JSONResponse(
                        status_code=403,
                        content={
                            "detail": "You must change your temporary password before using Infinit Audit.",
                            "code": "temporary_password_change_required",
                        },
                    )
        except (legacy.jwt.ExpiredSignatureError, legacy.jwt.InvalidTokenError):
            # Existing endpoint dependencies remain responsible for returning
            # the normal authentication error for invalid/expired sessions.
            pass

    return await call_next(request)


_REPLACED_ROUTES = {
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/register"),
    ("GET", "/api/auth/me"),
    ("POST", "/api/users"),
    ("GET", "/api/users"),
    ("POST", "/api/users/bulk-import"),
    ("GET", "/api/users/export-template"),
    ("DELETE", "/api/run-audits/{run_id}"),
    ("PUT", "/api/run-audits/{run_id}"),
    ("GET", "/api/audits/{audit_id}/runs"),
    ("GET", "/api/run-audits/{run_id}/details"),
    ("GET", "/api/run-audits/{run_id}/pdf"),
    ("GET", "/api/actions"),
    ("PUT", "/api/actions/{action_id}"),
    ("PUT", "/api/actions/{action_id}/reassign"),
    ("GET", "/api/traceability/templates/{template_id}"),
    ("PUT", "/api/traceability/templates/{template_id}"),
    ("DELETE", "/api/traceability/templates/{template_id}"),
    ("POST", "/api/traceability/documents"),
    ("GET", "/api/traceability/documents"),
    ("GET", "/api/traceability/documents/{doc_id}"),
    ("PUT", "/api/traceability/documents/{doc_id}"),
    ("GET", "/api/traceability/documents/{doc_id}/pdf"),
    ("POST", "/api/traceability/documents/batch-pdf"),
    ("POST", "/api/scheduled-audits"),
    ("GET", "/api/scheduled-audits"),
    ("GET", "/api/scheduled-audits/my-schedule"),
    ("PUT", "/api/scheduled-audits/{schedule_id}/complete"),
    ("DELETE", "/api/scheduled-audits/{schedule_id}"),
}

for route in legacy.api_router.routes:
    methods = getattr(route, "methods", None) or set()
    path = getattr(route, "path", "")
    if any((method, path) in _REPLACED_ROUTES for method in methods):
        continue
    app.router.routes.append(route)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

_reminder_task: asyncio.Task | None = None


@app.on_event("startup")
async def startup_event():
    global _reminder_task
    await legacy.startup_event()
    await legacy.db.notifications.create_index("id", unique=True)
    await legacy.db.password_reset_tokens.create_index("id", unique=True)
    await legacy.db.email_delivery_events.create_index("id", unique=True)
    await legacy.db.audit_cancellations.create_index("id", unique=True)

    enabled = os.environ.get("REMINDER_LOOP_ENABLED", "true").strip().lower() in {
        "1", "true", "yes", "on"
    }
    if enabled:
        _reminder_task = asyncio.create_task(reminder_loop())


@app.on_event("shutdown")
async def shutdown_event():
    global _reminder_task
    if _reminder_task:
        _reminder_task.cancel()
        with suppress(asyncio.CancelledError):
            await _reminder_task
        _reminder_task = None
    await legacy.shutdown_db_client()
