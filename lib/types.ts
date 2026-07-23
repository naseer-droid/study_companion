// Data model — handoff §5, kept verbatim in shape.

export type Resource = {
  title: string;
  type: "book" | "course" | "website" | "video" | "practice";
  why: string;
  url?: string; // model-provided when confident; absent on pre-v3.1 topics
  status?: "suggested" | "doing" | "done"; // absent = suggested (pre-v3.3 topics)
};

export type RoadmapStage = {
  id: number;
  title: string;
  desc: string;
  done: boolean;
  suggestedDone?: boolean; // v3.3: companion thinks this stage is done; learner confirms or dismisses
};

export type JournalEntry = {
  date: string; // ISO
  userNote: string;
  companionReply: string;
};

export type QAItem = {
  date: string; // ISO
  q: string;
  a: string;
  followUp: string;
};

// --- Study Room (v3.0) ---
// Library items carry metadata only; the extracted article text / transcript
// can be tens of KB, so it is stored server-side and fetched on demand
// (getLibraryContent), never shipped in load().
export type DiscussionMsg = {
  date: string; // ISO
  role: "user" | "companion";
  text: string;
};

// Books stream chunk-by-chunk from their source at read time — no text in the
// store. `ref` is the provider-native id (Gutenberg numeric id, Open Library
// work key, Drive file id).
export type BookSource = {
  provider: "gutenberg" | "openlibrary" | "drive" | "remote";
  ref: string;
  format?: "txt" | "epub" | "pdf"; // drive/remote only; probed in the background after add
  textUrl?: string; // gutenberg/remote: plain-text or .epub URL fetched server-side
};

export type LibraryItem = {
  id: string;
  kind: "article" | "youtube" | "book";
  url: string;
  title: string;
  addedAt: string; // ISO
  status: "unread" | "reading" | "done";
  siteName?: string; // article source / channel name / book author
  thumbnail?: string; // og:image, YouTube thumbnail, or book cover URL
  hasContent: boolean; // extraction succeeded (books: streamable text exists)
  extraction?: "pending" | "ok" | "failed"; // absent on pre-v3.2 items
  bookSource?: BookSource; // kind === "book" only
  discussion: DiscussionMsg[];
};

// Pre-v3.2 items have no `extraction` field — they finished (or failed)
// extraction long ago, so derive the terminal state from hasContent. All UI
// reads go through this, never item.extraction directly.
export function extractionState(item: LibraryItem): "pending" | "ok" | "failed" {
  return item.extraction ?? (item.hasContent ? "ok" : "failed");
}

// --- v3.4: transcript + article content shapes ---
// YouTube transcripts are now stored as JSON segments so the reader can show
// tappable timestamps; pre-v3.4 items hold a plain joined string. Every
// consumer (reader, discuss route) must handle BOTH shapes, so these pure
// helpers live here (client- and server-safe) rather than in the server-only
// extraction module.
export type TranscriptSegment = { t: number; text: string }; // t = seconds

export function parseTranscript(content: string): TranscriptSegment[] | null {
  if (!content || content[0] !== "[") return null; // legacy plain text / empty
  try {
    const arr = JSON.parse(content);
    if (
      Array.isArray(arr) &&
      arr.length > 0 &&
      arr.every((s) => s && typeof s.t === "number" && typeof s.text === "string")
    ) {
      return arr as TranscriptSegment[];
    }
  } catch {
    // not JSON — a legacy plain-text transcript
  }
  return null;
}

// Flatten stored transcript content to plain text (for the LLM / copy / legacy).
export function transcriptToText(content: string): string {
  const segs = parseTranscript(content);
  return segs ? segs.map((s) => s.text).join(" ") : content;
}

// Articles are stored as sanitized HTML (rich reader) when extraction is strong,
// or plain/markdown text (Jina fallback). Detect the HTML case for rendering,
// and strip tags when feeding the model.
export function looksLikeHtml(content: string): boolean {
  return (
    /^\s*<(?:p|h[1-6]|div|ul|ol|figure|blockquote|article|section|img|table|pre)\b/i.test(content) ||
    /<\/(?:p|h[1-6]|li|blockquote)>/i.test(content)
  );
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|figure|tr|br)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type Topic = {
  id: string;
  name: string;
  createdAt: string; // ISO
  brief: string;
  whyItMatters: string;
  firstStep: string;
  roadmap: RoadmapStage[];
  resources: Resource[];
  journal: JournalEntry[];
  qa: QAItem[];
  library: LibraryItem[]; // Study Room; older stores may lack it — treat as []
  memory: string; // shared memory, <130 words, model-maintained
  nextSuggestion: string;
};

export type AppData = {
  topics: Topic[];
};
