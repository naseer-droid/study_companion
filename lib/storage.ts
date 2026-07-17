import { promises as fs } from "fs";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppData, Topic, JournalEntry, QAItem, RoadmapStage, LibraryItem, DiscussionMsg } from "./types";
import { supabaseEnabled } from "./supabase/config";
import { createClient } from "./supabase/server";
import { LOCAL_USER_ID } from "./auth";

// StorageAdapter keeps persistence swappable (handoff §4). v2 note: the v1
// whole-blob load/save became per-entity operations so two devices can write
// concurrently without overwriting each other; only the model-rewritten
// memory is last-write-wins, which is the correct semantics for it.
export interface StorageAdapter {
  load(userId: string): Promise<AppData>;
  createTopic(userId: string, topic: Omit<Topic, "id">): Promise<Topic>;
  deleteTopic(userId: string, topicId: string): Promise<void>;
  addJournalEntry(
    userId: string,
    topicId: string,
    entry: JournalEntry,
    memory: string,
    nextSuggestion: string
  ): Promise<void>;
  addQA(userId: string, topicId: string, item: QAItem, memory: string): Promise<void>;
  updateRoadmap(userId: string, topicId: string, roadmap: RoadmapStage[]): Promise<void>;
  // --- Study Room (v3.0) ---
  addLibraryItem(
    userId: string,
    topicId: string,
    item: Omit<LibraryItem, "id" | "discussion">,
    content: string
  ): Promise<LibraryItem>;
  getLibraryContent(userId: string, itemId: string): Promise<string>;
  updateLibraryStatus(userId: string, itemId: string, status: LibraryItem["status"]): Promise<void>;
  addDiscussion(
    userId: string,
    topicId: string,
    itemId: string,
    userMsg: DiscussionMsg,
    companionMsg: DiscussionMsg,
    memory: string
  ): Promise<void>;
  deleteLibraryItem(userId: string, itemId: string): Promise<void>;
  importData(userId: string, data: AppData): Promise<void>;
}

const EMPTY: AppData = { topics: [] };

// ---------------------------------------------------------------------------
// Local mode: the v1 JSON file, unchanged on disk, now behind the v2 interface.
// ---------------------------------------------------------------------------
class JsonFileStorage implements StorageAdapter {
  constructor(private filePath: string) {}

  private async read(): Promise<AppData> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.topics)) return parsed as AppData;
      return EMPTY;
    } catch {
      return EMPTY; // missing or corrupt file starts fresh
    }
  }

  private async write(data: AppData): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    // Write via a temp file so a crash mid-write can't corrupt the store.
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tmp, this.filePath);
  }

  private async mutate(fn: (data: AppData) => AppData): Promise<void> {
    const data = await this.read();
    await this.write(fn(data));
  }

  async load(): Promise<AppData> {
    const data = await this.read();
    // Library content stays on disk only — load() ships item metadata, never
    // the extracted text (same contract as Supabase mode).
    return {
      ...data,
      topics: data.topics.map((t) => ({
        ...t,
        library: (t.library ?? []).map((item) => {
          const { content: _content, ...meta } = item as LibraryItem & { content?: string };
          return meta;
        }),
      })),
    };
  }

  async createTopic(_userId: string, topic: Omit<Topic, "id">): Promise<Topic> {
    const created: Topic = { ...topic, id: crypto.randomUUID() };
    await this.mutate((d) => ({ ...d, topics: [created, ...d.topics] }));
    return created;
  }

  async deleteTopic(_userId: string, topicId: string): Promise<void> {
    await this.mutate((d) => ({ ...d, topics: d.topics.filter((t) => t.id !== topicId) }));
  }

  async addJournalEntry(
    _userId: string,
    topicId: string,
    entry: JournalEntry,
    memory: string,
    nextSuggestion: string
  ): Promise<void> {
    await this.mutate((d) => ({
      ...d,
      topics: d.topics.map((t) =>
        t.id === topicId
          ? { ...t, journal: [...t.journal, entry], memory, nextSuggestion }
          : t
      ),
    }));
  }

  async addQA(_userId: string, topicId: string, item: QAItem, memory: string): Promise<void> {
    await this.mutate((d) => ({
      ...d,
      topics: d.topics.map((t) =>
        t.id === topicId ? { ...t, qa: [...(t.qa || []), item], memory } : t
      ),
    }));
  }

  async updateRoadmap(_userId: string, topicId: string, roadmap: RoadmapStage[]): Promise<void> {
    await this.mutate((d) => ({
      ...d,
      topics: d.topics.map((t) => (t.id === topicId ? { ...t, roadmap } : t)),
    }));
  }

  // --- Study Room (v3.0): content lives inline in the JSON file — fine for a
  // local single-user store; load() strips it before shipping to the browser.
  async addLibraryItem(
    _userId: string,
    topicId: string,
    item: Omit<LibraryItem, "id" | "discussion">,
    content: string
  ): Promise<LibraryItem> {
    const created: LibraryItem & { content?: string } = {
      ...item,
      id: crypto.randomUUID(),
      discussion: [],
      content,
    };
    await this.mutate((d) => ({
      ...d,
      topics: d.topics.map((t) =>
        t.id === topicId ? { ...t, library: [...(t.library ?? []), created] } : t
      ),
    }));
    const { content: _content, ...meta } = created;
    return meta;
  }

  async getLibraryContent(_userId: string, itemId: string): Promise<string> {
    const data = await this.read();
    for (const t of data.topics) {
      const item = (t.library ?? []).find((i) => i.id === itemId) as
        | (LibraryItem & { content?: string })
        | undefined;
      if (item) return item.content ?? "";
    }
    return "";
  }

  async updateLibraryStatus(_userId: string, itemId: string, status: LibraryItem["status"]): Promise<void> {
    await this.mutate((d) => ({
      ...d,
      topics: d.topics.map((t) => ({
        ...t,
        library: (t.library ?? []).map((i) => (i.id === itemId ? { ...i, status } : i)),
      })),
    }));
  }

  async addDiscussion(
    _userId: string,
    topicId: string,
    itemId: string,
    userMsg: DiscussionMsg,
    companionMsg: DiscussionMsg,
    memory: string
  ): Promise<void> {
    await this.mutate((d) => ({
      ...d,
      topics: d.topics.map((t) =>
        t.id === topicId
          ? {
              ...t,
              memory,
              library: (t.library ?? []).map((i) =>
                i.id === itemId
                  ? { ...i, discussion: [...i.discussion, userMsg, companionMsg] }
                  : i
              ),
            }
          : t
      ),
    }));
  }

  async deleteLibraryItem(_userId: string, itemId: string): Promise<void> {
    await this.mutate((d) => ({
      ...d,
      topics: d.topics.map((t) => ({
        ...t,
        library: (t.library ?? []).filter((i) => i.id !== itemId),
      })),
    }));
  }

  async importData(_userId: string, data: AppData): Promise<void> {
    await this.write(data);
  }
}

// ---------------------------------------------------------------------------
// Cloud mode: Supabase Postgres via the request-scoped client, so every query
// runs as the signed-in user and RLS scopes the rows — reads need no explicit
// user filter, and inserts carry user_id to satisfy the WITH CHECK policies.
// ---------------------------------------------------------------------------
type TopicRow = {
  id: string;
  name: string;
  created_at: string;
  brief: string;
  why_it_matters: string;
  first_step: string;
  roadmap: RoadmapStage[];
  resources: Topic["resources"];
  memory: string;
  next_suggestion: string;
};

class SupabaseStorage implements StorageAdapter {
  constructor(private supabase: SupabaseClient) {}

  private fail(context: string, error: { message: string } | null): never {
    throw new Error(`${context}: ${error?.message ?? "unknown error"}`);
  }

  async load(): Promise<AppData> {
    const [topicsRes, journalRes, questionsRes, libraryRes, discussionRes] = await Promise.all([
      this.supabase
        .from("topics")
        .select("id,name,created_at,brief,why_it_matters,first_step,roadmap,resources,memory,next_suggestion")
        .order("created_at", { ascending: false }),
      this.supabase
        .from("journal_entries")
        .select("topic_id,date,user_note,companion_reply")
        .order("date", { ascending: true }),
      this.supabase
        .from("questions")
        .select("topic_id,date,q,a,follow_up")
        .order("date", { ascending: true }),
      // Metadata only — `content` (extracted text/transcript) is fetched on
      // demand via getLibraryContent, never shipped in load().
      this.supabase
        .from("library_items")
        .select("id,topic_id,kind,url,title,site_name,thumbnail,status,has_content,added_at")
        .order("added_at", { ascending: true }),
      this.supabase
        .from("discussion_messages")
        .select("item_id,date,role,text")
        .order("date", { ascending: true }),
    ]);
    if (topicsRes.error) this.fail("load topics", topicsRes.error);
    if (journalRes.error) this.fail("load journal", journalRes.error);
    if (questionsRes.error) this.fail("load questions", questionsRes.error);
    if (libraryRes.error) this.fail("load library", libraryRes.error);
    if (discussionRes.error) this.fail("load discussions", discussionRes.error);

    const journalByTopic = new Map<string, JournalEntry[]>();
    for (const row of journalRes.data ?? []) {
      const list = journalByTopic.get(row.topic_id) ?? [];
      list.push({ date: row.date, userNote: row.user_note, companionReply: row.companion_reply });
      journalByTopic.set(row.topic_id, list);
    }
    const qaByTopic = new Map<string, QAItem[]>();
    for (const row of questionsRes.data ?? []) {
      const list = qaByTopic.get(row.topic_id) ?? [];
      list.push({ date: row.date, q: row.q, a: row.a, followUp: row.follow_up });
      qaByTopic.set(row.topic_id, list);
    }

    // Library items first (with empty threads), then hang each discussion
    // message on its item — same object, so both maps stay in sync.
    const libraryByTopic = new Map<string, LibraryItem[]>();
    const itemById = new Map<string, LibraryItem>();
    for (const row of libraryRes.data ?? []) {
      const item: LibraryItem = {
        id: row.id,
        kind: row.kind,
        url: row.url,
        title: row.title,
        addedAt: row.added_at,
        status: row.status,
        siteName: row.site_name ?? undefined,
        thumbnail: row.thumbnail ?? undefined,
        hasContent: row.has_content,
        discussion: [],
      };
      const list = libraryByTopic.get(row.topic_id) ?? [];
      list.push(item);
      libraryByTopic.set(row.topic_id, list);
      itemById.set(row.id, item);
    }
    for (const row of discussionRes.data ?? []) {
      itemById
        .get(row.item_id)
        ?.discussion.push({ date: row.date, role: row.role, text: row.text });
    }

    const topics: Topic[] = ((topicsRes.data ?? []) as TopicRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      brief: row.brief,
      whyItMatters: row.why_it_matters,
      firstStep: row.first_step,
      roadmap: row.roadmap ?? [],
      resources: row.resources ?? [],
      journal: journalByTopic.get(row.id) ?? [],
      qa: qaByTopic.get(row.id) ?? [],
      library: libraryByTopic.get(row.id) ?? [],
      memory: row.memory,
      nextSuggestion: row.next_suggestion,
    }));
    return { topics };
  }

  async createTopic(userId: string, topic: Omit<Topic, "id">): Promise<Topic> {
    const { data, error } = await this.supabase
      .from("topics")
      .insert({
        user_id: userId,
        name: topic.name,
        created_at: topic.createdAt,
        brief: topic.brief,
        why_it_matters: topic.whyItMatters,
        first_step: topic.firstStep,
        roadmap: topic.roadmap,
        resources: topic.resources,
        memory: topic.memory,
        next_suggestion: topic.nextSuggestion,
      })
      .select("id")
      .single();
    if (error || !data) this.fail("create topic", error);
    return { ...topic, id: data.id };
  }

  async deleteTopic(_userId: string, topicId: string): Promise<void> {
    // Journal entries and questions cascade in the schema.
    const { error } = await this.supabase.from("topics").delete().eq("id", topicId);
    if (error) this.fail("delete topic", error);
  }

  async addJournalEntry(
    userId: string,
    topicId: string,
    entry: JournalEntry,
    memory: string,
    nextSuggestion: string
  ): Promise<void> {
    const { error: insertError } = await this.supabase.from("journal_entries").insert({
      user_id: userId,
      topic_id: topicId,
      date: entry.date,
      user_note: entry.userNote,
      companion_reply: entry.companionReply,
    });
    if (insertError) this.fail("save journal entry", insertError);
    const { error: updateError } = await this.supabase
      .from("topics")
      .update({ memory, next_suggestion: nextSuggestion })
      .eq("id", topicId);
    if (updateError) this.fail("update memory", updateError);
  }

  async addQA(userId: string, topicId: string, item: QAItem, memory: string): Promise<void> {
    const { error: insertError } = await this.supabase.from("questions").insert({
      user_id: userId,
      topic_id: topicId,
      date: item.date,
      q: item.q,
      a: item.a,
      follow_up: item.followUp,
    });
    if (insertError) this.fail("save question", insertError);
    const { error: updateError } = await this.supabase
      .from("topics")
      .update({ memory })
      .eq("id", topicId);
    if (updateError) this.fail("update memory", updateError);
  }

  async addLibraryItem(
    userId: string,
    topicId: string,
    item: Omit<LibraryItem, "id" | "discussion">,
    content: string
  ): Promise<LibraryItem> {
    const { data, error } = await this.supabase
      .from("library_items")
      .insert({
        user_id: userId,
        topic_id: topicId,
        kind: item.kind,
        url: item.url,
        title: item.title,
        site_name: item.siteName ?? null,
        thumbnail: item.thumbnail ?? null,
        status: item.status,
        has_content: item.hasContent,
        content,
        added_at: item.addedAt,
      })
      .select("id")
      .single();
    if (error || !data) this.fail("add library item", error);
    return { ...item, id: data.id, discussion: [] };
  }

  async getLibraryContent(_userId: string, itemId: string): Promise<string> {
    const { data, error } = await this.supabase
      .from("library_items")
      .select("content")
      .eq("id", itemId)
      .single();
    if (error) this.fail("load library content", error);
    return (data?.content as string) ?? "";
  }

  async updateLibraryStatus(_userId: string, itemId: string, status: LibraryItem["status"]): Promise<void> {
    const { error } = await this.supabase
      .from("library_items")
      .update({ status })
      .eq("id", itemId);
    if (error) this.fail("update library status", error);
  }

  async addDiscussion(
    userId: string,
    topicId: string,
    itemId: string,
    userMsg: DiscussionMsg,
    companionMsg: DiscussionMsg,
    memory: string
  ): Promise<void> {
    const { error: insertError } = await this.supabase.from("discussion_messages").insert([
      { user_id: userId, item_id: itemId, date: userMsg.date, role: userMsg.role, text: userMsg.text },
      {
        user_id: userId,
        item_id: itemId,
        date: companionMsg.date,
        role: companionMsg.role,
        text: companionMsg.text,
      },
    ]);
    if (insertError) this.fail("save discussion", insertError);
    const { error: updateError } = await this.supabase
      .from("topics")
      .update({ memory })
      .eq("id", topicId);
    if (updateError) this.fail("update memory", updateError);
  }

  async deleteLibraryItem(_userId: string, itemId: string): Promise<void> {
    // Discussion messages cascade in the schema.
    const { error } = await this.supabase.from("library_items").delete().eq("id", itemId);
    if (error) this.fail("delete library item", error);
  }

  async updateRoadmap(_userId: string, topicId: string, roadmap: RoadmapStage[]): Promise<void> {
    const { error } = await this.supabase.from("topics").update({ roadmap }).eq("id", topicId);
    if (error) this.fail("update roadmap", error);
  }

  async importData(userId: string, data: AppData): Promise<void> {
    // One-time v1 migration: inserts everything as new rows (new ids).
    for (const topic of data.topics) {
      const created = await this.createTopic(userId, { ...topic, id: undefined } as unknown as Omit<Topic, "id">);
      for (const entry of topic.journal) {
        const { error } = await this.supabase.from("journal_entries").insert({
          user_id: userId,
          topic_id: created.id,
          date: entry.date,
          user_note: entry.userNote,
          companion_reply: entry.companionReply,
        });
        if (error) this.fail("import journal entry", error);
      }
      for (const item of topic.qa || []) {
        const { error } = await this.supabase.from("questions").insert({
          user_id: userId,
          topic_id: created.id,
          date: item.date,
          q: item.q,
          a: item.a,
          follow_up: item.followUp,
        });
        if (error) this.fail("import question", error);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Per-request entry point for API routes.
// ---------------------------------------------------------------------------
const localStore = new JsonFileStorage(path.join(process.cwd(), "data", "study-lamp.json"));

export async function getRequestStorage(): Promise<
  { storage: StorageAdapter; userId: string } | null
> {
  if (!supabaseEnabled) return { storage: localStore, userId: LOCAL_USER_ID };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub as string | undefined;
  if (!userId) return null; // caller responds 401
  return { storage: new SupabaseStorage(supabase), userId };
}
