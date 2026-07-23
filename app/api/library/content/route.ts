import { NextResponse } from "next/server";
import { getRequestStorage } from "@/lib/storage";
import { looksLikeHtml, parseTranscript } from "@/lib/types";
import { renderMarkdownToSafeHtml, htmlToMarkdown } from "@/lib/extract";

// The reader/discuss views fetch extracted text on demand — load() never
// ships it (it can be tens of KB per item).
//
// v3.8: articles are stored either as sanitized HTML (strong extraction) or as
// Markdown (Jina fallback + pasted/uploaded MD). Markdown is rendered to
// sanitized HTML HERE, at read time, so the reader has a single HTML render
// path and every stored MD item displays correctly with no migration. YouTube
// transcripts (JSON segments) pass through untouched. `?as=md` returns the
// article as Markdown for the reader's export/copy action.
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
      const markdown = looksLikeHtml(content) ? await htmlToMarkdown(content) : content;
      return NextResponse.json({ markdown });
    }

    // Markdown → sanitized HTML; stored HTML passes through unchanged. If the
    // conversion ever fails at runtime, degrade to the raw stored content
    // (the client renders non-HTML as readable plain text) rather than 500 —
    // the reader must never say "couldn't extract" while data exists.
    if (content && !looksLikeHtml(content)) {
      try {
        return NextResponse.json({ content: await renderMarkdownToSafeHtml(content) });
      } catch {
        return NextResponse.json({ content });
      }
    }
    return NextResponse.json({ content });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not load the text.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
