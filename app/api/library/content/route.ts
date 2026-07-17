import { NextResponse } from "next/server";
import { getRequestStorage } from "@/lib/storage";

// The reader/discuss views fetch extracted text on demand — load() never
// ships it (it can be tens of KB per item).
export async function GET(req: Request) {
  const ctx = await getRequestStorage();
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const itemId = new URL(req.url).searchParams.get("itemId") ?? "";
  if (!itemId) return NextResponse.json({ error: "Missing itemId." }, { status: 400 });
  try {
    const content = await ctx.storage.getLibraryContent(ctx.userId, itemId);
    return NextResponse.json({ content });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not load the text.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
