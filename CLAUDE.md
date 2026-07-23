# Study Lamp

A learning-companion webapp: name a topic → get a brief, roadmap, and resources — then a journal and Q&A where the companion learns *alongside* you, maintaining a shared memory that shapes every future response. Next.js (App Router) + TypeScript. Installable PWA; runs in **local mode** (no auth, JSON file) when Supabase env vars are absent, **cloud mode** (Supabase auth + Postgres, invite-only) when present.

## Status
<!-- STATUS:START -->
- **Updated:** 2026-07-23
- **Phase:** v3.7 — PDF books + richer discovery. (0) Rolled back the v3.6 Drive-folder "My Collection" scan (never landed on the user's large Calibre library) — back to paste-the-book-link. (1) PDF ebooks: paste a Drive/public .pdf link → lib/books.ts pdfText() (lazy pdfjs-dist legacy build, main-thread, standard_fonts+cmaps wired) extracts the text layer; scanned/image PDFs fail gracefully to a link. (2) YouTube results now show views + age (API statistics batch / scrape shortViewCountText+publishedTimeText). (3) Article discovery is multi-source + grouped: Web (jina/DDG) + Medium (site: SERP) + dev.to (JSON API) + Wikipedia (REST), all keyless-friendly. (4) Book suggestions revamped: /api/books/suggest names 4-6 real books, enriched with Google Books cover/rating/blurb + a Gutendex in-app pick; SuggestPanel is one rich list (Add / Save for later / Find a copy ↗). (5) Non-YouTube video embeds via lib/embed.ts (Vimeo, Dailymotion, Vidyard, direct .mp4/.webm/.ogv). Build green; PDF extraction runtime-verified in Node; Vidyard mapping + oEmbed verified against the real link
- **Architecture:** Next.js App Router; 8 LLM routes (topic/journal/ask/discuss/greeting/quiz/progress/books-suggest) + library routes (ingest / content / extract-retry / paste / status / book-chunks) + discover (multi-source video/article) + op-based storage route + keepalive cron; shared extraction pipeline in lib/extract.ts, book streaming in lib/books.ts (gutenberg/drive/remote; txt/epub/pdf), video-embed resolver in lib/embed.ts; StorageAdapter with JsonFileStorage (local) / SupabaseStorage (cloud, RLS); middleware auth gate; service worker (v4) + manifest; UI atoms in components/lamp-ui.tsx; link helpers + urlKey in lib/links.ts
- **Next:** 📋 Naseer pushes + redeploys, optionally drops the now-unused collection tables in Supabase (see docs/next-steps.md), phone-tests: paste a PDF → reads; video search shows views/age; article search shows grouped sources; ✨ Suggest books shows covers + adds a public-domain pick; paste a Vimeo/Vidyard link → plays embedded
- **Blocked on:** the human-only steps in docs/next-steps.md (push + redeploy; optional collection-table drop). No new required env vars — Google Books / dev.to / Wikipedia are keyless; YOUTUBE_API_KEY still recommended for reliable video search
<!-- STATUS:END -->

## Commands

- `npm run dev` — dev server (uses port 3001 if 3000 is busy on this machine)
- `npm run build` — production build + typecheck

## Golden rules

- **Never call the model from the browser.** All LLM calls go through `app/api/{topic,journal,ask}/route.ts` → `lib/llm.ts`; keys live only in `.env.local` / Vercel env.
- **Prompts in `lib/prompts.ts` are frozen contracts** (proven in the prototype) — refine only with evaluation, per the handoff doc.
- **Memory is always fully rewritten by the model, never appended by the app** — this keeps it compact and coherent.
- **Data access in cloud mode always goes through the request-scoped Supabase client** (RLS enforces per-user isolation); the secret key is used only by `/api/keepalive`, never for user data.
- `data/` and `.env.local` are gitignored; never commit either.
- Bump `VERSION` in `public/sw.js` whenever the service worker changes, or clients keep the old one.

## Docs index

- Product spec, prompt contracts, design tokens, v1 scope → `reference/study-lamp-handoff.md`
- Original Claude.ai artifact the UI was ported from → `reference/learning-companion.jsx`
- Why v2 is shaped this way (hosting choice, auth, schema, market research, roadmap) → `docs/v2-design-and-research.md`
- Naseer needs the human-only to-do list (Supabase setup, email templates, deploy, data import) → `docs/next-steps.md`
- Touching Supabase schema/auth/RLS → `supabase/schema.sql` is the single source of truth; re-run it in the SQL editor after edits (it's idempotent)
