// Data model — handoff §5, kept verbatim in shape.

export type Resource = {
  title: string;
  type: "book" | "course" | "website" | "video" | "practice";
  why: string;
};

export type RoadmapStage = {
  id: number;
  title: string;
  desc: string;
  done: boolean;
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

export type LibraryItem = {
  id: string;
  kind: "article" | "youtube";
  url: string;
  title: string;
  addedAt: string; // ISO
  status: "unread" | "reading" | "done";
  siteName?: string; // article source / channel name
  thumbnail?: string; // og:image or YouTube thumbnail URL
  hasContent: boolean; // extraction/transcript succeeded
  discussion: DiscussionMsg[];
};

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
