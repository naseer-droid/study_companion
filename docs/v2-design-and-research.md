# Study Lamp v2 — design & research (2026-07-11)

v2 turns the local single-user app into an installable mobile PWA with cloud
sync for Naseer + a few invited friends/family. This doc records the decisions
and the research behind them; `docs/next-steps.md` has the owner actions.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Hosting | **Vercel Hobby** (same account as the existing app) | Fluid Compute default gives a 300s function timeout — covers 30–60s LLM calls with zero rework. Netlify free tier times out at 10s, a hard blocker. Hobby allows up to 200 projects. |
| DB + auth | **Supabase free tier**, `@supabase/ssr` | Postgres + email auth in one free service; RLS gives real per-user isolation. |
| Login | Email+password primary, **email OTP code** as alternate | OTP doubles as the forgot-password path; friendly to non-technical users. |
| Signup | **Invite-only** via `allowed_emails` table + DB trigger on `auth.users` | Naseer's LLM key pays for everyone; enforcement at the DB layer can't be bypassed by calling the auth API directly. |
| Storage | Per-entity ops (`createTopic`, `addJournalEntry`, …) behind `StorageAdapter` | Whole-blob saves would let two devices overwrite each other. Per-entity writes are additive; only the model-rewritten memory is last-write-wins (correct for it). |
| Offline | Installable + read-only cached data; writes disabled with a clear banner | Every core action is an LLM round-trip, and iOS has no Background Sync — honest offline beats fake queueing. |
| Local dev | No Supabase env vars → v1 behavior (no login, JSON file) | `lib/supabase/config.ts` `supabaseEnabled` flag switches everything. |

## Current-docs facts that differ from older knowledge (verified 2026-07)

- Supabase keys are now **publishable/secret** (env: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`), not anon/service_role.
- Server code verifies identity with `auth.getClaims()`; never `getSession()`.
- Since 2026-04, new tables in `public` are **not auto-exposed** to the Data API — `supabase/schema.sql` grants access to `authenticated` explicitly.
- Supabase free projects **pause after 7 idle days** → `/api/keepalive` + daily Vercel cron (`vercel.json`).
- Vercel Hobby cron jobs run at most once/day — daily is fine for the keep-alive.

## Market research (Sonnet 5 agent, mid-2026) — what shaped the product

- **Differentiator to protect**: the fully model-rewritten shared memory. ChatGPT's memory is derided as unused "sticky notes"; the memory-native competitors (Rewind/Limitless) were acquired by Meta and shut down Dec 2025.
- **User complaints to avoid**: punitive streaks (Duolingo "energy" backlash), bad mobile apps (RemNote's #1 complaint), AI paywalled into top tiers (Notion AI), tools needing tutorials (Anki).
- **Adopted in v2**: gentle "Our progress" card (counts only grow; no streaks — copy: "Come back whenever — the lamp stays lit"), mobile bottom-tab nav, PWA installability.
- **Positioning**: *small, private, and still yours* — a low-ceremony personal learning companion, not a curriculum platform or knowledge-management suite.

## Roadmap

- **Phase B (product)**: gentle review prompts ("want to revisit X?"), spaced-repetition-lite from journal content, richer resource curation.
- **Phase C (scale, only if wanted)**: open signup + per-user LLM quotas, rate limiting, per-user BYO keys.

## Architecture map (v2)

- `middleware.ts` — session refresh + auth gate (cloud mode only)
- `lib/supabase/{config,client,server}.ts` — env switch + the two SSR clients
- `lib/auth.ts` — `getUserId()` for API routes
- `lib/storage.ts` — `StorageAdapter` interface; `JsonFileStorage` (local) and `SupabaseStorage` (cloud, request-scoped client so RLS applies)
- `app/api/storage/route.ts` — GET load + POST `{op,…}` mutations (incl. one-time `import`)
- `app/login`, `app/auth/{confirm,signout}` — auth UI + handlers
- `app/manifest.ts`, `public/sw.js`, `components/PwaSetup.tsx` — PWA layer
- `app/api/keepalive/route.ts` + `vercel.json` — Supabase anti-pause cron
- `supabase/schema.sql` — tables, RLS, grants, allowlist trigger + `email_is_allowed()` RPC
