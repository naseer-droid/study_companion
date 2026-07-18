import { NextResponse } from "next/server";
import { after } from "next/server";
import { getRequestStorage } from "@/lib/storage";
import { readerUrl } from "@/lib/links";
import { youtubeVideoId, quickYouTubeMeta, extractAndStore } from "@/lib/extract";
import { driveFileId, retryBookProbe } from "@/lib/books";
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

  // Medium is rewritten to the freedium mirror at ingestion, so the stored
  // URL (and the reader's "Original" link) opens the readable version.
  const effectiveUrl = readerUrl(parsed.toString());
  const videoId = youtubeVideoId(parsed);
  const kind: "article" | "youtube" = videoId ? "youtube" : "article";

  // Quick metadata only — enough for a presentable card right now. YouTube's
  // oEmbed is fast and unblocked; articles start as their hostname and get
  // the real title when extraction lands.
  const provisional = videoId
    ? await quickYouTubeMeta(effectiveUrl, videoId)
    : {
        title: parsed.hostname.replace(/^www\./, ""),
        siteName: undefined as string | undefined,
        thumbnail: undefined as string | undefined,
      };

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
      extraction: "pending",
    },
    ""
  );

  // ctx is captured here, BEFORE the response goes out — after() callbacks
  // must not touch cookies()/headers(), but the already-authed storage client
  // stays valid for the function's lifetime.
  after(async () => {
    await extractAndStore(ctx.storage, ctx.userId, {
      id: item.id,
      url: effectiveUrl,
      kind,
    });
  });

  return NextResponse.json({ item });
}

// Book picked from the in-app search. Gutenberg books stream in the reader
// (hasContent=true, text resolved live); Open Library has no full text, so
// those stay link-only cards the learner opens externally.
async function addPickedBook(
  ctx: NonNullable<Awaited<ReturnType<typeof getRequestStorage>>>,
  topicId: string,
  book: Record<string, unknown>
) {
  const provider = book.provider === "gutenberg" || book.provider === "openlibrary" ? book.provider : null;
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
