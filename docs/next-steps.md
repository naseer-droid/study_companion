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

## v3.5 source discovery — new owner actions (2026-07-20)

v3.5 (real in-app search for sources: the Library "Find more" chips and the
resource cards' "find it 🔍" now open a search panel with actual YouTube and
article results you can add to the shelf in one tap) needs **no schema
changes**. One **optional** new env var makes video search reliable on Vercel.

- [ ] **Create a free YouTube Data API key** (video search quality + reliability)
  - *Why only you:* it's tied to your Google account.
  - *How:* https://console.cloud.google.com → create/select a project →
    "APIs & Services" → Library → enable **YouTube Data API v3** →
    Credentials → **Create credentials → API key**. No billing account needed;
    the free quota (~100 searches/day) resets daily.
  - Add as `YOUTUBE_API_KEY` to `.env.local` **and** Vercel (all environments).
    Article search needs nothing new — your existing `JINA_API_KEY` powers it.
  - *Verify:* Library → "Find more" → ▶ chip → results show durations and
    channels (the keyless fallback shows them too, but breaks more easily —
    and usually won't work at all from Vercel's datacenter IPs).

- [ ] **Push + redeploy** (bundles with any pending v3.2–v3.4 steps).
  - *Why only you:* pushing is your pre-deploy step (per our workflow).
  - *Verify on the phone:*
    - Library → **Find more about [topic]** → tap a ▶ chip → real video
      results appear → **Add** → the card lands on the shelf, extracts its
      transcript, and plays in the reader.
    - Switch to the **📄 Articles** tab in the same panel → results with
      snippets → add one → it opens in the clean reader.
    - Overview → Resources: a resource with a link shows **＋ add to library**
      (turns into "in library ✓"); one without a link shows **find it 🔍**
      which opens the panel pre-filled.
    - Books are unchanged (📚 chip → the same book finder as before).

## v3.4 reader upgrades — new owner actions (2026-07-19)

v3.4 (visible video transcript with tappable timestamps + search + copy, rich
article reader with a Reader⇄Original-page toggle for Medium, per-article font
size + scroll position, public .epub/.txt streaming books, redesigned mic with
live dictation preview) needs **no new env vars and no schema changes** — it
rides the existing content column and jsonb. Committed locally (`5f65a0f`) and
verified end-to-end in local mode.

- [ ] **Push + redeploy** (bundles with the pending v3.2/v3.3 steps — same
  keys, same schema).
  - *Why only you:* pushing is your pre-deploy step (per our workflow).
  - *Verify on the phone:*
    - Open a **YouTube** item → transcript panel under the video: tap a
      timestamp → the video jumps there; the search box filters lines; Copy works.
    - Open an **article** → it shows headings/images/formatting (not a flat
      wall); A−/A+ resize and stick after reload; scroll position is remembered.
    - Open a **Medium** item → **Original page** toggle loads the real page in
      an iframe; **Reader** switches back to the clean text.
    - Add a public ebook link (e.g. a Standard Ebooks `.epub` URL) → it streams
      page by page like a Gutenberg book.
    - The mic on the journal/quiz is now a clean icon (not the old emoji) and
      shows your words live while you speak.
  - *Note:* transcripts still come from an unofficial source and can be missing
    or in an auto-selected language — the designed fallback (discuss from title)
    is unchanged.

## v3.3 Living Companion + focus/voice — new owner actions (2026-07-19)

v3.3 (teach-back quiz, review chip, roadmap suggestions, resource status,
focus session, voice dictation, watched-video prefill) needs **no new env
vars and no schema changes** — jsonb columns absorb the new fields. Committed
locally and verified end-to-end in local mode.

- [ ] **Push + redeploy** (after finishing any pending v3.2 steps below —
  the Supadata/Jina keys are already in your local `.env.local`, so if you've
  also added them to Vercel and re-run the schema, everything ships together).
  - *Why only you:* pushing is your pre-deploy step (per our workflow).
  - *Verify on the phone:*
    - Journal tab → **Quiz me** → answer → warm feedback lands as a journal entry.
    - A 7+ day old entry shows the "still got it?" chip → **Quiz me on it**.
    - Write an entry that clearly finishes a stage → Path tab shows the amber
      "companion thinks you've got this" card → Mark done.
    - Resource rows have tap-to-cycle status chips; Brief tab counts them.
    - **◉ Focus** in the topic header → timer, music toggle, chime, prefilled entry.
    - 🎤 appears on the journal/quiz composers (Chrome/Safari; hidden on Firefox).
    - Open a YouTube item → **Log what I learned** → prefilled "Watched: …".

## v3.2 reliable extraction + books — new owner actions (2026-07-18)

Deployed extraction fails because Vercel's datacenter IPs are blocked by
YouTube/Freedium. v3.2 ships the fixes (background extraction, Jina article
fallback, Supadata transcript fallback, retry/paste recovery, streamed books)
— these three steps switch the fallbacks on:

- [ ] **Create a Supadata account and copy the API key** (YouTube transcripts)
  - *Why only you:* account creation at https://supadata.ai (free tier ≈100
    videos/month is plenty).
  - *How:* sign up → dashboard → copy the API key.
  - Optional: also grab a free key at https://jina.ai (raises the article
    fallback's rate limits; it works keyless, so this can wait until Medium
    articles start failing again).

- [ ] **Add the new env vars** to Vercel (all environments) and `.env.local`:
  ```
  SUPADATA_API_KEY=<from supadata.ai>
  JINA_API_KEY=<optional, from jina.ai>
  ```
  - *Verify:* redeploy, then add a YouTube link on the deployed app — the card
    appears instantly, and within ~30s the "no text" badge is gone (poll or
    reload). Add a Medium link — the reader shows the text.

- [ ] **Re-run `supabase/schema.sql`** in the SQL editor (idempotent — adds
  `extraction` + `book_source` columns and lets `kind` be `'book'`).
  - *Verify:* Table Editor → `library_items` shows the two new columns.
    **Without this step, adding any link on the deployed app will fail.**

- [ ] **Redeploy and spot-check the new features** on your phone:
  - Add an article → card is instant with an "extracting…" badge that resolves
    by itself; you can navigate away immediately.
  - A failed card shows **Retry**; the reader also offers "paste the text
    yourself" (works for YouTube transcripts via Show transcript → copy).
  - Select text in the reader → **Discuss this** quotes it into the discussion.
  - Library "Find more" row → 📚 Books → add a Project Gutenberg book → it
    reads page-by-page in-app and the companion discusses the page you're on.
  - A Google Drive ebook (.txt/.epub, shared as "anyone with the link") pasted
    into the add box becomes a streamed book too — nothing stored in the DB.

## v3.1 fixes — new owner actions (2026-07-18)

- [ ] **Pull the Vercel function logs for the `/api/library` 500** (Dashboard →
  project → Logs, filter `/api/library`) and paste what the function logged
  into a Claude session.
  - *Why only you:* the Vercel integration connected to Claude sees no
    projects — the deployment lives under a different login.
  - *Context:* v3.1 hardened the route (lazy-loads jsdom/youtube-transcript,
    guaranteed JSON errors), which fixes the most likely cause (module-load
    crash) — the logs confirm whether anything else was going on.

- [ ] **Redeploy** (auto if the Vercel project is GitHub-connected — the fix is
  pushed to `main`) and re-test: open a topic → Library → add a Medium link and
  a YouTube link.
  - *Verify:* both cards appear; the Medium card's stored URL starts with
    `https://freedium-mirror.cfd/`; if it still fails, the error message is now
    specific instead of "couldn't reach the companion (error 500)" — paste it.

## v3.0 Study Room — new owner actions (2026-07-17)

- [ ] **Re-run `supabase/schema.sql`** in the SQL editor (idempotent) — adds the
  `library_items` and `discussion_messages` tables with RLS.
  - *Verify:* Table Editor shows both new tables.

- [ ] **Redeploy to Vercel** so the new routes ship (`/api/library`,
  `/api/library/content`, `/api/discuss`, `/api/greeting`).

- [ ] **Verify the Study Room on the deployed app**
  - *How:* open a topic → Library tab → paste a real article URL → card with
    title/thumbnail appears; open it → clean reader view. Paste a YouTube URL →
    card + playable embed. Send a message in Discuss → reply references the
    content; reload → discussion persists. Reopen the topic → greeting strip
    references last activity.
  - *Note:* YouTube transcripts come from an unofficial client and can fail;
    the video still embeds and the companion discusses from the title (this is
    the designed fallback, not a bug).
