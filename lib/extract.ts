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
import type { LibraryItem } from "./types";
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

// Attempt 1: scrape the watch-page caption tracks (works from residential
// IPs / local dev). Hard 15s budget — from datacenter IPs YouTube often
// HANGS rather than refuses. Lazy import so a packaging failure costs the
// transcript, not the function.
async function transcriptViaScrape(videoId: string): Promise<string> {
  const parts = await Promise.race([
    import("youtube-transcript")
      .then(({ YoutubeTranscript }) => YoutubeTranscript.fetchTranscript(videoId))
      .catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
  ]);
  if (!parts) return "";
  return parts
    .map((p) => p.text)
    .join(" ")
    .replace(/\[.*?\]/g, " ") // drop [Music]-style markers
    .replace(/\s+/g, " ")
    .trim();
}

// Attempt 2: Supadata (residential-proxy transcript API; free tier).
// GET /v1/youtube/transcript?videoId=&text=true → { content: string };
// 206 means "video has no transcript" — a real answer, not an error.
async function transcriptViaSupadata(videoId: string): Promise<string> {
  const key = process.env.SUPADATA_API_KEY;
  if (!key) return "";
  try {
    const res = await fetch(
      `https://api.supadata.ai/v1/youtube/transcript?videoId=${encodeURIComponent(videoId)}&text=true`,
      { headers: { "x-api-key": key }, signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) return "";
    const data = await res.json();
    return typeof data.content === "string" ? data.content.replace(/\s+/g, " ").trim() : "";
  } catch {
    return "";
  }
}

// Attempt 1: fetch + Readability, exactly as v3.0/3.1 did. jsdom/Readability
// load lazily so a packaging failure surfaces as a thrown error (→ fallback),
// not a dead route module.
async function articleViaDirectFetch(url: string): Promise<Extracted> {
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
  return {
    title: (article?.title || doc.title || host).trim(),
    siteName: article?.siteName || og("og:site_name") || host,
    thumbnail: og("og:image"),
    content: (article?.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim(),
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
