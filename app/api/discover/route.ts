import { NextResponse } from "next/server";
import { getRequestStorage } from "@/lib/storage";
import { UA } from "@/lib/extract";

// v3.5 source discovery: real search for videos and articles, replacing the
// external search-link chips. Same layering philosophy as extraction — a
// keyed API is the reliable primary, a keyless path keeps the feature alive
// without it — and search failure is never an app error: the client always
// gets 200 + { results } (possibly empty, with a note).
//
// Every host fetched here is fixed and trusted (googleapis / youtube / jina /
// duckduckgo), so the assertPublicHttpUrl SSRF guard isn't needed. If a
// user-configurable search endpoint is ever added, guard it like books.ts.

export const maxDuration = 30;

export type DiscoverResult = {
  title: string;
  url: string;
  source: "youtube-api" | "youtube" | "jina" | "ddg";
  thumbnail?: string;
  channel?: string;
  duration?: string;
  snippet?: string;
  siteName?: string;
};

const MAX_RESULTS = 8;

export async function GET(req: Request) {
  const ctx = await getRequestStorage();
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().slice(0, 200);
  const kind = searchParams.get("kind");
  if (!q) return NextResponse.json({ error: "Missing query." }, { status: 400 });
  if (kind !== "video" && kind !== "article") {
    return NextResponse.json({ error: "kind must be video or article." }, { status: 400 });
  }

  try {
    const results = kind === "video" ? await searchVideos(q) : await searchArticles(q);
    if (results.length === 0) {
      return NextResponse.json({ results, note: "Nothing found — try different words." });
    }
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [], note: "Search is unavailable right now." });
  }
}

// ---------------------------------------------------------------- videos ---

async function searchVideos(q: string): Promise<DiscoverResult[]> {
  if (process.env.YOUTUBE_API_KEY) {
    try {
      const viaApi = await videosViaApi(q, process.env.YOUTUBE_API_KEY);
      if (viaApi.length) return viaApi;
    } catch {
      // quota exhausted / key misconfigured — the scrape below still works
    }
  }
  return videosViaScrape(q);
}

// Primary: the official Data API. search.list costs 100 quota units (free
// tier: 10k/day → ~100 searches), the videos.list duration batch costs 1.
async function videosViaApi(q: string, key: string): Promise<DiscoverResult[]> {
  const searchUrl =
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${MAX_RESULTS}` +
    `&q=${encodeURIComponent(q)}&relevanceLanguage=en&key=${key}`;
  const res = await fetch(searchUrl, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`youtube api ${res.status}`);
  const data = await res.json();
  type SearchItem = {
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      channelTitle?: string;
      thumbnails?: { medium?: { url?: string } };
    };
  };
  const items: SearchItem[] = Array.isArray(data.items) ? data.items : [];
  const results: DiscoverResult[] = [];
  for (const it of items) {
    const id = it.id?.videoId;
    if (!id || !it.snippet?.title) continue;
    results.push({
      // The API returns titles with HTML entities intact ("Rust &amp; Go")
      title: decodeEntities(it.snippet.title),
      url: `https://www.youtube.com/watch?v=${id}`,
      source: "youtube-api",
      thumbnail: it.snippet.thumbnails?.medium?.url,
      channel: it.snippet.channelTitle ? decodeEntities(it.snippet.channelTitle) : undefined,
    });
  }

  // One cheap batch call turns ISO8601 durations into "12:34" badges.
  if (results.length) {
    try {
      const ids = results.map((r) => new URL(r.url).searchParams.get("v")).join(",");
      const dRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${key}`,
        { signal: AbortSignal.timeout(8_000) }
      );
      if (dRes.ok) {
        const dData = await dRes.json();
        const byId = new Map<string, string>();
        for (const v of dData.items ?? []) {
          if (v.id && v.contentDetails?.duration) {
            byId.set(v.id, formatIsoDuration(v.contentDetails.duration));
          }
        }
        for (const r of results) {
          const id = new URL(r.url).searchParams.get("v") ?? "";
          const dur = byId.get(id);
          if (dur) r.duration = dur;
        }
      }
    } catch {
      // durations are decoration — results stand without them
    }
  }
  return results;
}

// Fallback: parse ytInitialData out of the results page. Works from
// residential/local IPs; from datacenter IPs YouTube may hang (same story as
// transcript scraping), hence the hard timeout.
async function videosViaScrape(q: string): Promise<DiscoverResult[]> {
  const res = await fetch(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
    {
      headers: { "user-agent": UA, "accept-language": "en" },
      signal: AbortSignal.timeout(12_000),
    }
  );
  if (!res.ok) throw new Error(`youtube ${res.status}`);
  const html = await res.text();
  const m = html.match(/var ytInitialData = (\{.+?\});<\/script>/s);
  if (!m) return [];
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }

  const results: DiscoverResult[] = [];
  collectVideoRenderers(data, results);
  return results.slice(0, MAX_RESULTS);
}

// ytInitialData nests videoRenderer objects at unstable depths — a recursive
// scan survives layout reshuffles better than a fixed path.
function collectVideoRenderers(node: unknown, out: DiscoverResult[]) {
  if (out.length >= MAX_RESULTS || !node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectVideoRenderers(item, out);
    return;
  }
  const obj = node as Record<string, unknown>;
  const vr = obj.videoRenderer as Record<string, unknown> | undefined;
  if (vr && typeof vr.videoId === "string") {
    const runText = (v: unknown): string => {
      const runs = (v as { runs?: { text?: string }[] } | undefined)?.runs;
      return runs?.[0]?.text ?? "";
    };
    const title =
      runText(vr.title) || (vr.title as { simpleText?: string } | undefined)?.simpleText || "";
    if (title) {
      const thumbs = (vr.thumbnail as { thumbnails?: { url?: string }[] } | undefined)
        ?.thumbnails;
      out.push({
        title,
        url: `https://www.youtube.com/watch?v=${vr.videoId}`,
        source: "youtube",
        thumbnail: thumbs?.[thumbs.length - 1]?.url,
        channel: runText(vr.ownerText) || runText(vr.longBylineText) || undefined,
        duration:
          (vr.lengthText as { simpleText?: string } | undefined)?.simpleText || undefined,
      });
    }
    return; // don't descend into a matched renderer
  }
  for (const value of Object.values(obj)) collectVideoRenderers(value, out);
}

// -------------------------------------------------------------- articles ---

async function searchArticles(q: string): Promise<DiscoverResult[]> {
  if (process.env.JINA_API_KEY) {
    try {
      const viaJina = await articlesViaJina(q, process.env.JINA_API_KEY);
      if (viaJina.length) return viaJina;
    } catch {
      // fall through to DuckDuckGo
    }
  }
  return articlesViaDdg(q);
}

// Primary: Jina search (same account as the r.jina.ai reader fallback).
// X-Respond-With: no-content returns just the SERP — a few hundred tokens
// per search, so the free credit lasts thousands of searches.
async function articlesViaJina(q: string, key: string): Promise<DiscoverResult[]> {
  const res = await fetch(`https://s.jina.ai/?q=${encodeURIComponent(q)}`, {
    headers: {
      authorization: `Bearer ${key}`,
      accept: "application/json",
      "x-respond-with": "no-content",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`jina ${res.status}`);
  const data = await res.json();
  const items: { title?: string; url?: string; description?: string }[] = Array.isArray(
    data.data
  )
    ? data.data
    : [];
  const results: DiscoverResult[] = [];
  for (const it of items) {
    if (!it.url || !it.title || !/^https?:\/\//.test(it.url)) continue;
    results.push({
      title: it.title,
      url: it.url,
      source: "jina",
      snippet: it.description || undefined,
      siteName: hostOf(it.url),
    });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

// Fallback: DuckDuckGo's no-JS HTML endpoint, parsed with the jsdom we
// already ship for Readability. Result links are redirect URLs carrying the
// real target in the uddg param.
async function articlesViaDdg(q: string): Promise<DiscoverResult[]> {
  const { JSDOM } = await import("jsdom");
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
    headers: { "user-agent": UA, accept: "text/html" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`ddg ${res.status}`);
  const html = await res.text();
  const doc = new JSDOM(html).window.document;

  const results: DiscoverResult[] = [];
  for (const row of Array.from(doc.querySelectorAll(".result"))) {
    if (row.classList.contains("result--ad")) continue;
    const a = row.querySelector<HTMLAnchorElement>("a.result__a");
    const rawHref = a?.getAttribute("href") ?? "";
    const title = a?.textContent?.trim() ?? "";
    if (!rawHref || !title) continue;
    const url = ddgTargetUrl(rawHref);
    if (!url) continue;
    results.push({
      title,
      url,
      source: "ddg",
      snippet: row.querySelector(".result__snippet")?.textContent?.trim() || undefined,
      siteName: hostOf(url),
    });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

function ddgTargetUrl(href: string): string {
  try {
    // "//duckduckgo.com/l/?uddg=<encoded>&rut=..." → the encoded target
    const u = new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    const target = uddg ?? (u.hostname.endsWith("duckduckgo.com") ? "" : u.toString());
    if (!target || !/^https?:\/\//.test(target)) return "";
    return target;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------- shared ---

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

// The Data API HTML-escapes text fields; only these few entities appear.
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// "PT1H2M3S" → "1:02:03", "PT12M34S" → "12:34"
function formatIsoDuration(iso: string): string {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return "";
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  return h
    ? `${h}:${String(min).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${min}:${String(s).padStart(2, "0")}`;
}
