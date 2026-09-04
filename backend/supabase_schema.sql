-- Infinit Audit document store on Supabase PostgreSQL.
-- The FastAPI backend is the only permitted data access path.  Supabase's
-- browser-facing anon/authenticated roles are deliberately denied access.

create table if not exists public.app_documents (
    collection text not null,
    id text not null,
    data jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (collection, id),
    constraint app_documents_data_is_object check (jsonb_typeof(data) = 'object')
);

create unique index if not exists app_documents_users_email_unique
    on public.app_documents (lower(data ->> 'email'))
    where collection = 'users' and data ? 'email';

create index if not exists app_documents_company_id_idx
    on public.app_documents (collection, (data ->> 'company_id'));

create index if not exists app_documents_audit_id_idx
    on public.app_documents (collection, (data ->> 'audit_id'));

create index if not exists app_documents_auditor_id_idx
    on public.app_documents (collection, (data ->> 'auditor_id'));

create index if not exists app_documents_assigned_to_idx
    on public.app_documents (collection, (data ->> 'assigned_to'));

create index if not exists app_documents_assigned_user_id_idx
    on public.app_documents (collection, (data ->> 'assigned_user_id'));

create index if not exists app_documents_due_date_idx
    on public.app_documents (collection, (data ->> 'due_date'));

create index if not exists app_documents_status_idx
    on public.app_documents (collection, (data ->> 'status'));

-- Cover the list and dashboard access patterns without sorting entire tenant
-- collections in memory.
create index if not exists app_documents_company_created_idx
    on public.app_documents (collection, (data ->> 'company_id'), (data ->> 'created_at') desc);

create index if not exists app_documents_company_completed_idx
    on public.app_documents (collection, (data ->> 'company_id'), (data ->> 'completed'), (data ->> 'completed_at') desc);

create index if not exists app_documents_audit_completed_idx
    on public.app_documents (collection, (data ->> 'audit_id'), (data ->> 'completed'), (data ->> 'completed_at') desc);

create index if not exists app_documents_company_release_status_idx
    on public.app_documents (collection, (data ->> 'company_id'), (data ->> 'releaseStatus'), (data ->> 'created_at') desc);

revoke all on table public.app_documents from anon, authenticated;

-- Activity entries are generated in the same transaction as the change. No
-- application endpoint can alter history, including a system administrator.
create or replace function public.protect_company_activity() returns trigger
language plpgsql as $$
begin
    if old.collection = 'company_activity' then
        raise exception 'Company activity is append-only';
    end if;
    return old;
end;
$$;
drop trigger if exists protect_company_activity on public.app_documents;
create trigger protect_company_activity before update or delete on public.app_documents
for each row when (old.collection = 'company_activity')
execute function public.protect_company_activity();

create or replace function public.log_company_change() returns trigger
language plpgsql as $$
declare
    resource jsonb;
    actor jsonb;
    kind text;
    verb text;
    event_id text;
    company text;
begin
    if tg_op = 'DELETE' then resource := old.data; else resource := new.data; end if;
    kind := case coalesce(new.collection, old.collection)
        when 'users' then 'account'
        when 'audits' then 'audit_template'
        when 'traceability_templates' then 'document_template'
        when 'traceability_documents' then 'document'
        when 'hold_notices' then 'hold_notice'
        when 'disposal_notices' then 'disposal_notice'
        when 'run_audits' then 'audit'
        when 'companies' then 'company'
        when 'distribution_lists' then 'distribution_list'
        when 'disposal_routes' then 'disposal_route'
        when 'response_groups' then 'response_group'
        when 'audit_types' then 'audit_type'
        when 'lines_shifts' then 'line_shift'
        else null end;
    if kind is null then return null; end if;
    -- Record structural/company changes, never audit starts, progress or completions.
    if kind = 'audit' and tg_op <> 'DELETE' then return null; end if;
    if kind in ('document', 'hold_notice', 'disposal_notice') and tg_op = 'UPDATE' then return null; end if;
    if tg_op = 'UPDATE' then
        if old.data = new.data then return null; end if;
        -- Login, password and personal-preference changes are not company events.
        if kind = 'account' and
            (old.data->'name', old.data->'email', old.data->'role', old.data->'company_id', old.data->'feature_access')
            is not distinct from
            (new.data->'name', new.data->'email', new.data->'role', new.data->'company_id', new.data->'feature_access')
        then return null; end if;
    end if;
    actor := coalesce(nullif(current_setting('app.activity_actor', true), '')::jsonb, '{}'::jsonb);
    company := case when kind = 'company' then resource->>'id' else resource->>'company_id' end;
    verb := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;
    event_id := gen_random_uuid()::text;
    insert into public.app_documents(collection, id, data)
    values ('company_activity', event_id, jsonb_build_object(
        'id', event_id, 'company_id', company,
        'event_type', kind || '_' || verb, 'resource_type', kind,
        'resource_id', resource->>'id',
        'resource_name', coalesce(resource->>'name', resource->>'title', resource->>'template_title', resource->>'audit_name', resource->>'reference', resource->>'id'),
        'actor_id', actor->>'id', 'actor_name', coalesce(actor->>'name', 'System'),
        'reason', nullif(current_setting('app.activity_reason', true), ''),
        'occurred_at', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    ));
    return null;
end;
$$;
drop trigger if exists log_company_change on public.app_documents;
create trigger log_company_change after insert or update or delete on public.app_documents
for each row execute function public.log_company_change();

create index if not exists app_documents_activity_time_idx
on public.app_documents ((data->>'company_id'), (data->>'occurred_at') desc)
where collection = 'company_activity';
