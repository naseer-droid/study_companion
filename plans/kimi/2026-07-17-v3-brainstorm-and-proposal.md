# Study Lamp v3 — brainstorm & proposal (Kimi)

> Brainstormed 2026-07-17. Naseer chose to implement the "Study Room" plan first
> (`plans/2026-07-17-v3-study-room-plan.md`). This document is the v3.1+ backlog:
> items below map onto its deferred roadmap (A3→v3.1 books, B1/B2→v3.2 living
> companion, C→v3.3 beauty pass).

Goal restated (Naseer's words): the app should feel like **a friend you study with** —
you tell them what you're doing, they're an expert who guides you and learns *alongside*
you, and the content you're learning from (videos, books) should live *inside* that
relationship instead of being a dead "watch this, read this" list.

---

## 0. Coverage after v3.0 "Study Room" (2026-07-17)

Shipped (see `plans/2026-07-17-v3-study-room-plan.md`):

- **A2 YouTube in-app — done.** oEmbed metadata (keyless) + transcript via
  `youtube-transcript` + `youtube-nocookie` embed. Timestamp-aware: pasted
  `?t=57s` / `?t=1m32s` carries into the embed as `start`. Fallback when no
  transcript: card still plays; companion discusses from title.
- **In-app article reading — done.** Readability extraction → typeset reader
  (65ch serif). **Medium links auto-mirror to `https://freedium-mirror.cfd/` at
  ingestion** (paywall bypass); the stored URL is the mirror, so "Original ↗"
  opens the readable version.
- **Content-grounded discuss (the NotebookLM pattern) — done.** The companion
  gets the extracted text/transcript (≤20k chars) plus last 10 turns; every
  exchange rewrites shared topic memory.
- **B2-lite — done.** Session greeting strip references where you left off.
  Full spaced-recall (B2 proper) still open.

Still open below: A3 (v3.1), B1/B2-proper/B3/B4 (v3.2), C (v3.3).

### v3.1 build-ready spec (A3 ebook shelf)

- **Storage:** Supabase bucket `topic-files` (RLS mirroring `library_items`) +
  `files` table (id, user_id, topic_id FK cascade, path, name, mime, created_at);
  local mode writes under `data/files/` via a new storage op.
- **Upload:** new route accepting multipart form data; Library tab gains
  "Upload EPUB/PDF" beside the URL box.
- **Reader:** PDF in a native `<iframe>`/`<embed>` (no dep); EPUB via `epub.js`
  (one client dep). Reuse `ReaderView`'s overlay + DiscussPanel.
- **Ask-the-passage:** text selection in the reader → floating "Ask the
  companion" → existing `/api/ask` with `Re: "<quote>" — <question>`; frozen
  prompts untouched. Chapter text (≤20k chars) can also feed `discussPrompt`.
- **Copyright-safe by construction:** users upload their own files to their
  own bucket.

---

## 1. Honest gaps in v1/v2 (grounded in the code)

- **Resources are dead text.** `lib/prompts.ts` returns `{title, type, why}` — no URL.
  `components/StudyLamp.tsx` renders them as plain text with a disclaimer
  ("worth verifying availability yourself"). You can't click, watch, or track them.
  This is the #1 gap between "advice app" and "study companion."
- **The journal is the only input channel.** Everything the companion knows comes from
  what you type. If you watched a video or read a chapter, you must manually summarize
  it — the friction that kills learning apps.
- **No retention loop.** Nothing ever comes back. The roadmap doc (Phase B) already
  names this: review prompts + spaced-repetition-lite. Unbuilt.
- **Memory is capped at 130 words** (`lib/prompts.ts` frozen contract). Fine for now;
  will feel tight once videos/books feed it. Do NOT change lightly — frozen contract.
- **Unused assets already in repo:** `companion-app-audio/` (focus music loop, chimes)
  is referenced nowhere. A focus-session feature could finally use them.
- **Feel:** spinner-based loading, inline text errors, one dark theme, system fonts.
  Charming but plain; replies arrive in one 10–30s lump.

## 2. Mini case study — what's proven to work elsewhere

- **NotebookLM**: chat grounded in *your* sources is the killer pattern. Lesson:
  "ask the companion about this passage/video" beats generic Q&A.
- **Readwise/Kindle**: highlights are worthless until they resurface. Lesson:
  capture is easy; *resurfacing* is the product.
- **Duolingo**: streak mechanics work until they feel punitive (project research
  already flagged this — keep "counts only grow," no guilt mechanics).
- **Anki**: retrieval practice is the most evidence-backed accelerator, but Anki's UX
  tax is legendary. Lesson: teach-back should feel like a friend quizzing you, not
  a flashcard deck manager.
- **YouTube self-learners**: everyone learns from playlists, but the loop
  watch→notes→remember spans 3 apps. Friction is tab-switching, not content.

Design principles that follow: content comes *inside*; every act of consumption ends
in a 1-line reflection that feeds shared memory; retrieval is gentle; stay small,
private, yours (v2 positioning).

## 3. Feature proposals (ranked by impact on the stated goal)

### A. Content in the loop — the main ask

**A1. Live resources (quick win).**
Give every resource a working link without trusting the LLM for URLs (it will
hallucinate them). Deterministic links instead:
- video → `https://www.youtube.com/results?search_query=<title>`
- book → Google Books / OpenLibrary search URL
- course/website/practice → Google search URL
Zero new keys, zero hallucination. Plus a per-resource status toggle
(`suggested → doing → done`) stored in DB, and the progress card counts them.

**A2. YouTube inside the app.**
- Covered by Study Room v3.0 via oEmbed + embed (keyless — simpler than the
  Data API v3 idea from this brainstorm; keep Data API as an upgrade path only
  if oEmbed metadata proves too thin).
- After watching: one-tap "Log what I learned" → journal composer prefilled
  ("Watched: <title> — ") so the memory loop captures it.
- Optional delight: PWA `share_target` in `app/manifest.ts` so sharing a video from
  the YouTube app opens Study Lamp to attach it to a topic.

**A3. Ebook shelf + reader + "ask about this passage."** (= Study Room v3.1)
- Upload EPUB/PDF per topic → Supabase Storage bucket (`topic-files`) with RLS
  policies mirroring the tables; local mode stores under `data/files/` via the
  storage route. New `files` table (id, topic_id, path, name, mime).
- Reader: PDF via browser-native `<iframe>`/embed (no dep); EPUB via `epub.js`
  (one client-side dep). Keep reader minimal — paginate, that's it.
- The magic: select text in the reader → floating "Ask the companion" → sends
  `Re: "<quote>" — <your question>` to the existing `/api/ask` route. The frozen
  prompt needs no change; the quote rides inside the question string. Answers still
  feed shared memory — now the companion has literally read the passage with you.
- Copyright-safe by construction: users upload their own files to their own bucket.

### B. Learn faster — retention loops

**B1. Teach-back ("quiz me, friend").**
Highest learning-science ROI (retrieval practice). New `/api/quiz` route + ONE new
prompt (adding prompts is allowed; *editing* the frozen three is what needs
evaluation): companion picks something from shared memory and asks you to explain
it; your answer + its feedback is stored as a journal entry, so it feeds memory
like everything else. Feels like a friend checking you got it, not a test.

**B2. Gentle review prompts.**
Server-side, no LLM cost: "3 entries ago you learned X — want to revisit?" derived
from journal timestamps. Matches the already-planned Phase B. The v3.0 greeting
route is the natural home for a light version of this.

**B3. Voice journal.**
Web Speech API (`SpeechRecognition`) — free, on-device, ~1 component. Talking to
your study friend beats typing on a phone. Graceful hide when unsupported.

**B4. Weekly digest (optional, later).**
One LLM call/week per topic: "what we covered, what's shaky, suggested next focus."
Delivered as a special card on the overview. Costs ~nothing at invite-only scale.

### C. Beauty & feel

- **Streaming replies** (SSE) for journal/ask — the single biggest "alive" upgrade;
  watch your friend think instead of a 20s spinner. `lib/llm.ts` streams, UI appends.
- Typography: one real serif webfont (Fraunces or Source Serif 4) for companion
  voice + headings; keep system sans for UI.
- Skeleton cards instead of spinners; toast-style errors instead of inline text.
- Lamp polish: subtle ember flicker animation (CSS), glow already grows — make the
  home lamp gently pulse when there's an unread `nextSuggestion`.
- Warm "daylight" theme (light variant of the same palette), auto by time/OS.
- Focus session (uses the orphaned audio assets): 25-min timer + focus music loop +
  chime; ending a session opens the journal prefilled. Small build, big vibe.

## 4. Suggested build order (post-Study Room)

| Phase | Contents | Rough size |
|---|---|---|
| **v3.1** | A3 ebook shelf + reader + ask-the-passage (Study Room plan's v3.1) | 3–4 days |
| **v3.2** | B1 teach-back + B2 review prompts + A1 resource links/status (Study Room plan's v3.2 "living companion") | 2–3 days |
| **v3.3** | C streaming, typography, skeletons, daylight theme, focus session; B3 voice; B4 digest (Study Room plan's v3.3 beauty pass) | 2–3 days |

## 5. Technical notes & risks

- **Schema:** v3.1 needs a `files` table + Storage bucket + RLS policies;
  A1 needs a resource-status field. `supabase/schema.sql` stays the source of
  truth; additions must be idempotent like the rest.
- **Frozen prompts:** no edits to the three existing contracts. New features get NEW
  prompts. If memory ever needs >130 words, that's an evaluated contract change.
- **Deps added:** `epub.js` (v3.1 only). PDF/voice/streaming need none.
- **Costs:** all trivial at invite-only scale.
- **Mobile:** reader and embed must respect the 680px column and PWA offline rules.
