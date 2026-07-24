import Anthropic from "@anthropic-ai/sdk";

// One model call: prompt in, parsed JSON out (handoff §3).
// Provider is chosen by env: Kimi K3 by default, with DeepSeek/OpenRouter
// and the native Anthropic API as alternates.

const MAX_TOKENS = 1024;

class LlmError extends Error {}

function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

async function callOpenAiCompatible(prompt: string, baseUrl: string, defaultModel: string, maxTokens = MAX_TOKENS): Promise<string> {
  const apiKey = env("LLM_API_KEY");
  if (!apiKey) throw new LlmError("LLM_API_KEY is not set. Add it to .env.local.");
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: env("LLM_MODEL", defaultModel),
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new LlmError(`Model provider returned ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new LlmError("Model provider returned no text.");
  return text;
}

async function callAnthropic(prompt: string, maxTokens = MAX_TOKENS): Promise<string> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  const response = await client.messages.create({
    model: env("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

// Canned responses so the full UI loop can be exercised without a key.
function callMock(prompt: string): string {
  if (prompt.includes("helping someone start learning a new topic")) {
    return JSON.stringify({
      brief: "This is a mock brief for local testing. The topic is introduced in plain language across a few sentences so the layout can be checked.",
      whyItMatters: "It matters because verifying the app end-to-end should not require API credits.",
      roadmap: [
        { title: "Foundations", desc: "Learn the core vocabulary and ideas." },
        { title: "First practice", desc: "Do one small hands-on exercise." },
        { title: "Core techniques", desc: "Work through the main methods." },
        { title: "Small project", desc: "Build something end to end." },
        { title: "Review and deepen", desc: "Revisit weak spots and go deeper." },
      ],
      resources: [
        { title: "A Well-Known Book", type: "book", why: "The standard beginner text." },
        { title: "A Popular Course", type: "course", why: "Structured and hands-on." },
        { title: "An Official Website", type: "website", why: "Authoritative reference." },
        { title: "A YouTube Channel", type: "video", why: "Good visual explanations." },
      ],
      firstStep: "Spend 20 minutes reading an introductory article and note three things that surprised you.",
    });
  }
  if (prompt.includes("The learner just shared")) {
    return JSON.stringify({
      reply: "Nice — you got the first idea down. I hadn't thought about it that way; I wonder how it connects to what we saw earlier?",
      updatedMemory: "Mock memory: the learner has made one or more journal entries and we are tracking their progress together.",
      nextSuggestion: "Tomorrow, try a 15-minute practical exercise on what you just learned.",
    });
  }
  // AI organize (v3.9) mock: returns raw Markdown (askModelText path), not JSON.
  if (prompt.includes("reformat or rewrite this saved article")) {
    return "## Mock organized result\n\nThis is a **mock** tidy of the article. The key idea is stated plainly, then:\n\n- a first point\n- a second point\n\n> A short takeaway to close.\n";
  }
  // Study Room (v3.0) mock branches — keyed on distinctive prompt substrings.
  if (prompt.includes("just spent time with this")) {
    return JSON.stringify({
      reply: "Mock discussion reply: that's a fair reading of it — the part you mention connects to the main argument near the end. What did you make of the author's example?",
      updatedMemory: "Mock memory: the learner saved an item to the library and we discussed its key ideas together.",
    });
  }
  if (prompt.includes("welcoming the learner back")) {
    return JSON.stringify({
      greeting: "Mock greeting: last time we were working through the middle stages — want to pick up there, or revisit what felt shaky?",
    });
  }
  // Book suggestions (v3.7) mock: a real public-domain title (so the Gutendex
  // resolve + in-app Add path is exercised without a key) plus a modern one
  // (which stays a link-only "save/find a copy" card).
  if (prompt.includes("best books to read for")) {
    return JSON.stringify({
      books: [
        { title: "Pride and Prejudice", author: "Jane Austen", why: "A readable public-domain classic to warm up on." },
        { title: "The Pragmatic Programmer", author: "Andrew Hunt", why: "A modern standard text for the topic." },
      ],
    });
  }
  return JSON.stringify({
    answer: "Mock answer: in plain terms, the thing you asked about works by combining a few simple parts. For example, imagine a tiny version of it with just two pieces.",
    updatedMemory: "Mock memory: the learner asked a question and we noted the key takeaway.",
    followUp: "What happens in the edge case we haven't covered yet?",
  });
}

async function callProvider(prompt: string, maxTokens?: number): Promise<string> {
  const provider = env("LLM_PROVIDER", "kimi").toLowerCase();
  switch (provider) {
    case "anthropic":
      return callAnthropic(prompt, maxTokens);
    case "kimi":
    case "moonshot":
      // Kimi Code endpoint (API key from the Kimi Code Console, uses the
      // membership quota). For the pay-as-you-go Open Platform instead, set
      // LLM_BASE_URL=https://api.moonshot.cn/v1 and its LLM_MODEL slug.
      // K3 reasons before answering and reasoning shares the completion
      // budget — at 1024 tokens thinking consumes it all (empty reply).
      return callOpenAiCompatible(prompt, env("LLM_BASE_URL", "https://api.kimi.com/coding/v1"), "k3", maxTokens ?? 4096);
    case "deepseek":
      return callOpenAiCompatible(prompt, "https://api.deepseek.com", "deepseek-chat", maxTokens ?? MAX_TOKENS);
    case "openrouter":
      return callOpenAiCompatible(prompt, "https://openrouter.ai/api/v1", "anthropic/claude-sonnet-4.6", maxTokens ?? MAX_TOKENS);
    case "mock":
      return callMock(prompt);
    default:
      throw new LlmError(`Unknown LLM_PROVIDER "${provider}".`);
  }
}

function parseJson(text: string): unknown {
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

/**
 * Ask the configured model and parse its JSON response.
 * On a parse failure, retries the model call once (handoff §3), then throws
 * a friendly error the API routes can surface verbatim.
 */
export async function askModel(prompt: string): Promise<unknown> {
  let text = await callProvider(prompt);
  try {
    return parseJson(text);
  } catch {
    text = await callProvider(prompt);
    try {
      return parseJson(text);
    } catch {
      throw new LlmError("The companion's response wasn't readable. Please try again.");
    }
  }
}

/**
 * Ask the configured model for free-form TEXT (not JSON). Used by the reader's
 * "organize with AI", where the result is a rewritten Markdown article — large
 * and full of quotes/newlines/backticks that are fragile to escape inside JSON.
 * Callers pass a generous token budget since a whole tidied article is long.
 */
export async function askModelText(prompt: string, maxTokens?: number): Promise<string> {
  const text = await callProvider(prompt, maxTokens);
  return typeof text === "string" ? text : "";
}

export function errorMessage(e: unknown): string {
  if (e instanceof LlmError) return e.message;
  if (e instanceof Error && e.message) return `Couldn't reach the companion: ${e.message}`;
  return "Couldn't reach the companion. Check your connection and try again.";
}
