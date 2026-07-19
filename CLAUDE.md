# Study Lamp

A learning-companion webapp: name a topic → get a brief, roadmap, and resources — then a journal and Q&A where the companion learns *alongside* you, maintaining a shared memory that shapes every future response. Next.js (App Router) + TypeScript. Installable PWA; runs in **local mode** (no auth, JSON file) when Supabase env vars are absent, **cloud mode** (Supabase auth + Postgres, invite-only) when present.

## Status
<!-- STATUS:START -->
- **Updated:** 2026-07-20
- **Phase:** v3.5 — Source discovery: real in-app search for sources replaces the external search-link chips. New auth-gated `GET /api/discover?q&kind=video|article` (videos: YouTube Data API when `YOUTUBE_API_KEY` set → ytInitialData scrape fallback; articles: s.jina.ai SERP via existing `JINA_API_KEY` → DuckDuckGo HTML fallback; search failure returns 200 + empty results, never an error). New `components/SourceSearch.tsx` panel (Videos/Articles tabs, seed chips from topic + open roadmap steps, one-tap Add → existing `/api/library` extraction pipeline, "Added ✓" dedupe via `urlKey` in lib/links.ts). Entry points: Library "Find more" chips (now in-app) and Resources card per-resource chips (＋ add to library / find it 🔍). No schema changes; one optional env var
- **Architecture:** Next.js App Router; 7 LLM routes (topic/journal/ask/discuss/greeting/quiz/progress) + library routes (ingest / content / extract-retry / paste / status / book-chunks) + discover route (no LLM) + op-based storage route + keepalive cron; shared extraction pipeline in lib/extract.ts (transcript segments + sanitized article HTML), book streaming in lib/books.ts (gutenberg/drive/remote); StorageAdapter with JsonFileStorage (local) / SupabaseStorage (cloud, RLS); middleware auth gate; service worker (v4) + manifest; UI atoms in components/lamp-ui.tsx; link helpers + urlKey in lib/links.ts
- **Next:** 📋 Naseer creates the free `YOUTUBE_API_KEY` (optional but recommended — keyless video search rarely works from Vercel), finishes any pending v3.2 Vercel steps, pushes + redeploys, then phone-tests v3.5 (find-more video/article search → add → transcript/reader) alongside the v3.3/v3.4 spot-checks — see docs/next-steps.md
- **Blocked on:** the human-only deploy steps in docs/next-steps.md (YouTube key optional, Vercel env vars if still missing, schema re-run if pending, push + redeploy)
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
