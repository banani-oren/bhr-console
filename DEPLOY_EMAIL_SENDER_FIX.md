# Deploy: switch invite/auth emails to verified `banani-hr.com` domain

This is a focused, self-contained task. Execute it to completion. Do not stop, do not
ask, do not summarize mid-run. When done, report in `EMAIL_FIX_REPORT.md`.

## Context

Oren just verified `banani-hr.com` in Resend (Ireland, eu-west-1). The repo has already
been updated so the `invite-user` edge function sends from
`BHR Console <no-reply@banani-hr.com>` (with optional override via the
`INVITE_FROM_EMAIL` secret). `BHR_CONSOLE_PROJECT.md` has been updated accordingly.

What remains is to (a) deploy the function to Supabase, (b) switch the built-in
Supabase Auth SMTP sender to the same verified domain, (c) commit the source changes,
and (d) verify end-to-end on the live site.

## Hard rules

1. **Read `BHR_CONSOLE_PROJECT.md` and `BHR_CONSOLE_CHECKLIST.md` first.**
2. **English only** for reasoning and commit messages.
3. **Do not print or log** `SUPABASE_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`,
   `RESEND_API_KEY`, `VERCEL_TOKEN`, or any password.
4. **Do not defer.** Every step must succeed with observable evidence.

## Steps

### 1. Confirm the edge-function source is correct

Read `supabase/functions/invite-user/index.ts`. Confirm that the Resend `from` field
uses `INVITE_FROM_EMAIL` with a default of `BHR Console <no-reply@banani-hr.com>`. If
not, fix it (this is the already-committed change from Oren's session; it should be
present).

### 2. Deploy the edge function

Load the Supabase access token from `.env.local` into the process environment, then
deploy:

```bash
export SUPABASE_ACCESS_TOKEN="$(grep '^SUPABASE_ACCESS_TOKEN=' .env.local | cut -d= -f2-)"
npx supabase functions deploy invite-user \
  --project-ref szunbwkmldepkwpxojma \
  --no-verify-jwt
```

The command must print a version ID and exit zero. If it fails, diagnose from the
output and retry — do not skip.

### 3. Update the Supabase Auth SMTP sender

The built-in auth emails (password reset, magic link, email confirmation) are sent by
Supabase, not the edge function, and still point at `onboarding@resend.dev`. Patch the
auth config via Management API so these also come from the verified domain:

```bash
curl -sS -X PATCH \
  "https://api.supabase.com/v1/projects/szunbwkmldepkwpxojma/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "smtp_sender_name": "BHR Console",
    "smtp_admin_email": "no-reply@banani-hr.com"
  }'
```

Then verify:

```bash
curl -sS \
  "https://api.supabase.com/v1/projects/szunbwkmldepkwpxojma/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  | grep -E '"smtp_(sender_name|admin_email)"'
```

Both fields must reflect the new values.

### 4. Commit and push the source changes

Stage, commit, and push the files that changed in the repo:

```bash
git add supabase/functions/invite-user/index.ts BHR_CONSOLE_PROJECT.md
git commit -m "invite-user: send from no-reply@banani-hr.com (verified Resend domain); update spec & auth SMTP sender"
git push origin main
```

Wait 90 seconds for Vercel to deploy (the frontend is unchanged, but keep the
discipline — verify the live commit SHA matches).

### 5. End-to-end live verification in Chrome

1. Generate a magic link for the admin (`bananioren@gmail.com`) via the Supabase
   Admin API (`/auth/v1/admin/generate_link`, `type: "magiclink"`, service-role key).
2. Open that link in Chrome. You should land on the dashboard as admin.
3. Navigate to `/users`. Click "הזמן משתמש".
4. Invite the address `qa.test+senderfix@banani-hr.test`, full name
   `QA Test Sender Fix`, role `employee`. Submit.
5. Observe the response in the browser network tab: the call to
   `/functions/v1/invite-user` must return HTTP 200 with
   `email_sent: true` and a non-null `email_id`, and **no `email_warning`**.
   If `email_warning` is present, the send failed — diagnose (Resend API response,
   function logs via `curl "https://api.supabase.com/v1/projects/szunbwkmldepkwpxojma/functions/invite-user/body" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"`
   or via `npx supabase functions logs invite-user`) and fix.
6. Cross-check in Resend: query the Resend API with `RESEND_API_KEY` (from
   `.env.local`) to confirm the send was accepted:

   ```bash
   RESEND_KEY="$(grep '^RESEND_API_KEY=' .env.local | cut -d= -f2-)"
   # Replace <email_id> with the id returned in step 5
   curl -sS "https://api.resend.com/emails/<email_id>" \
     -H "Authorization: Bearer $RESEND_KEY"
   ```

   The response's `last_event` should be `delivered`, `sent`, or `opened`
   (NOT `bounced` or `failed`).

### 6. Cleanup

Delete the test user via service role:

```bash
SUPABASE_URL="$(grep '^VITE_SUPABASE_URL=' .env.local | cut -d= -f2-)"
SERVICE_ROLE="$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-)"

# Find the user
USER_ID=$(curl -sS "${SUPABASE_URL}/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE" -H "Authorization: Bearer $SERVICE_ROLE" \
  | python -c "import sys,json; d=json.load(sys.stdin); print(next((u['id'] for u in d['users'] if u['email']=='qa.test+senderfix@banani-hr.test'), ''))")

# Delete
if [ -n "$USER_ID" ]; then
  curl -sS -X DELETE "${SUPABASE_URL}/auth/v1/admin/users/${USER_ID}" \
    -H "apikey: $SERVICE_ROLE" -H "Authorization: Bearer $SERVICE_ROLE"
fi
```

Confirm with a follow-up fetch that the user is gone.

### 7. Update the checklist

In `BHR_CONSOLE_CHECKLIST.md`, locate §8 (`/users` — admin only). If the invite-flow
items are already `[x]`, append a note to the "Submitting the invite" line:
`→ re-verified post-sender-fix; email_sent=true, Resend last_event=<value>`.

If any related item was `[ ]`, flip to `[x]` with that live evidence.

### 8. Final report

Write `EMAIL_FIX_REPORT.md` with:
- Commit SHA pushed to `main`.
- Deployed edge-function version ID from step 2.
- The Supabase auth config values read back in step 3.
- The `/functions/v1/invite-user` response body from step 5 (redact nothing — it
  contains no secrets, just `success`, `user_id`, `email_sent`, `email_id`).
- The Resend event status from step 6.
- Confirmation the test user was deleted.
- Print `EMAIL FIX COMPLETE` and stop.
