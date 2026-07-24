# Study Lamp

A learning-companion webapp: name a topic → get a brief, roadmap, and resources — then a journal and Q&A where the companion learns *alongside* you, maintaining a shared memory that shapes every future response. Next.js (App Router) + TypeScript. Installable PWA; runs in **local mode** (no auth, JSON file) when Supabase env vars are absent, **cloud mode** (Supabase auth + Postgres, invite-only) when present.

## Status
<!-- STATUS:START -->
- **Updated:** 2026-07-24
- **Phase:** v3.9 — Hero reader: client rendering, in-app editing, AI organize. **Root-cause fix:** the v3.8 "render Markdown→HTML at read time on the server" failed in Vercel's serverless bundle (ESM-only `marked` not in `serverExternalPackages`), and eadf614's try/catch silently shipped raw `###`. Now articles render **on the client** with **react-markdown** (remark-gfm + rehype-raw + rehype-sanitize) in `components/ArticleMarkdown.tsx` — one path renders Markdown, stored HTML, and the HTML+MD mix Jina returns; `/api/library/content` just returns raw content. This fixes every already-stored item with **no migration** and can't recur (no serverless render). (2) **Images that load**: `/api/img` proxy (reuses assertPublicHttpUrl + UA; SSRF-guarded, image-only, size-capped, streamed) rewrites hotlinked `<img>` src → defeats mixed-content + referrer/hotlink blocks. (3) **Edit any article**: Markdown editor (Write/Preview tabs, live preview via the same renderer) → `/api/library/edit` reuses updateLibraryItem's content param (no schema change); HTML items convert to MD via `?as=md` first, converging to Markdown. (4) **Organize with AI**: `/api/library/organize` (whole-doc tidy/summarize/simplify/fixFormatting + selection rewrite/explain) via new `askModelText` (raw Markdown, larger token budget) + additive `organizePrompt`; preview → Save/Copy/Discard, never saves silently. (5) **Select-to-act pill**: Discuss · Rewrite · Explain · Edit. (6) **Reading polish**: heading scale, inline-code chips, hr, reading-progress bar; TOC/A±/scroll-resume kept. Build green; verified in local mode — render pipeline (formatted MD, `<script>` stripped, images proxied, mixed HTML + tables), image proxy (streams + SSRF 400), edit save+readback, AI summarize round-trip. **Roadmap:** rich WYSIWYG (TipTap) deferred.
- **Architecture:** Next.js App Router; 8 LLM routes (topic/journal/ask/discuss/greeting/quiz/progress/books-suggest) + library routes (ingest / content / edit / organize / extract-retry / paste / status / book-chunks) + `/api/img` proxy + discover + op-based storage route + keepalive cron; **client article render in components/ArticleMarkdown.tsx (react-markdown + remark-gfm + rehype-raw + rehype-sanitize, images proxied through /api/img)**; extraction pipeline in lib/extract.ts (sanitizeArticleHtml at ingest/paste, htmlToMarkdown via turndown for export/edit; `marked` no longer on the read path); lib/llm.ts adds askModelText (raw text + token budget); book streaming in lib/books.ts; video-embed resolver in lib/embed.ts; StorageAdapter JsonFileStorage (local) / SupabaseStorage (cloud, RLS); middleware auth gate; service worker (v4) + manifest; UI atoms in components/lamp-ui.tsx; link helpers + urlKey in lib/links.ts
- **Next:** 📋 Naseer redeploys (no schema change), phone-tests: an article that showed raw `###` now renders **formatted** (headings/bold/links/images); images load in-app; **Edit** an article (Write/Preview → Save) persists; **✨ Organize with AI** (Tidy/Summarize/Simplify/Fix) previews then Save/Copy/Discard; highlight text → **Rewrite/Explain/Discuss/Edit** pill; reading-progress bar tracks scroll
- **Blocked on:** the human-only push + redeploy in docs/next-steps.md. No new required env vars; new deps `react-markdown`/`remark-gfm`/`rehype-raw`/`rehype-sanitize` are bundled client-side
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
