# Deployment checklist

## 1. Supabase
1. **Apply migrations**: `supabase db push` (includes `20261019090000_security_hardening.sql`, which also creates the private `faces` bucket).
2. **Deploy functions**: `supabase functions deploy` (all of them; `supabase/config.toml` carries the JWT settings).
3. **Set secrets** (`supabase secrets set NAME=value`):

| Secret | Purpose |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Sheets access (share your sheet with the service-account email as Editor) |
| `GOOGLE_SHEET_ID` | Fallback sheet id (can also be set in-app) |
| `FACE_API_KEY` | API key of your OpenAI-compatible vision provider (falls back to `LOVABLE_API_KEY` if you stay on Lovable) |
| `FACE_API_URL` | Chat-completions URL (default: Lovable gateway). e.g. `https://api.openai.com/v1/chat/completions` |
| `FACE_MODEL` | Vision model id. **Verify it exists on your provider** (default `google/gemini-3.6-flash` is a Lovable-gateway id) |
| `CRON_SECRET` | Long random string; required header `x-cron-secret` for `cleanup-attendance` |
| `RETENTION_HOURS` | Optional. Hours to keep synced attendance rows in Postgres (default 24) |

4. **Schedule cleanup** (SQL editor; replace placeholders):
```sql
select cron.schedule('cleanup-attendance', '0 2 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/cleanup-attendance',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','<CRON_SECRET>'),
    body := '{}'::jsonb);
$$);
```
(Enable the `pg_cron` and `pg_net` extensions first.) Consider raising `RETENTION_HOURS` — after cleanup, Google Sheets is the only long-term record.

5. **Auth settings** (Dashboard -> Authentication): turn **Confirm email ON**, set the **Site URL** to your production domain, and add it to **Redirect URLs**. Consider disabling public sign-ups if admins are always invited.
6. Create your first `super_admin`: sign up, then in the SQL editor
   `update public.user_roles set role='super_admin' where user_id='<uid>';`

## 2. Vercel
- Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` as environment variables (the `.env` file is no longer committed).
- `vercel.json` already contains the SPA rewrite (so `/scan?token=...` works on a fresh visit) and security headers.

## 3. Android
- `CAPACITOR_SERVER_URL` env var picks the hosted URL (default: the existing Vercel URL). Set it empty to bundle `dist/` instead.
- Release signing: create `android/keystore.properties` (git-ignored) with `storeFile`, `storePassword`, `keyAlias`, `keyPassword`. Bump `versionCode` for every release.
- `npx cap sync android` after every web build.

## 4. Student onboarding flow (new)
1. Admin clicks **Provision logins** -> a dialog shows each student's **one-time temporary password** (download CSV). Passwords are not stored readable; they cannot be shown again.
2. Student signs in with matric + temporary password and is forced to choose a new password.
3. Per-student actions: key icon = full account reset (new temp password, clears face + device); phone icon = unbind device only.

## 5. Known limitations (design decisions for you)
- Public "Check my attendance" lets anyone look up a student's attendance by exact matric number (rate limited). Remove the page/route if that is not acceptable.
- GPS and device id are client-supplied and are weak signals; "liveness" is a vision-model prompt, not certified anti-spoofing.
- Google Sheets has API quotas and a 10M-cell cap; plan for archiving by semester.
- Remaining `npm audit` high/critical items are dev-only build tools (vite, vitest, tailwind) and are not shipped.
