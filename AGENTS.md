# Study Lamp

A learning-companion webapp: name a topic → get a brief, roadmap, and resources — then a journal and Q&A where the companion learns *alongside* you, maintaining a shared memory that shapes every future response. Next.js (App Router) + TypeScript. Installable PWA; runs in **local mode** (no auth, JSON file) when Supabase env vars are absent, **cloud mode** (Supabase auth + Postgres, invite-only) when present.

## Status
<!-- STATUS:START -->
- **Updated:** 2026-07-23
- **Phase:** v3.8 — Markdown reader + extraction honesty. (1) Articles are stored as sanitized HTML (Readability) or Markdown (Jina fallback / pasted-uploaded MD); the content route converts MD → sanitized HTML at read time (one render path, ?as=md export), and NEVER 500s on a conversion error — it degrades to raw text so the reader can't say "couldn't extract" while data exists. (2) Extraction honesty: looksLikeJunkContent() in lib/extract.ts gates wall/error stubs (freedium/Medium 404 pages, reddit "blocked by network security", X signup wall, Cloudflare challenges) — junk is extraction:"failed", not a fake-ok render. (3) Medium fallback chain: freedium direct → Jina-on-mirror → Jina on the ORIGINAL medium.com URL (renders fine, previously untried). (4) Paste recovery accepts HTML too (same allow-list sanitizer); RecoveryBox points Medium items at the "Original page" mirror embed. Verified end-to-end in local mode: real Medium + dev.to render, dead Medium slug lands failed, pasted HTML sanitizes; build green
- **Architecture:** Next.js App Router; 8 LLM routes (topic/journal/ask/discuss/greeting/quiz/progress/books-suggest) + library routes (ingest / content / extract-retry / paste / status / book-chunks) + discover (multi-source video/article) + op-based storage route + keepalive cron; shared extraction pipeline in lib/extract.ts (junk gate + freedium/original fallback chain), book streaming in lib/books.ts (gutenberg/drive/remote; txt/epub/pdf), video-embed resolver in lib/embed.ts; StorageAdapter with JsonFileStorage (local) / SupabaseStorage (cloud, RLS); middleware auth gate; service worker (v4) + manifest; UI atoms in components/lamp-ui.tsx; link helpers + urlKey in lib/links.ts
- **Next:** 📋 Naseer pushes + redeploys, optionally drops the now-unused collection tables in Supabase (see docs/next-steps.md), phone-tests: add a Medium article from search → renders in the reader; a dead Medium link → honest "couldn't extract" + retry/paste/mirror options; add a normal article → renders; Copy as MD still works; paste a PDF → reads; ✨ Suggest books shows covers
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
- Portable reference for reusing the K3 LLM layer + library scraping pipeline in another project → `docs/k3-llm-and-scraping-reference.md`
