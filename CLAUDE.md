# Study Lamp

A learning-companion webapp: name a topic → get a brief, roadmap, and resources — then a journal and Q&A where the companion learns *alongside* you, maintaining a shared memory that shapes every future response. Next.js (App Router) + TypeScript, single-user local-first.

## Status
<!-- STATUS:START -->
- **Updated:** 2026-07-05
- **Phase:** v1 built and verified end-to-end with the mock provider; awaiting a real API key for live model runs
- **Architecture:** Next.js App Router; 3 LLM API routes + 1 storage route; JSON-file persistence behind a StorageAdapter; provider-switchable LLM layer (openrouter/deepseek/anthropic/mock)
- **Next:** 📋 Naseer puts his OpenRouter or DeepSeek key in `.env.local` and runs the live acceptance test (see docs/next-steps.md)
- **Blocked on:** the human-only steps in docs/next-steps.md (API key)
<!-- STATUS:END -->

## Commands

- `npm run dev` — dev server (uses port 3001 if 3000 is busy on this machine)
- `npm run build` — production build + typecheck

## Golden rules

- **Never call the model from the browser.** All LLM calls go through `app/api/{topic,journal,ask}/route.ts` → `lib/llm.ts`; keys live only in `.env.local`.
- **Prompts in `lib/prompts.ts` are frozen contracts** (proven in the prototype) — refine only with evaluation, per the handoff doc.
- **Memory is always fully rewritten by the model, never appended by the app** — this keeps it compact and coherent.
- `data/` and `.env.local` are gitignored; never commit either.

## Docs index

- Product spec, prompt contracts, design tokens, v1 scope → `reference/study-lamp-handoff.md`
- Original Claude.ai artifact the UI was ported from → `reference/learning-companion.jsx`
- Naseer needs the human-only to-do list (API key, live test) → `docs/next-steps.md`
