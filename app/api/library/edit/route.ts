import { NextResponse } from "next/server";
import { getRequestStorage } from "@/lib/storage";
import { CONTENT_CAP } from "@/lib/extract";

// Save a user-edited article body. Editing is always in Markdown (HTML items
// are converted to Markdown via the content route's `?as=md` before editing),
// so the stored content converges to Markdown over time and reads back through
// the client renderer. Reuses updateLibraryItem's existing `content` param —
// no schema change. Books stream their text and have nothing to edit here.
export async function POST(req: Request) {
  const ctx = await getRequestStorage();
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { itemId, content } = await req.json();
    if (typeof itemId !== "string" || !itemId || typeof content !== "string") {
      return NextResponse.json({ error: "Missing item or content." }, { status: 400 });
    }
    const text = content.trim();
    if (!text) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });

    await ctx.storage.updateLibraryItem(
      ctx.userId,
      itemId,
      { hasContent: true, extraction: "ok" },
      text.slice(0, CONTENT_CAP)
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn't save your edit.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
