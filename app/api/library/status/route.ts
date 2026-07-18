import { NextResponse } from "next/server";
import { getRequestStorage } from "@/lib/storage";

// Poll target while items are extraction:"pending" — returns just the fields
// the background job may have patched. Reuses load() (metadata-only, no
// content); a dedicated storage method is the optimization if this ever gets
// heavy.
export async function GET(req: Request) {
  const ctx = await getRequestStorage();
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const ids = (new URL(req.url).searchParams.get("ids") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20);
    if (!ids.length) return NextResponse.json({ items: [] });

    const wanted = new Set(ids);
    const data = await ctx.storage.load(ctx.userId);
    const items = data.topics
      .flatMap((t) => t.library)
      .filter((i) => wanted.has(i.id))
      .map((i) => ({
        id: i.id,
        title: i.title,
        siteName: i.siteName,
        thumbnail: i.thumbnail,
        hasContent: i.hasContent,
        extraction: i.extraction,
      }));
    return NextResponse.json({ items });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not check status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
