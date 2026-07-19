# Study Lamp

A learning-companion webapp: name a topic → get a brief, roadmap, and resources — then a journal and Q&A where the companion learns *alongside* you, maintaining a shared memory that shapes every future response. Next.js (App Router) + TypeScript. Installable PWA; runs in **local mode** (no auth, JSON file) when Supabase env vars are absent, **cloud mode** (Supabase auth + Postgres, invite-only) when present.

## Status
<!-- STATUS:START -->
- **Updated:** 2026-07-19
- **Phase:** v3.4 — Reader upgrades: YouTube transcript now VISIBLE in the reader (stored as JSON `{t,text}` segments; tappable timestamps seek the player; search + copy; legacy plain-text transcripts still render), richer article reader (Readability `.content` stored as server-sanitized HTML — headings/lists/images, hotlinked so DB size unchanged, capped at CONTENT_CAP) with a Reader⇄Original-page toggle that iframes the Freedium mirror for Medium, per-article reading-position + font-size (localStorage), new book source `provider:"remote"` streaming public .epub/.txt URLs (Standard Ebooks / archive.org / self-host) via SSRF-guarded fetch (redirects re-validated each hop), and a redesigned inline-SVG mic with live interim dictation preview. Build passes; no schema changes or new env vars
- **Architecture:** Next.js App Router; 7 LLM routes (topic/journal/ask/discuss/greeting/quiz/progress) + library routes (ingest / content / extract-retry / paste / status / book-chunks) + op-based storage route + keepalive cron; shared extraction pipeline in lib/extract.ts (now stores transcript segments + sanitized article HTML), book streaming in lib/books.ts (gutenberg/drive/remote); transcript+HTML helpers in lib/types.ts (parseTranscript/transcriptToText/looksLikeHtml/stripHtml); StorageAdapter with JsonFileStorage (local) / SupabaseStorage (cloud, RLS); middleware auth gate; service worker (v4) + manifest; UI atoms in components/lamp-ui.tsx; link helpers in lib/links.ts
- **Next:** 📋 Naseer finishes the v3.2 owner steps if not yet done on Vercel (Supadata/Jina keys are now in local .env.local; Vercel side unverified), re-runs supabase/schema.sql if pending, pushes + redeploys, then re-tests v3.2 (Medium/YouTube/Gutenberg), v3.3 (quiz, focus, voice) and v3.4 (visible transcript, rich article + Original-page toggle, .epub/.txt book, new mic) on the phone — see docs/next-steps.md
- **Blocked on:** the human-only deploy steps in docs/next-steps.md (Vercel env vars if still missing, schema re-run if pending, push + redeploy)
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
