import { NextResponse } from "next/server";
import { getRequestStorage } from "@/lib/storage";
import { CONTENT_CAP } from "@/lib/extract";

// Last-resort recovery: the learner pastes the text (article body or a copy
// of YouTube's Show-Transcript panel) themselves. Universal — works when
// every automated fetch is blocked.
export async function POST(req: Request) {
  const ctx = await getRequestStorage();
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const itemId = typeof body.itemId === "string" ? body.itemId : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!itemId) return NextResponse.json({ error: "Missing itemId." }, { status: 400 });
    if (!text) return NextResponse.json({ error: "Nothing to save — the text was empty." }, { status: 400 });

    const data = await ctx.storage.load(ctx.userId);
    const item = data.topics.flatMap((t) => t.library).find((i) => i.id === itemId);
    if (!item) {
      return NextResponse.json({ error: "Couldn't find that library item." }, { status: 404 });
    }
    if (item.kind === "book") {
      return NextResponse.json({ error: "Books stream their text — nothing to paste." }, { status: 400 });
    }

    await ctx.storage.updateLibraryItem(
      ctx.userId,
      itemId,
      { hasContent: true, extraction: "ok" },
      text.slice(0, CONTENT_CAP)
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save the text.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
