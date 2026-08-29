from __future__ import annotations

import hashlib
import html
import secrets
from datetime import datetime, timedelta, timezone
from typing import Dict

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

import server as legacy
from app_core.email_service import public_app_url, send_email
from app_core.preferences import (
    PREFERENCE_DESCRIPTIONS,
    normalise_notification_preferences,
    update_notification_preferences,
)


router = APIRouter(prefix="/api", tags=["account"])
RESET_TOKEN_TTL_MINUTES = 30
RESET_REQUEST_COOLDOWN_SECONDS = 60


class NotificationPreferenceUpdate(BaseModel):
    preferences: Dict[str, bool] = Field(default_factory=dict)


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str = Field(min_length=20, max_length=512)
    new_password: str = Field(min_length=8, max_length=128)


def _hash_reset_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


async def _send_password_reset_email(to_email: str, name: str, raw_token: str) -> None:
    reset_url = f"{public_app_url()}/reset-password?token={raw_token}"
    safe_name = html.escape(name or "there")
    safe_url = html.escape(reset_url, quote=True)
    await send_email(
        to_email=to_email,
        subject="Reset your Infinit Audit password",
        text_body=(
            f"Hi {name or 'there'},\n\n"
            "A password reset was requested for your Infinit Audit account. "
            f"Use this link within {RESET_TOKEN_TTL_MINUTES} minutes:\n{reset_url}\n\n"
            "If you did not request this, you can ignore this email."
        ),
        html_body=(
            f"<p>Hi {safe_name},</p>"
            "<p>A password reset was requested for your Infinit Audit account.</p>"
            f"<p><a href=\"{safe_url}\">Reset your password</a></p>"
            f"<p>This link expires in {RESET_TOKEN_TTL_MINUTES} minutes and can only be used once.</p>"
            "<p>If you did not request this, you can ignore this email.</p>"
        ),
        template="password_reset",
    )


@router.get("/account")
async def get_account(user: dict = Depends(legacy.get_current_user)):
    company_name = None
    if user.get("company_id"):
        company = await legacy.db.companies.find_one(
            {"id": user["company_id"]}, {"_id": 0}
        )
        company_name = (company or {}).get("name")
    return {
        "id": user["id"],
        "name": user.get("name"),
        "email": user.get("email"),
        "role": user.get("role"),
        "company_id": user.get("company_id"),
        "company_name": company_name,
        "notification_preferences": normalise_notification_preferences(user),
        "notification_preference_descriptions": PREFERENCE_DESCRIPTIONS,
    }


@router.put("/account/notification-preferences")
async def update_account_notification_preferences(
    data: NotificationPreferenceUpdate,
    user: dict = Depends(legacy.get_current_user),
):
    preferences = await update_notification_preferences(user, data.preferences)
    return {"notification_preferences": preferences}


@router.post("/auth/password-reset/request")
async def request_password_reset(
    data: PasswordResetRequest,
    background_tasks: BackgroundTasks,
):
    """Always return the same response so the endpoint cannot enumerate accounts."""
    generic_response = {
        "message": "If an account exists for that email address, a password reset link will be sent."
    }
    email = legacy.normalise_email(data.email)
    user = await legacy.db.users.find_one({"email": {"$ieq": email}}, {"_id": 0})
    if not user:
        # Do the same token hashing work as the success path without storing anything.
        _hash_reset_token(secrets.token_urlsafe(32))
        return generic_response

    now = datetime.now(timezone.utc)
    last_requested = _parse_iso(user.get("password_reset_requested_at"))
    if last_requested and now - last_requested < timedelta(seconds=RESET_REQUEST_COOLDOWN_SECONDS):
        return generic_response

    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_reset_token(raw_token)
    token_doc = {
        "id": secrets.token_hex(16),
        "user_id": user["id"],
        "token_hash": token_hash,
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(minutes=RESET_TOKEN_TTL_MINUTES)).isoformat(),
        "used_at": None,
    }
    await legacy.db.password_reset_tokens.insert_one(token_doc)
    await legacy.db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_reset_requested_at": now.isoformat()}},
    )
    background_tasks.add_task(
        _send_password_reset_email,
        user.get("email") or email,
        user.get("name") or "",
        raw_token,
    )
    return generic_response


@router.post("/auth/password-reset/confirm")
async def confirm_password_reset(data: PasswordResetConfirm):
    token_hash = _hash_reset_token(data.token)
    token_doc = await legacy.db.password_reset_tokens.find_one(
        {"token_hash": token_hash}, {"_id": 0}
    )
    now = datetime.now(timezone.utc)
    expires_at = _parse_iso((token_doc or {}).get("expires_at"))
    if (
        not token_doc
        or token_doc.get("used_at")
        or not expires_at
        or expires_at <= now
    ):
        raise HTTPException(status_code=400, detail="This password reset link is invalid or has expired")

    user = await legacy.db.users.find_one({"id": token_doc["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=400, detail="This password reset link is invalid or has expired")

    await legacy.db.users.update_one(
        {"id": user["id"]},
        {"$set": {
            "password": legacy.hash_password(data.new_password),
            "password_reset_requested_at": None,
            "password_changed_at": legacy.get_uk_time_iso(),
        }},
    )

    # Make every outstanding reset token for this account single-use after a
    # successful reset, not just the token that happened to be submitted.
    tokens = await legacy.db.password_reset_tokens.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    used_at = now.isoformat()
    for token in tokens:
        if not token.get("used_at"):
            await legacy.db.password_reset_tokens.update_one(
                {"id": token["id"]}, {"$set": {"used_at": used_at}}
            )

    return {"message": "Password updated successfully. You can now sign in."}
