---
name: verify
description: How to launch and drive Study Lamp to verify changes end-to-end in the browser
---

# Verifying Study Lamp

## Launch

- `npm run dev` (background) — lands on **http://localhost:3001** on this machine (3000 is taken).
- No Supabase env in `.env.local` → local mode: no login, data in `data/study-lamp.json`.
- `LLM_PROVIDER` in `.env.local` may be a **real provider (deepseek)** — each topic/journal/ask is a real, cheap API call. Fine for verification; don't loop it.

## Drive (chrome-devtools MCP)

- `data/study-lamp.json` holds Naseer's real topics. **Create a throwaway topic for testing and delete only that one.**
- React 19 controlled inputs ignore the `fill` tool: use the native value setter + `dispatchEvent(new Event("input", {bubbles:true}))`, and if the value was already set once, clear it first (React dedupes identical values).
- There are TWO "Ask" buttons (tab + submit). `[...querectorAll("button")].find(t => t.textContent === "Ask")` grabs the tab. Take the **last** match.
- Topic deletion opens a `window.confirm` — pass `dialogAction: "accept"` on the evaluate call, and check for a leftover dialog before the next navigation (`handle_dialog`).
- LLM waits: `wait_for` text like "THE BRIEF" / "Companion" with a 90s timeout.

## Worth checking after changes

- PWA: `fetch("/manifest.webmanifest")`, `navigator.serviceWorker.getRegistrations()`, the four `/icons/*.png` return 200.
- Offline: DevTools network emulation does NOT flip `navigator.onLine` — the SW cache fallback is testable (reload while offline), but for the offline banner override the `onLine` getter and dispatch an `offline` event.
- Persistence: full reload after mutations; per-entity ops mean counts must survive.
- API probes: POST `/api/storage` with unknown op / bad JSON → 400 with a named error.
- Mobile: `emulate` viewport `390x844x3,mobile,touch` → bottom tab bar appears under 520px.
