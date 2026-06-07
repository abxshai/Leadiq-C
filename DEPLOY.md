# Deploying Qualifier to Railway

Railway runs a persistent Node process, which is what the fire-and-forget
worker needs — Vercel's serverless runtime would cut runs short.

This guide assumes you already have:

- A Supabase project with `schema.sql` + `rls.sql` already applied
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
3. Wait for the first build. It **will** fail — because env vars aren't
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

**Optional (lead temperature deep links, M-CX1):**

| Key | Value |
|---|---|
| `NEXT_PUBLIC_HUBSPOT_PORTAL_ID` | HubSpot account/portal ID — the number in your HubSpot URLs (`app.hubspot.com/contacts/`**`<this>`**`/...`). **Deccan's value: `47712062`** (set in Railway + local `.env.local`). Enables the "View in HubSpot" link on the touchpoint-history card; if unset that link is hidden (Smartlead links work regardless). |
| `NEXT_PUBLIC_SMARTLEAD_BASE_URL` | only if self-hosting Smartlead; defaults to `https://app.smartlead.ai`. |

After saving, Railway redeploys automatically. **Important — `NEXT_PUBLIC_*` vars are inlined at *build* time, not read at runtime:** the var must be present *before* the build runs. Adding it then waiting for the fresh build to finish works; a runtime-only restart won't pick it up. If a deploy ever serves a stale bundle, push a commit to force a clean rebuild. (The HubSpot links not showing in prod once traced to exactly this — the bundle had been built before the var existed.)

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
- [ ] `/analytics` populates.
- [ ] CSV export downloads.
- [ ] Delete a campaign — row disappears and analytics decrement.

If the worker seems to hang, open Railway's **Logs** tab — any errors
thrown in `startCampaignRun` print there with `[worker] campaign <id>
failed: …`.

---

## 8. Deploy Supabase edge functions

The **LeadQuery** agent (see [`agent-section-plan.md`](./agent-section-plan.md)) uses Supabase's hosted gte-small model to embed leads for semantic search. Embeddings are computed by an Edge Function at `supabase/functions/embed-text`. Edge Functions live in Supabase, not Railway — Railway redeploys don't touch them.

**One-time setup:**

1. Install the Supabase CLI if you haven't already:
   ```bash
   brew install supabase/tap/supabase
   ```
2. From the repo root, link your Supabase project:
   ```bash
   supabase link --project-ref <your-project-ref>
   ```
3. Deploy the edge function:
   ```bash
   supabase functions deploy embed-text
   ```

**On every change to the edge function:** re-run `supabase functions deploy embed-text`. No Railway redeploy needed for edge function changes alone.

**Env vars:** none required beyond what Supabase provides to the edge function runtime — gte-small is hosted by Supabase itself, no BYOK key.

**Verify:** Supabase dashboard → **Edge Functions** should list `embed-text`. From the deployed Lead-IQ app, run a small campaign and check that `leads.embedded_at` populates after qualification.

**One-shot backfill of existing leads** (run once after first deploy):

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run backfill-embeddings
```

Walks all leads where `embedding IS NULL`, embeds via the edge function, writes back. ~5-10 min for ~3000 leads. Non-destructive — only writes to NULL rows; safe to run on a live system.

---

## 9. (Optional) Custom domain

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
| "relation does not exist" | Schema SQL not applied to the Supabase project this deploy points at | Re-run `schema.sql` + `rls.sql` in the SQL editor |

---

## What's NOT deployed here

- Google Sheets push (M4) — env var `GOOGLE_SERVICE_ACCOUNT_JSON` isn't
  wired yet.
- Multi-tenant workspaces — single Supabase project = single shared
  workspace.
- Cron / scheduled runs — all campaigns are user-triggered today.

Add these incrementally; the deploy model stays the same (push to
`main`, Railway picks it up).
