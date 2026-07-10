"use client";

import { useState, useEffect, useRef, CSSProperties, ReactNode } from "react";
import type { AppData, Topic } from "@/lib/types";
import type { TopicSetupResponse, JournalResponse, AskResponse } from "@/lib/schemas";

// ---------- palette: "study lamp at night" (handoff §7) ----------
const C = {
  bg: "#141A26",
  panel: "#1C2433",
  panel2: "#222D40",
  line: "#2C3750",
  ink: "#EFEAE0",
  dim: "#8A94A8",
  amber: "#F5B34E",
  amberSoft: "rgba(245,179,78,0.14)",
  sage: "#8FBF7F",
  danger: "#D9776B",
};
const serif = "Georgia, 'Iowan Old Style', 'Times New Roman', serif";
const sans = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// ---------- server calls ----------
async function api<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || "Couldn't reach the companion. Check your connection and try again.");
  }
  return data as T;
}

async function loadData(): Promise<AppData> {
  try {
    const res = await fetch("/api/storage");
    const data = await res.json();
    return data && Array.isArray(data.topics) ? data : { topics: [] };
  } catch {
    return { topics: [] };
  }
}

async function saveData(d: AppData): Promise<void> {
  try {
    await fetch("/api/storage", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(d),
    });
  } catch (e) {
    console.error("Save failed", e);
  }
}

// ---------- small UI atoms ----------
function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.line}`,
        borderRadius: 14,
        padding: 16,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: sans,
        fontSize: 11,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: C.amber,
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

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

function Btn({
  children,
  onClick,
  disabled,
  variant = "solid",
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "solid" | "ghost" | "danger";
  style?: CSSProperties;
}) {
  const base: CSSProperties = {
    fontFamily: sans,
    fontSize: 14,
    fontWeight: 600,
    borderRadius: 10,
    padding: "10px 16px",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
    border: "none",
    transition: "opacity 0.2s",
  };
  const variants: Record<string, CSSProperties> = {
    solid: { background: C.amber, color: "#1B1406" },
    ghost: {
      background: "transparent",
      color: C.dim,
      border: `1px solid ${C.line}`,
    },
    danger: { background: "transparent", color: C.danger, border: `1px solid ${C.line}` },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant], ...style }}>
      {children}
    </button>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, color: C.dim, fontFamily: sans, fontSize: 14 }}>
      <span
        className="lc-pulse"
        style={{ width: 10, height: 10, borderRadius: "50%", background: C.amber, display: "inline-block" }}
      />
      {label}
    </div>
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
  const journalEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    loadData().then(setData);
  }, []);

  useEffect(() => {
    if (journalEndRef.current) journalEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [data, tab]);

  const persist = async (next: AppData) => {
    setData(next);
    await saveData(next);
  };

  const active = data?.topics.find((t) => t.id === activeId);

  // ----- create topic -----
  const createTopic = async () => {
    const name = newTopic.trim();
    if (!name || creating || !data) return;
    setCreating(true);
    setError("");
    try {
      const plan = await api<TopicSetupResponse>("/api/topic", { topic: name });
      const topic: Topic = {
        id: Date.now().toString(36),
        name,
        createdAt: new Date().toISOString(),
        brief: plan.brief || "",
        whyItMatters: plan.whyItMatters || "",
        roadmap: (plan.roadmap || []).map((s, i) => ({ ...s, id: i, done: false })),
        resources: (plan.resources || []) as Topic["resources"],
        firstStep: plan.firstStep || "",
        journal: [],
        qa: [],
        memory: "",
        nextSuggestion: plan.firstStep || "",
      };
      const next = { ...data, topics: [topic, ...data.topics] };
      await persist(next);
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
    if (!text || thinking || !active || !data) return;
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
      const topics = data.topics.map((t) =>
        t.id === active.id
          ? {
              ...t,
              journal: [...t.journal, entry],
              memory: res.updatedMemory || t.memory,
              nextSuggestion: res.nextSuggestion || t.nextSuggestion,
            }
          : t
      );
      await persist({ ...data, topics });
      setEntryText("");
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
    if (!q || asking || !active || !data) return;
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
      const topics = data.topics.map((t) =>
        t.id === active.id ? { ...t, qa: [...(t.qa || []), item], memory: res.updatedMemory || t.memory } : t
      );
      await persist({ ...data, topics });
      setAskText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't get an answer just now - try again.");
    }
    setAsking(false);
  };

  const toggleStage = async (stageId: number) => {
    if (!data || !active) return;
    const topics = data.topics.map((t) =>
      t.id === active.id
        ? { ...t, roadmap: t.roadmap.map((s) => (s.id === stageId ? { ...s, done: !s.done } : s)) }
        : t
    );
    await persist({ ...data, topics });
  };

  const deleteTopic = async (id: string) => {
    if (!data) return;
    const topic = data.topics.find((t) => t.id === id);
    if (!window.confirm(`Delete "${topic?.name ?? "this topic"}" and its journal? This can't be undone.`)) return;
    const topics = data.topics.filter((t) => t.id !== id);
    await persist({ ...data, topics });
    if (activeId === id) setActiveId(null);
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

  // ----- home -----
  if (!active) {
    return (
      <div style={wrap}>
        <div style={inner}>
          <header style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
            <Lamp level={Math.min(1, data.topics.reduce((a, t) => a + t.journal.length, 0) / 15)} />
            <div>
              <h1 style={{ fontFamily: serif, fontSize: 30, fontWeight: 500, margin: 0, letterSpacing: "-0.01em" }}>
                Study Lamp
              </h1>
              <div style={{ color: C.dim, fontSize: 14 }}>A companion that learns alongside you</div>
            </div>
          </header>

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
                  fontSize: 15,
                  outline: "none",
                }}
              />
              <Btn onClick={createTopic} disabled={creating || !newTopic.trim()}>
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
  const doneCount = active.roadmap.filter((s) => s.done).length;
  const glowLevel = Math.min(1, (active.journal.length + (active.qa || []).length * 0.5) / 10);
  const qaList = active.qa || [];
  const tabs: [string, string][] = [
    ["overview", "Brief"],
    ["path", "Path"],
    ["ask", `Ask${qaList.length ? " · " + qaList.length : ""}`],
    ["journal", `Journal${active.journal.length ? " · " + active.journal.length : ""}`],
  ];

  return (
    <div style={wrap}>
      <div style={inner}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <Btn variant="ghost" onClick={() => setActiveId(null)} style={{ padding: "8px 12px" }}>
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
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
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

            <Card>
              <Eyebrow>Resources</Eyebrow>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {active.resources.map((r, i) => (
                  <div
                    key={i}
                    style={{
                      paddingBottom: i < active.resources.length - 1 ? 12 : 0,
                      borderBottom: i < active.resources.length - 1 ? `1px solid ${C.line}` : "none",
                    }}
                  >
                    <div style={{ fontSize: 15, fontWeight: 600 }}>
                      {r.title}{" "}
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
                    <div style={{ color: C.dim, fontSize: 13, marginTop: 3, lineHeight: 1.5 }}>{r.why}</div>
                  </div>
                ))}
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
            {active.roadmap.map((s) => (
              <Card
                key={s.id}
                style={{
                  cursor: "pointer",
                  opacity: s.done ? 0.75 : 1,
                  borderColor: s.done ? C.sage : C.line,
                }}
              >
                <div onClick={() => toggleStage(s.id)} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 7,
                      border: `2px solid ${s.done ? C.sage : C.dim}`,
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
              </Card>
            ))}
          </div>
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
                  fontSize: 15,
                  fontFamily: sans,
                  outline: "none",
                  resize: "vertical",
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
                <Btn onClick={askQuestion} disabled={asking || !askText.trim()}>
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
                <div style={{ marginTop: 10, fontSize: 15, lineHeight: 1.65, fontFamily: serif }}>{item.a}</div>
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
                  <div style={{ fontSize: 15, lineHeight: 1.6, fontFamily: serif }}>{e.companionReply}</div>
                </Card>
              </div>
            ))}
            <div ref={journalEndRef} />

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
                  fontSize: 15,
                  fontFamily: sans,
                  outline: "none",
                  resize: "vertical",
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
                <Btn onClick={submitEntry} disabled={thinking || !entryText.trim()}>
                  {thinking ? "Listening..." : "Share"}
                </Btn>
                {thinking && <Spinner label="The companion is reflecting..." />}
              </div>
              {error && <div style={{ marginTop: 10, color: C.danger, fontSize: 13 }}>{error}</div>}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
