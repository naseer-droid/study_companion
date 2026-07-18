# Study Lamp

A learning-companion webapp: name a topic → get a brief, roadmap, and resources — then a journal and Q&A where the companion learns *alongside* you, maintaining a shared memory that shapes every future response. Next.js (App Router) + TypeScript. Installable PWA; runs in **local mode** (no auth, JSON file) when Supabase env vars are absent, **cloud mode** (Supabase auth + Postgres, invite-only) when present.

## Status
<!-- STATUS:START -->
- **Updated:** 2026-07-18
- **Phase:** v3.2 — background (non-blocking) library ingestion via after(), extraction fallbacks for Vercel's blocked datacenter IPs (Jina Reader for articles, Supadata for YouTube transcripts), retry + paste-text recovery, discuss-a-selection, library search/filters, "find more" chips, and streamed books (Gutenberg in-app reader, Open Library links, Drive .txt/.epub — no book text stored); verified end-to-end locally incl. Gutenberg paging + quote-to-discuss
- **Architecture:** Next.js App Router; 5 LLM routes (topic/journal/ask/discuss/greeting) + library routes (ingest / content / extract-retry / paste / status / book-chunks) + op-based storage route + keepalive cron; shared extraction pipeline in lib/extract.ts, book streaming in lib/books.ts; StorageAdapter with JsonFileStorage (local) / SupabaseStorage (cloud, RLS); middleware auth gate; service worker (v3) + manifest; UI atoms in components/lamp-ui.tsx; link helpers in lib/links.ts
- **Next:** 📋 Naseer creates the Supadata key, adds SUPADATA_API_KEY (+ optional JINA_API_KEY) to Vercel, re-runs supabase/schema.sql, redeploys, re-tests Medium + YouTube + a Gutenberg book on the phone (see docs/next-steps.md → v3.2)
- **Blocked on:** the human-only v3.2 steps in docs/next-steps.md (Supadata account, Vercel env vars, schema re-run, redeploy)
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
