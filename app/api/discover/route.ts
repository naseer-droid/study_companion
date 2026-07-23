import { NextResponse } from "next/server";
import { getRequestStorage } from "@/lib/storage";
import { UA } from "@/lib/extract";
import { urlKey } from "@/lib/links";

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
  source: "youtube-api" | "youtube" | "jina" | "ddg" | "devto" | "wikipedia";
  thumbnail?: string;
  channel?: string;
  duration?: string;
  views?: number; // video view count (best-effort)
  ageText?: string; // relative upload age from the scrape path ("3 years ago")
  publishedAt?: string; // ISO upload date from the API path
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
      publishedAt?: string;
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
      publishedAt: it.snippet.publishedAt || undefined,
    });
  }

  // One cheap batch call adds duration ("12:34") + view counts — statistics and
  // contentDetails ride the same 1-unit videos.list request.
  if (results.length) {
    try {
      const ids = results.map((r) => new URL(r.url).searchParams.get("v")).join(",");
      const dRes = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${ids}&key=${key}`,
        { signal: AbortSignal.timeout(8_000) }
      );
      if (dRes.ok) {
        const dData = await dRes.json();
        const byId = new Map<string, { duration?: string; views?: number }>();
        for (const v of dData.items ?? []) {
          if (!v.id) continue;
          const views = v.statistics?.viewCount ? Number(v.statistics.viewCount) : undefined;
          byId.set(v.id, {
            duration: v.contentDetails?.duration ? formatIsoDuration(v.contentDetails.duration) : undefined,
            views: Number.isFinite(views) ? views : undefined,
          });
        }
        for (const r of results) {
          const id = new URL(r.url).searchParams.get("v") ?? "";
          const stat = byId.get(id);
          if (stat?.duration) r.duration = stat.duration;
          if (stat?.views !== undefined) r.views = stat.views;
        }
      }
    } catch {
      // stats are decoration — results stand without them
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
      const simpleOrRun = (v: unknown): string =>
        (v as { simpleText?: string } | undefined)?.simpleText || runText(v);
      const viewText = simpleOrRun(vr.shortViewCountText); // "1.2M views"
      out.push({
        title,
        url: `https://www.youtube.com/watch?v=${vr.videoId}`,
        source: "youtube",
        thumbnail: thumbs?.[thumbs.length - 1]?.url,
        channel: runText(vr.ownerText) || runText(vr.longBylineText) || undefined,
        duration:
          (vr.lengthText as { simpleText?: string } | undefined)?.simpleText || undefined,
        views: parseCompactCount(viewText),
        ageText: simpleOrRun(vr.publishedTimeText) || undefined, // "3 years ago"
      });
    }
    return; // don't descend into a matched renderer
  }
  for (const value of Object.values(obj)) collectVideoRenderers(value, out);
}

// -------------------------------------------------------------- articles ---

// Multi-source (v3.7): a general web SERP plus Medium, dev.to and Wikipedia,
// each independent and best-effort. allSettled means one slow/failed source
// never sinks the others; the client groups results by siteName.
async function searchArticles(q: string): Promise<DiscoverResult[]> {
  const settled = await Promise.allSettled([
    webArticles(q),
    mediumArticles(q),
    devtoArticles(q),
    wikipediaArticles(q),
  ]);
  // De-dup across sources by canonical URL: the web SERP and a dedicated source
  // (Medium/Wikipedia/dev.to) often return the same page, which otherwise shows
  // as a repeated row + a duplicate React key. Keep the first occurrence.
  const merged: DiscoverResult[] = [];
  const seen = new Set<string>();
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value) {
      const key = urlKey(item.url);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}

// The general "Web" group: the keyed Jina SERP, DuckDuckGo when it's absent.
async function serpArticles(q: string): Promise<DiscoverResult[]> {
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

async function webArticles(q: string): Promise<DiscoverResult[]> {
  return (await serpArticles(q)).slice(0, 6);
}

// Medium: the same SERP scoped to medium.com. Ingestion already rewrites
// Medium → Freedium, so these read in-app after adding.
async function mediumArticles(q: string): Promise<DiscoverResult[]> {
  const r = await serpArticles(`site:medium.com ${q}`);
  return r
    .filter((x) => hostOf(x.url)?.includes("medium.com"))
    .slice(0, 6)
    .map((x) => ({ ...x, siteName: "Medium" }));
}

// dev.to: real keyless JSON API. Tag search first (best guess from the query),
// then top-of-week as a fallback so tech topics still surface something.
async function devtoArticles(q: string): Promise<DiscoverResult[]> {
  type DevtoArticle = { title?: string; url?: string; description?: string; cover_image?: string };
  const fetchList = async (path: string): Promise<DevtoArticle[]> => {
    const res = await fetch(`https://dev.to/api/articles${path}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`dev.to ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  };
  const tag = q.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 30);
  let list: DevtoArticle[] = [];
  if (tag) {
    try {
      list = await fetchList(`?per_page=8&tag=${encodeURIComponent(tag)}`);
    } catch {
      list = [];
    }
  }
  if (!list.length) list = await fetchList(`?per_page=8&top=7`);
  const results: DiscoverResult[] = [];
  for (const a of list) {
    if (!a.url || !a.title) continue;
    results.push({
      title: a.title,
      url: a.url,
      source: "devto",
      snippet: a.description || undefined,
      thumbnail: a.cover_image || undefined,
      siteName: "dev.to",
    });
    if (results.length >= 6) break;
  }
  return results;
}

// Wikipedia: keyless REST search. Evergreen background reading for a topic.
async function wikipediaArticles(q: string): Promise<DiscoverResult[]> {
  const res = await fetch(
    `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(q)}&limit=5`,
    { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(10_000) }
  );
  if (!res.ok) throw new Error(`wikipedia ${res.status}`);
  const data = await res.json();
  type WikiPage = {
    key?: string;
    title?: string;
    excerpt?: string;
    description?: string;
    thumbnail?: { url?: string };
  };
  const pages: WikiPage[] = Array.isArray(data.pages) ? data.pages : [];
  const results: DiscoverResult[] = [];
  for (const p of pages) {
    if (!p.key || !p.title) continue;
    const excerpt = (p.excerpt || p.description || "").replace(/<[^>]+>/g, "").trim();
    const thumb = p.thumbnail?.url
      ? p.thumbnail.url.startsWith("//")
        ? `https:${p.thumbnail.url}`
        : p.thumbnail.url
      : undefined;
    results.push({
      title: p.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.key)}`,
      source: "wikipedia",
      snippet: excerpt || undefined,
      thumbnail: thumb,
      siteName: "Wikipedia",
    });
  }
  return results;
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

// "1.2M views" → 1200000, "1,234 views" → 1234, "No views" → undefined.
function parseCompactCount(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase()] ?? 1;
  return Math.round(n * mult);
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
