# Email Sender Fix — Run Report

Date: 2026-04-18
Executor: Claude Code (Opus 4.7, 1M context)
Task spec: `DEPLOY_EMAIL_SENDER_FIX.md`

## 1. Commit pushed to `main`

- SHA: **36496f8**
- Message: `invite-user: send from no-reply@banani-hr.com (verified Resend domain); update spec & auth SMTP sender`
- Previous: `8666093`
- Push target: `https://github.com/banani-oren/bhr-console` → `main`
- Files: `supabase/functions/invite-user/index.ts`, `BHR_CONSOLE_PROJECT.md`

## 2. Deployed edge-function version

- Project ref: `szunbwkmldepkwpxojma`
- Function slug: `invite-user`
- Function id: `2f41373e-9023-45d1-846c-6b614eb09aa8`
- Version: **6** (status `ACTIVE`, `verify_jwt: false`)
- Deploy command: `npx supabase functions deploy invite-user --project-ref szunbwkmldepkwpxojma --no-verify-jwt`

## 3. Supabase Auth SMTP config (read back via Management API)

```
smtp_sender_name = BHR Console
smtp_admin_email = no-reply@banani-hr.com
smtp_host        = smtp.resend.com
smtp_user        = resend
smtp_port        = 465
```

Both target fields reflect the new verified-domain values.

## 4. `/functions/v1/invite-user` live response (step 5)

Submitted through the `/users` admin UI (via the in-browser session JS fetch, same endpoint the UI invokes), email `qa.test+senderfix2@banani-hr.test` / full name `QA Test Sender Fix 2` / role `employee`. HTTP 200, body:

```json
{
  "success": true,
  "user_id": "c8842f1a-ffa1-4b56-b146-ae79d201d299",
  "email_sent": true,
  "email_id": "c545aa7b-5128-4459-9b6b-dd5bfd03995c",
  "email_warning": null,
  "action_link": "<redacted by Chrome tooling; was a valid https://szunbwkmldepkwpxojma.supabase.co/auth/v1/verify?... invite link>"
}
```

`email_warning` is `null` — no Resend rejection. (An initial UI click with `qa.test+senderfix@banani-hr.test` also succeeded and appeared in the /users table; the JS-fetch variant was used to capture the raw response body since the Chrome network tap missed the first call.)

## 5. Resend event status (step 6)

Queried `GET https://api.resend.com/emails/c545aa7b-5128-4459-9b6b-dd5bfd03995c`:

```
id:         c545aa7b-5128-4459-9b6b-dd5bfd03995c
from:       BHR Console <no-reply@banani-hr.com>
to:         qa.test+senderfix2@banani-hr.test
subject:    הוזמנת להצטרף ל-BHR Console
last_event: sent
created_at: 2026-04-18 08:56:58+00
```

`last_event = sent` — accepted by Resend with the verified `banani-hr.com` sender. Not `bounced` and not `failed`. (The `.banani-hr.test` recipient TLD is a sink, so `delivered` is not expected — Resend's `sent` is the terminal success state for such addresses.)

## 6. Test user cleanup

Both test auth users + their profile rows were removed via service role:

- `qa.test+senderfix@banani-hr.test`  (`675d7368-c0a0-4ee9-8eb8-928497834ff1`) — profile DELETE → 204, auth DELETE → 200
- `qa.test+senderfix2@banani-hr.test` (`c8842f1a-ffa1-4b56-b146-ae79d201d299`) — profile DELETE → 204, auth DELETE → 200

Follow-up `GET /auth/v1/admin/users` confirmed zero `senderfix` users remain.

## 7. Checklist update

`BHR_CONSOLE_CHECKLIST.md` §8 — appended live-evidence note to the "Submitting the invite" line: `→ re-verified post-sender-fix; email_sent=true, Resend last_event=sent`.

---

EMAIL FIX COMPLETE
