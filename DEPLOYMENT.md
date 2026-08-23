# Infinit Audit deployment guide

Infinit Audit uses a React frontend on Render, a FastAPI backend on Render, and
Supabase PostgreSQL for persistent data.

## 1. Create the Supabase Free project

1. Create a project in the Supabase dashboard. Choose a UK or nearby European
   region and save the generated database password securely.
2. Open **Connect** and select the **Transaction pooler** connection string.
   Use the pooler string on port `6543`, not the direct IPv6 connection.
3. Replace the password placeholder and ensure the connection string ends with
   `?sslmode=require`.

The backend applies `backend/supabase_schema.sql` automatically at startup.
There is no need to paste the schema into the Supabase SQL editor manually.

## 2. Configure the Render backend

Create or update the Render web service with:

- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn server:app --host 0.0.0.0 --port $PORT`

Set these environment variables:

```text
DATABASE_URL=postgresql://postgres.PROJECT_REF:PASSWORD@POOLER_HOST:6543/postgres?sslmode=require
JWT_SECRET_KEY=<a long random value>
BOOTSTRAP_ADMIN_EMAIL=<initial administrator email>
BOOTSTRAP_ADMIN_PASSWORD=<initial administrator password>
CORS_ORIGINS=https://your-frontend-domain.example
```

`BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` create the first system
administrator only if that email does not already exist. Startup never resets
an existing password. After the first administrator exists, the bootstrap
variables may be removed.

The database pool is deliberately limited to five backend connections, which
is appropriate for the Supabase Free tier and Render's current single service.

## 3. Migrate existing test data from MongoDB

If the MongoDB records are worth keeping, run the migration once from the
`backend` directory. Keep MongoDB available until the validation completes.

Set `MONGO_URL`, `DB_NAME`, and `DATABASE_URL` in a local `.env`, then preview
the collection counts:

```bash
python migrate_from_mongodb.py
```

Copy the records only after the counts look correct:

```bash
python migrate_from_mongodb.py --apply
```

The migration is repeatable: it upserts records using their existing IDs and
verifies every collection count after copying. It includes companies, users,
feature permissions, audit configuration, audit runs, schedules, photos,
document templates and completed traceability documents.

Do not delete or downgrade MongoDB until login, user permissions, audits,
documents and traceability have all been checked against Supabase.

## 4. Configure the Render frontend

Create or update the static site with:

- Root directory: `frontend`
- Build command: `yarn install && yarn build`
- Publish directory: `build`

Set:

```text
REACT_APP_BACKEND_URL=https://your-api-service.onrender.com
```

Add a rewrite from `/*` to `/index.html` for React routing.

## 5. Verify the deployment

Check database connectivity:

```bash
curl https://your-api-service.onrender.com/api/health
```

A successful response is:

```json
{"status":"healthy","database":"postgresql"}
```

Then verify:

1. System administrator login.
2. Company and user lists.
3. Each user's Audits, Traceability and Documents toggles.
4. Creating, running and exporting an audit.
5. Creating and completing a traceability document.

## Free-tier operating notes

The Supabase Free database has a 500 MB database limit and may pause after a
period of inactivity. Render Free services can also sleep when idle. These are
acceptable while Infinit Audit is being tested. Upgrade Supabase to Pro before
customers depend on uninterrupted access and managed daily backups.

Files and photos are currently retained in the document store for compatibility.
Before production use, move uploaded evidence to Supabase Storage so database
capacity is reserved for structured records.

## Troubleshooting

If the backend does not start, check that `DATABASE_URL` is the transaction
pooler URL, the password is URL-escaped, port `6543` is present, and
`sslmode=require` is included.

If the health endpoint returns 503, inspect the Render logs for the PostgreSQL
connection error before changing application code.

If the frontend cannot reach the backend, confirm `REACT_APP_BACKEND_URL` is an
HTTPS URL without a trailing slash and rebuild the frontend after changing it.
