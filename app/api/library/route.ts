import { NextResponse } from "next/server";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { YoutubeTranscript } from "youtube-transcript";
import { getRequestStorage } from "@/lib/storage";
import type { LibraryItem } from "@/lib/types";

// Ingestion: paste a URL → we fetch metadata + readable text/transcript and
// save a LibraryItem. No LLM call here. Extraction failure is never fatal:
// the worst case is a link-only card with hasContent=false (plan §4).
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

type Extracted = {
  title: string;
  siteName?: string;
  thumbnail?: string;
  content: string;
};

function youtubeVideoId(u: URL): string | null {
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

async function fetchYouTube(url: string, videoId: string): Promise<Extracted> {
  // Keyless metadata via the public oEmbed endpoint.
  let title = "YouTube video";
  let siteName: string | undefined = "YouTube";
  let thumbnail: string | undefined = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { signal: AbortSignal.timeout(10_000) }
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

  // Transcript via the watch-page caption tracks (youtube-transcript). This
  // has no official API and breaks occasionally — designed-in fallback:
  // hasContent=false and the companion discusses from the title + the
  // learner's own account.
  // Hard 15s budget: from datacenter IPs YouTube often HANGS rather than
  // refuses, and an unbounded wait gets the serverless function killed —
  // the client then receives an HTML error page it can't read.
  let content = "";
  const parts = await Promise.race([
    YoutubeTranscript.fetchTranscript(videoId).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
  ]);
  if (parts) {
    content = parts
      .map((p) => p.text)
      .join(" ")
      .replace(/\[.*?\]/g, " ") // drop [Music]-style markers
      .replace(/\s+/g, " ")
      .trim();
  }
  return { title, siteName, thumbnail, content };
}

async function fetchArticle(url: string): Promise<Extracted> {
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

// Medium articles are paywalled for most readers; the freedium mirror serves
// the same text openly. Rewrite at ingestion and store the mirror URL, so the
// reader's "Original" link also opens the readable version.
const FREEDIUM_MIRROR = "https://freedium-mirror.cfd";

function maybeMirrorMedium(u: URL): { url: string; mirrored: boolean } {
  const host = u.hostname.replace(/^www\./, "");
  if (host === "medium.com" || host.endsWith(".medium.com")) {
    return { url: `${FREEDIUM_MIRROR}/${u.toString()}`, mirrored: true };
  }
  return { url: u.toString(), mirrored: false };
}

export async function POST(req: Request) {
  const ctx = await getRequestStorage();
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const topicId = typeof body.topicId === "string" ? body.topicId : "";
  const rawUrl = typeof body.url === "string" ? body.url.trim() : "";
  if (!topicId) return NextResponse.json({ error: "Missing topicId." }, { status: 400 });

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
  } catch {
    return NextResponse.json({ error: "That doesn't look like a valid URL." }, { status: 400 });
  }

  const { url: effectiveUrl, mirrored } = maybeMirrorMedium(parsed);
  const videoId = youtubeVideoId(parsed);
  const kind: LibraryItem["kind"] = videoId ? "youtube" : "article";
  let extracted: Extracted;
  try {
    extracted = videoId ? await fetchYouTube(effectiveUrl, videoId) : await fetchArticle(effectiveUrl);
  } catch {
    // Link-only card — the learner can still open the URL and discuss it.
    extracted = {
      title: parsed.hostname.replace(/^www\./, ""),
      content: "",
    };
  }
  if (mirrored) extracted.siteName = "Medium";

  // Shorter than this is usually a paywall/JS-wall stub, not real content.
  const hasContent = extracted.content.length > 200;
  try {
    const item = await ctx.storage.addLibraryItem(
      ctx.userId,
      topicId,
      {
        kind,
        url: effectiveUrl,
        title: extracted.title,
        addedAt: new Date().toISOString(),
        status: "unread",
        siteName: extracted.siteName,
        thumbnail: extracted.thumbnail,
        hasContent,
      },
      extracted.content.slice(0, 100_000)
    );
    return NextResponse.json({ item });
  } catch (e) {
    // Surface the real reason (e.g. schema.sql not re-run → missing
    // library_items table) instead of a bare 500 the client can't read.
    const message = e instanceof Error ? e.message : "Could not save the item.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
