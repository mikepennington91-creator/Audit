"""Shared in-app and email notification helpers."""

from __future__ import annotations

import uuid
from typing import Any, Dict, Optional

from services.email_service import send_email


DEFAULT_NOTIFICATION_PREFERENCES = {
    "action_assignment_email": True,
    "action_review_in_app": True,
    "action_review_email": False,
    "scheduled_audit_reminder_email": True,
}

ALLOWED_NOTIFICATION_PREFERENCES = frozenset(DEFAULT_NOTIFICATION_PREFERENCES)


def notification_preferences(user: dict) -> Dict[str, bool]:
    result = DEFAULT_NOTIFICATION_PREFERENCES.copy()
    stored = user.get("notification_preferences") or {}
    for key in ALLOWED_NOTIFICATION_PREFERENCES:
        if key in stored:
            result[key] = bool(stored[key])
    return result


async def create_notification(
    db,
    *,
    user_id: str,
    company_id: Optional[str],
    notification_type: str,
    title: str,
    message: str,
    created_at: str,
    link: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> dict:
    notification = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "company_id": company_id,
        "type": notification_type,
        "title": title,
        "message": message,
        "link": link,
        "metadata": metadata or {},
        "created_at": created_at,
        "read_at": None,
    }
    await db.notifications.insert_one(notification)
    return notification


async def send_user_email(
    user: dict,
    *,
    preference_key: str,
    subject: str,
    text_body: str,
    html_body: Optional[str] = None,
    attachment: Optional[bytes] = None,
    attachment_name: Optional[str] = None,
    attachment_type: str = "application/octet-stream",
) -> bool:
    if not notification_preferences(user).get(preference_key, False):
        return False
    return await send_email(
        recipients=[user.get("email", "")],
        subject=subject,
        text_body=text_body,
        html_body=html_body,
        attachment=attachment,
        attachment_name=attachment_name,
        attachment_type=attachment_type,
    )
