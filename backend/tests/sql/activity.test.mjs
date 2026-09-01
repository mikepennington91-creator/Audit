import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db;
before(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated;');
  await db.exec(await readFile(new URL('../../supabase_schema.sql', import.meta.url), 'utf8'));
});
after(async () => { await db.close(); });
const insert = (collection, id, fields = {}) => db.query('insert into app_documents(collection,id,data) values ($1,$2,$3::jsonb)', [collection, id, JSON.stringify({ id, company_id: 'company-1', ...fields })]);
const events = async id => (await db.query("select data from app_documents where collection='company_activity' and data->>'resource_id'=$1 order by created_at", [id])).rows.map(r => r.data);
const update = (collection, id, fields) => db.query('update app_documents set data=data || $3::jsonb where collection=$1 and id=$2', [collection, id, JSON.stringify(fields)]);

test('account creation/deletion and role changes log actor but password changes do not', async () => {
  await db.exec('begin');
  await db.query("select set_config('app.activity_actor',$1,true)", [JSON.stringify({ id: 'admin', name: 'Company Admin' })]);
  await insert('users', 'account-1', { name: 'New User', role: 'user', password: 'never-log-this' });
  await update('users', 'account-1', { password: 'new-private-value', must_change_password: false });
  await update('users', 'account-1', { role: 'company_admin' });
  await db.query("delete from app_documents where collection='users' and id='account-1'");
  await db.exec('commit');
  const entries = await events('account-1');
  assert.deepEqual(entries.map(e => e.event_type), ['account_created', 'account_updated', 'account_deleted']);
  assert(entries.every(e => e.actor_id === 'admin' && e.company_id === 'company-1'));
  assert(!JSON.stringify(entries).includes('private-value'));
  assert(!JSON.stringify(entries).includes('never-log-this'));
});

test('audit starts and completions are excluded; deletion retains reason and identity', async () => {
  await insert('run_audits', 'run-1', { audit_name: 'Weekly audit', completed: false });
  await update('run_audits', 'run-1', { completed: true });
  assert.deepEqual(await events('run-1'), []);
  await db.exec('begin');
  await db.query("select set_config('app.activity_reason',$1,true)", ['Duplicate completed audit']);
  await db.query("delete from app_documents where collection='run_audits' and id='run-1'");
  await db.exec('commit');
  const [entry] = await events('run-1');
  assert.equal(entry.event_type, 'audit_deleted');
  assert.equal(entry.reason, 'Duplicate completed audit');
  assert.equal(entry.resource_name, 'Weekly audit');
});

test('document creation and deletion log, progress and completion do not', async () => {
  await insert('traceability_documents', 'doc-1', { template_title: 'Delivery form' });
  await update('traceability_documents', 'doc-1', { completed: true, field_values: ['sensitive detail'] });
  assert.equal((await events('doc-1')).length, 1);
  await db.query("delete from app_documents where collection='traceability_documents' and id='doc-1'");
  assert.deepEqual((await events('doc-1')).map(e => e.event_type), ['document_created', 'document_deleted']);
});

test('activity cannot be updated or deleted, even through raw SQL', async () => {
  const [entry] = await events('account-1');
  await assert.rejects(db.query("update app_documents set data=data || '{\"reason\":\"edited\"}'::jsonb where collection='company_activity' and id=$1", [entry.id]), /append-only/);
  await assert.rejects(db.query("delete from app_documents where collection='company_activity' and id=$1", [entry.id]), /append-only/);
  assert.equal((await events('account-1')).length, 3);
});

test('failed activity write rolls back deletion', async () => {
  await insert('run_audits', 'rollback-run');
  await db.exec(`create function reject_activity() returns trigger language plpgsql as $$ begin
    if new.collection='company_activity' then raise exception 'simulated log storage failure'; end if;
    return new; end; $$;
    create trigger reject_activity before insert on app_documents for each row execute function reject_activity();`);
  await assert.rejects(db.query("delete from app_documents where collection='run_audits' and id='rollback-run'"), /simulated log storage failure/);
  assert.equal((await db.query("select id from app_documents where collection='run_audits' and id='rollback-run'")).rows.length, 1);
  assert.deepEqual(await events('rollback-run'), []);
  await db.exec('drop trigger reject_activity on app_documents; drop function reject_activity();');
});

test('configuration changes log and same-value updates do not', async () => {
  await insert('distribution_lists', 'list-1', { name: 'Factory team', emails: ['one@example.test'] });
  await update('distribution_lists', 'list-1', { emails: ['one@example.test', 'two@example.test'] });
  await update('distribution_lists', 'list-1', { emails: ['one@example.test', 'two@example.test'] });
  assert.deepEqual((await events('list-1')).map(e => e.event_type), ['distribution_list_created', 'distribution_list_updated']);
});
