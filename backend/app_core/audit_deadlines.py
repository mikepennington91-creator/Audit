from __future__ import annotations

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo
import html
import logging

import server as legacy
from app_core.email_service import email_is_configured, public_app_url, send_email

LONDON = ZoneInfo('Europe/London')
logger = logging.getLogger(__name__)


def audit_deadlines(started_at):
    started = datetime.fromisoformat(str(started_at).replace('Z', '+00:00'))
    if started.tzinfo is None:
        started = started.replace(tzinfo=LONDON)
    monday = started.astimezone(LONDON).date() - timedelta(days=started.astimezone(LONDON).weekday())
    return {
        'due_date': (monday + timedelta(days=4)).isoformat(),
        'reminder_at': datetime.combine(monday + timedelta(days=3), time(23), LONDON).isoformat(),
        'auto_close_at': datetime.combine(monday + timedelta(days=7), time.min, LONDON).isoformat(),
    }


def run_payload(run):
    return {**audit_deadlines(run['started_at']), **run}


def is_expired(run, now=None):
    deadline = datetime.fromisoformat(audit_deadlines(run['started_at'])['auto_close_at'])
    return (now or legacy.get_uk_time()) >= deadline


async def close_if_expired(run, now=None):
    if run.get('completed') or run.get('closed_at') or not is_expired(run, now):
        return run
    changes = {
        **audit_deadlines(run['started_at']),
        'closed_at': (now or legacy.get_uk_time()).isoformat(),
        'status': 'closed_incomplete',
        'not_completed_in_time': True,
        'closure_reason': 'Not completed by the start of the following Monday',
        'version': (run.get('version') or 0) + 1,
    }
    await legacy.db.run_audits.update_one({'id': run['id'], 'completed': False, 'closed_at': None}, {'$set': changes})
    return {**run, **changes}


async def process_open_audits():
    """Close overdue runs even without SMTP; retry failed reminders on next pass.

    All writers take the same transaction lock, preventing worker duplication or
    closure during a user's final submission. A process crash just after SMTP
    accepts mail can still cause a retry (SMTP has no transactional delivery).
    """
    runs = await legacy.db.run_audits.find({'completed': False, 'closed_at': None}, {'_id': 0}).to_list(100000)
    counts = {'closed': 0, 'sent': 0, 'failed': 0}
    for item in runs:
        try:
            async with legacy.db.transaction('audit:' + item['id']):
                run = await legacy.db.run_audits.find_one({'id': item['id']})
                if not run or run.get('completed') or run.get('closed_at'):
                    continue
                if not run.get('company_id'):
                    audit = await legacy.db.audits.find_one({'id': run.get('audit_id')})
                    if (audit or {}).get('company_id'):
                        run['company_id'] = audit['company_id']
                        await legacy.db.run_audits.update_one({'id': run['id']}, {'$set': {'company_id': run['company_id']}})
                now = legacy.get_uk_time()
                if is_expired(run, now):
                    await close_if_expired(run, now)
                    counts['closed'] += 1
                    continue
                deadlines = audit_deadlines(run['started_at'])
                reminder_at = datetime.fromisoformat(deadlines['reminder_at'])
                # Only Thursday night/Friday, including recovery after downtime.
                if now < reminder_at or now.astimezone(LONDON).date().isoformat() > deadlines['due_date']:
                    continue
                if run.get('completion_reminder_sent_at'):
                    continue
                if not email_is_configured():
                    counts['failed'] += 1
                    continue
                starter = await legacy.db.users.find_one({'id': run['auditor_id']})
                if not starter or not starter.get('email') or starter.get('company_id') != run.get('company_id'):
                    continue
                due = legacy.format_uk_date(deadlines['due_date'])
                url = f"{public_app_url()}/run-audit/{run['id']}"
                body = f"Hi {starter.get('name', '')},\n\nYou started {run['audit_name']}. Please complete it by Friday {due}. Other users with audit access in your company can also finish it. It will close as not completed in time at the start of Monday.\n\nOpen audit: {url}"
                result = await send_email(to_email=starter['email'], subject=f"Complete your audit by Friday: {run['audit_name']}", text_body=body, html_body=f'<p>{html.escape(body).replace(chr(10), "<br>")}</p>', template='audit_completion_reminder')
                changes = {'completion_reminder_status': result.status, 'completion_reminder_attempted_at': now.isoformat()}
                if result.sent:
                    changes['completion_reminder_sent_at'] = now.isoformat()
                    counts['sent'] += 1
                else:
                    counts['failed'] += 1
                await legacy.db.run_audits.update_one({'id': run['id']}, {'$set': changes})
        except Exception:
            counts['failed'] += 1
            logger.exception('Audit deadline processing failed for %s', item['id'])
    return counts
