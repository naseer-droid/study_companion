import { NextResponse } from "next/server";
import { getRequestStorage } from "@/lib/storage";
import { looksLikeHtml, parseTranscript } from "@/lib/types";
import { htmlToMarkdown } from "@/lib/extract";

// The reader/discuss views fetch extracted text on demand — load() never
// ships it (it can be tens of KB per item).
//
// v3.9: the route returns the RAW stored content and the reader renders it on
// the client with react-markdown (Markdown, HTML, or a mix all render through
// one resilient path). This replaces the v3.8 server-side Markdown→HTML render,
// which failed inside Vercel's serverless bundle (ESM-only `marked`) and, after
// a defensive try/catch was added, silently shipped raw `###` to the reader.
// Rendering on the client removes that failure mode entirely and fixes every
// already-stored item with no migration. `?as=md` still returns Markdown for
// the reader's export/copy and edit-mode (HTML → Markdown via Turndown).
export async function GET(req: Request) {
  const ctx = await getRequestStorage();
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const url = new URL(req.url);
  const itemId = url.searchParams.get("itemId") ?? "";
  const asMarkdown = url.searchParams.get("as") === "md";
  if (!itemId) return NextResponse.json({ error: "Missing itemId." }, { status: 400 });
  try {
    const content = await ctx.storage.getLibraryContent(ctx.userId, itemId);

    // YouTube transcript JSON — never treat as article text.
    if (parseTranscript(content)) return NextResponse.json({ content });

    if (asMarkdown) {
      // Editing/export is always in Markdown: HTML articles are converted with
      // Turndown (server-side; uses the externalized jsdom), Markdown passes
      // through. Turndown failure degrades to the raw stored content.
      let markdown = content;
      if (content && looksLikeHtml(content)) {
        try {
          markdown = await htmlToMarkdown(content);
        } catch {
          markdown = content;
        }
      }
      return NextResponse.json({ markdown });
    }

    // Raw content — the client renders it (see components/ReaderView.tsx).
    return NextResponse.json({ content });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not load the text.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
