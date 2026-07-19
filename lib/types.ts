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
  provider: "gutenberg" | "openlibrary" | "drive";
  ref: string;
  format?: "txt" | "epub"; // drive only; probed in the background after add
  textUrl?: string; // gutenberg: plain-text URL chosen at add time
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
