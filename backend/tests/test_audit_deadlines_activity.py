import asyncio
import copy
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

os.environ.setdefault('DATABASE_URL', 'postgresql://test:test@localhost/test')
os.environ.setdefault('JWT_SECRET_KEY', 'test-secret')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from database import activity_reason
from app_core import audit_deadlines as deadlines, audit_runs, actions, documents, company_activity, audit_reports


def matches(row, query):
    for key, value in query.items():
        if key == '$or':
            if not any(matches(row, q) for q in value): return False
        elif isinstance(value, dict):
            for op, operand in value.items():
                actual = row.get(key) or ''
                if op == '$gte' and actual < operand: return False
                if op == '$lt' and actual >= operand: return False
        elif row.get(key) != value: return False
    return True


class Collection:
    def __init__(self, rows=()): self.rows = {r['id']: copy.deepcopy(r) for r in rows}
    async def find_one(self, q, projection=None):
        return next((copy.deepcopy(r) for r in self.rows.values() if matches(r, q)), None)
    def find(self, q, projection=None):
        rows = [copy.deepcopy(r) for r in self.rows.values() if matches(r, q)]
        class Cursor:
            def sort(self, field, direction):
                rows.sort(key=lambda r: r.get(field) or '', reverse=direction < 0); return self
            def skip(self, count): del rows[:count]; return self
            async def to_list(self, n): return rows[:n]
        return Cursor()
    async def count_documents(self, q): return sum(matches(r, q) for r in self.rows.values())
    async def insert_one(self, row): self.rows[row['id']] = copy.deepcopy(row)
    async def update_one(self, q, update):
        for row in self.rows.values():
            if matches(row, q):
                row.update(copy.deepcopy(update['$set']))
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)
    async def delete_one(self, q):
        self.deletion_reason = activity_reason.get()
        for key, row in list(self.rows.items()):
            if matches(row, q): del self.rows[key]; return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class DB:
    def __init__(self, run):
        self.run_audits = Collection([run])
        self.audits = Collection([{'id': 'a1', 'name': 'Weekly check', 'company_id': 'c1', 'questions': [], 'pass_rate': 80}])
        self.users = Collection([{'id': 'starter', 'name': 'Starter', 'email': 'starter@example.test', 'company_id': 'c1'}])
        self.corrective_actions = Collection()
        self.traceability_documents = Collection([{'id': 'doc1', 'company_id': 'c1', 'completed': True}])
        self.company_activity = Collection()
        self.audit_cancellations = Collection()
        self.locks = {}
    @asynccontextmanager
    async def transaction(self, key=None):
        async with self.locks.setdefault(key, asyncio.Lock()): yield


def user(role='user', company='c1', uid='finisher'):
    return {'id': uid, 'name': 'Finisher', 'email': 'finisher@example.test', 'role': role, 'company_id': company}


@pytest.fixture
def database(monkeypatch):
    run = dict(id='r1', audit_id='a1', audit_name='Weekly check', auditor_id='starter', auditor_name='Starter',
               company_id='c1', started_at='2026-09-01T10:00:00+01:00', completed=False, answers=[],
               notes=None, location=None, total_score=None, pass_status=None, completed_at=None, version=0)
    db = DB(run)
    monkeypatch.setattr(server, 'db', db)
    monkeypatch.setattr(server, 'get_uk_time', lambda: datetime.fromisoformat('2026-09-03T23:15:00+01:00'))
    return db


@pytest.mark.parametrize('start,due,close', [
    ('2026-09-01T10:00:00+01:00', '2026-09-04', '2026-09-07T00:00:00+01:00'),
    ('2026-03-27T10:00:00+00:00', '2026-03-27', '2026-03-30T00:00:00+01:00'),
    ('2026-10-23T10:00:00+01:00', '2026-10-23', '2026-10-26T00:00:00+00:00'),
    ('2026-09-05T10:00:00+01:00', '2026-09-04', '2026-09-07T00:00:00+01:00'),
])
def test_deadlines_use_same_calendar_week_including_dst(start, due, close):
    result = deadlines.audit_deadlines(start)
    assert result['due_date'] == due
    assert result['auto_close_at'] == close


def test_reminder_goes_only_to_starter_once_with_concurrent_workers(database, monkeypatch):
    sent = []
    monkeypatch.setattr(deadlines, 'email_is_configured', lambda: True)
    async def send(**kwargs):
        sent.append(kwargs); await asyncio.sleep(0)
        return SimpleNamespace(sent=True, status='sent')
    monkeypatch.setattr(deadlines, 'send_email', send)
    async def workers():
        await asyncio.gather(deadlines.process_open_audits(), deadlines.process_open_audits())
        await deadlines.process_open_audits()
    asyncio.run(workers())
    assert len(sent) == 1
    assert sent[0]['to_email'] == 'starter@example.test'
    assert '04/09/2026' in sent[0]['text_body']


def test_failed_reminders_retry_without_marking_sent(database, monkeypatch):
    monkeypatch.setattr(deadlines, 'email_is_configured', lambda: True)
    async def send(**kw): return SimpleNamespace(sent=False, status='failed')
    monkeypatch.setattr(deadlines, 'send_email', send)
    assert asyncio.run(deadlines.process_open_audits())['failed'] == 1
    assert 'completion_reminder_sent_at' not in database.run_audits.rows['r1']


@pytest.mark.parametrize('now', ['2026-09-03T22:59:00+01:00', '2026-09-05T10:00:00+01:00'])
def test_reminder_does_not_send_outside_thursday_night_friday(database, monkeypatch, now):
    monkeypatch.setattr(server, 'get_uk_time', lambda: datetime.fromisoformat(now))
    monkeypatch.setattr(deadlines, 'email_is_configured', lambda: True)
    async def send(**kw): pytest.fail('Unexpected email')
    monkeypatch.setattr(deadlines, 'send_email', send)
    assert asyncio.run(deadlines.process_open_audits())['sent'] == 0


def test_monday_closes_without_smtp_preserves_answers_and_blocks_save(database, monkeypatch):
    database.run_audits.rows['r1']['answers'] = [{'question_id': 'q1', 'response_value': 'saved'}]
    monkeypatch.setattr(server, 'get_uk_time', lambda: datetime.fromisoformat('2026-09-07T00:00:00+01:00'))
    monkeypatch.setattr(deadlines, 'email_is_configured', lambda: False)
    assert asyncio.run(deadlines.process_open_audits())['closed'] == 1
    row = database.run_audits.rows['r1']
    assert row['status'] == 'closed_incomplete' and not row['completed']
    assert row['not_completed_in_time'] and row['answers'][0]['response_value'] == 'saved'
    assert not row.get('completed_by_id')
    with pytest.raises(HTTPException) as error:
        asyncio.run(actions.update_run_audit('r1', server.RunAuditSubmit(answers=[], expected_version=1), user()))
    assert error.value.status_code == 409
    assert asyncio.run(deadlines.process_open_audits())['closed'] == 0


def test_shared_run_records_starter_and_actual_finisher_and_rejects_rewrite(database):
    assert len(asyncio.run(audit_runs.get_run_audits(False, user()))) == 1
    result = asyncio.run(actions.update_run_audit('r1', server.RunAuditSubmit(answers=[], completed=True, expected_version=0, signoff_name='Spoofed'), user()))
    assert result.auditor_id == 'starter'
    assert result.completed_by_id == 'finisher' and result.signoff_name == 'Finisher'
    with pytest.raises(HTTPException) as error:
        asyncio.run(actions.update_run_audit('r1', server.RunAuditSubmit(answers=[], expected_version=1), user()))
    assert error.value.status_code == 409


def test_stale_shared_save_is_rejected(database):
    submission = server.RunAuditSubmit(answers=[], expected_version=0)
    asyncio.run(actions.update_run_audit('r1', submission, user()))
    with pytest.raises(HTTPException) as error:
        asyncio.run(actions.update_run_audit('r1', submission, user(uid='third')))
    assert error.value.status_code == 409


def test_cross_company_cannot_view_edit_delete_even_former_starter(database):
    outsider = user('company_admin', 'c2', 'starter')
    assert asyncio.run(audit_runs.get_run_audits(False, outsider)) == []
    for call in [audit_runs.get_run_audit('r1', outsider),
                 actions.update_run_audit('r1', server.RunAuditSubmit(answers=[], expected_version=0), outsider),
                 audit_runs.cancel_audit_run('r1', audit_runs.AuditCancellation(reason='Reason'), outsider)]:
        with pytest.raises(HTTPException) as error: asyncio.run(call)
        assert error.value.status_code == 404


@pytest.mark.parametrize('kind', ['audit', 'document'])
def test_completed_deletion_requires_admin_and_reason(database, kind):
    database.run_audits.rows['r1']['completed'] = True
    def call(actor, reason):
        if kind == 'audit': return audit_runs.cancel_audit_run('r1', audit_runs.AuditCancellation(reason=reason), actor)
        return documents.delete_traceability_document('doc1', company_activity.DeletionReason(reason=reason), actor)
    with pytest.raises(HTTPException): asyncio.run(call(user(), 'Remove duplicate'))
    with pytest.raises((HTTPException, ValidationError)): asyncio.run(call(user('company_admin'), '  '))
    asyncio.run(call(user('company_admin'), 'Remove duplicate'))
    collection = database.run_audits if kind == 'audit' else database.traceability_documents
    assert not collection.rows and collection.deletion_reason == 'Remove duplicate'
    assert activity_reason.get() == ''


def test_activity_admin_scope_filters_and_no_mutation_routes(database):
    database.company_activity = Collection([
        {'id': 'one', 'company_id': 'c1', 'event_type': 'audit_deleted', 'occurred_at': '2026-09-01T10:00:00.000000Z'},
        {'id': 'two', 'company_id': 'c2', 'event_type': 'audit_deleted', 'occurred_at': '2026-09-01T10:00:00.000000Z'},
        {'id': 'three', 'company_id': 'c1', 'event_type': 'account_created', 'occurred_at': '2026-09-01T10:00:00.000000Z'},
    ])
    def call(actor): return company_activity.get_company_activity('audit_deleted', None, None, 0, 50, actor)
    with pytest.raises(HTTPException): asyncio.run(call(user()))
    result = asyncio.run(call(user('company_admin')))
    assert result['total'] == 1 and result['entries'][0]['id'] == 'one'
    from main import app
    assert [r.methods for r in app.routes if getattr(r, 'path', '') == '/api/company-activity'] == [{'GET'}]


def test_closed_records_in_reports_are_not_counted_completed(database):
    database.run_audits.rows['r1'].update(status='closed_incomplete', closed_at='2026-09-07T00:00:00+01:00')
    result = asyncio.run(audit_reports.get_audit_runs('a1', '2026-09-07', '2026-09-07', 'closed_incomplete', user()))
    assert len(result['runs']) == 1 and result['stats']['total_completed'] == 0


def test_job_auth_accepts_only_signed_main_branch_workflow(monkeypatch):
    import jwt
    from cryptography.hazmat.primitives.asymmetric import rsa
    from app_core import job_auth
    import time
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(job_auth._jwks, 'get_signing_key_from_jwt', lambda token: SimpleNamespace(key=key.public_key()))
    now = int(time.time())
    claims = dict(iss=job_auth.ISSUER, aud=job_auth.AUDIENCE, sub='repo:owner/repo:ref:refs/heads/main',
                  exp=now+300, iat=now, nbf=now, repository_id='1133086327', workflow_ref=job_auth.WORKFLOW,
                  ref='refs/heads/main', event_name='schedule')
    assert job_auth.verify_job_token(jwt.encode(claims, key, algorithm='RS256'))['repository_id'] == '1133086327'
    for changed in [{'repository_id': 'other'}, {'ref': 'refs/heads/untrusted'}, {'event_name': 'pull_request'},
                    {'workflow_ref': 'other.yml'}, {'aud': 'wrong'}, {'exp': now - 10}]:
        with pytest.raises(jwt.InvalidTokenError):
            job_auth.verify_job_token(jwt.encode({**claims, **changed}, key, algorithm='RS256'))
