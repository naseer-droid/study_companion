import { NextResponse } from "next/server";
import { getRequestStorage } from "@/lib/storage";
import { loadBook } from "@/lib/books";

// Streamed book pages: resolve the item's source (Gutenberg URL / Drive file)
// live, slice into chunks in memory, return one page. Nothing is stored.
export const maxDuration = 60;

export async function GET(req: Request) {
  const ctx = await getRequestStorage();
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const params = new URL(req.url).searchParams;
    const itemId = params.get("itemId") ?? "";
    const requested = Number(params.get("chunk") ?? 0);
    if (!itemId) return NextResponse.json({ error: "Missing itemId." }, { status: 400 });

    const data = await ctx.storage.load(ctx.userId);
    const item = data.topics.flatMap((t) => t.library).find((i) => i.id === itemId);
    if (!item) {
      return NextResponse.json({ error: "Couldn't find that library item." }, { status: 404 });
    }
    if (item.kind !== "book" || !item.bookSource) {
      return NextResponse.json({ error: "Not a streamable book." }, { status: 400 });
    }

    const { chunks, title } = await loadBook(item.bookSource);
    // A stored reading position can outlive a reparse — clamp, don't 404.
    const chunk = Math.min(Math.max(0, Number.isFinite(requested) ? Math.trunc(requested) : 0), chunks.length - 1);

    const res = NextResponse.json({
      text: chunks[chunk] ?? "",
      chunk,
      totalChunks: chunks.length,
      title,
    });
    // Public-domain Gutenberg text is immutable — let the CDN keep it. Drive
    // files are personal: never put them on the shared cache.
    res.headers.set(
      "Cache-Control",
      item.bookSource.provider === "gutenberg"
        ? "public, s-maxage=604800, stale-while-revalidate=86400"
        : "private, max-age=3600"
    );
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't fetch the book.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
