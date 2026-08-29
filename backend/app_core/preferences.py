from __future__ import annotations

from typing import Any, Dict

from fastapi import HTTPException

import server as legacy


DEFAULT_NOTIFICATION_PREFERENCES: Dict[str, bool] = {
    "email_action_assigned": True,
    "email_action_review": True,
    "email_scheduled_audit_reminder": True,
}

PREFERENCE_DESCRIPTIONS = {
    "email_action_assigned": "Email me when a corrective action is assigned to me.",
    "email_action_review": "Email me when a corrective action is ready for my review.",
    "email_scheduled_audit_reminder": "Email me before an audit assigned to me is due.",
}


def normalise_notification_preferences(user: Dict[str, Any]) -> Dict[str, bool]:
    preferences = DEFAULT_NOTIFICATION_PREFERENCES.copy()
    stored = user.get("notification_preferences") or {}
    for key in preferences:
        if key in stored:
            preferences[key] = bool(stored[key])
    return preferences


def email_preference_enabled(user: Dict[str, Any], preference_key: str) -> bool:
    return normalise_notification_preferences(user).get(preference_key, False)


async def update_notification_preferences(
    user: Dict[str, Any], requested: Dict[str, bool]
) -> Dict[str, bool]:
    unknown = set(requested) - set(DEFAULT_NOTIFICATION_PREFERENCES)
    if unknown:
        raise HTTPException(
            status_code=400,
            detail="Unknown notification preference(s): " + ", ".join(sorted(unknown)),
        )

    preferences = normalise_notification_preferences(user)
    preferences.update({key: bool(value) for key, value in requested.items()})
    await legacy.db.users.update_one(
        {"id": user["id"]}, {"$set": {"notification_preferences": preferences}}
    )
    return preferences
