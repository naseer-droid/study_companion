import { NextResponse } from "next/server";
import { getRequestStorage } from "@/lib/storage";
import { extractAndStore } from "@/lib/extract";

// Re-run extraction for an item that failed at add time. Runs INLINE (not in
// after()) — the Retry button shows a spinner and deserves a definitive
// answer in one round trip. Returns the updated item for direct client merge.
export const maxDuration = 60;

export async function POST(req: Request) {
  const ctx = await getRequestStorage();
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const itemId = typeof body.itemId === "string" ? body.itemId : "";
    if (!itemId) return NextResponse.json({ error: "Missing itemId." }, { status: 400 });

    const data = await ctx.storage.load(ctx.userId);
    const item = data.topics.flatMap((t) => t.library).find((i) => i.id === itemId);
    if (!item) {
      return NextResponse.json({ error: "Couldn't find that library item." }, { status: 404 });
    }
    if (item.kind === "book") {
      // Books never store text; their retry is the drive probe (v3.2 M5).
      const { retryBookProbe } = await import("@/lib/books");
      const patch = await retryBookProbe(ctx.storage, ctx.userId, item);
      return NextResponse.json({ item: { ...item, ...patch } });
    }

    const patch = await extractAndStore(ctx.storage, ctx.userId, {
      id: item.id,
      url: item.url,
      kind: item.kind,
    });
    return NextResponse.json({ item: { ...item, ...patch } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not retry extraction.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
