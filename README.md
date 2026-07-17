# Study Lamp

A learning companion that learns alongside you. Name a topic and it produces a plain-language brief, a 5–7 stage roadmap, and real resources — then grows a shared memory through your journal entries and questions. An ember in a dark glass orb glows brighter as you learn.

## Run it

```bash
npm install
cp .env.local.example .env.local   # then fill in your provider + key
npm run dev
```

Open http://localhost:3000 (or 3001 if 3000 is busy).

## Configuration (`.env.local`)

| Variable | Values | Notes |
|---|---|---|
| `LLM_PROVIDER` | `kimi` (default) \| `deepseek` \| `openrouter` \| `anthropic` \| `mock` | `mock` runs with no key (canned responses) |
| `LLM_API_KEY` | your key | for kimi/deepseek/openrouter |
| `LLM_MODEL` | e.g. `k3`, `deepseek-chat`, `anthropic/claude-sonnet-4.6` | provider model slug (`k3` default for kimi) |
| `LLM_BASE_URL` | e.g. `https://api.moonshot.cn/v1` | only to override the Kimi Code endpoint (`https://api.kimi.com/coding/v1`) |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | key / `claude-sonnet-4-6` | only for `LLM_PROVIDER=anthropic` |

## How it's put together

- `app/api/topic|journal|ask` — one model call each: build prompt server-side, validate the JSON with zod, retry once on a malformed response.
- `app/api/storage` + `lib/storage.ts` — all topics/journal/memory persist to `data/study-lamp.json` behind a `StorageAdapter` interface (swap in a DB later without touching the UI).
- `lib/prompts.ts` — the three prompt contracts, kept verbatim from the validated prototype.
- `components/StudyLamp.tsx` — the full UI (Brief / Path / Ask / Journal tabs, the lamp).

The product spec lives in `reference/study-lamp-handoff.md`.
