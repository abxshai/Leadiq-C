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

In the Railway service → **Variables** tab, add these **five** keys:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | your Supabase service-role key |
| `NODE_ENV` | `production` |
| `NEXT_TELEMETRY_DISABLED` | `1` |

> **Do NOT set any Groq-related env var.** The app is BYOK — users enter
> their Groq key in-browser per session. There is no server-held Groq key
> by design.

After saving, Railway will redeploy automatically.

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

## 6. Configure Supabase redirects (CRITICAL)

This step traps almost everyone. Magic links come back pointing to
**localhost** unless you tell Supabase about your production URL.

1. Supabase dashboard → **Authentication → URL Configuration**.
2. **Site URL**: set to your Railway URL, e.g.
   `https://qualifier-production-abcd.up.railway.app`.
3. **Redirect URLs**: add both:
   - `https://qualifier-production-abcd.up.railway.app/**`
   - `http://localhost:3000/**` (so local dev still works)
4. Save.

Test: on the deployed site, enter your email → click the magic link in
your inbox. It should redirect to the Railway URL and sign you in.

---

## 7. Smoke test

Once signed in on production:

- [ ] `/campaigns` loads (empty or shows your dev campaigns if the same
      Supabase project).
- [ ] "Connect Groq" modal accepts a real Groq key.
- [ ] New campaign: upload a small test file (5-10 rows), run it.
- [ ] `/analytics` populates.
- [ ] CSV export downloads.
- [ ] Delete a campaign — row disappears and analytics decrement.

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
| Magic link redirects to `localhost` | Site URL not set in Supabase | Step 6 |
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
