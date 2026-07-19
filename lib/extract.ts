// Server-only extraction pipeline shared by the add flow (runs in after(),
// post-response) and the retry route (runs inline). Philosophy unchanged from
// v3.0: extraction failure is never fatal — the worst case is a link-only
// card the learner can still open and discuss.
//
// v3.2 layering: each source gets a direct attempt first, then a delegated
// fallback. The fallbacks exist because Vercel's egress IPs are datacenter
// IPs — YouTube hangs their watch-page scrapes and Freedium slow-walks plain
// fetches — so "try harder locally" cannot work; a service with better IP
// reputation (Jina Reader / Supadata) has to do the fetch.

import type { StorageAdapter } from "./storage";
import type { LibraryItem, TranscriptSegment } from "./types";
import { FREEDIUM_MIRROR } from "./links";

export const HAS_CONTENT_MIN = 200; // shorter is usually a paywall/JS-wall stub
export const CONTENT_CAP = 100_000;

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export type Extracted = {
  title: string;
  siteName?: string;
  thumbnail?: string;
  content: string;
};

export function youtubeVideoId(u: URL): string | null {
  const host = u.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") {
    const id = u.pathname.slice(1).split("/")[0];
    return id || null;
  }
  if (host !== "youtube.com") return null;
  if (u.pathname === "/watch") return u.searchParams.get("v");
  const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/);
  return m ? m[2] : null;
}

// Keyless metadata via the public oEmbed endpoint — fast enough to run
// before the add response goes out, so the card appears with a real title.
export async function quickYouTubeMeta(
  url: string,
  videoId: string
): Promise<Omit<Extracted, "content">> {
  let title = "YouTube video";
  let siteName: string | undefined = "YouTube";
  let thumbnail: string | undefined = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { signal: AbortSignal.timeout(5_000) }
    );
    if (res.ok) {
      const meta = await res.json();
      if (typeof meta.title === "string" && meta.title) title = meta.title;
      if (typeof meta.author_name === "string" && meta.author_name) siteName = meta.author_name;
      if (typeof meta.thumbnail_url === "string" && meta.thumbnail_url) thumbnail = meta.thumbnail_url;
    }
  } catch {
    // keep the fallbacks above
  }
  return { title, siteName, thumbnail };
}

// v3.4: transcripts are stored as JSON segments ({ t: seconds, text }) so the
// reader can render tappable timestamps. buildTranscript normalizes raw cue
// offsets to seconds — the youtube-transcript package returns ms on its
// InnerTube path but seconds on its classic-caption path, and Supadata returns
// ms, so we detect the unit from the median gap between cues (real cues are a
// few seconds apart; a median gap over 100 means the values are milliseconds).
function buildTranscript(raw: { o: number; text: string }[]): string {
  const cues = raw.filter((r) => r.text);
  if (!cues.length) return "";
  const gaps: number[] = [];
  for (let i = 1; i < cues.length; i++) {
    const g = cues[i].o - cues[i - 1].o;
    if (g > 0) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  const isMs = median > 100;
  const segs: TranscriptSegment[] = cues.map((r) => ({
    t: Math.max(0, Math.floor(isMs ? r.o / 1000 : r.o)),
    text: r.text,
  }));
  // Keep the serialized transcript under CONTENT_CAP by dropping trailing
  // segments (a >100KB transcript means a multi-hour video).
  let json = JSON.stringify(segs);
  while (json.length > CONTENT_CAP && segs.length > 1) {
    segs.splice(Math.floor(segs.length * 0.9));
    json = JSON.stringify(segs);
  }
  return json;
}

const cleanCue = (s: string) =>
  s.replace(/\[.*?\]/g, " ").replace(/\s+/g, " ").trim(); // drop [Music]-style markers

// Attempt 1: scrape the watch-page caption tracks (works from residential
// IPs / local dev). Hard 15s budget — from datacenter IPs YouTube often
// HANGS rather than refuses. Lazy import so a packaging failure costs the
// transcript, not the function.
async function transcriptViaScrape(videoId: string): Promise<string> {
  // fetchTranscript picks captionTracks[0] when no lang is given, which can be
  // a translated/non-English track. Prefer English variants, then fall back to
  // the default track so a genuinely non-English video still yields something.
  // (Requesting a missing lang throws, hence the try-each cascade.)
  const fetchParts = (lang?: string) =>
    import("youtube-transcript")
      .then(({ YoutubeTranscript }) =>
        YoutubeTranscript.fetchTranscript(videoId, lang ? { lang } : undefined)
      )
      .catch(() => null);
  const preferred = (async () => {
    for (const lang of ["en", "en-US", "en-GB", undefined]) {
      const p = await fetchParts(lang);
      if (p && p.length) return p;
    }
    return null;
  })();
  const parts = await Promise.race([
    preferred,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
  ]);
  if (!parts) return "";
  return buildTranscript(
    parts.map((p) => ({ o: Number(p.offset ?? 0), text: cleanCue(String(p.text ?? "")) }))
  );
}

// Attempt 2: Supadata (residential-proxy transcript API; free tier).
// GET /v1/youtube/transcript?videoId= → { content: [{ text, offset, duration }] };
// 206 means "video has no transcript" — a real answer, not an error. We omit
// text=true so the response carries per-cue offsets for the timestamped reader.
async function transcriptViaSupadata(videoId: string): Promise<string> {
  const key = process.env.SUPADATA_API_KEY;
  if (!key) return "";
  try {
    const res = await fetch(
      `https://api.supadata.ai/v1/youtube/transcript?videoId=${encodeURIComponent(videoId)}&lang=en`,
      { headers: { "x-api-key": key }, signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) return "";
    const data = await res.json();
    if (Array.isArray(data.content)) {
      return buildTranscript(
        data.content.map((c: { text?: unknown; offset?: unknown }) => ({
          o: Number(c.offset ?? 0),
          text: cleanCue(String(c.text ?? "")),
        }))
      );
    }
    // Fallback: some responses return a flat string (no per-cue timing).
    return typeof data.content === "string" ? cleanCue(data.content) : "";
  } catch {
    return "";
  }
}

// Fetching user-supplied URLs server-side is the product feature here, but it
// must never become a bridge to internal addresses (matters most when
// self-hosted rather than on Vercel). Cheap SSRF guard: http(s) only, and no
// loopback/link-local/private hosts.
export function assertPublicHttpUrl(url: string): void {
  const u = new URL(url);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("unsupported URL scheme");
  const host = u.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1" ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^f[cde]/.test(host) // fc00::/7 + fe80::/10 IPv6 literals
  ) {
    throw new Error("that address can't be fetched");
  }
}

// v3.4 rich reader: store the article as sanitized HTML so the in-app reader
// keeps headings, lists, blockquotes and images instead of a flat wall of
// text. Sanitization is the security boundary (the reader renders this with
// dangerouslySetInnerHTML), so it is a strict allow-list: unknown tags are
// unwrapped, dangerous tags dropped, every attribute stripped except safe
// href/src/alt, and all URLs resolved to absolute http(s). Images are
// hotlinked by URL — no bytes are ever stored, so DB size is unchanged.
type JSDOMCtor = (typeof import("jsdom"))["JSDOM"];

const ARTICLE_ALLOWED_TAGS = new Set([
  "P", "BR", "HR", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI",
  "BLOCKQUOTE", "PRE", "CODE", "A", "IMG", "FIGURE", "FIGCAPTION", "STRONG",
  "EM", "B", "I", "U", "S", "SUP", "SUB", "MARK", "SPAN", "DIV", "SECTION",
  "ARTICLE", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD",
]);
const ARTICLE_DROP_TAGS = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "LINK", "META",
  "NOSCRIPT", "SVG", "CANVAS", "INPUT", "BUTTON", "SELECT", "TEXTAREA",
  "VIDEO", "AUDIO", "HEAD", "TITLE",
]);
const ARTICLE_ALLOWED_ATTR: Record<string, Set<string>> = {
  A: new Set(["href"]),
};

function absoluteHttpUrl(raw: string, baseUrl: string): string {
  try {
    const abs = new URL(raw, baseUrl);
    return abs.protocol === "http:" || abs.protocol === "https:" ? abs.toString() : "";
  } catch {
    return "";
  }
}

function sanitizeArticleHtml(html: string, baseUrl: string, JSDOM: JSDOMCtor): string {
  const doc = new JSDOM(`<!DOCTYPE html><body>${html}</body>`, { url: baseUrl }).window.document;
  const body = doc.body;

  const clean = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) continue; // text node — keep
      if (child.nodeType !== 1) {
        child.parentNode?.removeChild(child); // comments etc.
        continue;
      }
      const el = child as unknown as Element;
      const tag = el.tagName.toUpperCase();
      if (ARTICLE_DROP_TAGS.has(tag)) {
        el.remove();
        continue;
      }
      clean(el); // depth-first so unwrapping preserves already-cleaned children
      if (!ARTICLE_ALLOWED_TAGS.has(tag)) {
        const parent = el.parentNode;
        if (parent) {
          while (el.firstChild) parent.insertBefore(el.firstChild, el);
          parent.removeChild(el);
        }
        continue;
      }
      if (tag === "IMG") {
        // Lazy-loaded images hide the real URL in data-* / srcset; grab it
        // before wiping attributes, then keep only a resolved src + alt.
        const cand =
          el.getAttribute("data-src") ||
          el.getAttribute("data-original") ||
          el.getAttribute("data-lazy-src") ||
          el.getAttribute("src") ||
          (el.getAttribute("srcset") || "").split(",")[0]?.trim().split(/\s+/)[0] ||
          "";
        const alt = el.getAttribute("alt") || "";
        const src = cand ? absoluteHttpUrl(cand, baseUrl) : "";
        for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);
        if (!src) {
          el.remove();
          continue;
        }
        el.setAttribute("src", src);
        if (alt) el.setAttribute("alt", alt);
        el.setAttribute("loading", "lazy");
        continue;
      }
      const allowed = ARTICLE_ALLOWED_ATTR[tag];
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on") || !allowed || !allowed.has(name)) el.removeAttribute(attr.name);
      }
      if (tag === "A") {
        const safe = absoluteHttpUrl(el.getAttribute("href") || "", baseUrl);
        if (safe) {
          el.setAttribute("href", safe);
          el.setAttribute("target", "_blank");
          el.setAttribute("rel", "noreferrer");
        } else {
          el.removeAttribute("href");
        }
      }
    }
  };
  clean(body);

  // Truncate at block boundaries so a stored article never ends mid-tag.
  while (body.lastChild && body.innerHTML.length > CONTENT_CAP) body.removeChild(body.lastChild);
  return body.innerHTML.trim();
}

// Attempt 1: fetch + Readability, exactly as v3.0/3.1 did. jsdom/Readability
// load lazily so a packaging failure surfaces as a thrown error (→ fallback),
// not a dead route module.
async function articleViaDirectFetch(url: string): Promise<Extracted> {
  assertPublicHttpUrl(url);
  const [{ JSDOM }, { Readability }] = await Promise.all([
    import("jsdom"),
    import("@mozilla/readability"),
  ]);
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`page returned ${res.status}`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > 5_000_000) throw new Error("page too large");
  const html = await res.text();

  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;
  const og = (property: string) =>
    doc.querySelector(`meta[property="${property}"]`)?.getAttribute("content") ?? undefined;

  const article = new Readability(doc).parse();
  const host = new URL(url).hostname.replace(/^www\./, "");
  const textLen = (article?.textContent ?? "").trim().length;
  // Rich HTML when the body is substantial; otherwise plain text, which stays
  // below HAS_CONTENT_MIN and lets the Jina fallback take over (unchanged flow).
  const content =
    article?.content && textLen > HAS_CONTENT_MIN
      ? sanitizeArticleHtml(article.content, url, JSDOM)
      : (article?.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
  return {
    title: (article?.title || doc.title || host).trim(),
    siteName: article?.siteName || og("og:site_name") || host,
    thumbnail: og("og:image"),
    content,
  };
}

// Attempt 2: Jina Reader — GET r.jina.ai/<url> returns readable text with
// "Title:" / "URL Source:" / "Markdown Content:" header lines. Keyless works
// (rate-limited); JINA_API_KEY raises limits.
async function articleViaJina(url: string): Promise<Extracted> {
  const headers: Record<string, string> = { accept: "text/plain" };
  if (process.env.JINA_API_KEY) headers.authorization = `Bearer ${process.env.JINA_API_KEY}`;
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`jina returned ${res.status}`);
  const body = (await res.text()).trim();

  const host = new URL(url).hostname.replace(/^www\./, "");
  let title = host;
  let content = body;
  const titleMatch = body.match(/^Title:\s*(.+)$/m);
  if (titleMatch) title = titleMatch[1].trim();
  const marker = body.indexOf("Markdown Content:");
  if (marker !== -1) content = body.slice(marker + "Markdown Content:".length).trim();
  return { title, siteName: host, content };
}

export async function extractContent(
  url: string,
  kind: "article" | "youtube",
  videoId: string | null
): Promise<Extracted> {
  if (kind === "youtube" && videoId) {
    const meta = await quickYouTubeMeta(url, videoId);
    let content = await transcriptViaScrape(videoId);
    if (!content) content = await transcriptViaSupadata(videoId);
    return { ...meta, content };
  }

  let direct: Extracted | null = null;
  try {
    direct = await articleViaDirectFetch(url);
  } catch {
    // fall through to Jina
  }
  if (direct && direct.content.length > HAS_CONTENT_MIN) return direct;
  try {
    const jina = await articleViaJina(url);
    // The direct fetch may have gotten real metadata (og:image, site name)
    // even when the text was walled — keep it and let Jina fill the content.
    if (direct) {
      return {
        title: direct.title || jina.title,
        siteName: direct.siteName ?? jina.siteName,
        thumbnail: direct.thumbnail,
        content: jina.content,
      };
    }
    return jina;
  } catch {
    if (direct) return direct; // thin, but better than nothing
    throw new Error("could not fetch the page");
  }
}

// Freedium suffixes its own name onto page titles; the mirror is always
// "Medium" content.
function polishMirrored(extracted: Extracted, url: string): Extracted {
  if (!url.startsWith(`${FREEDIUM_MIRROR}/`)) return extracted;
  return {
    ...extracted,
    siteName: "Medium",
    title: extracted.title.replace(/\s*[-–|]\s*Freedium\s*$/i, ""),
  };
}

export type ExtractPatch = Partial<
  Pick<LibraryItem, "title" | "siteName" | "thumbnail" | "hasContent" | "extraction">
>;

// Orchestrator shared by the after() background job and the retry route.
// Runs the pipeline, patches the stored item to a terminal state, and returns
// the patch so inline callers can hand the client the updated fields without
// a re-load. Never throws.
export async function extractAndStore(
  storage: StorageAdapter,
  userId: string,
  item: { id: string; url: string; kind: "article" | "youtube" }
): Promise<ExtractPatch> {
  try {
    const videoId = item.kind === "youtube" ? youtubeVideoId(new URL(item.url)) : null;
    const extracted = polishMirrored(await extractContent(item.url, item.kind, videoId), item.url);
    const hasContent = extracted.content.length > HAS_CONTENT_MIN;
    const patch: ExtractPatch = {
      hasContent,
      extraction: hasContent ? "ok" : "failed",
    };
    // Only overwrite provisional metadata with real values — never clobber a
    // good oEmbed title with an empty failure.
    if (extracted.title) patch.title = extracted.title;
    if (extracted.siteName) patch.siteName = extracted.siteName;
    if (extracted.thumbnail) patch.thumbnail = extracted.thumbnail;
    await storage.updateLibraryItem(userId, item.id, patch, extracted.content.slice(0, CONTENT_CAP));
    return patch;
  } catch {
    const patch: ExtractPatch = { extraction: "failed" };
    try {
      await storage.updateLibraryItem(userId, item.id, patch);
    } catch {
      // storage briefly unavailable — the item stays "pending"; the client's
      // poll cap surfaces it as stuck rather than looping forever.
    }
    return patch;
  }
}
