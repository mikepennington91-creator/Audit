from __future__ import annotations

import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from server import db, get_current_user, get_uk_time_iso, hash_password, normalise_email
from services.email_service import send_email
from services.notification_service import (
    ALLOWED_NOTIFICATION_PREFERENCES,
    notification_preferences,
)

router = APIRouter(prefix="/api", tags=["account"])


class NotificationPreferencesUpdate(BaseModel):
    preferences: Dict[str, bool] = Field(default_factory=dict)


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _validate_new_password(password: str) -> None:
    if len(password) < 10:
        raise HTTPException(status_code=400, detail="Password must be at least 10 characters")
    if not any(character.isalpha() for character in password) or not any(character.isdigit() for character in password):
        raise HTTPException(status_code=400, detail="Password must contain at least one letter and one number")


@router.get("/account")
async def get_account(user: dict = Depends(get_current_user)):
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
        "company_id": user.get("company_id"),
        "notification_preferences": notification_preferences(user),
    }


@router.put("/account/notification-preferences")
async def update_notification_preferences(
    data: NotificationPreferencesUpdate,
    user: dict = Depends(get_current_user),
):
    unknown = set(data.preferences) - ALLOWED_NOTIFICATION_PREFERENCES
    if unknown:
        raise HTTPException(status_code=400, detail="Unknown notification preference(s): " + ", ".join(sorted(unknown)))
    updated = notification_preferences(user)
    updated.update({key: bool(value) for key, value in data.preferences.items()})
    await db.users.update_one({"id": user["id"]}, {"$set": {"notification_preferences": updated}})
    return {"notification_preferences": updated}


@router.get("/notifications")
async def get_notifications(unread_only: bool = False, user: dict = Depends(get_current_user)):
    notifications = await db.notifications.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(250)
    if unread_only:
        notifications = [item for item in notifications if not item.get("read_at")]
    return notifications


@router.put("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, user: dict = Depends(get_current_user)):
    notification = await db.notifications.find_one({"id": notification_id}, {"_id": 0})
    if not notification or notification.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Notification not found")
    read_at = notification.get("read_at") or get_uk_time_iso()
    await db.notifications.update_one({"id": notification_id}, {"$set": {"read_at": read_at}})
    return {**notification, "read_at": read_at}


@router.post("/auth/password-reset/request")
async def request_password_reset(data: PasswordResetRequest):
    # Deliberately identical response for existing and non-existing accounts to
    # prevent account enumeration.
    generic_response = {
        "message": "If an account exists for that email address, a password reset link will be sent."
    }
    email = normalise_email(data.email)
    user = await db.users.find_one({"email": {"$ieq": email}}, {"_id": 0})
    if not user:
        return generic_response

    # Basic persistent throttling. Repeated requests remain indistinguishable
    # to the caller but no more than one message is generated per minute.
    last_requested = _parse_datetime(user.get("password_reset_requested_at"))
    now_utc = datetime.now(timezone.utc)
    if last_requested and now_utc - last_requested.astimezone(timezone.utc) < timedelta(minutes=1):
        return generic_response

    raw_token = secrets.token_urlsafe(40)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    token_id = str(uuid.uuid4())
    expires_at = (now_utc + timedelta(minutes=30)).isoformat()
    reset_doc = {
        "id": token_id,
        "user_id": user["id"],
        "token_hash": token_hash,
        "created_at": now_utc.isoformat(),
        "expires_at": expires_at,
        "used_at": None,
    }
    await db.password_reset_tokens.insert_one(reset_doc)
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_reset_token_id": token_id, "password_reset_requested_at": now_utc.isoformat()}},
    )

    app_base_url = os.environ.get("APP_BASE_URL", "https://www.infinit-audit.co.uk").rstrip("/")
    reset_url = f"{app_base_url}/reset-password?token={raw_token}"
    await send_email(
        recipients=[user["email"]],
        subject="Reset your Infinit Audit password",
        text_body=(
            f"A password reset was requested for your Infinit Audit account.\n\n"
            f"Use this link within 30 minutes:\n{reset_url}\n\n"
            "If you did not request this, you can ignore this email."
        ),
    )
    return generic_response


@router.post("/auth/password-reset/confirm")
async def confirm_password_reset(data: PasswordResetConfirm):
    _validate_new_password(data.new_password)
    token_hash = hashlib.sha256(data.token.encode("utf-8")).hexdigest()
    reset = await db.password_reset_tokens.find_one({"token_hash": token_hash}, {"_id": 0})
    if not reset or reset.get("used_at"):
        raise HTTPException(status_code=400, detail="This password reset link is invalid or has expired")

    expiry = _parse_datetime(reset.get("expires_at"))
    if not expiry or expiry.astimezone(timezone.utc) <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="This password reset link is invalid or has expired")

    user = await db.users.find_one({"id": reset["user_id"]}, {"_id": 0})
    if not user or user.get("password_reset_token_id") != reset["id"]:
        raise HTTPException(status_code=400, detail="This password reset link is invalid or has expired")

    now = get_uk_time_iso()
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {
            "password": hash_password(data.new_password),
            "password_reset_token_id": None,
            "password_reset_completed_at": now,
        }},
    )
    await db.password_reset_tokens.update_one({"id": reset["id"]}, {"$set": {"used_at": now}})
    return {"message": "Password updated successfully. You can now sign in."}
