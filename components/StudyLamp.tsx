"use client";

import { useState, useEffect, useRef, CSSProperties } from "react";
import type { AppData, Topic, LibraryItem, DiscussionMsg, RoadmapStage } from "@/lib/types";
import type { TopicSetupResponse, JournalResponse, AskResponse } from "@/lib/schemas";
import { supabaseEnabled } from "@/lib/supabase/config";
import { C, serif, sans, Card, Eyebrow, Btn, Spinner, Linkify } from "./lamp-ui";
import { readerUrl, searchUrl, urlKey } from "@/lib/links";
import Library from "./Library";
import type { BookPick } from "./BookSearch";
import ReaderView from "./ReaderView";
import DiscussPanel from "./DiscussPanel";
import FocusSession from "./FocusSession";
import SourceSearch, { type SourceKind } from "./SourceSearch";
import MicButton from "./MicButton";

// ---------- server calls ----------
async function api<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Non-JSON bodies (Vercel error pages, timeouts) carry no message of
    // their own — include the status so failures are diagnosable.
    throw new Error(
      data?.error ||
        `Couldn't reach the companion (error ${res.status}). Check your connection and try again.`
    );
  }
  return data as T;
}

async function loadData(): Promise<AppData> {
  try {
    const res = await fetch("/api/storage");
    if (res.status === 401) {
      window.location.href = "/login";
      return { topics: [] };
    }
    const data = await res.json();
    return data && Array.isArray(data.topics) ? data : { topics: [] };
  } catch {
    return { topics: [] };
  }
}

// Per-entity mutations: each change is one small operation instead of a
// whole-data PUT, so two devices can't overwrite each other's entries.
async function storageOp<T = { ok: true }>(body: unknown): Promise<T> {
  const res = await fetch("/api/storage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Signed out.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "Couldn't save that. Try again.");
  return data as T;
}

// ---------- small UI atoms live in ./lamp-ui (shared with the Study Room) ----------

// The companion's presence: a dark glass orb with an ember inside.
// The ember grows and the glow spreads as you learn together.
function Lamp({ level, size = 44 }: { level: number; size?: number }) {
  const l = Math.min(1, Math.max(0, level));
  const core = 10 + l * 24; // ember radius as % of orb
  return (
    <div
      aria-hidden="true"
      className="lc-lamp"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        background: `radial-gradient(circle at 50% 60%,
          rgba(255,222,166,${0.7 + l * 0.3}) 0%,
          rgba(245,179,78,${0.45 + l * 0.4}) ${core}%,
          rgba(120,86,38,${0.25 + l * 0.2}) ${core + 14}%,
          #202A3C ${core + 34}%,
          #171F2E 100%)`,
        border: "1px solid #33405C",
        boxShadow: `0 0 ${3 + l * 24}px rgba(245,179,78,${0.1 + l * 0.4}), inset 0 2px 6px rgba(0,0,0,0.45)`,
        transition: "background 0.8s ease, box-shadow 0.8s ease",
      }}
    />
  );
}

// ---------- main app ----------
export default function StudyLamp() {
  const [data, setData] = useState<AppData | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");
  const [newTopic, setNewTopic] = useState("");
  const [creating, setCreating] = useState(false);
  const [entryText, setEntryText] = useState("");
  const [askText, setAskText] = useState("");
  const [asking, setAsking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(true);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [quoteSeed, setQuoteSeed] = useState(""); // "Discuss this" passage from the reader
  const [bookChunk, setBookChunkState] = useState(0); // current page of the open book
  const [greeting, setGreeting] = useState("");
  const [greetingDismissed, setGreetingDismissed] = useState(false);
  // v3.3 teach-back quiz: idle → loading (fetching question) → asked (awaiting
  // the learner's answer) → grading (fetching feedback, then back to idle —
  // the exchange lands in the journal feed).
  const [quiz, setQuiz] = useState<{ phase: "idle" | "loading" | "asked" | "grading"; question: string }>({
    phase: "idle",
    question: "",
  });
  const [quizAnswer, setQuizAnswer] = useState("");
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  // v3.5 in-app source finder — opened from the Library "find more" row or a
  // resource's "find" chip, pre-seeded with a query.
  const [sourceSearch, setSourceSearch] = useState<{ query: string; kind: SourceKind } | null>(null);
  const [addingResource, setAddingResource] = useState<number | null>(null);
  const journalEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    loadData().then(setData);
  }, []);

  // Offline = read-only: the cached data stays viewable, composing is paused.
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    if (journalEndRef.current) journalEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [data, tab]);

  // Session greeting: one short continuity note per topic-open, never blocking
  // and never an error surface — the strip just stays hidden on failure.
  useEffect(() => {
    setGreeting("");
    setGreetingDismissed(false);
    setReviewDismissed(false);
    setQuiz({ phase: "idle", question: "" });
    setQuizAnswer("");
    setFocusOpen(false);
    if (!activeId || !online) return;
    fetch("/api/greeting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId: activeId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.greeting === "string") setGreeting(d.greeting);
      })
      .catch(() => {});
  }, [activeId, online]);

  const active = data?.topics.find((t) => t.id === activeId);

  // ----- create topic -----
  const createTopic = async () => {
    const name = newTopic.trim();
    if (!name || creating || !data || !online) return;
    setCreating(true);
    setError("");
    try {
      const plan = await api<TopicSetupResponse>("/api/topic", { topic: name });
      const draft: Omit<Topic, "id"> = {
        name,
        createdAt: new Date().toISOString(),
        brief: plan.brief || "",
        whyItMatters: plan.whyItMatters || "",
        roadmap: (plan.roadmap || []).map((s, i) => ({ ...s, id: i, done: false })),
        resources: (plan.resources || []) as Topic["resources"],
        firstStep: plan.firstStep || "",
        journal: [],
        qa: [],
        library: [],
        memory: "",
        nextSuggestion: plan.firstStep || "",
      };
      // The server assigns the id (a DB uuid in cloud mode).
      const { topic } = await storageOp<{ topic: Topic }>({ op: "createTopic", topic: draft });
      setData({ ...data, topics: [topic, ...data.topics] });
      setNewTopic("");
      setActiveId(topic.id);
      setTab("overview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the companion. Check your connection and try again.");
    }
    setCreating(false);
  };

  // ----- journal entry -----
  const submitEntry = async () => {
    const text = entryText.trim();
    if (!text || thinking || !active || !data || !online) return;
    setThinking(true);
    setError("");
    try {
      const res = await api<JournalResponse>("/api/journal", {
        topic: active.name,
        memory: active.memory,
        entry: text,
      });
      const entry = {
        date: new Date().toISOString(),
        userNote: text,
        companionReply: res.reply || "",
      };
      const memory = res.updatedMemory || active.memory;
      const nextSuggestion = res.nextSuggestion || active.nextSuggestion;
      await storageOp({
        op: "addJournalEntry",
        topicId: active.id,
        entry,
        memory,
        nextSuggestion,
      });
      const topics = data.topics.map((t) =>
        t.id === active.id
          ? { ...t, journal: [...t.journal, entry], memory, nextSuggestion }
          : t
      );
      setData({ ...data, topics });
      setEntryText("");
      checkProgress(active.id, text, active.roadmap);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The companion couldn't respond just now. Your note wasn't lost - try sending it again."
      );
    }
    setThinking(false);
  };

  // ----- ask a question (also feeds shared memory) -----
  const askQuestion = async () => {
    const q = askText.trim();
    if (!q || asking || !active || !data || !online) return;
    setAsking(true);
    setError("");
    try {
      const res = await api<AskResponse>("/api/ask", {
        topic: active.name,
        memory: active.memory,
        question: q,
      });
      const item = {
        date: new Date().toISOString(),
        q,
        a: res.answer || "",
        followUp: res.followUp || "",
      };
      const memory = res.updatedMemory || active.memory;
      await storageOp({ op: "addQA", topicId: active.id, item, memory });
      const topics = data.topics.map((t) =>
        t.id === active.id ? { ...t, qa: [...(t.qa || []), item], memory } : t
      );
      setData({ ...data, topics });
      setAskText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't get an answer just now - try again.");
    }
    setAsking(false);
  };

  // v3.3: after a journal entry saves, quietly ask whether it shows a roadmap
  // stage is done. Suggestions only — never errors, never blocks the UI.
  const checkProgress = (topicId: string, entryText: string, roadmapSnapshot: RoadmapStage[]) => {
    fetch("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topicId, entryText }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const ids: number[] = Array.isArray(d?.completedStageIds) ? d.completedStageIds : [];
        if (!ids.length) return;
        const idSet = new Set(ids);
        const mark = (roadmap: RoadmapStage[]) =>
          roadmap.map((s) => (idSet.has(s.id) && !s.done ? { ...s, suggestedDone: true } : s));
        storageOp({ op: "updateRoadmap", topicId, roadmap: mark(roadmapSnapshot) }).catch(() => {});
        setData((prev) =>
          prev
            ? {
                ...prev,
                topics: prev.topics.map((t) => (t.id === topicId ? { ...t, roadmap: mark(t.roadmap) } : t)),
              }
            : prev
        );
      })
      .catch(() => {});
  };

  // Learner confirms or dismisses a suggested stage; either way the flag clears
  // (JSON.stringify drops the undefined, so the store forgets it too).
  const resolveSuggestion = async (stageId: number, accept: boolean) => {
    if (!data || !active || !online) return;
    const roadmap = active.roadmap.map((s) =>
      s.id === stageId ? { ...s, done: accept ? true : s.done, suggestedDone: undefined } : s
    );
    setData({
      ...data,
      topics: data.topics.map((t) => (t.id === active.id ? { ...t, roadmap } : t)),
    });
    try {
      await storageOp({ op: "updateRoadmap", topicId: active.id, roadmap });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
      loadData().then(setData);
    }
  };

  // ----- v3.3 teach-back quiz (persists as a journal entry) -----
  const startQuiz = async (seedNote?: string) => {
    if (!active || quiz.phase === "loading" || quiz.phase === "grading" || !online) return;
    setQuiz({ phase: "loading", question: "" });
    setQuizAnswer("");
    setError("");
    setTab("journal");
    try {
      const res = await api<{ question: string }>("/api/quiz", {
        topicId: active.id,
        mode: "question",
        seedNote,
      });
      setQuiz({ phase: "asked", question: res.question });
    } catch (e) {
      setQuiz({ phase: "idle", question: "" });
      setError(e instanceof Error ? e.message : "The companion couldn't think of a question just now.");
    }
  };

  const submitQuizAnswer = async () => {
    const answer = quizAnswer.trim();
    if (!answer || !active || !data || quiz.phase !== "asked" || !online) return;
    setQuiz({ ...quiz, phase: "grading" });
    setError("");
    try {
      const res = await api<{ feedback: string; updatedMemory: string }>("/api/quiz", {
        topicId: active.id,
        mode: "answer",
        question: quiz.question,
        answer,
      });
      const entry = {
        date: new Date().toISOString(),
        userNote: `Quiz — ${quiz.question}\n\nMy answer: ${answer}`,
        companionReply: res.feedback || "",
      };
      const memory = res.updatedMemory || active.memory;
      await storageOp({
        op: "addJournalEntry",
        topicId: active.id,
        entry,
        memory,
        nextSuggestion: active.nextSuggestion,
      });
      setData({
        ...data,
        topics: data.topics.map((t) =>
          t.id === active.id ? { ...t, journal: [...t.journal, entry], memory } : t
        ),
      });
      setQuiz({ phase: "idle", question: "" });
      setQuizAnswer("");
    } catch (e) {
      setQuiz({ ...quiz, phase: "asked" });
      setError(
        e instanceof Error ? e.message : "The companion couldn't respond just now. Your answer wasn't lost - try again."
      );
    }
  };

  const toggleStage = async (stageId: number) => {
    if (!data || !active || !online) return;
    const roadmap = active.roadmap.map((s) => (s.id === stageId ? { ...s, done: !s.done } : s));
    // Optimistic: update the UI first, reload from the server if the save fails.
    setData({
      ...data,
      topics: data.topics.map((t) => (t.id === active.id ? { ...t, roadmap } : t)),
    });
    try {
      await storageOp({ op: "updateRoadmap", topicId: active.id, roadmap });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
      loadData().then(setData);
    }
  };

  // v3.3: tap-to-cycle a resource through suggested → doing → done.
  const cycleResourceStatus = async (index: number) => {
    if (!data || !active || !online) return;
    const next = { suggested: "doing", doing: "done", done: "suggested" } as const;
    const resources = active.resources.map((r, i) =>
      i === index ? { ...r, status: next[r.status ?? "suggested"] } : r
    );
    setData({
      ...data,
      topics: data.topics.map((t) => (t.id === active.id ? { ...t, resources } : t)),
    });
    try {
      await storageOp({ op: "updateResources", topicId: active.id, resources });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
      loadData().then(setData);
    }
  };

  // v3.5: put a suggested resource (one the model gave a real URL for) on the
  // Study Room shelf — same add flow as pasting the link.
  const addResourceToLibrary = async (index: number) => {
    if (!active || !online || addingResource !== null) return;
    const url = active.resources[index]?.url;
    if (!url) return;
    setAddingResource(index);
    try {
      await addLibraryItem(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that. Try again.");
    }
    setAddingResource(null);
  };

  const deleteTopic = async (id: string) => {
    if (!data || !online) return;
    const topic = data.topics.find((t) => t.id === id);
    if (!window.confirm(`Delete "${topic?.name ?? "this topic"}" and its journal? This can't be undone.`)) return;
    setData({ ...data, topics: data.topics.filter((t) => t.id !== id) });
    if (activeId === id) setActiveId(null);
    try {
      await storageOp({ op: "deleteTopic", topicId: id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete that. Try again.");
      loadData().then(setData);
    }
  };

  // ----- Study Room: library items + discussion -----
  const addLibraryItem = async (url: string) => {
    if (!data || !active) return;
    const { item } = await api<{ item: LibraryItem }>("/api/library", { topicId: active.id, url });
    setData({
      ...data,
      topics: data.topics.map((t) =>
        t.id === active.id ? { ...t, library: [...(t.library ?? []), item] } : t
      ),
    });
  };

  // A picked book from the in-app search — same route, different body shape.
  const addBookItem = async (book: BookPick) => {
    if (!data || !active) return;
    const { item } = await api<{ item: LibraryItem }>("/api/library", {
      topicId: active.id,
      book,
    });
    setData({
      ...data,
      topics: data.topics.map((t) =>
        t.id === active.id ? { ...t, library: [...(t.library ?? []), item] } : t
      ),
    });
  };

  // Merge a partial item update into state without touching anything else
  // (deliberately never the discussion array). Functional form so the poll
  // interval can't work from a stale snapshot.
  const mergeItemPatch = (itemId: string, patch: Partial<LibraryItem>) => {
    setData((d) =>
      d
        ? {
            ...d,
            topics: d.topics.map((t) => ({
              ...t,
              library: (t.library ?? []).map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
            })),
          }
        : d
    );
  };

  // While any items are extraction:"pending" (the background job hasn't
  // landed yet), poll their status. Keyed on the joined id list so the
  // interval dies naturally once everything is terminal; hard tick cap so a
  // stuck job can't poll forever.
  const pendingIds = (active?.library ?? [])
    .filter((i) => i.extraction === "pending")
    .map((i) => i.id)
    .join(",");
  useEffect(() => {
    if (!pendingIds || !online) return;
    let tries = 0;
    const t = setInterval(async () => {
      if (++tries > 40) {
        clearInterval(t);
        return;
      }
      try {
        const res = await fetch(`/api/library/status?ids=${encodeURIComponent(pendingIds)}`);
        if (!res.ok) return;
        const d = await res.json();
        for (const it of d.items ?? []) {
          if (it.extraction !== "pending") {
            mergeItemPatch(it.id, {
              title: it.title,
              siteName: it.siteName,
              thumbnail: it.thumbnail,
              hasContent: it.hasContent,
              extraction: it.extraction,
            });
          }
        }
      } catch {
        // transient network hiccup — next tick retries
      }
    }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingIds, online]);

  // Re-run extraction for a failed item. Runs inline server-side; the caller
  // shows its own busy state, so no optimistic "pending" flag here (a poll
  // tick could race it back to "failed" mid-flight and flicker).
  const retryExtract = async (itemId: string) => {
    const { item } = await api<{ item: LibraryItem }>("/api/library/extract", { itemId });
    mergeItemPatch(itemId, {
      title: item.title,
      siteName: item.siteName,
      thumbnail: item.thumbnail,
      hasContent: item.hasContent,
      extraction: item.extraction,
      bookSource: item.bookSource,
    });
    if (item.extraction !== "ok") {
      throw new Error("Still couldn't get the text — you can paste it yourself below.");
    }
  };

  const pasteText = async (itemId: string, text: string) => {
    await api("/api/library/paste", { itemId, text });
    mergeItemPatch(itemId, { hasContent: true, extraction: "ok" });
  };

  const setLibraryStatus = async (itemId: string, status: LibraryItem["status"]) => {
    if (!data || !active) return;
    // Optimistic, like toggleStage: update first, reload if the save fails.
    setData({
      ...data,
      topics: data.topics.map((t) =>
        t.id === active.id
          ? { ...t, library: (t.library ?? []).map((i) => (i.id === itemId ? { ...i, status } : i)) }
          : t
      ),
    });
    try {
      await storageOp({ op: "updateLibraryStatus", itemId, status });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
      loadData().then(setData);
    }
  };

  const openLibraryItem = (itemId: string) => {
    setOpenItemId(itemId);
    setQuoteSeed("");
    // Books resume where you left off (position lives client-side only).
    let pos = 0;
    try {
      pos = Number(window.localStorage.getItem(`lamp-book-pos-${itemId}`) ?? 0) || 0;
    } catch {
      // storage unavailable (private mode) — start at page 1
    }
    setBookChunkState(pos);
    const item = (active?.library ?? []).find((i) => i.id === itemId);
    if (item && item.status === "unread" && online) void setLibraryStatus(itemId, "reading");
  };

  const setBookChunk = (chunk: number) => {
    setBookChunkState(chunk);
    if (openItemId) {
      try {
        window.localStorage.setItem(`lamp-book-pos-${openItemId}`, String(chunk));
      } catch {
        // fine — the position just won't persist
      }
    }
  };

  const deleteLibraryItem = async (itemId: string) => {
    if (!data || !active || !online) return;
    const item = (active.library ?? []).find((i) => i.id === itemId);
    if (
      !window.confirm(
        `Remove "${item?.title ?? "this item"}" and its discussion? This can't be undone.`
      )
    )
      return;
    setData({
      ...data,
      topics: data.topics.map((t) =>
        t.id === active.id ? { ...t, library: (t.library ?? []).filter((i) => i.id !== itemId) } : t
      ),
    });
    if (openItemId === itemId) setOpenItemId(null);
    try {
      await storageOp({ op: "deleteLibraryItem", itemId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete that. Try again.");
      loadData().then(setData);
    }
  };

  const sendDiscussion = async (itemId: string, message: string) => {
    if (!data || !active) return;
    const item = (active.library ?? []).find((i) => i.id === itemId);
    const res = await api<{ userMsg: DiscussionMsg; companionMsg: DiscussionMsg; memory: string }>(
      "/api/discuss",
      {
        topicId: active.id,
        itemId,
        message,
        // Books: the companion reads the page currently on screen.
        ...(item?.kind === "book" ? { chunk: bookChunk } : {}),
      }
    );
    setData({
      ...data,
      topics: data.topics.map((t) =>
        t.id === active.id
          ? {
              ...t,
              memory: res.memory || t.memory,
              library: (t.library ?? []).map((i) =>
                i.id === itemId
                  ? { ...i, discussion: [...i.discussion, res.userMsg, res.companionMsg] }
                  : i
              ),
            }
          : t
      ),
    });
  };

  // ---------- render ----------
  if (!data) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Spinner label="Opening your study..." />
      </div>
    );
  }

  const wrap: CSSProperties = {
    minHeight: "100vh",
    background: C.bg,
    color: C.ink,
    fontFamily: sans,
    padding: "20px 16px 40px",
  };
  const inner: CSSProperties = { maxWidth: 680, margin: "0 auto" };

  const offlineNote = !online && (
    <div
      style={{
        background: C.panel2,
        border: `1px solid ${C.line}`,
        borderRadius: 10,
        padding: "8px 12px",
        color: C.dim,
        fontSize: 13,
        lineHeight: 1.5,
        marginBottom: 14,
      }}
    >
      You&apos;re offline — showing your last sync. Reading works; writing needs a connection.
    </div>
  );

  // ----- home -----
  if (!active) {
    return (
      <div style={wrap}>
        <div style={inner}>
          <header style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
            <Lamp level={Math.min(1, data.topics.reduce((a, t) => a + t.journal.length, 0) / 15)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ fontFamily: serif, fontSize: 30, fontWeight: 500, margin: 0, letterSpacing: "-0.01em" }}>
                Study Lamp
              </h1>
              <div style={{ color: C.dim, fontSize: 14 }}>A companion that learns alongside you</div>
            </div>
            {supabaseEnabled && (
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  style={{
                    fontFamily: sans,
                    fontSize: 12,
                    fontWeight: 600,
                    background: "transparent",
                    color: C.dim,
                    border: `1px solid ${C.line}`,
                    borderRadius: 8,
                    padding: "7px 10px",
                    cursor: "pointer",
                  }}
                >
                  Sign out
                </button>
              </form>
            )}
          </header>
          {offlineNote && <div style={{ marginTop: 12 }}>{offlineNote}</div>}

          <Card style={{ marginTop: 22 }}>
            <Eyebrow>Start something new</Eyebrow>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createTopic()}
                placeholder="e.g. music theory, Rust, watercolor..."
                style={{
                  flex: 1,
                  background: C.bg,
                  border: `1px solid ${C.line}`,
                  borderRadius: 10,
                  padding: "10px 12px",
                  color: C.ink,
                  fontSize: 16, // ≥16px stops iOS Safari zooming the field on focus
                  outline: "none",
                }}
              />
              <Btn onClick={createTopic} disabled={creating || !newTopic.trim() || !online}>
                {creating ? "Reading up..." : "Begin"}
              </Btn>
            </div>
            {creating && (
              <div style={{ marginTop: 12 }}>
                <Spinner label={`Preparing a brief, roadmap and resources for "${newTopic.trim()}"...`} />
              </div>
            )}
            {error && <div style={{ marginTop: 10, color: C.danger, fontSize: 13 }}>{error}</div>}
          </Card>

          {data.topics.length === 0 && !creating && (
            <div style={{ marginTop: 28, color: C.dim, fontSize: 14, lineHeight: 1.6 }}>
              Name a topic above and the lamp lights up: you&apos;ll get a plain-language brief, a step-by-step path,
              real resources, and a journal where the companion learns with you and remembers everything.
            </div>
          )}

          {data.topics.length > 0 && (
            <div style={{ marginTop: 26 }}>
              <Eyebrow>Your topics</Eyebrow>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {data.topics.map((t) => {
                  const done = t.roadmap.filter((s) => s.done).length;
                  return (
                    <Card key={t.id} style={{ cursor: "pointer" }}>
                      <div
                        onClick={() => {
                          setActiveId(t.id);
                          setTab("overview");
                          setOpenItemId(null);
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                          <div style={{ fontFamily: serif, fontSize: 19 }}>{t.name}</div>
                          <div style={{ color: C.dim, fontSize: 12 }}>{t.journal.length} entries</div>
                        </div>
                        <div style={{ marginTop: 10, height: 5, background: C.bg, borderRadius: 3 }}>
                          <div
                            style={{
                              width: `${t.roadmap.length ? (done / t.roadmap.length) * 100 : 0}%`,
                              height: "100%",
                              background: C.sage,
                              borderRadius: 3,
                              transition: "width 0.4s",
                            }}
                          />
                        </div>
                        <div style={{ marginTop: 6, color: C.dim, fontSize: 12 }}>
                          {done}/{t.roadmap.length} stages
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ----- topic view -----
  // v3.3 gentle review (spaced-lite, zero LLM cost until acted on): surface an
  // entry that's ~7 or ~21 days old and hasn't been quiz-revisited since.
  const DAY = 86400000;
  const lastQuizTime = active.journal
    .filter((e) => e.userNote.startsWith("Quiz —"))
    .reduce((max, e) => Math.max(max, Date.parse(e.date)), 0);
  const reviewCandidate =
    active.journal
      .filter((e) => !e.userNote.startsWith("Quiz —"))
      .filter((e) => {
        const age = Date.now() - Date.parse(e.date);
        return age >= 7 * DAY && Date.parse(e.date) > lastQuizTime;
      })
      .sort((a, b) => {
        // Closest to a spaced interval (7 or 21 days) wins.
        const dist = (e: typeof a) => {
          const days = (Date.now() - Date.parse(e.date)) / DAY;
          return Math.min(Math.abs(days - 7), Math.abs(days - 21));
        };
        return dist(a) - dist(b);
      })[0] ?? null;

  const doneCount = active.roadmap.filter((s) => s.done).length;
  const glowLevel = Math.min(1, (active.journal.length + (active.qa || []).length * 0.5) / 10);
  const qaList = active.qa || [];
  const libraryList = active.library ?? [];
  const openItem = libraryList.find((i) => i.id === openItemId) ?? null;
  const tabs: [string, string][] = [
    ["overview", "Brief"],
    ["path", "Path"],
    ["library", `Library${libraryList.length ? " · " + libraryList.length : ""}`],
    ["ask", `Ask${qaList.length ? " · " + qaList.length : ""}`],
    ["journal", `Journal${active.journal.length ? " · " + active.journal.length : ""}`],
  ];

  return (
    <div style={wrap}>
      <div style={inner} className="lc-topic-inner">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <Btn
            variant="ghost"
            onClick={() => {
              setActiveId(null);
              setOpenItemId(null);
            }}
            style={{ padding: "8px 12px" }}
          >
            ← Topics
          </Btn>
          <Lamp level={glowLevel} size={34} />
          <h1
            style={{
              fontFamily: serif,
              fontSize: 22,
              fontWeight: 500,
              margin: 0,
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {active.name}
          </h1>
          {!focusOpen && (
            <Btn variant="ghost" onClick={() => setFocusOpen(true)} style={{ padding: "8px 12px", flexShrink: 0 }}>
              ◉ Focus
            </Btn>
          )}
        </div>

        {focusOpen && (
          <FocusSession
            topicName={active.name}
            onFinish={(minutes) => {
              setFocusOpen(false);
              setTab("journal");
              setEntryText(`Focused for ${minutes} min on ${active.name} — `);
            }}
            onClose={() => setFocusOpen(false)}
          />
        )}

        {offlineNote}

        <div className="lc-tabs" style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {tabs.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                fontFamily: sans,
                fontSize: 13,
                fontWeight: 600,
                padding: "8px 14px",
                borderRadius: 999,
                border: `1px solid ${tab === key ? C.amber : C.line}`,
                background: tab === key ? C.amberSoft : "transparent",
                color: tab === key ? C.amber : C.dim,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {greeting && !greetingDismissed && (
          <div
            style={{
              background: C.amberSoft,
              border: `1px solid ${C.amber}`,
              borderRadius: 12,
              padding: "10px 14px",
              marginBottom: 16,
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
            }}
          >
            <div style={{ flex: 1, fontFamily: serif, fontSize: 14, lineHeight: 1.6 }}>
              <Linkify text={greeting} />
            </div>
            <button
              onClick={() => setGreetingDismissed(true)}
              aria-label="Dismiss greeting"
              style={{
                background: "none",
                border: "none",
                color: C.dim,
                cursor: "pointer",
                fontSize: 16,
                padding: 2,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        )}

        {reviewCandidate && !reviewDismissed && quiz.phase === "idle" && (
          <div
            style={{
              background: C.panel2,
              border: `1px solid ${C.line}`,
              borderRadius: 12,
              padding: "10px 14px",
              marginBottom: 16,
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 200, fontSize: 13, lineHeight: 1.5, color: C.dim }}>
              A while back you learned:{" "}
              <span style={{ color: C.ink, fontFamily: serif }}>
                &ldquo;{reviewCandidate.userNote.slice(0, 90)}
                {reviewCandidate.userNote.length > 90 ? "…" : ""}&rdquo;
              </span>{" "}
              — still got it?
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Btn
                variant="ghost"
                onClick={() => {
                  setReviewDismissed(true);
                  startQuiz(reviewCandidate.userNote);
                }}
                disabled={!online}
                style={{ padding: "6px 12px", fontSize: 13 }}
              >
                Quiz me on it
              </Btn>
              <button
                onClick={() => setReviewDismissed(true)}
                aria-label="Dismiss review reminder"
                style={{
                  background: "none",
                  border: "none",
                  color: C.dim,
                  cursor: "pointer",
                  fontSize: 16,
                  padding: 2,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          </div>
        )}

        {tab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Card>
              <Eyebrow>The brief</Eyebrow>
              <p style={{ margin: 0, lineHeight: 1.65, fontSize: 15 }}>{active.brief}</p>
              {active.whyItMatters && (
                <p style={{ margin: "12px 0 0", lineHeight: 1.6, fontSize: 14, color: C.dim, fontStyle: "italic" }}>
                  {active.whyItMatters}
                </p>
              )}
            </Card>

            <Card style={{ borderColor: C.amber, background: C.amberSoft }}>
              <Eyebrow>Start here today</Eyebrow>
              <p style={{ margin: 0, lineHeight: 1.6, fontSize: 15 }}>{active.firstStep}</p>
            </Card>

            {/* Gentle progress: numbers that only ever grow — no streaks, no guilt. */}
            <Card>
              <Eyebrow>Our progress</Eyebrow>
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 14, lineHeight: 1.6 }}>
                <span>
                  <strong style={{ color: C.sage }}>{doneCount}</strong>
                  <span style={{ color: C.dim }}>/{active.roadmap.length} stages</span>
                </span>
                <span>
                  <strong>{active.journal.length}</strong>{" "}
                  <span style={{ color: C.dim }}>journal {active.journal.length === 1 ? "entry" : "entries"}</span>
                </span>
                <span>
                  <strong>{qaList.length}</strong>{" "}
                  <span style={{ color: C.dim }}>{qaList.length === 1 ? "question" : "questions"} asked</span>
                </span>
                <span>
                  <strong style={{ color: C.sage }}>
                    {active.resources.filter((r) => r.status === "done").length}
                  </strong>
                  <span style={{ color: C.dim }}>/{active.resources.length} resources</span>
                </span>
              </div>
              <div style={{ marginTop: 12, height: 5, background: C.bg, borderRadius: 3 }}>
                <div
                  style={{
                    width: `${active.roadmap.length ? (doneCount / active.roadmap.length) * 100 : 0}%`,
                    height: "100%",
                    background: C.sage,
                    borderRadius: 3,
                    transition: "width 0.4s",
                  }}
                />
              </div>
              <div style={{ marginTop: 10, color: C.dim, fontSize: 12 }}>
                Learning together since{" "}
                {new Date(active.createdAt).toLocaleDateString(undefined, {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
                . Come back whenever — the lamp stays lit.
              </div>
            </Card>

            <Card>
              <Eyebrow>Resources</Eyebrow>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {active.resources.map((r, i) => {
                  const status = r.status ?? "suggested";
                  const statusColor = status === "done" ? C.sage : status === "doing" ? C.amber : C.dim;
                  // v3.5: bridge a suggestion to the Study Room — add directly
                  // when the model gave a URL, otherwise offer a real search.
                  const inShelf =
                    !!r.url && (active.library ?? []).some((it) => urlKey(it.url) === urlKey(r.url!));
                  const findQuery = r.title.toLowerCase().includes(active.name.toLowerCase())
                    ? r.title
                    : `${r.title} ${active.name}`;
                  const resourceChip: React.CSSProperties = {
                    fontFamily: sans,
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "3px 10px",
                    borderRadius: 999,
                    border: `1px solid ${C.line}`,
                    background: "transparent",
                    color: C.dim,
                    cursor: "pointer",
                  };
                  return (
                    <div
                      key={i}
                      style={{
                        paddingBottom: i < active.resources.length - 1 ? 12 : 0,
                        borderBottom: i < active.resources.length - 1 ? `1px solid ${C.line}` : "none",
                        opacity: status === "done" ? 0.75 : 1,
                      }}
                    >
                      <div
                        style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 15, fontWeight: 600 }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <a
                            href={r.url ? readerUrl(r.url) : searchUrl(`${r.title} ${active.name}`)}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              color: C.ink,
                              textDecoration: "underline",
                              textDecorationColor: C.amber,
                              textUnderlineOffset: 3,
                            }}
                          >
                            {r.title} ↗
                          </a>{" "}
                          <span
                            style={{
                              fontSize: 11,
                              color: C.amber,
                              fontWeight: 600,
                              textTransform: "uppercase",
                              letterSpacing: "0.08em",
                              marginLeft: 6,
                            }}
                          >
                            {r.type}
                          </span>
                        </div>
                        <button
                          onClick={() => cycleResourceStatus(i)}
                          title="Tap to change: suggested → doing → done"
                          style={{
                            fontFamily: sans,
                            fontSize: 11,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            padding: "3px 10px",
                            borderRadius: 999,
                            border: `1px solid ${statusColor}`,
                            background: "transparent",
                            color: statusColor,
                            cursor: "pointer",
                            flexShrink: 0,
                          }}
                        >
                          {status === "done" ? "✓ done" : status}
                        </button>
                      </div>
                      <div style={{ color: C.dim, fontSize: 13, marginTop: 3, lineHeight: 1.5 }}>{r.why}</div>
                      <div style={{ marginTop: 7 }}>
                        {r.url ? (
                          inShelf ? (
                            <span style={{ ...resourceChip, cursor: "default", color: C.sage, borderColor: C.sage }}>
                              in library ✓
                            </span>
                          ) : (
                            <button
                              onClick={() => void addResourceToLibrary(i)}
                              disabled={addingResource !== null || !online}
                              style={resourceChip}
                            >
                              {addingResource === i ? "adding…" : "＋ add to library"}
                            </button>
                          )
                        ) : (
                          <button
                            onClick={() =>
                              setSourceSearch({
                                query: findQuery,
                                kind: r.type === "video" ? "video" : "article",
                              })
                            }
                            disabled={!online}
                            style={resourceChip}
                          >
                            find it 🔍
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 12, fontSize: 12, color: C.dim }}>
                Suggested from the companion&apos;s knowledge - worth verifying availability yourself.
              </div>
            </Card>

            <Btn variant="danger" onClick={() => deleteTopic(active.id)} style={{ alignSelf: "flex-start" }}>
              Delete this topic
            </Btn>
          </div>
        )}

        {tab === "path" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ color: C.dim, fontSize: 13, marginBottom: 4 }}>
              {doneCount} of {active.roadmap.length} stages complete - tap a stage when you&apos;ve got it.
            </div>
            {active.roadmap.map((s) => {
              const suggested = !s.done && s.suggestedDone;
              return (
                <Card
                  key={s.id}
                  style={{
                    cursor: "pointer",
                    opacity: s.done ? 0.75 : 1,
                    borderColor: s.done ? C.sage : suggested ? C.amber : C.line,
                    background: suggested ? C.amberSoft : undefined,
                  }}
                >
                  <div onClick={() => toggleStage(s.id)} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 7,
                        border: `2px solid ${s.done ? C.sage : suggested ? C.amber : C.dim}`,
                        background: s.done ? C.sage : "transparent",
                        color: C.bg,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 14,
                        fontWeight: 800,
                        flexShrink: 0,
                        marginTop: 1,
                      }}
                    >
                      {s.done ? "✓" : ""}
                    </div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 600, textDecoration: s.done ? "line-through" : "none" }}>
                        {s.title}
                      </div>
                      <div style={{ color: C.dim, fontSize: 13, marginTop: 3, lineHeight: 1.5 }}>{s.desc}</div>
                    </div>
                  </div>
                  {suggested && (
                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                        flexWrap: "wrap",
                        marginTop: 10,
                        paddingTop: 10,
                        borderTop: `1px solid ${C.line}`,
                      }}
                    >
                      <span style={{ fontSize: 13, color: C.amber, flex: 1, minWidth: 180 }}>
                        From your journal, the companion thinks you&apos;ve got this one.
                      </span>
                      <Btn
                        onClick={() => resolveSuggestion(s.id, true)}
                        style={{ padding: "6px 12px", fontSize: 13 }}
                      >
                        Mark done
                      </Btn>
                      <Btn
                        variant="ghost"
                        onClick={() => resolveSuggestion(s.id, false)}
                        style={{ padding: "6px 12px", fontSize: 13 }}
                      >
                        Not yet
                      </Btn>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        {tab === "library" && (
          <Library
            topic={active}
            online={online}
            onAdd={addLibraryItem}
            onAddBook={addBookItem}
            onFindSources={(query, kind) => setSourceSearch({ query, kind })}
            onOpen={openLibraryItem}
            onDelete={deleteLibraryItem}
            onRetry={retryExtract}
          />
        )}

        {tab === "ask" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Card>
              <Eyebrow>Ask anything about {active.name}</Eyebrow>
              <textarea
                value={askText}
                onChange={(e) => setAskText(e.target.value)}
                placeholder="What's the difference between... / Why does... / How do I..."
                rows={3}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: C.bg,
                  border: `1px solid ${C.line}`,
                  borderRadius: 10,
                  padding: "10px 12px",
                  color: C.ink,
                  fontSize: 16, // ≥16px stops iOS Safari zooming the field on focus
                  fontFamily: sans,
                  outline: "none",
                  resize: "vertical",
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
                <Btn onClick={askQuestion} disabled={asking || !askText.trim() || !online}>
                  {asking ? "Thinking..." : "Ask"}
                </Btn>
                {asking && <Spinner label="Looking into it..." />}
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: C.dim }}>
                Answers here also feed our shared memory, so asking counts as learning.
              </div>
              {error && <div style={{ marginTop: 10, color: C.danger, fontSize: 13 }}>{error}</div>}
            </Card>

            {qaList.length === 0 && (
              <div style={{ color: C.dim, fontSize: 14, lineHeight: 1.6, padding: "4px 2px" }}>
                No questions yet. Anything you&apos;re curious or confused about is a good place to start.
              </div>
            )}

            {[...qaList].reverse().map((item, i) => (
              <Card key={i}>
                <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.5 }}>{item.q}</div>
                <div style={{ marginTop: 10, fontSize: 15, lineHeight: 1.65, fontFamily: serif }}>
                  <Linkify text={item.a} />
                </div>
                {item.followUp && (
                  <div
                    onClick={() => setAskText(item.followUp)}
                    style={{ marginTop: 12, fontSize: 13, color: C.amber, cursor: "pointer" }}
                  >
                    Explore next: {item.followUp}
                  </div>
                )}
                <div style={{ marginTop: 10, color: C.dim, fontSize: 11 }}>
                  {new Date(item.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </div>
              </Card>
            ))}
          </div>
        )}

        {tab === "journal" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Card style={{ background: C.panel2 }}>
              <Eyebrow>What we&apos;ve learned together</Eyebrow>
              <p style={{ margin: 0, lineHeight: 1.65, fontSize: 14, color: active.memory ? C.ink : C.dim }}>
                {active.memory ||
                  "Nothing yet. Write your first entry below - tell me what you read, tried, or figured out - and this shared memory will start to grow."}
              </p>
              {active.nextSuggestion && (
                <div style={{ marginTop: 12, fontSize: 13, color: C.amber }}>Next: {active.nextSuggestion}</div>
              )}
            </Card>

            {active.journal.map((e, i) => (
              <div key={i}>
                <div style={{ color: C.dim, fontSize: 11, marginBottom: 6, letterSpacing: "0.06em" }}>
                  {new Date(e.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                </div>
                <Card style={{ borderRadius: "14px 14px 14px 4px", marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: C.dim, marginBottom: 5 }}>You</div>
                  <div style={{ fontSize: 15, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{e.userNote}</div>
                </Card>
                <Card style={{ borderRadius: "14px 14px 4px 14px", borderColor: "#3A4560", background: C.panel2 }}>
                  <div style={{ fontSize: 12, color: C.amber, marginBottom: 5 }}>Companion</div>
                  <div style={{ fontSize: 15, lineHeight: 1.6, fontFamily: serif }}>
                    <Linkify text={e.companionReply} />
                  </div>
                </Card>
              </div>
            ))}
            <div ref={journalEndRef} />

            {quiz.phase !== "idle" && (
              <Card style={{ borderColor: C.amber }}>
                <Eyebrow>Quiz time — explain it back</Eyebrow>
                {quiz.phase === "loading" ? (
                  <Spinner label="The companion is thinking of a question..." />
                ) : (
                  <>
                    <div style={{ fontFamily: serif, fontSize: 15, lineHeight: 1.6, marginBottom: 10 }}>
                      {quiz.question}
                    </div>
                    <textarea
                      value={quizAnswer}
                      onChange={(e) => setQuizAnswer(e.target.value)}
                      placeholder="Explain it in your own words - imperfect is fine, that's the point..."
                      rows={3}
                      disabled={quiz.phase === "grading"}
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        background: C.bg,
                        border: `1px solid ${C.line}`,
                        borderRadius: 10,
                        padding: "10px 12px",
                        color: C.ink,
                        fontSize: 16,
                        fontFamily: sans,
                        outline: "none",
                        resize: "vertical",
                      }}
                    />
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
                      <Btn onClick={submitQuizAnswer} disabled={quiz.phase === "grading" || !quizAnswer.trim() || !online}>
                        {quiz.phase === "grading" ? "Checking..." : "That's my answer"}
                      </Btn>
                      {quiz.phase === "grading" ? (
                        <Spinner label="The companion is reading your answer..." />
                      ) : (
                        <Btn variant="ghost" onClick={() => setQuiz({ phase: "idle", question: "" })}>
                          Not now
                        </Btn>
                      )}
                      <div style={{ marginLeft: "auto" }}>
                        <MicButton
                          onText={(t) => setQuizAnswer((v) => (v ? v.replace(/\s*$/, " ") : "") + t)}
                          disabled={quiz.phase === "grading"}
                        />
                      </div>
                    </div>
                  </>
                )}
              </Card>
            )}

            <Card>
              <Eyebrow>Tell me what you learned</Eyebrow>
              <textarea
                value={entryText}
                onChange={(e) => setEntryText(e.target.value)}
                placeholder="Today I read about... / I tried... / I'm confused by..."
                rows={4}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: C.bg,
                  border: `1px solid ${C.line}`,
                  borderRadius: 10,
                  padding: "10px 12px",
                  color: C.ink,
                  fontSize: 16, // ≥16px stops iOS Safari zooming the field on focus
                  fontFamily: sans,
                  outline: "none",
                  resize: "vertical",
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
                <Btn onClick={submitEntry} disabled={thinking || !entryText.trim() || !online}>
                  {thinking ? "Listening..." : "Share"}
                </Btn>
                {thinking && <Spinner label="The companion is reflecting..." />}
                {!thinking && quiz.phase === "idle" && active.memory && (
                  <Btn variant="ghost" onClick={() => startQuiz()} disabled={!online}>
                    Quiz me
                  </Btn>
                )}
                <div style={{ marginLeft: "auto" }}>
                  <MicButton onText={(t) => setEntryText((v) => (v ? v.replace(/\s*$/, " ") : "") + t)} disabled={thinking} />
                </div>
              </div>
              {error && <div style={{ marginTop: 10, color: C.danger, fontSize: 13 }}>{error}</div>}
            </Card>
          </div>
        )}

        {openItem && (
          <ReaderView
            item={openItem}
            online={online}
            onClose={() => setOpenItemId(null)}
            onRetry={() => retryExtract(openItem.id)}
            onPaste={(text) => pasteText(openItem.id, text)}
            onQuote={setQuoteSeed}
            onLogLearned={() => {
              setOpenItemId(null);
              setTab("journal");
              setEntryText(`Watched: ${openItem.title} — `);
            }}
            bookChunk={bookChunk}
            onBookChunk={setBookChunk}
            panel={
              <DiscussPanel
                item={openItem}
                online={online}
                onSend={(m) => sendDiscussion(openItem.id, m)}
                onSetStatus={(s) => setLibraryStatus(openItem.id, s)}
                onPaste={(text) => pasteText(openItem.id, text)}
                seedDraft={quoteSeed}
                onSeedConsumed={() => setQuoteSeed("")}
              />
            }
          />
        )}

        {sourceSearch && (
          <SourceSearch
            topic={active}
            online={online}
            initialQuery={sourceSearch.query}
            initialKind={sourceSearch.kind}
            onAdd={addLibraryItem}
            onClose={() => setSourceSearch(null)}
          />
        )}
      </div>
    </div>
  );
}
