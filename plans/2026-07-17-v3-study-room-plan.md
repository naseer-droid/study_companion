# Study Lamp v3.0 — "The Study Room" (implementation plan)

> **Brief:** v2 only *points* at learning ("watch this, read this") — the actual reading and watching happens outside the app, invisible to the companion. v3.0 brings the content inside: a new **Library** tab per topic where you paste an article or YouTube URL; articles open in a beautifully typeset in-app reader, YouTube videos play embedded, and the server extracts the article text / video transcript so the companion has genuinely "seen" what you saw. A **Discuss** panel beside the reader/player lets you talk about the content with a friend who consumed it too — and every exchange rewrites the shared topic memory, exactly like journal/ask do today. A small **session greeting** ("last time you were on X — want to continue, or try Z?") rides along. Books/PDFs, adaptive roadmap, and the full visual-identity pass are deferred to v3.1–v3.3.

## Context

Brainstormed 2026-07-17, after v2 deployed successfully. Clarified with Naseer:

- How he learns, in order: **1) articles, 2) YouTube, 3) practice, 4) books** (topic-dependent).
- Biggest gaps in the current app: learning happens elsewhere; companion is too passive; roadmap is static.
- Wanted companion behaviors: knows where I am and greets me; discusses the content with me; adapts the plan; light quizzing only.
- Chosen sequencing: **Study Room first**. Deferred: v3.1 books/PDF reader (Supabase Storage + pdf.js/epub.js), v3.2 adaptive roadmap + spaced recall, v3.3 full visual-identity pass.

Prior art validating the shape: NotebookLM (chat with sources the AI has read), Khanmigo (tutor continuity), Readwise Reader (save/read/watch in one app). Study Lamp's differentiator is the persistent per-topic co-learner memory — v3.0 feeds it much richer input.

## What gets built

### 1. Data model (`lib/types.ts` — additive)

```ts
export type DiscussionMsg = { date: string; role: "user" | "companion"; text: string };

export type LibraryItem = {
  id: string;
  kind: "article" | "youtube";
  url: string;
  title: string;
  addedAt: string;            // ISO
  status: "unread" | "reading" | "done";
  siteName?: string;          // article source / channel name
  thumbnail?: string;         // og:image or YouTube thumbnail URL
  hasContent: boolean;        // extraction/transcript succeeded
  discussion: DiscussionMsg[];
};
// Topic gains: library: LibraryItem[]
```

Extracted content (article text / transcript) is **stored server-side only** and never shipped in `load()` — it can be tens of KB per item. The reader fetches it on demand.

### 2. Storage (`lib/storage.ts` — new `StorageAdapter` ops, both implementations)

- `addLibraryItem(userId, topicId, item, content)` — item metadata + extracted content
- `getLibraryContent(userId, itemId): Promise<string>` — content on demand for the reader/discuss route
- `updateLibraryStatus(userId, itemId, status)`
- `addDiscussion(userId, topicId, itemId, userMsg, companionMsg, memory)` — appends the exchange and rewrites topic memory (same last-write-wins semantics as journal/ask)
- `deleteLibraryItem(userId, itemId)`

JsonFileStorage: `library` array on each topic in the JSON file (content inline — fine locally). SupabaseStorage: new tables (below). Extend the op-based `app/api/storage/route.ts` with the matching ops.

### 3. Supabase schema (`supabase/schema.sql` — idempotent additions)

- `library_items` (id, user_id, topic_id FK cascade, kind, url, title, site_name, thumbnail, status, has_content, content text, added_at) + RLS policies copying the existing per-user pattern.
- `discussion_messages` (id, user_id, item_id FK cascade, date, role, text) + RLS.
- Naseer must re-run schema.sql in the SQL editor after deploy → add to `docs/next-steps.md`.

### 4. Ingestion route — `app/api/library/route.ts` (POST { topicId, url })

- **YouTube URL detected** (youtube.com / youtu.be): title + thumbnail via the keyless oEmbed endpoint (`https://www.youtube.com/oembed?url=...`); transcript via `youtubei.js`. Transcript failure is non-fatal: save with `hasContent: false`.
- **Any other URL**: server-side fetch + `@mozilla/readability` with `jsdom` to extract title, site name, og:image, and clean article text. Extraction failure → save link-only card, `hasContent: false`.
- New deps: `@mozilla/readability`, `jsdom`, `youtubei.js`.
- Follow the existing LLM-route conventions in `app/api/{topic,journal,ask}/route.ts` for auth/error shape (this route makes no LLM call).
- Known risk: YouTube transcript fetching has no official API; scraping libraries break occasionally. The fallback (video still embeds, companion discusses from title + learner's account) is designed in from the start.

### 5. Discuss route — `app/api/discuss/route.ts` (POST { topicId, itemId, message })

- Loads item content + topic memory + last ~10 discussion turns.
- New `discussPrompt(topic, memory, itemTitle, content, recentTurns, message)` added to `lib/prompts.ts` (additive — the three frozen v1 prompt contracts are untouched). Content truncated to a safe budget (~20k chars). Output JSON: `{ reply, updatedMemory }` — same memory-rewrite contract as journal/ask. Zod schema added to `lib/schemas.ts`.
- If `hasContent` is false, the prompt says so and the companion discusses from title + the learner's own account.
- Persists via `addDiscussion`.

### 6. Greeting route — `app/api/greeting/route.ts` (POST { topicId }) — final phase, small

- `greetingPrompt(topic, memory, nextSuggestion, roadmap, lastActivityDate)` → `{ greeting }`: 1–2 warm sentences of continuity + one concrete suggestion for today. Rendered as a dismissible strip at the top of an opened topic. Fetched once per topic-open, never blocking the UI.

### 7. UI (new components — begin splitting the `StudyLamp.tsx` monolith; new features live in new files)

- `components/Library.tsx` — 5th tab: URL input ("paste an article or YouTube link"), item cards (thumbnail, title, source, status chip), tap to open.
- `components/ReaderView.tsx` — full-screen overlay. Article: typeset reading column (larger reading font, ~65ch measure, generous leading — the first real "beauty" investment). YouTube: responsive 16:9 iframe embed (`youtube-nocookie.com`).
- `components/DiscussPanel.tsx` — chat about *this* item: slide-up sheet on mobile, side panel ≥1024px. "Mark done" control lives here.
- Match the existing design tokens in `reference/study-lamp-handoff.md`; keep StudyLamp.tsx changes to wiring (tab entry, state, fetch calls).

### 8. Housekeeping

- Bump `VERSION` in `public/sw.js` (golden rule) if the service worker or cached shell changes.
- Update `CLAUDE.md` Status block and `docs/next-steps.md` (re-run schema.sql on Supabase; redeploy).

## Order of work

1. Types + storage ops + schema.sql (both storage modes)
2. Ingestion route + Library tab (add/list/open cards) — verify with real URLs
3. ReaderView (article reader + YouTube embed)
4. Discuss route + DiscussPanel + memory integration
5. Greeting route + strip
6. Docs/status/next-steps updates

## Verification

- Use the project **verify** skill (launch + browser-drive recipe) in local mode.
- Ingestion: paste a real article URL (e.g. a blog post) → card appears with title/thumbnail; open it → clean reader view. Paste a real YouTube URL → card + embedded playable video. Paste a junk URL → link-only card, no crash.
- Discuss: with the mock/local LLM provider (and one live pass against the configured provider), ask about a passage → reply references the content; check the topic memory string changed; reload the page → discussion persists.
- Status: mark an item done → survives reload.
- Greeting: reopen a topic with history → greeting strip references last activity.
- `npm run build` passes (typecheck).
- Cloud mode: after Naseer re-runs schema.sql, repeat the ingestion + discuss check on the deployed app (tracked in docs/next-steps.md).

## Deferred roadmap (agreed direction, not in this plan)

- **v3.1 — Books:** upload PDF/EPUB to Supabase Storage; in-app reader (pdf.js / epub.js); chapter text feeds the Discuss panel.
- **v3.2 — Living Companion:** auto-mark roadmap progress from journal/library activity; reshape roadmap on struggle/leaps; light spaced-recall questions in the greeting.
- **v3.3 — Beauty pass:** full visual identity around the lamp (warm light, evening mood, dark mode), micro-interactions, monolith fully split.
