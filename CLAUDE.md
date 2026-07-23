# Study Lamp

A learning-companion webapp: name a topic → get a brief, roadmap, and resources — then a journal and Q&A where the companion learns *alongside* you, maintaining a shared memory that shapes every future response. Next.js (App Router) + TypeScript. Installable PWA; runs in **local mode** (no auth, JSON file) when Supabase env vars are absent, **cloud mode** (Supabase auth + Postgres, invite-only) when present.

## Status
<!-- STATUS:START -->
- **Updated:** 2026-07-24
- **Phase:** v3.8 — Markdown reader + MD input + filter fixes. (1) The article reader now renders **Markdown**: articles stored as Markdown (the Jina fallback, plus pasted/uploaded MD) are converted MD→sanitized HTML **at read time** in /api/library/content (marked → the existing sanitizeArticleHtml allow-list), fixing the raw-`###`/`[](url)` display bug with **no schema migration**; stored HTML + YouTube transcripts pass through unchanged. (2) **Add Markdown directly**: a Library textarea (paste) + a `.md` file picker (upload, read client-side) → stored as a Markdown article via /api/library POST (synthetic `about:markdown/<uuid>` URL, no extraction). (3) **Reader extras**: reading time + word count in the subtitle, an auto table-of-contents from H2/H3 (client-built, ids assigned), and **Copy as Markdown** (raw MD for MD items, turndown(html) for HTML items via `?as=md`). (4) **Filter fixes**: Reading status has its own chip and status filtering is now status-exact (was silently hiding in-progress items); chips appear from ≥2 items (was ≥4); Discover article grouping is host-based so Wikipedia/Medium from the web SERP group correctly, and results are de-duped by urlKey. Build green; verified end-to-end in local mode (paste MD → formatted reader with `<script>` stripped, reading stats + TOC + export, Reading filter round-trip)
- **Architecture:** Next.js App Router; 8 LLM routes (topic/journal/ask/discuss/greeting/quiz/progress/books-suggest) + library routes (ingest / content / extract-retry / paste / status / book-chunks) + discover (multi-source video/article) + op-based storage route + keepalive cron; shared extraction pipeline in lib/extract.ts (v3.8: + renderMarkdownToSafeHtml via marked, + htmlToMarkdown via turndown; content route renders Markdown→sanitized HTML at read time), book streaming in lib/books.ts (gutenberg/drive/remote; txt/epub/pdf), video-embed resolver in lib/embed.ts; StorageAdapter with JsonFileStorage (local) / SupabaseStorage (cloud, RLS); middleware auth gate; service worker (v4) + manifest; UI atoms in components/lamp-ui.tsx; link helpers + urlKey in lib/links.ts
- **Next:** 📋 Naseer pushes + redeploys (no schema change), phone-tests: paste Markdown (textarea + `.md` upload) → reads formatted; an article that used the Jina fallback now renders formatted (not raw `###`); reader shows `~N min read · words` + a **Contents** list; **Copy as MD** copies/downloads; Library **Reading** chip surfaces in-progress items; Discover articles group under Web/Medium/dev.to/Wikipedia with no duplicate rows
- **Blocked on:** the human-only push + redeploy in docs/next-steps.md. No new required env vars; `marked`/`turndown` are bundled dependencies
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
