# Deploying Qualifier to Railway

Railway runs a persistent Node process, which is what the fire-and-forget
worker needs — Vercel's serverless runtime would cut runs short.

This guide assumes you already have:

- A Supabase project with `supabase/init.sql` already applied (single
  consolidated build — tables, RLS, grants, seed templates). See
  `supabase/README.md`.
- A GitHub account
- A Railway account ([railway.app](https://railway.app) — sign in with
  GitHub is easiest)

Budget time: **~10 minutes end to end**.

---

## 1. Push the repo to GitHub

From `/Users/abishai/lead-qualifier`:

```bash
git init
git add .
git commit -m "Initial commit — Qualifier M2"
```

Create a new repo on GitHub (private is fine — the repo contains no
secrets, since `.env.local` is gitignored by default in Next apps). Then:

```bash
git remote add origin git@github.com:<your-user>/qualifier.git
git branch -M main
git push -u origin main
```

> **Check before pushing:** `git status --porcelain | grep -E "\.env"` —
> should output nothing. Next's default `.gitignore` already excludes
> `.env*` files, but a paranoid look costs nothing.

---

## 2. Create the Railway service

1. Railway dashboard → **New Project** → **Deploy from GitHub repo**.
2. Pick the repo you just pushed. Railway auto-detects Next.js and
   generates a service.
3. **Set the region to match Supabase — this matters more than any code fix.**
   Settings → Deploy → **Region**. Every `force-dynamic` page runs several
   server-side DB queries per load; if Railway and Supabase are in different
   regions you pay cross-region RTT (~150 ms Amsterdam↔Singapore) *per query*,
   which dominates page-load TTFB. Pick the Railway region **in Supabase's
   region** (our Supabase is Singapore `aws-1` → Railway `asia-southeast1`).
   For an India-based team Singapore also minimizes the user→server leg.
   *(This was misconfigured in prod until 2026-07-15 — Railway EU-West vs
   Supabase Singapore — costing ~400–700 ms/page. See the roadmap's
   "Page-load latency pass" entry.)*
4. Wait for the first build. It **will** fail — because env vars aren't
   set yet. That's fine, we fix that next.

---

## 3. Set environment variables

In the Railway service → **Variables** tab, add these **six** keys:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | your Supabase service-role key |
| `SUPABASE_DB_URL` | direct Postgres connection string. Supabase dashboard → Project Settings → Database → **Connection string** (Transaction pooler, port 6543, recommended). Needed by the **LeadQuery agent (M-AG1)** to run read-only SQL via postgres.js. |
| `NODE_ENV` | `production` |
| `NEXT_TELEMETRY_DISABLED` | `1` |

> **Do NOT set any Groq-related env var.** The app is BYOK — users enter
> their Groq key in-browser per session. There is no server-held Groq key
> by design.

After saving, Railway redeploys automatically. **Important — `NEXT_PUBLIC_*` vars are inlined at *build* time, not read at runtime:** the var must be present *before* the build runs. Adding it then waiting for the fresh build to finish works; a runtime-only restart won't pick it up. If a deploy ever serves a stale bundle, push a commit to force a clean rebuild.

---

## 4. Confirm the build settings

Railway should auto-detect, but double-check:

- **Build command:** `npm install && npm run build`
- **Start command:** `npm run start`
- **Port:** Railway injects `$PORT`; Next.js reads it automatically. No
  action needed.

If you see the build trying to use `next dev`, override the start
command to `npm run start` explicitly.

---

## 5. Grab the production URL

Once deploy goes green, Railway gives you a URL like:

```
https://qualifier-production-abcd.up.railway.app
```

Open it. You should hit the login page.

---

## 6. Sign in (shared-password auth)

Auth runs as a single shared Supabase user (`team@lead-iq.local`) — no
magic links, no email round-trip, no per-user accounts. The team
shares one password.

If this is a fresh Supabase project:

1. Supabase dashboard → **Authentication → Users → Add user → Create
   new user**.
2. Email: `team@lead-iq.local`. Password: pick something strong, share
   it with the team via 1Password / your secrets manager. Make sure
   "Auto-confirm user" is checked so no verification email is sent.
3. (Optional) Supabase **Authentication → URL Configuration → Site URL**:
   set to your Railway URL. Not strictly required for password auth,
   but tidies up some admin-page links.

Test: on the deployed site, enter `team@lead-iq.local` + the shared
password → land on `/campaigns`.

---

## 7. Smoke test

Once signed in on production:

- [ ] `/campaigns` loads (empty or shows your dev campaigns if the same
      Supabase project).
- [ ] "Connect Groq" modal accepts a real Groq key.
- [ ] "Connect Phantombuster" modal accepts a real PB API key.
- [ ] `/scrape`: agents dropdown populates → Fetch output on a known
      finished phantom returns row count + Download CSV works.
- [ ] New campaign: upload a small test file (5-10 rows), run it.
- [ ] Push to Campaign from `/scrape` → wizard lands on Configure step
      with leads pre-loaded.
- [ ] `/leads` loads and filters work.
- [ ] CSV export downloads.
- [ ] Delete a campaign — row disappears.

If the worker seems to hang, open Railway's **Logs** tab — any errors
thrown in `startCampaignRun` print there with `[worker] campaign <id>
failed: …`.

---

## 8. (Optional) Custom domain

Railway → your service → **Settings → Networking → Custom Domain**. Add
`qualifier.yourdomain.com`, set the CNAME at your DNS provider to the
target Railway gives you. Then **update the Supabase Site URL + Redirect
URLs** to the custom domain (step 6) or logins will break again.

---

## Updating deploys

Railway watches your GitHub branch. Push to `main` → auto-redeploy. Roll
back via **Deployments → click a prior deploy → Redeploy**.

For schema changes, always apply SQL migrations in the **Supabase SQL
editor** before pushing code that depends on them — otherwise the first
request that touches a new column 500s.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| 500 on every page | Supabase env vars missing or wrong | Check Variables tab, redeploy |
| Login fails with valid credentials | Shared user doesn't exist or password mismatch | Step 6: re-create the user with auto-confirm on |
| `/scrape` agents dropdown stays empty | PB API key not connected, or invalid | Click the **Connect Phantombuster** pill, paste the key — it validates against `/orgs/fetch-resources` |
| Run starts but leads never update | Worker crashed silently | Check Railway logs for `[worker]` lines |
| `baseURL.endsWith is not a function` | `GROQ_BASE_URL` import got crossed with a `"use client"` module | Should be fixed on `main`; `import` from `@/lib/groq-config`, not `@/lib/groq-store` |
| "relation does not exist" | Schema not applied to the Supabase project this deploy points at | Re-run `supabase/init.sql` in the SQL editor |

---

## What's NOT deployed here

- Google Sheets push (M4) — env var `GOOGLE_SERVICE_ACCOUNT_JSON` isn't
  wired yet.
- Multi-tenant workspaces — single Supabase project = single shared
  workspace.
- Cron / scheduled runs — all campaigns are user-triggered today.

Add these incrementally; the deploy model stays the same (push to
`main`, Railway picks it up).
