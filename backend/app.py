"""Application composition layer.

server.py remains the compatibility core while new features live in focused
routers/services.  Existing routes can be migrated out of server.py gradually
without another all-at-once rewrite.
"""

import asyncio
import logging

from server import app
from routers.account import router as account_router
from routers.exports import router as exports_router
from routers.workflow import (
    process_pending_action_emails,
    process_scheduled_audit_reminders,
    router as workflow_router,
)

logger = logging.getLogger(__name__)
_notification_task = None

app.include_router(account_router)
app.include_router(exports_router)
app.include_router(workflow_router)


async def _notification_worker() -> None:
    while True:
        try:
            await process_pending_action_emails()
            await process_scheduled_audit_reminders()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Notification worker failed; it will retry on the next cycle")
        await asyncio.sleep(3600)


@app.on_event("startup")
async def start_notification_worker() -> None:
    global _notification_task
    _notification_task = asyncio.create_task(_notification_worker())


@app.on_event("shutdown")
async def stop_notification_worker() -> None:
    global _notification_task
    if _notification_task:
        _notification_task.cancel()
        try:
            await _notification_task
        except asyncio.CancelledError:
            pass
        _notification_task = None
