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
  memory: string; // shared memory, <130 words, model-maintained
  nextSuggestion: string;
};

export type AppData = {
  topics: Topic[];
};
