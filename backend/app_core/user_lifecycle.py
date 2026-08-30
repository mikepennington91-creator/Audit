from __future__ import annotations

import csv
import html
import io
import secrets
import uuid
from typing import Dict, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr, Field

import server as legacy
from app_core.email_service import public_app_url, send_email


router = APIRouter(prefix="/api", tags=["user-lifecycle"])


class ManagedUserCreate(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=200)
    role: str = legacy.UserRole.USER
    company_id: Optional[str] = None
    feature_access: Dict[str, bool] = Field(default_factory=lambda: legacy.DEFAULT_FEATURE_ACCESS.copy())


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TemporaryPasswordChange(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


def _temporary_password(length: int = 14) -> str:
    """Create a strong but reasonably typeable one-time password."""
    upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"
    lower = "abcdefghijkmnopqrstuvwxyz"
    digits = "23456789"
    symbols = "!@#$%"
    alphabet = upper + lower + digits + symbols
    chars = [
        secrets.choice(upper),
        secrets.choice(lower),
        secrets.choice(digits),
        secrets.choice(symbols),
    ]
    chars.extend(secrets.choice(alphabet) for _ in range(max(0, length - len(chars))))
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


def _public_user(user: dict) -> dict:
    result = {key: value for key, value in user.items() if key not in {"_id", "password"}}
    result["feature_access"] = legacy.normalise_feature_access(user)
    result["must_change_password"] = bool(user.get("must_change_password", False))
    return result


async def _send_welcome_email(user: dict, temporary_password: str):
    login_url = f"{public_app_url()}/login"
    safe_name = html.escape(user.get("name") or "there")
    safe_password = html.escape(temporary_password)
    safe_login_url = html.escape(login_url, quote=True)
    return await send_email(
        to_email=user["email"],
        subject="Your Infinit Audit account is ready",
        text_body=(
            f"Hi {user.get('name') or 'there'},\n\n"
            "An Infinit Audit account has been created for you.\n\n"
            f"Email: {user['email']}\n"
            f"Temporary password: {temporary_password}\n\n"
            f"Sign in: {login_url}\n\n"
            "You will be required to choose a new password immediately after signing in. "
            "Do not share your temporary password."
        ),
        html_body=(
            f"<p>Hi {safe_name},</p>"
            "<p>An Infinit Audit account has been created for you.</p>"
            "<div style=\"margin:22px 0;padding:18px;border:1px solid #dbe5e4;border-radius:10px;background:#f7faf9\">"
            f"<p style=\"margin:0 0 8px\"><strong>Email</strong><br>{html.escape(user['email'])}</p>"
            f"<p style=\"margin:0\"><strong>Temporary password</strong><br>"
            f"<span style=\"font-family:monospace;font-size:18px;letter-spacing:.4px\">{safe_password}</span></p>"
            "</div>"
            f"<p><a href=\"{safe_login_url}\" style=\"display:inline-block;background:#17877d;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600\">Sign in to Infinit Audit</a></p>"
            "<p><strong>You will be required to create a new password immediately after signing in.</strong></p>"
            "<p>For your security, do not share your temporary password.</p>"
        ),
        template="new_user_welcome",
    )


def _resolve_managed_role_and_company(data: ManagedUserCreate, admin: dict) -> tuple[str, Optional[str]]:
    role = data.role
    company_id = data.company_id

    if not legacy.is_system_admin(admin):
        if not admin.get("company_id"):
            raise HTTPException(status_code=400, detail="Your administrator account is not assigned to a company")
        company_id = admin["company_id"]
        if role == legacy.UserRole.SYSTEM_ADMIN:
            raise HTTPException(status_code=403, detail="Cannot create system administrators")
        if role == legacy.UserRole.ADMIN:
            role = legacy.UserRole.COMPANY_ADMIN

    valid_roles = {
        legacy.UserRole.SYSTEM_ADMIN,
        legacy.UserRole.COMPANY_ADMIN,
        legacy.UserRole.AUDIT_CREATOR,
        legacy.UserRole.USER,
    }
    if role not in valid_roles:
        raise HTTPException(status_code=400, detail="Invalid user role")
    if role == legacy.UserRole.COMPANY_ADMIN and not company_id:
        raise HTTPException(status_code=400, detail="Company administrators must be assigned to a company")
    return role, company_id


async def _create_user_with_temporary_password(data: ManagedUserCreate, admin: dict) -> dict:
    if not legacy.is_admin(admin):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    role, company_id = _resolve_managed_role_and_company(data, admin)
    if company_id and not await legacy.db.companies.find_one({"id": company_id}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Company not found")

    first_company_user = bool(
        company_id and await legacy.db.users.count_documents({"company_id": company_id}) == 0
    )
    if first_company_user:
        role = legacy.UserRole.COMPANY_ADMIN

    email = legacy.normalise_email(data.email)
    if await legacy.db.users.find_one({"email": {"$ieq": email}}):
        raise HTTPException(status_code=400, detail="Email already registered")

    temporary_password = _temporary_password()
    user_doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password": legacy.hash_password(temporary_password),
        "name": data.name.strip(),
        "role": role,
        "company_id": company_id,
        "feature_access": legacy.normalise_feature_access(
            {"role": role, "feature_access": data.feature_access},
            legacy.ADMIN_FEATURE_ACCESS if first_company_user else data.feature_access,
        ),
        "must_change_password": True,
        "temporary_password_issued_at": legacy.get_uk_time_iso(),
        "created_at": legacy.get_uk_time_iso(),
    }
    await legacy.db.users.insert_one(user_doc)

    delivery = await _send_welcome_email(user_doc, temporary_password)
    if not delivery.sent:
        # Do not leave an account behind if the only copy of its one-time
        # credential could not be delivered.
        await legacy.db.users.delete_one({"id": user_doc["id"]})
        raise HTTPException(
            status_code=502,
            detail="The account was not created because the welcome email could not be delivered. Please try again.",
        )

    response = _public_user(user_doc)
    if company_id:
        company = await legacy.db.companies.find_one({"id": company_id}, {"_id": 0})
        if company:
            response["company_name"] = company.get("name")
    return response


@router.post("/users")
async def create_managed_user(data: ManagedUserCreate, user: dict = Depends(legacy.get_current_user)):
    created = await _create_user_with_temporary_password(data, user)
    return {
        "user": created,
        "welcome_email_sent": True,
        "message": "User created and temporary sign-in details emailed successfully.",
    }


@router.get("/users")
async def get_managed_users(user: dict = Depends(legacy.get_current_user)):
    """List users in the administrator's scope, including first-login state."""
    if legacy.is_system_admin(user):
        query = {}
    elif legacy.is_admin(user) and user.get("company_id"):
        query = {"company_id": user["company_id"]}
    else:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    users = await legacy.db.users.find(query, {"_id": 0, "password": 0}).to_list(1000)
    results = []
    company_names: dict[str, str] = {}
    for item in users:
        result = _public_user(item)
        company_id = item.get("company_id")
        if company_id:
            if company_id not in company_names:
                company = await legacy.db.companies.find_one({"id": company_id}, {"_id": 0})
                company_names[company_id] = (company or {}).get("name") or ""
            if company_names[company_id]:
                result["company_name"] = company_names[company_id]
        results.append(result)
    return results


@router.post("/auth/login")
async def login(credentials: LoginRequest):
    email = legacy.normalise_email(credentials.email)
    user = await legacy.db.users.find_one({"email": {"$ieq": email}})
    if not user or not legacy.verify_password(credentials.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = legacy.create_token(user["id"], user["email"], user["role"])
    return {"token": token, "user": _public_user(user)}


@router.get("/auth/me")
async def get_me(user: dict = Depends(legacy.get_current_user)):
    result = _public_user(user)
    if user.get("company_id"):
        company = await legacy.db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
        if company:
            result["company_name"] = company.get("name")
    return result


@router.post("/auth/change-temporary-password")
async def change_temporary_password(
    data: TemporaryPasswordChange,
    user: dict = Depends(legacy.get_current_user),
):
    stored_user = await legacy.db.users.find_one({"id": user["id"]})
    if not stored_user:
        raise HTTPException(status_code=404, detail="User not found")
    if not stored_user.get("must_change_password"):
        raise HTTPException(status_code=400, detail="A temporary password change is not required for this account")
    if legacy.verify_password(data.new_password, stored_user["password"]):
        raise HTTPException(status_code=400, detail="Choose a password different from your temporary password")

    await legacy.db.users.update_one(
        {"id": user["id"]},
        {"$set": {
            "password": legacy.hash_password(data.new_password),
            "must_change_password": False,
            "temporary_password_issued_at": None,
            "password_changed_at": legacy.get_uk_time_iso(),
        }},
    )
    return {"message": "Password updated successfully"}


@router.post("/users/bulk-import")
async def bulk_import_users(file: UploadFile = File(...), user: dict = Depends(legacy.get_current_user)):
    if not legacy.is_admin(user):
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a CSV")

    try:
        decoded = (await file.read()).decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="CSV must be UTF-8 encoded") from exc

    reader = csv.DictReader(io.StringIO(decoded))
    results = {"success": 0, "failed": 0, "errors": []}
    for row_num, row in enumerate(reader, start=2):
        try:
            email = (row.get("email") or "").strip()
            name = (row.get("name") or "").strip()
            if not email or not name:
                raise HTTPException(status_code=400, detail="Missing email or name")

            role = (row.get("role") or legacy.UserRole.USER).strip().lower()
            company_id = (row.get("company_id") or "").strip() or None
            access = legacy.DEFAULT_FEATURE_ACCESS.copy()
            created = await _create_user_with_temporary_password(
                ManagedUserCreate(
                    email=email,
                    name=name,
                    role=role,
                    company_id=company_id,
                    feature_access=access,
                ),
                user,
            )
            if created:
                results["success"] += 1
        except Exception as exc:
            detail = exc.detail if isinstance(exc, HTTPException) else str(exc)
            results["failed"] += 1
            results["errors"].append(f"Row {row_num}: {detail}")
    return results


@router.get("/users/export-template")
async def get_user_import_template(user: dict = Depends(legacy.get_current_user)):
    if not legacy.is_admin(user):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["email", "name", "role", "company_id"])
    writer.writerow(["john@example.com", "John Doe", "user", ""])
    writer.writerow(["jane@example.com", "Jane Smith", "audit_creator", "company-id-here"])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=user_import_template.csv"},
    )
