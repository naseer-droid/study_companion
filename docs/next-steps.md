# Next steps — owner actions (Naseer)

Things only you can do. Tick them here **and** update the matching line in
`CLAUDE.md → ## Status` when done.

- [x] **Put a real API key in `.env.local`** — done (DeepSeek). Verified live
  on 2026-07-11: topic brief, journal reply, memory rewrite, and Q&A all ran
  against the real model.

- [x] **Run the acceptance test for the memory loop** (handoff §8) — done
  2026-07-11 during v2 verification: the shared memory referenced the journal
  entry, and the next answer demonstrably used it.

- [ ] **Create the Supabase project** (needed before the app can go online)
  - *Why only you:* account creation at https://supabase.com (free tier).
  - *How:*
    1. New project (any region near you; note the database password somewhere safe).
    2. SQL Editor → paste all of `supabase/schema.sql` → Run.
    3. Table Editor → `allowed_emails` → insert your email first, then any invitees.
    4. Project Settings → API: copy the **Project URL**, **publishable key**, and **secret key**.
  - *Verify:* Table Editor shows `topics`, `journal_entries`, `questions`, `allowed_emails`.

- [ ] **Update the two auth email templates** (Dashboard → Authentication → Emails)
  - *Why only you:* dashboard access.
  - *How:*
    - **Confirm signup** template — replace the link with:
      `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
    - **Magic Link** template — make the body show the code: include `{{ .Token }}`
      (this is what "Email me a code" sends).
    - Also set Authentication → URL Configuration → Site URL to your deployed
      URL once you have it, and add `http://localhost:3001` to Redirect URLs for local testing.
  - *Verify:* sign up with your own email → the link lands on `/auth/confirm` and signs you in.

- [ ] **Add the env vars** to `.env.local` (for local cloud-mode testing) and to Vercel
  - *Why only you:* they're secrets.
  - *Keys:*
    ```
    NEXT_PUBLIC_SUPABASE_URL=<project url>
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>
    SUPABASE_SECRET_KEY=<secret key>        # used only by /api/keepalive
    CRON_SECRET=<any long random string>    # protects the keepalive route
    LLM_PROVIDER=kimi                       # + LLM_API_KEY from the Kimi Code Console
    ```
  - *Verify locally:* `npm run dev` → you now get the login page; sign up (your
    email is allowlisted) → confirm → the app loads empty (cloud data).

- [ ] **Import your local data into your cloud account** (optional, one-time)
  - *Why only you:* it must run as your logged-in user.
  - *How:* signed in, open the browser console on the app (F12) and paste — with
    `DATA` replaced by the full contents of `data/study-lamp.json`:
    ```js
    fetch("/api/storage", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "import", data: DATA }) })
    ```
    Easiest path: ask Claude to walk through this with you once you're signed in.
  - *Verify:* your topics appear after a reload, from any device.

- [ ] **Create the Vercel project and deploy**
  - *Why only you:* Vercel account access.
  - *How (pick one):*
    - Dashboard: vercel.com → Add New Project → import this GitHub repo → add the
      env vars above (plus `LLM_PROVIDER`/`LLM_API_KEY`) → Deploy. Or:
    - CLI: `npm i -g vercel`, then ask Claude to run the deploy with you.
  - *Verify:* the deployed URL shows the login page; after signing in, create a
    topic end-to-end. The cron (`vercel.json`) appears under Project → Settings → Cron Jobs.

- [ ] **Install it on your phone**
  - *Why only you:* your phone.
  - *How:* Android Chrome → menu → "Install app". iPhone Safari → Share →
    "Add to Home Screen" (the app shows a one-time hint).
  - *Verify:* opens full-screen with the lamp icon; airplane mode still shows
    your topics read-only with the offline banner.
