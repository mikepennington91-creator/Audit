from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

import server as legacy
from database import activity_reason

router = APIRouter(prefix='/api', tags=['company-activity'])


class DeletionReason(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)

    @field_validator('reason')
    @classmethod
    def require_reason(cls, value):
        if not value.strip():
            raise ValueError('A reason is required')
        return value.strip()


def require_company_admin(user):
    if not legacy.is_admin(user):
        raise HTTPException(status_code=403, detail='Administrator access is required')
    if not legacy.is_system_admin(user) and not user.get('company_id'):
        raise HTTPException(status_code=403, detail='Company access is required')


async def delete_with_reason(collection, resource, data, user):
    require_company_admin(user)
    if not legacy.is_system_admin(user) and resource.get('company_id') != user.get('company_id'):
        raise HTTPException(status_code=404, detail='Record not found')
    token = activity_reason.set(data.reason)
    try:
        # The database trigger writes the immutable event atomically with deletion.
        result = await collection.delete_one({'id': resource['id']})
    finally:
        activity_reason.reset(token)
    if not result.deleted_count:
        raise HTTPException(status_code=409, detail='Record has already been deleted')
    return {'message': 'Record deleted; reason retained in company activity'}


@router.get('/company-activity')
async def get_company_activity(
    event_type: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    user: dict = Depends(legacy.get_current_user),
):
    require_company_admin(user)
    query = {} if legacy.is_system_admin(user) else {'company_id': user['company_id']}
    if event_type:
        query['event_type'] = event_type
    london = ZoneInfo('Europe/London')
    for value, operator, extra_day in [(date_from, '$gte', 0), (date_to, '$lt', 1)]:
        if value:
            stamp = datetime.combine(value + timedelta(days=extra_day), time.min, london)
            query.setdefault('occurred_at', {})[operator] = stamp.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ')
    entries = await legacy.db.company_activity.find(query, {'_id': 0}).sort('occurred_at', -1).skip(offset).to_list(limit)
    total = await legacy.db.company_activity.count_documents(query)
    return {'entries': entries, 'total': total}
