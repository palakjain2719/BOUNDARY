# Deployment: Supabase + Vercel

Nothing in this repository has been deployed yet. These are the steps to do it.

## 1. Supabase

1. Create a project at https://supabase.com and note the project URL, `anon` key and `service_role` key (Project Settings → API).
2. Apply the migration. With the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`. Or paste `supabase/migrations/20261011000000_init.sql` into the SQL editor and run it.
3. Seed reference tables (rules configs, team rules, model versions, players, archived matches):
   ```bash
   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run db:seed
   ```
4. Auth → URL configuration: add your site URL and `https://<your-domain>/matches` as a redirect URL (magic-link sign-in).
5. After first sign-in, copy your user id (Auth → Users) into `ADMIN_USER_IDS`.

The service-role key is only read on the server (`src/lib/env.ts`, `src/lib/store/supabase.ts`, `scripts/seed-supabase.ts`). Never prefix it with `NEXT_PUBLIC_`.

## 2. Vercel

1. Push this folder to a Git repository. Raw datasets (`data/raw/`) are gitignored. `data/processed/*.json` (~6 MB) **is** committed, because the server reads it at runtime.
2. Import the repository in Vercel (framework: Next.js; build command `npm run build`).
3. Set environment variables (Production + Preview): everything in `.env.example` you use. At minimum `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_USER_IDS`, `CRON_SECRET`. Optionally `GEMINI_API_KEY`, `GEMINI_MODEL`, `CRICKET_PROVIDER`, `CRICAPI_KEY`, notification keys.
4. Deploy.

### Scheduler

- `vercel.json` registers a **daily** cron on `/api/cron/pipeline`, which works on every plan. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set.
- For 15-minute ticks:
  - **Vercel Pro**: change the schedule to `*/15 * * * *`.
  - **Any plan**: enable `.github/workflows/pipeline-tick.yml` and set repository secrets `APP_URL` and `CRON_SECRET`.
- Route durations are capped at 60s. A tick usually takes 1–5s; the first model-improvement cycle of a fresh deployment can take longer.

### Demo mode on Vercel

Without Supabase, the store lives in `/tmp` on each serverless instance. It's ephemeral and not shared between instances, so autonomous runs won't persist reliably. Use Supabase for any real deployment. Demo mode is fine for a visual walkthrough.

## 3. Verify

```bash
curl https://<your-domain>/api/health
```

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/pipeline
```

Then open `/settings`: integrations show `configured_unverified` until the health check succeeds, and the job-run table shows each pipeline job.
