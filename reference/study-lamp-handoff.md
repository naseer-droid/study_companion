# Study Lamp — Handoff Document for Claude Code

A learning companion app: give it a topic, it produces a plain-language brief, a roadmap, and resources — then learns *alongside* you through a journal and Q&A, accumulating a shared memory that shapes every future response.

This document finalizes the scope validated in the Claude.ai artifact prototype and specifies the standalone build.

---

## 1. Product vision

Not a Q&A chatbot. The core differentiator is the **memory loop**: every journal entry and every question updates a running "what we've learned together" summary, which is injected into every subsequent model call. The companion visibly evolves with the learner. The lamp metaphor makes progress ambient: an ember inside a dark glass orb grows and glows as learning accumulates.

## 2. Finalized v1 scope

| Feature | Description |
|---|---|
| Topic setup | User names a topic → one model call returns brief, why-it-matters, 5–7 stage roadmap, 4–5 real resources, one first step (structured JSON) |
| Path | Roadmap as a checklist; progress bar per topic |
| Ask | Free-form questions; answers are beginner-friendly, connect to prior learning, and **update shared memory**; each answer includes a tappable follow-up question |
| Journal | User logs what they learned; companion replies as a co-learner (reflect + one insight/question, gently correct misconceptions), updates memory, suggests a next step |
| Shared memory | Compact running summary (<130 words), rewritten by the model on every journal/ask interaction; displayed to the user |
| Persistence | All topics, roadmap state, journal, Q&A, and memory persist locally across sessions |
| Lamp | Ember size + glow = f(journal entries + 0.5 × questions), capped |

**Explicitly out of scope for v1** (v2 candidates): quiz-me / active recall mode, streaks and habit tracking, proactive companion questions, web-verified resource links, multi-device sync, spaced-repetition review.

## 3. LLM integration — options and decision

Three ways to put Claude inside the app:

**A. Anthropic Messages API (recommended).** Direct `POST /v1/messages` via the official SDK (`anthropic` for Python, `@anthropic-ai/sdk` for TS). Every interaction in this app is a single request → structured JSON response with no tools. This is exactly the request-response pattern the Messages API is built for. Simple, cheap, stateless; we manage state (memory string) ourselves, which is the whole product concept anyway.

**B. Claude Agent SDK.** A library that exposes the Claude Code agent harness (agent loop, built-in file/bash/web tools, sessions, MCP). Right choice when the model must autonomously run multi-step tool workflows. Study Lamp has no such workflows in v1 — an agent loop adds runtime weight and complexity that doesn't pay for itself here. Note: products built on it must use API-key authentication; piggybacking on a claude.ai/Pro login is not permitted for third-party apps. Revisit the Agent SDK if v2 adds resource-verification via web search or document ingestion.

**C. Claude Code CLI.** A development tool, not an application runtime. We use it to *build* this app, not inside it.

**Decision: Messages API, called from a thin server route (never from the browser — the API key must stay server-side).**

- Model: `claude-sonnet-4-6` (good quality/cost balance for this workload). Make the model name a config value.
- `max_tokens`: 1024 for all three call types.
- Structured output: prompt for JSON-only responses; strip any accidental ```json fences; `JSON.parse` in try/catch; on parse failure retry once, then surface a friendly error.
- Docs: https://docs.claude.com/en/api/overview

## 4. Recommended stack

- **Next.js (App Router) + React + TypeScript** — one repo, UI plus API routes.
- **API routes**: `/api/topic` (setup), `/api/journal`, `/api/ask` — each builds the prompt server-side, calls Anthropic, validates the JSON shape (zod), returns it.
- **Persistence v1**: single-user local-first — SQLite via Prisma (or even a JSON file behind an interface). Keep a `StorageAdapter` interface so v2 can swap in Postgres + auth for multi-user.
- **Secrets**: `ANTHROPIC_API_KEY` in `.env.local`, never shipped to the client.
- **Styling**: plain CSS modules or Tailwind; design tokens below.

## 5. Data model

```ts
type Topic = {
  id: string;
  name: string;
  createdAt: string;           // ISO
  brief: string;
  whyItMatters: string;
  firstStep: string;
  roadmap: { id: number; title: string; desc: string; done: boolean }[];
  resources: { title: string; type: "book"|"course"|"website"|"video"|"practice"; why: string }[];
  journal: { date: string; userNote: string; companionReply: string }[];
  qa: { date: string; q: string; a: string; followUp: string }[];
  memory: string;              // the shared memory, <130 words, model-maintained
  nextSuggestion: string;
};
```

## 6. Prompt contracts (proven in the prototype — keep verbatim, refine only with eval)

**Topic setup** → returns `{ brief, whyItMatters, roadmap[{title,desc}], resources[{title,type,why}], firstStep }`
> You are a warm, curious learning companion helping someone start learning a new topic: "{topic}". Respond ONLY with valid JSON, no markdown fences… Give 5–7 roadmap stages ordered beginner→capable, and 4–5 genuinely well-known real resources.

**Journal** → returns `{ reply, updatedMemory, nextSuggestion }`
> You are a learning companion who is learning "{topic}" ALONGSIDE the learner, as a curious co-learner (not a lecturer). Shared memory so far: """{memory}""". The learner just shared: """{entry}""". reply = 2–4 warm sentences: reflect back what they learned, add ONE insight/connection/question of your own, gently correct clear misconceptions. updatedMemory = compact rewrite <130 words including this entry. nextSuggestion = one concrete step for tomorrow.

**Ask** → returns `{ answer, updatedMemory, followUp }`
> Same persona + shared memory. answer = 3–6 beginner-friendly sentences with a tiny example, connected to prior learning where relevant. updatedMemory = rewrite noting the question and key takeaway. followUp = one short related question.

**Invariant:** memory is always fully rewritten by the model, never appended by the app — this keeps it compact and coherent.

## 7. Design spec — "study lamp at night"

Palette: bg `#141A26`, panel `#1C2433`, raised panel `#222D40`, line `#2C3750`, ink `#EFEAE0`, dim `#8A94A8`, amber accent `#F5B34E` (used sparingly — eyebrows, active tab, ember), sage `#8FBF7F` (progress/done only), danger `#D9776B`.

Type: serif display (Georgia-class; upgrade to Fraunces if self-hosting fonts) for headings and the companion's voice; system sans for UI and user text. The companion "speaks in serif" — keep this distinction.

**The lamp (signature element).** Not a yellow ball. A dark glass orb (`#171F2E→#202A3C`) with a warm ember at its center; ember radius and outer glow scale with `min(1, (journalCount + 0.5*qaCount)/10)`. Subtle 0.8s transitions; respect `prefers-reduced-motion`.

Layout: max-width 680px single column, mobile-first. Topic view has four pill tabs: **Brief / Path / Ask / Journal** (Ask and Journal show counts). Journal renders as an asymmetric dialogue (user card left-cornered, companion right-cornered, serif). Empty states give direction, not mood.

## 8. Build plan for Claude Code (suggested milestones)

1. **Scaffold**: Next.js + TS, env handling, `StorageAdapter` with SQLite implementation, Topic CRUD, seed with a mock topic.
2. **API routes**: three routes with prompt builders, zod validation of model output, one retry on parse failure, error responses the UI can show verbatim.
3. **UI**: home (topic list + create flow with loading state), topic view with four tabs, lamp component, progress bars.
4. **Memory loop hardening**: cap memory at ~130 words defensively (truncate as fallback), optimistic UI for journal/ask with rollback on failure.
5. **Polish**: keyboard focus states, reduced motion, delete-topic confirm, export topic as markdown (nice-to-have).

Acceptance test for the core loop: create a topic → add 3 journal entries and 2 questions → the shared memory visibly references all five interactions in compact form, and the next companion reply demonstrably uses that context.

## 9. Cost & operational notes

- Every interaction ≈ one Sonnet call with a short prompt (<1.5k input tokens thanks to compact memory) and ≤1k output — pennies per session; no caching needed at v1 scale.
- Rate-limit the API routes lightly (e.g., 1 concurrent call per client) to prevent double-submits.
- Log model latency and JSON-parse failure rate; those are the two health metrics that matter.
- Verify current model names, pricing, and limits at https://docs.claude.com before shipping.
