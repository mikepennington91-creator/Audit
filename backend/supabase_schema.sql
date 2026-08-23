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

revoke all on table public.app_documents from anon, authenticated;
