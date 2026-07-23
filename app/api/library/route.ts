import { NextResponse } from "next/server";
import { after } from "next/server";
import { getRequestStorage } from "@/lib/storage";
import { readerUrl } from "@/lib/links";
import {
  youtubeVideoId,
  quickYouTubeMeta,
  extractAndStore,
  assertPublicHttpUrl,
  CONTENT_CAP,
} from "@/lib/extract";
import { driveFileId, retryBookProbe } from "@/lib/books";
import { videoEmbed, videoEmbedMeta } from "@/lib/embed";
import type { BookSource } from "@/lib/types";

// Ingestion: paste a URL → the item is saved and returned IMMEDIATELY with
// extraction:"pending"; the actual text/transcript extraction runs after the
// response via after(), so a slow or blocked source can never make the add
// feel broken (v3.2). No LLM call here. Extraction failure is never fatal:
// the worst case is a link-only card with hasContent=false.
export const maxDuration = 60; // must cover the response AND the after() work

export async function POST(req: Request) {
  // Outer catch: no path may return a bodyless 500 — the client can only
  // show a useful error when the body is JSON.
  try {
    return await handleAdd(req);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not add that link.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleAdd(req: Request) {
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

  // Picked from the in-app book search (Gutenberg / Open Library) — the
  // client already has the metadata, nothing to extract.
  if (body.book && typeof body.book === "object") {
    return addPickedBook(ctx, topicId, body.book as Record<string, unknown>);
  }

  // v3.8: paste/upload Markdown directly (e.g. an LLM-generated summary or a
  // .md file). Stored as a Markdown article — no URL, no extraction; it reads
  // in the same reader as any Markdown-format article.
  if (typeof body.markdown === "string" && body.markdown.trim()) {
    return addMarkdownNote(
      ctx,
      topicId,
      body.markdown.trim(),
      typeof body.title === "string" ? body.title.trim() : ""
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
  } catch {
    return NextResponse.json({ error: "That doesn't look like a valid URL." }, { status: 400 });
  }

  // A link-shared Drive ebook (.txt/.epub) becomes a streamed book: the card
  // saves instantly and a background probe opens the file to learn its
  // title/format. No book text is ever stored.
  const driveId = driveFileId(parsed);
  if (driveId) {
    const item = await ctx.storage.addLibraryItem(
      ctx.userId,
      topicId,
      {
        kind: "book",
        url: parsed.toString(),
        title: "Drive ebook",
        addedAt: new Date().toISOString(),
        status: "unread",
        siteName: "Google Drive",
        hasContent: false,
        extraction: "pending",
        bookSource: { provider: "drive", ref: driveId },
      },
      ""
    );
    after(async () => {
      await retryBookProbe(ctx.storage, ctx.userId, item);
    });
    return NextResponse.json({ item });
  }

  // A public .txt/.epub/.pdf URL (Standard Ebooks, archive.org public-domain,
  // arxiv, or self-hosted) becomes a streamed book like Drive: saved instantly,
  // opened by a background probe. The SSRF guard refuses private/loopback
  // addresses; no book text is ever stored.
  const lowerPath = parsed.pathname.toLowerCase();
  if (lowerPath.endsWith(".epub") || lowerPath.endsWith(".txt") || lowerPath.endsWith(".pdf")) {
    try {
      assertPublicHttpUrl(parsed.toString());
    } catch {
      return NextResponse.json({ error: "That address can't be fetched." }, { status: 400 });
    }
    const format: "txt" | "epub" | "pdf" = lowerPath.endsWith(".epub")
      ? "epub"
      : lowerPath.endsWith(".pdf")
        ? "pdf"
        : "txt";
    const rawName = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "Ebook");
    const item = await ctx.storage.addLibraryItem(
      ctx.userId,
      topicId,
      {
        kind: "book",
        url: parsed.toString(),
        title: rawName.replace(/\.(txt|epub|pdf)$/i, "").replace(/[-_]+/g, " ").trim() || "Ebook",
        addedAt: new Date().toISOString(),
        status: "unread",
        siteName: parsed.hostname.replace(/^www\./, ""),
        hasContent: false,
        extraction: "pending",
        bookSource: { provider: "remote", ref: parsed.toString(), format, textUrl: parsed.toString() },
      },
      ""
    );
    after(async () => {
      await retryBookProbe(ctx.storage, ctx.userId, item);
    });
    return NextResponse.json({ item });
  }

  // Medium is rewritten to the freedium mirror at ingestion, so the stored
  // URL (and the reader's "Original" link) opens the readable version.
  const effectiveUrl = readerUrl(parsed.toString());
  const videoId = youtubeVideoId(parsed);
  // Non-YouTube embeddable video (Vimeo/Dailymotion/Vidyard/direct file) reuses
  // the "youtube" kind (the schema allows only article/youtube/book; siteName
  // shows the real host). It has no transcript — the reader plays the embed and
  // the companion discusses from the title.
  const embed = videoId ? null : videoEmbed(parsed);
  const kind: "article" | "youtube" = videoId || embed ? "youtube" : "article";

  // Quick metadata only — enough for a presentable card right now. YouTube's
  // oEmbed is fast and unblocked; other video hosts get a best-effort oEmbed
  // title; articles start as their hostname and get the real title when
  // extraction lands.
  let provisional: { title: string; siteName?: string; thumbnail?: string };
  if (videoId) {
    provisional = await quickYouTubeMeta(effectiveUrl, videoId);
  } else if (embed) {
    const meta = await videoEmbedMeta(effectiveUrl, embed);
    // Direct video files have no oEmbed — derive a readable title from the
    // filename so the companion has something better than the bare host.
    const fileTitle =
      embed.kind === "file"
        ? decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "")
            .replace(/\.(mp4|webm|ogv)$/i, "")
            .replace(/[-_]+/g, " ")
            .trim()
        : "";
    provisional = {
      title: meta.title || fileTitle || parsed.hostname.replace(/^www\./, ""),
      siteName: embed.host,
      thumbnail: meta.thumbnail,
    };
  } else {
    provisional = { title: parsed.hostname.replace(/^www\./, ""), siteName: undefined, thumbnail: undefined };
  }

  const item = await ctx.storage.addLibraryItem(
    ctx.userId,
    topicId,
    {
      kind,
      url: effectiveUrl,
      title: provisional.title,
      addedAt: new Date().toISOString(),
      status: "unread",
      siteName: provisional.siteName,
      thumbnail: provisional.thumbnail,
      hasContent: false,
      // Non-YouTube embeds have nothing to extract — mark terminal so the reader
      // shows the player + discuss-from-title rather than a stuck "pending".
      extraction: embed ? "ok" : "pending",
    },
    ""
  );

  // Only run the extraction pipeline for real articles / YouTube (transcript).
  // ctx is captured here, BEFORE the response goes out — after() callbacks must
  // not touch cookies()/headers(), but the already-authed storage client stays
  // valid for the function's lifetime.
  if (!embed) {
    after(async () => {
      await extractAndStore(ctx.storage, ctx.userId, {
        id: item.id,
        url: effectiveUrl,
        kind,
      });
    });
  }

  return NextResponse.json({ item });
}

// Book picked from the in-app search / suggestions. Gutenberg books stream in
// the reader (hasContent=true, text resolved live); Open Library / Google Books
// have no full text, so those stay link-only cards the learner opens externally
// (or fetches themselves and pastes the Drive/.epub/.pdf link into the shelf).
async function addPickedBook(
  ctx: NonNullable<Awaited<ReturnType<typeof getRequestStorage>>>,
  topicId: string,
  book: Record<string, unknown>
) {
  const provider =
    book.provider === "gutenberg" || book.provider === "openlibrary"
      ? book.provider
      : null;
  const ref = typeof book.ref === "string" ? book.ref : "";
  const title = typeof book.title === "string" ? book.title.trim() : "";
  const url = typeof book.url === "string" ? book.url : "";
  if (!provider || !ref || !title || !url) {
    return NextResponse.json({ error: "That book couldn't be added." }, { status: 400 });
  }
  const textUrl = typeof book.textUrl === "string" ? book.textUrl : undefined;
  if (textUrl && !/^https:\/\/([\w-]+\.)*gutenberg\.org\//.test(textUrl)) {
    // The chunk route fetches textUrl server-side — only Gutenberg qualifies.
    return NextResponse.json({ error: "That book couldn't be added." }, { status: 400 });
  }

  const streamable = provider === "gutenberg" && !!textUrl;
  const bookSource: BookSource = { provider, ref, textUrl };
  const item = await ctx.storage.addLibraryItem(
    ctx.userId,
    topicId,
    {
      kind: "book",
      url,
      title,
      addedAt: new Date().toISOString(),
      status: "unread",
      siteName: typeof book.author === "string" && book.author ? book.author : "Book",
      thumbnail: typeof book.thumbnail === "string" && book.thumbnail ? book.thumbnail : undefined,
      hasContent: streamable,
      extraction: "ok",
      bookSource,
    },
    ""
  );
  return NextResponse.json({ item });
}

// Derive a card title from pasted Markdown: the first ATX/underline heading,
// else the first non-empty line, else a fallback — capped so a runaway first
// line can't become the title.
function titleFromMarkdown(md: string): string {
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.replace(/^#{1,6}\s+/, "").replace(/^#+$/, "").trim();
    return (h || line).replace(/[*_`]/g, "").slice(0, 120).trim() || "Untitled note";
  }
  return "Untitled note";
}

async function addMarkdownNote(
  ctx: NonNullable<Awaited<ReturnType<typeof getRequestStorage>>>,
  topicId: string,
  markdown: string,
  providedTitle: string
) {
  const item = await ctx.storage.addLibraryItem(
    ctx.userId,
    topicId,
    {
      kind: "article",
      // Synthetic, non-navigable URL: there is no original page. The reader
      // hides "Original ↗" for about: URLs.
      url: `about:markdown/${crypto.randomUUID()}`,
      title: providedTitle || titleFromMarkdown(markdown),
      addedAt: new Date().toISOString(),
      status: "unread",
      siteName: "Markdown",
      hasContent: true,
      extraction: "ok",
    },
    markdown.slice(0, CONTENT_CAP)
  );
  return NextResponse.json({ item });
}
