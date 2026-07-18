# K3 LLM + Web-Scraping Reference (portable)

A self-contained reference for reusing this project's two server-side subsystems in
another project:

1. **K3 LLM integration** — how the app talks to the Kimi K3 model (and alternate providers)
2. **Library scraping pipeline** — how URLs are ingested and their text extracted, with
   layered fallbacks that survive datacenter-IP blocking

Everything below is implemented and verified in this repo (`lib/llm.ts`, `lib/extract.ts`,
`app/api/library/*`). Code snippets are condensed but faithful to the real implementation.

---

## Part 1 — K3 LLM integration

### Key facts

- **K3 is not involved in scraping.** It only powers the *generative* routes
  (topic brief, journal reply, Q&A, discuss, greeting). Scraped text is fed to it as
  context afterwards.
- **Endpoint (default):** `POST https://api.kimi.com/coding/v1/chat/completions`
  (OpenAI-compatible; API key from the Kimi Code Console, consumes membership quota).
- **Pay-as-you-go alternative:** set `LLM_BASE_URL=https://api.moonshot.cn/v1` and the
  matching `LLM_MODEL` slug from the Moonshot Open Platform.
- **Model slug:** `k3` (default), override with `LLM_MODEL`.
- **Auth:** `Authorization: Bearer $LLM_API_KEY`.
- Golden rule: **never call the model from the browser** — all calls go through API
  routes → `lib/llm.ts`; keys live only in `.env.local` / hosting env vars.

### The K3 reasoning quirk (important)

K3 reasons ("thinks") before answering, and **reasoning tokens share the completion
budget**. Consequences:

- Use `max_tokens: 4096` for K3. At 1024 the thinking consumes the entire budget and the
  reply comes back **empty**.
- K3 round-trips can exceed 60s. On Vercel, set `export const maxDuration = 300` on any
  route that calls it (stay under Vercel's 300s ceiling).

### Env-var-driven provider abstraction

One function, provider chosen entirely by env — easy to port:

| Env var | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `kimi` | `kimi` / `moonshot` / `deepseek` / `openrouter` / `anthropic` / `mock` |
| `LLM_API_KEY` | — | Bearer key for the OpenAI-compatible providers |
| `LLM_BASE_URL` | `https://api.kimi.com/coding/v1` | Override for Moonshot Open Platform etc. |
| `LLM_MODEL` | `k3` | Provider model slug (`deepseek-chat`, `anthropic/claude-sonnet-4.6`, …) |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | — / `claude-sonnet-4-6` | Native Anthropic SDK path |

### Minimal portable implementation

```ts
const MAX_TOKENS = 1024;

async function callOpenAiCompatible(
  prompt: string,
  baseUrl: string,
  defaultModel: string,
  maxTokens = MAX_TOKENS
): Promise<string> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) throw new Error("LLM_API_KEY is not set.");
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL ?? defaultModel,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Model provider returned ${res.status}`);
  const text = (await res.json())?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("Model provider returned no text.");
  return text;
}

// K3: bigger budget because reasoning shares it
const callK3 = (prompt: string) =>
  callOpenAiCompatible(
    prompt,
    process.env.LLM_BASE_URL ?? "https://api.kimi.com/coding/v1",
    "k3",
    4096
  );
```

### JSON-in/JSON-out contract with one retry

Prompts demand JSON; the parser strips markdown fences and retries the model call **once**
on parse failure, then throws a friendly message the route can surface verbatim:

```ts
function parseJson(text: string): unknown {
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

export async function askModel(prompt: string): Promise<unknown> {
  let text = await callProvider(prompt);
  try {
    return parseJson(text);
  } catch {
    text = await callProvider(prompt); // one retry
    try {
      return parseJson(text);
    } catch {
      throw new Error("The companion's response wasn't readable. Please try again.");
    }
  }
}
```

### Mock provider for keyless local dev

`LLM_PROVIDER=mock` returns canned JSON keyed on distinctive prompt substrings, so the
full UI loop can be exercised without API credits. Worth copying into any project.

### Route-level pattern (Next.js App Router)

```ts
// K3's thinking pushes LLM round-trips past 60s; stay under Vercel's 300s.
export const maxDuration = 300;

export async function POST(req: Request) {
  // 1. auth via request-scoped storage/Supabase client
  // 2. build prompt from lib/prompts.ts (frozen contracts — refine only with evaluation)
  // 3. const result = await askModel(prompt)
  // 4. validate shape, persist, return NextResponse.json(...)
  // 5. outer try/catch ALWAYS returns a JSON error body — never a bodyless 500
}
```

---

## Part 2 — Library scraping pipeline

### Design philosophy

- **Extraction failure is never fatal.** Worst case is a link-only card the user can
  still open. The add flow returns instantly; scraping happens post-response.
- **Layered fallbacks, not retries.** From datacenter IPs (Vercel), YouTube *hangs*
  scrapes and paywalled sites slow-walk plain fetches — "trying harder from the same
  server" can't work, so the fallback is a *different service with better IP
  reputation* (Jina Reader, Supadata), not another attempt.

### Endpoints (Next.js App Router)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/library` | POST | Add a URL. Saves item with `extraction:"pending"` and returns **immediately**; real scraping runs in Next's `after()`. `maxDuration = 60` must cover response + background work. |
| `/api/library/status?ids=a,b,c` | GET | Poll target while items are pending (max 20 ids). Returns only the fields the background job may patch: title, siteName, thumbnail, hasContent, extraction. |
| `/api/library/extract` | POST | Retry button. Runs the pipeline **inline** (not `after()`) so the spinner gets a definitive answer in one round trip. Returns the full updated item. |
| `/api/library/content?itemId=x` | GET | Loads extracted text on demand for reader/discuss views — the main data `load()` never ships content (can be tens of KB per item). |
| `/api/library/paste` | POST | Last-resort recovery: the user pastes the article body / YouTube "Show transcript" panel themselves. Universal — works when every automated fetch is blocked. |

### Ingestion flow (POST /api/library)

1. Validate: JSON body with `topicId` + `url`; URL must parse and be http/https.
2. **Medium rewrite:** medium.com, `*.medium.com`, and known Medium custom domains
   (`betterprogramming.pub`, `levelup.gitconnected.com`, `uxdesign.cc`, `itnext.io`,
   `proandroiddev.com`, …) are rewritten to the Freedium mirror:
   `https://freedium-mirror.cfd/<original-url>`. The *stored* URL is the readable one.
3. **YouTube detection** from the URL shape: `youtu.be/<id>`, `youtube.com/watch?v=`,
   `/shorts/`, `/embed/`, `/live/`.
4. **Provisional metadata** so the card looks presentable instantly:
   - YouTube → keyless oEmbed: `GET https://www.youtube.com/oembed?url=<url>&format=json`
     (5s timeout; fall back to `https://i.ytimg.com/vi/<id>/hqdefault.jpg`).
   - Articles → hostname as provisional title.
5. Save item with `extraction:"pending"`, `hasContent:false`, empty content.
6. Kick off `after(() => extractAndStore(...))`. Capture the authed storage client
   **before** the response goes out — `after()` callbacks must not touch
   `cookies()`/`headers()`.
7. Outer `try/catch` on the whole handler: every error path returns a JSON body
   (`{ error }`), never a bodyless 500.

### Article extraction — two attempts

**Attempt 1 — direct fetch + Readability:**

```ts
const res = await fetch(url, {
  headers: { "user-agent": CHROME_UA, accept: "text/html,application/xhtml+xml,*/*" },
  redirect: "follow",
  signal: AbortSignal.timeout(15_000),
});
if (!res.ok) throw new Error(`page returned ${res.status}`);
if (Number(res.headers.get("content-length") ?? 0) > 5_000_000) throw new Error("too large");
const html = await res.text();
// jsdom + @mozilla/readability → title, siteName, textContent; og:image for thumbnail
```

- jsdom and `@mozilla/readability` are **lazy `import()`ed** so a packaging/bundling
  failure surfaces as a thrown error (→ fallback), not a dead route module.
- Success requires `content.length > 200` (`HAS_CONTENT_MIN`) — shorter usually means a
  paywall/JS-wall stub.

**Attempt 2 — Jina Reader** (if attempt 1 throws or is too thin):

```ts
// Keyless works (rate-limited); JINA_API_KEY raises limits.
const res = await fetch(`https://r.jina.ai/${url}`, {
  headers: { accept: "text/plain", ...(key ? { authorization: `Bearer ${key}` } : {}) },
  signal: AbortSignal.timeout(20_000),
});
// Response has "Title:" / "URL Source:" / "Markdown Content:" header lines — split on them.
```

- **Metadata merge trick:** if the direct fetch got real metadata (og:image, site name)
  but walled text, keep the direct metadata and let Jina fill only the content.
- If Jina also fails: keep the thin direct result if there is one; otherwise mark failed.

### YouTube extraction — metadata + two transcript attempts

- **Metadata:** oEmbed as above (fast, unblocked, keyless).
- **Transcript attempt 1 — watch-page scrape** via the `youtube-transcript` npm package.
  Wrapped in `Promise.race` with a hard **15s** budget, because from datacenter IPs
  YouTube often *hangs* instead of refusing. Strip `[Music]`-style markers, collapse
  whitespace.
- **Transcript attempt 2 — Supadata** (residential-proxy transcript API, free tier):

```ts
// GET https://api.supadata.ai/v1/youtube/transcript?videoId=<id>&text=true
// header: x-api-key: SUPADATA_API_KEY
// 206 = "video has no transcript" — a real answer, not an error.
```

### Storage of results

- Content capped at **100,000 chars** (`CONTENT_CAP`).
- `hasContent = content.length > 200`; `extraction: "ok" | "failed"`.
- Only overwrite provisional metadata with **non-empty** real values — never clobber a
  good oEmbed title with an empty failure.
- `extractAndStore()` **never throws** — if even the storage patch fails, the item stays
  `pending` and the client's poll cap surfaces it as stuck instead of looping forever.
- Freedium-mirrored results are polished afterwards: `siteName` forced to "Medium" and
  the " – Freedium" title suffix stripped.

### Required packages & env vars

- Packages: `jsdom`, `@mozilla/readability`, `youtube-transcript`
- Env (all optional, degrade gracefully): `JINA_API_KEY`, `SUPADATA_API_KEY`

### Client-side contract

- After adding, the client polls `/api/library/status?ids=…` (with a cap on attempts)
  and merges patched fields into the card.
- Reader/discuss views fetch `/api/library/content?itemId=…` lazily.
- Failed items show Retry (`/api/library/extract`) and a paste fallback
  (`/api/library/paste`).

---

## Porting checklist for a new project

1. Copy `lib/llm.ts` pattern: provider switch, `askModel` with fence-stripping + one
   retry, friendly error messages, mock provider.
2. K3 routes: `max_tokens` ≥ 4096, `maxDuration = 300` on Vercel.
3. Copy `lib/extract.ts`: UA string, 15s/20s timeouts, 200-char / 100KB thresholds,
   direct→Jina and scrape→Supadata fallback chains, lazy imports, never-throw
   orchestrator.
4. Copy the five `/api/library/*` routes: respond-first-scrape-later via `after()`,
   status polling, inline retry, on-demand content, manual paste.
5. Copy `lib/links.ts` Medium→Freedium rewrite (host list + `readerUrl`).
6. Set env vars; keep every key server-side.
