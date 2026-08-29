from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

import server as legacy


router = APIRouter(prefix="/api", tags=["notifications"])


async def create_notification(
    *,
    user_id: str,
    notification_type: str,
    title: str,
    message: str,
    link: Optional[str] = None,
    company_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    notification = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "company_id": company_id,
        "type": notification_type,
        "title": title,
        "message": message,
        "link": link,
        "metadata": metadata or {},
        "read_at": None,
        "created_at": legacy.get_uk_time_iso(),
    }
    await legacy.db.notifications.insert_one(notification)
    return notification


async def mark_action_notifications_read(user_id: str, action_id: str) -> None:
    notifications = await legacy.db.notifications.find(
        {"user_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    for notification in notifications:
        if notification.get("read_at"):
            continue
        if (notification.get("metadata") or {}).get("action_id") != action_id:
            continue
        await legacy.db.notifications.update_one(
            {"id": notification["id"]},
            {"$set": {"read_at": legacy.get_uk_time_iso()}},
        )


@router.get("/notifications")
async def get_notifications(
    unread_only: bool = False,
    limit: int = 50,
    user: dict = Depends(legacy.get_current_user),
) -> List[Dict[str, Any]]:
    limit = max(1, min(limit, 100))
    notifications = await legacy.db.notifications.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(limit if unread_only else max(limit, 100))
    if unread_only:
        notifications = [item for item in notifications if not item.get("read_at")][:limit]
    else:
        notifications = notifications[:limit]
    return notifications


@router.get("/notifications/unread-count")
async def get_unread_notification_count(
    user: dict = Depends(legacy.get_current_user),
) -> Dict[str, int]:
    notifications = await legacy.db.notifications.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    return {"count": sum(1 for item in notifications if not item.get("read_at"))}


@router.put("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    user: dict = Depends(legacy.get_current_user),
) -> Dict[str, Any]:
    notification = await legacy.db.notifications.find_one(
        {"id": notification_id, "user_id": user["id"]}, {"_id": 0}
    )
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    if not notification.get("read_at"):
        read_at = legacy.get_uk_time_iso()
        await legacy.db.notifications.update_one(
            {"id": notification_id}, {"$set": {"read_at": read_at}}
        )
        notification["read_at"] = read_at
    return notification


@router.put("/notifications/read-all")
async def mark_all_notifications_read(
    user: dict = Depends(legacy.get_current_user),
) -> Dict[str, int]:
    notifications = await legacy.db.notifications.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(500)
    read_at = legacy.get_uk_time_iso()
    updated = 0
    for notification in notifications:
        if notification.get("read_at"):
            continue
        await legacy.db.notifications.update_one(
            {"id": notification["id"]}, {"$set": {"read_at": read_at}}
        )
        updated += 1
    return {"updated": updated}
