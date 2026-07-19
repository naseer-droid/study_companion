// Server-only book streaming (v3.2). Books are NEVER stored in the database —
// a library item holds only metadata + a source pointer, and this module
// resolves that pointer to text at read time: Gutenberg plain-text files,
// or link-shared Google Drive ebooks (.txt / .epub). Open Library items have
// no full text and stay link-only cards.

import type { StorageAdapter } from "./storage";
import type { BookSource, LibraryItem } from "./types";
import { assertPublicHttpUrl, UA } from "./extract";

export const BOOK_CHUNK = 18_000; // chars per reader "page"
const DRIVE_CAP = 25_000_000; // bytes — parsing happens in memory

// ---------------------------------------------------------------------------
// Google Drive
// ---------------------------------------------------------------------------

// Accepts the shapes a "copy link" can take:
//   drive.google.com/file/d/<ID>/view, /open?id=<ID>, /uc?id=<ID>
export function driveFileId(u: URL): string | null {
  const host = u.hostname.replace(/^www\./, "");
  if (host !== "drive.google.com" && host !== "docs.google.com") return null;
  const m = u.pathname.match(/^\/file\/d\/([\w-]{10,})/);
  if (m) return m[1];
  if (u.pathname === "/open" || u.pathname === "/uc") {
    const id = u.searchParams.get("id");
    if (id && /^[\w-]{10,}$/.test(id)) return id;
  }
  return null;
}

// Fetch a link-shared Drive file. Small files come straight back; large ones
// return an HTML virus-scan interstitial whose <form> carries the real
// download URL + confirm tokens — parse and follow it.
export async function fetchDriveFile(
  fileId: string
): Promise<{ bytes: Uint8Array; filename?: string }> {
  const first = await fetch(
    `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
    { redirect: "follow", signal: AbortSignal.timeout(30_000) }
  );
  if (!first.ok) throw new Error(`drive returned ${first.status}`);

  let res = first;
  if ((first.headers.get("content-type") ?? "").includes("text/html")) {
    const html = await first.text();
    const action = html.match(/<form[^>]+action="([^"]+)"/)?.[1];
    if (!action) throw new Error("drive file is not link-shared (or was removed)");
    // The form action comes out of HTML we fetched — only follow it back into
    // Google's own domains (SSRF guard on attacker-shaped interstitials).
    const next = new URL(action.replace(/&amp;/g, "&"), "https://drive.google.com");
    const nextHost = next.hostname.toLowerCase().replace(/\.$/, "");
    if (next.protocol !== "https:" || (nextHost !== "google.com" && !nextHost.endsWith(".google.com"))) {
      throw new Error("unexpected drive redirect");
    }
    const params = new URLSearchParams(next.search);
    for (const input of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) {
      params.set(input[1], input[2]);
    }
    next.search = params.toString();
    res = await fetch(next, {
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`drive download returned ${res.status}`);
  }

  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > DRIVE_CAP) throw new Error("ebook too large (25MB max)");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > DRIVE_CAP) throw new Error("ebook too large (25MB max)");

  const disposition = res.headers.get("content-disposition") ?? "";
  const filename =
    disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1] ??
    disposition.match(/filename="([^"]+)"/)?.[1];
  return { bytes, filename: filename ? decodeURIComponent(filename) : undefined };
}

// ---------------------------------------------------------------------------
// Generic public URL (v3.4): a .txt/.epub file the learner supplies —
// Standard Ebooks, archive.org public-domain, or self-hosted. The SSRF guard
// (http/https + public IPs only, re-checked on every redirect hop) is the
// security boundary; nothing is stored, capped at the same 25MB as Drive.
// ---------------------------------------------------------------------------
// Fetch a URL following 3xx redirects manually — re-validating every hop so a
// redirect can't bounce the fetch to a private address (archive.org, for one,
// redirects downloads to a CDN node).
async function fetchFollowing(url: string): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    assertPublicHttpUrl(current);
    const res = await fetch(current, {
      redirect: "manual",
      headers: { "user-agent": UA, accept: "*/*" },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error("too many redirects");
}

async function readCapped(res: Response): Promise<Uint8Array> {
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > DRIVE_CAP) throw new Error("ebook too large (25MB max)");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > DRIVE_CAP) throw new Error("ebook too large (25MB max)");
  return bytes;
}

export async function fetchRemoteFile(url: string): Promise<Uint8Array> {
  let res = await fetchFollowing(url);
  if (!res.ok) throw new Error(`source returned ${res.status}`);
  let bytes = await readCapped(res);
  // Some hosts serve an HTML "your download has started" interstitial with a
  // <meta http-equiv="refresh"> to the real file (Standard Ebooks does this).
  // Follow that once, re-validating the target.
  const ctype = res.headers.get("content-type") || "";
  if (sniffFormat(bytes) !== "epub" && /html|xml/i.test(ctype)) {
    const meta = decodeText(bytes).match(
      /http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"'>\s]+)/i
    );
    if (meta) {
      const next = new URL(meta[1].replace(/&amp;/g, "&"), url).toString();
      res = await fetchFollowing(next);
      if (!res.ok) throw new Error(`source returned ${res.status}`);
      bytes = await readCapped(res);
    }
  }
  return bytes;
}

function sniffFormat(bytes: Uint8Array): "epub" | "txt" {
  // Zip magic "PK\x03\x04" → epub; anything else is treated as text.
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
    ? "epub"
    : "txt";
}

function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  // A high density of replacement chars means it wasn't UTF-8 — most older
  // ebook text files are latin-1.
  const bad = (utf8.match(/�/g) ?? []).length;
  if (bad > utf8.length / 1000) {
    return new TextDecoder("iso-8859-1").decode(bytes);
  }
  return utf8;
}

// ---------------------------------------------------------------------------
// EPUB parsing: an EPUB is a ZIP of XHTML chapters. Reading order lives in
// the OPF's <spine>; the OPF path lives in META-INF/container.xml.
// ---------------------------------------------------------------------------

async function epubChapters(bytes: Uint8Array): Promise<{ chapters: string[]; title?: string }> {
  const [{ unzipSync }, { JSDOM }] = await Promise.all([import("fflate"), import("jsdom")]);
  const files = unzipSync(bytes);
  const text = (path: string) => {
    const f = files[path];
    if (!f) throw new Error(`epub is missing ${path}`);
    return new TextDecoder("utf-8").decode(f);
  };
  const xml = (s: string) =>
    new JSDOM(s, { contentType: "application/xml" }).window.document;

  const container = xml(text("META-INF/container.xml"));
  const opfPath = container
    .querySelector("rootfile")
    ?.getAttribute("full-path");
  if (!opfPath) throw new Error("epub has no rootfile");
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  const opf = xml(text(opfPath));
  const title =
    opf.getElementsByTagNameNS("http://purl.org/dc/elements/1.1/", "title")[0]?.textContent?.trim() ||
    undefined;

  // manifest id → href, spine gives the reading order.
  const manifest = new Map<string, { href: string; type: string }>();
  for (const item of opf.querySelectorAll("manifest > item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) {
      manifest.set(id, { href, type: item.getAttribute("media-type") ?? "" });
    }
  }

  // Resolve hrefs relative to the OPF's directory; hrefs may be url-encoded
  // and may climb with "../".
  const resolve = (href: string) => {
    const parts = `${opfDir}${decodeURIComponent(href.split("#")[0])}`.split("/");
    const out: string[] = [];
    for (const p of parts) {
      if (p === "..") out.pop();
      else if (p !== "." && p !== "") out.push(p);
    }
    return out.join("/");
  };

  const chapters: string[] = [];
  for (const ref of opf.querySelectorAll("spine > itemref")) {
    const id = ref.getAttribute("idref");
    const entry = id ? manifest.get(id) : undefined;
    if (!entry || !/x?html/.test(entry.type)) continue;
    const path = resolve(entry.href);
    if (!files[path]) continue;
    const doc = new JSDOM(new TextDecoder("utf-8").decode(files[path])).window.document;
    const body = (doc.body?.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (body) chapters.push(body);
  }
  if (!chapters.length) throw new Error("epub had no readable chapters");
  return { chapters, title };
}

// ---------------------------------------------------------------------------
// Chunking: ~BOOK_CHUNK chars per page, split on paragraph boundaries where
// possible; EPUB chapters are merged/split so pages track chapter edges.
// ---------------------------------------------------------------------------

export function chunkPlainText(text: string): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > BOOK_CHUNK) {
    // Prefer a paragraph break in the back half of the window, then a
    // sentence end, then hard-cut.
    let cut = rest.lastIndexOf("\n\n", BOOK_CHUNK);
    if (cut < BOOK_CHUNK / 2) cut = rest.lastIndexOf(". ", BOOK_CHUNK);
    if (cut < BOOK_CHUNK / 2) cut = BOOK_CHUNK;
    chunks.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.length ? chunks : [""];
}

function chunkChapters(chapters: string[]): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const ch of chapters) {
    if (current && current.length + ch.length > BOOK_CHUNK) {
      chunks.push(current.trim());
      current = "";
    }
    if (ch.length > BOOK_CHUNK) {
      if (current) {
        chunks.push(current.trim());
        current = "";
      }
      chunks.push(...chunkPlainText(ch));
    } else {
      current = current ? `${current}\n\n${ch}` : ch;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.length ? chunks : [""];
}

// ---------------------------------------------------------------------------
// loadBook: source pointer → { chunks, title }
// ---------------------------------------------------------------------------

// Warm Fluid Compute instances serve consecutive page turns — a single-entry
// memo spares the refetch+reparse. Cold starts just pay the fetch once.
let memo: { key: string; value: { chunks: string[]; title?: string } } | null = null;

export async function loadBook(src: BookSource): Promise<{ chunks: string[]; title?: string }> {
  const key = `${src.provider}:${src.ref}`;
  if (memo?.key === key) return memo.value;

  let value: { chunks: string[]; title?: string };
  if (src.provider === "gutenberg") {
    if (!src.textUrl) throw new Error("this book has no readable text");
    // The add route already pins textUrl to gutenberg.org; re-check here so a
    // value that reached storage any other way still can't make the server
    // fetch an arbitrary URL (SSRF defense-in-depth).
    const textHost = new URL(src.textUrl).hostname.toLowerCase().replace(/\.$/, "");
    if (
      new URL(src.textUrl).protocol !== "https:" ||
      (textHost !== "gutenberg.org" && !textHost.endsWith(".gutenberg.org"))
    ) {
      throw new Error("this book has no readable text");
    }
    const res = await fetch(src.textUrl, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`gutenberg returned ${res.status}`);
    let text = await res.text();
    // Strip the license header/footer so page 1 is the book, not boilerplate.
    const start = text.match(/\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG[^*]*\*\*\*/);
    if (start && start.index !== undefined) text = text.slice(start.index + start[0].length);
    const end = text.match(/\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG[^*]*\*\*\*/);
    if (end && end.index !== undefined) text = text.slice(0, end.index);
    value = { chunks: chunkPlainText(text) };
  } else if (src.provider === "drive") {
    const { bytes, filename } = await fetchDriveFile(src.ref);
    if (sniffFormat(bytes) === "epub") {
      const { chapters, title } = await epubChapters(bytes);
      value = { chunks: chunkChapters(chapters), title: title ?? filename };
    } else {
      value = { chunks: chunkPlainText(decodeText(bytes)), title: filename };
    }
  } else if (src.provider === "remote") {
    if (!src.textUrl) throw new Error("this book has no readable text");
    const bytes = await fetchRemoteFile(src.textUrl);
    if (sniffFormat(bytes) === "epub") {
      const { chapters, title } = await epubChapters(bytes);
      value = { chunks: chunkChapters(chapters), title };
    } else {
      value = { chunks: chunkPlainText(decodeText(bytes)) };
    }
  } else {
    throw new Error("this book has no readable text"); // openlibrary: link-only
  }

  memo = { key, value };
  return value;
}

// ---------------------------------------------------------------------------
// Drive probe: runs in after() when a Drive link is added (and on Retry).
// Confirms the file opens + parses, learns its title/format — stores nothing.
// ---------------------------------------------------------------------------

export async function retryBookProbe(
  storage: StorageAdapter,
  userId: string,
  item: LibraryItem
): Promise<Partial<Pick<LibraryItem, "title" | "hasContent" | "extraction" | "bookSource">>> {
  const provider = item.bookSource?.provider;
  if (provider !== "drive" && provider !== "remote") {
    // Nothing to probe for gutenberg/openlibrary — they're terminal at add.
    return { extraction: extractionTerminal(item) };
  }
  // Generic public URL: open it once to confirm it streams and learn the title
  // (epub only; a .txt keeps the filename-derived title). Stores no text.
  if (provider === "remote") {
    try {
      const { title } = await loadBook(item.bookSource!);
      const patch = {
        ...(title ? { title } : {}),
        hasContent: true,
        extraction: "ok" as const,
      };
      await storage.updateLibraryItem(userId, item.id, patch);
      return patch;
    } catch {
      const patch = { extraction: "failed" as const };
      try {
        await storage.updateLibraryItem(userId, item.id, patch);
      } catch {
        // storage briefly unavailable — stays pending until the next retry
      }
      return patch;
    }
  }
  const drive = item.bookSource!; // narrowed: provider === "drive" here
  try {
    const { bytes, filename } = await fetchDriveFile(drive.ref);
    const format = sniffFormat(bytes);
    let title = filename?.replace(/\.(txt|epub)$/i, "");
    if (format === "epub") {
      const parsed = await epubChapters(bytes); // throws if unreadable
      title = parsed.title ?? title;
      memo = {
        key: `drive:${drive.ref}`,
        value: { chunks: chunkChapters(parsed.chapters), title },
      };
    }
    const patch = {
      ...(title ? { title } : {}),
      hasContent: true,
      extraction: "ok" as const,
      bookSource: { ...drive, format },
    };
    await storage.updateLibraryItem(userId, item.id, patch);
    return patch;
  } catch {
    const patch = { extraction: "failed" as const };
    try {
      await storage.updateLibraryItem(userId, item.id, patch);
    } catch {
      // storage briefly unavailable — stays pending until the next retry
    }
    return patch;
  }
}

function extractionTerminal(item: LibraryItem): "ok" | "failed" {
  return item.hasContent || item.kind === "book" ? "ok" : "failed";
}
