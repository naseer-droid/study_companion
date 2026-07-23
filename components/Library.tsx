"use client";

import { useState } from "react";
import type { LibraryItem, Topic } from "@/lib/types";
import { extractionState } from "@/lib/types";
import { C, sans, Card, Eyebrow, Btn, Spinner } from "./lamp-ui";
import BookSearch, { type BookPick } from "./BookSearch";
import SuggestPanel from "./SuggestPanel";
import type { SourceKind } from "./SourceSearch";

const statusLabel: Record<LibraryItem["status"], string> = {
  unread: "Unread",
  reading: "Reading",
  done: "Done",
};
const statusColor: Record<LibraryItem["status"], string> = {
  unread: C.dim,
  reading: C.amber,
  done: C.sage,
};

const kindTile: Record<LibraryItem["kind"], string> = {
  youtube: "VIDEO",
  article: "ARTICLE",
  book: "BOOK",
};
const kindFallbackSite: Record<LibraryItem["kind"], string> = {
  youtube: "YouTube",
  article: "Link",
  book: "Book",
};

type StatusFilter = "all" | "unread" | "reading" | "done";
type KindFilter = "all" | "youtube" | "article" | "book";

// The Study Room shelf: paste article/YouTube/Drive links or pick books, tap
// to read/watch with the companion. Item mutations are owned by the parent
// (StudyLamp).
export default function Library({
  topic,
  online,
  onAdd,
  onAddBook,
  onAddMarkdown,
  onFindSources,
  onOpen,
  onDelete,
  onRetry,
}: {
  topic: Topic;
  online: boolean;
  onAdd: (url: string) => Promise<void>;
  onAddBook: (book: BookPick) => Promise<void>;
  onAddMarkdown: (markdown: string, title?: string) => Promise<void>;
  onFindSources: (query: string, kind: SourceKind) => void;
  onOpen: (itemId: string) => void;
  onDelete: (itemId: string) => Promise<void>;
  onRetry: (itemId: string) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [findOpen, setFindOpen] = useState(false);
  const [bookSearchOpen, setBookSearchOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [mdOpen, setMdOpen] = useState(false);
  const [mdText, setMdText] = useState("");
  const [mdTitle, setMdTitle] = useState("");
  const [mdBusy, setMdBusy] = useState(false);
  const [mdError, setMdError] = useState("");

  const add = async () => {
    const u = url.trim();
    if (!u || adding || !online) return;
    setAdding(true);
    setError("");
    try {
      await onAdd(u);
      setUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that link. Try again.");
    }
    setAdding(false);
  };

  const addMarkdown = async () => {
    const md = mdText.trim();
    if (!md || mdBusy || !online) return;
    setMdBusy(true);
    setMdError("");
    try {
      await onAddMarkdown(md, mdTitle.trim() || undefined);
      setMdText("");
      setMdTitle("");
      setMdOpen(false);
    } catch (e) {
      setMdError(e instanceof Error ? e.message : "Couldn't add that. Try again.");
    }
    setMdBusy(false);
  };

  // Read a picked .md/.txt file into the textarea (client-side); the user can
  // review and then Add. FileReader keeps it keyless and offline-friendly.
  const onPickMdFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setMdText(typeof reader.result === "string" ? reader.result : "");
      setMdTitle((t) =>
        t.trim()
          ? t
          : file.name.replace(/\.(md|markdown|txt)$/i, "").replace(/[-_]+/g, " ").trim()
      );
    };
    reader.readAsText(file);
  };

  const retry = async (itemId: string) => {
    if (retryingId || !online) return;
    setRetryingId(itemId);
    try {
      await onRetry(itemId);
    } catch {
      // the card keeps its "no text" badge — the reader offers paste-yourself
    }
    setRetryingId(null);
  };

  const items = topic.library ?? [];
  const q = query.trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (statusFilter !== "all" && item.status !== statusFilter) return false;
    if (kindFilter !== "all" && item.kind !== kindFilter) return false;
    if (q && !`${item.title} ${item.siteName ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const filtersActive = q !== "" || statusFilter !== "all" || kindFilter !== "all";

  const chip = (active: boolean): React.CSSProperties => ({
    fontFamily: sans,
    fontSize: 12,
    fontWeight: 600,
    padding: "6px 12px",
    borderRadius: 999,
    border: `1px solid ${active ? C.amber : C.line}`,
    background: active ? C.amberSoft : "transparent",
    color: active ? C.amber : C.dim,
    cursor: "pointer",
  });

  // "Find more": real in-app searches seeded from the topic + its next open
  // roadmap steps — a nudge toward the next thing worth looking up (v3.5:
  // these open the SourceSearch panel instead of external search pages).
  const openSteps = topic.roadmap.filter((s) => !s.done).slice(0, 2);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card>
        <Eyebrow>Add to the library</Eyebrow>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Paste an article, video, or a Drive / .epub / .pdf / .txt book link..."
            style={{
              flex: 1,
              minWidth: 0,
              background: C.bg,
              border: `1px solid ${C.line}`,
              borderRadius: 10,
              padding: "10px 12px",
              color: C.ink,
              fontSize: 16, // ≥16px stops iOS Safari zooming the field on focus
              fontFamily: sans,
              outline: "none",
            }}
          />
          <Btn onClick={add} disabled={adding || !url.trim() || !online}>
            {adding ? "Adding..." : "Add"}
          </Btn>
        </div>
        {adding && (
          <div style={{ marginTop: 12 }}>
            <Spinner label="Adding it to the shelf..." />
          </div>
        )}
        {error && <div style={{ marginTop: 10, color: C.danger, fontSize: 13 }}>{error}</div>}
        <div style={{ marginTop: 10, fontSize: 12, color: C.dim, lineHeight: 1.5 }}>
          The card appears right away; pulling out the text keeps working in the background, so
          feel free to move on. Articles open in a clean reader, videos (YouTube, Vimeo and more)
          play right here, books read page by page — including Google Drive or public
          .epub / .pdf / .txt links. The companion reads along either way.
        </div>

        <div style={{ marginTop: 12, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
          <button
            onClick={() => setFindOpen(!findOpen)}
            style={{
              background: "none",
              border: "none",
              color: C.dim,
              fontFamily: sans,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              padding: 0,
            }}
          >
            Find more about {topic.name} {findOpen ? "▾" : "▸"}
          </button>
          {findOpen && (
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button onClick={() => onFindSources(topic.name, "video")} style={chip(false)}>
                ▶ {topic.name}
              </button>
              <button onClick={() => onFindSources(topic.name, "article")} style={chip(false)}>
                📄 {topic.name}
              </button>
              {openSteps.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onFindSources(`${topic.name} ${s.title}`, "video")}
                  style={chip(false)}
                >
                  ▶ {s.title}
                </button>
              ))}
              <button onClick={() => setBookSearchOpen(true)} style={chip(false)}>
                📚 Books
              </button>
              <button onClick={() => setSuggestOpen(true)} style={chip(false)}>
                ✨ Suggest books
              </button>
            </div>
          )}
        </div>

        <div style={{ marginTop: 12, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
          <button
            onClick={() => setMdOpen(!mdOpen)}
            style={{
              background: "none",
              border: "none",
              color: C.dim,
              fontFamily: sans,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              padding: 0,
            }}
          >
            Paste or upload Markdown {mdOpen ? "▾" : "▸"}
          </button>
          {mdOpen && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                value={mdTitle}
                onChange={(e) => setMdTitle(e.target.value)}
                placeholder="Title (optional — the first heading is used otherwise)"
                style={{
                  background: C.bg,
                  border: `1px solid ${C.line}`,
                  borderRadius: 10,
                  padding: "8px 12px",
                  color: C.ink,
                  fontSize: 16,
                  fontFamily: sans,
                  outline: "none",
                }}
              />
              <textarea
                value={mdText}
                onChange={(e) => setMdText(e.target.value)}
                placeholder="Paste Markdown here — e.g. an LLM-generated summary or notes."
                rows={6}
                style={{
                  background: C.bg,
                  border: `1px solid ${C.line}`,
                  borderRadius: 10,
                  padding: "10px 12px",
                  color: C.ink,
                  fontSize: 16,
                  fontFamily: sans,
                  lineHeight: 1.5,
                  resize: "vertical",
                  outline: "none",
                }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <label style={{ ...chip(false), display: "inline-flex", alignItems: "center" }}>
                  📄 Upload .md file
                  <input
                    type="file"
                    accept=".md,.markdown,.txt,text/markdown,text/plain"
                    onChange={onPickMdFile}
                    style={{ display: "none" }}
                  />
                </label>
                <Btn onClick={addMarkdown} disabled={mdBusy || !mdText.trim() || !online}>
                  {mdBusy ? "Adding..." : "Add to library"}
                </Btn>
              </div>
              {mdError && <div style={{ color: C.danger, fontSize: 13 }}>{mdError}</div>}
            </div>
          )}
        </div>
      </Card>

      {items.length >= 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the shelf..."
            style={{
              background: C.bg,
              border: `1px solid ${C.line}`,
              borderRadius: 10,
              padding: "8px 12px",
              color: C.ink,
              fontSize: 16, // ≥16px stops iOS Safari zooming the field on focus
              fontFamily: sans,
              outline: "none",
            }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {(
              [
                ["all", "All"],
                ["unread", "Unread"],
                ["reading", "Reading"],
                ["done", "Done"],
              ] as [StatusFilter, string][]
            ).map(([key, label]) => (
              <button key={key} onClick={() => setStatusFilter(key)} style={chip(statusFilter === key)}>
                {label}
              </button>
            ))}
            <span style={{ width: 6 }} />
            {(
              [
                ["youtube", "Videos"],
                ["article", "Articles"],
                ["book", "Books"],
              ] as [KindFilter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setKindFilter(kindFilter === key ? "all" : key)}
                style={chip(kindFilter === key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {items.length === 0 && !adding && (
        <div style={{ color: C.dim, fontSize: 14, lineHeight: 1.6, padding: "4px 2px" }}>
          Nothing on the shelf yet. Found a good article or video about {topic.name}? Paste the
          link above and it becomes part of what we&apos;re learning together.
        </div>
      )}

      {items.length > 0 && filtered.length === 0 && (
        <div style={{ color: C.dim, fontSize: 14, lineHeight: 1.6, padding: "4px 2px" }}>
          Nothing matches.{" "}
          <button
            onClick={() => {
              setQuery("");
              setStatusFilter("all");
              setKindFilter("all");
            }}
            style={{
              background: "none",
              border: "none",
              color: C.amber,
              cursor: "pointer",
              fontSize: 14,
              fontFamily: sans,
              padding: 0,
              textDecoration: "underline",
            }}
          >
            Clear filters
          </button>
        </div>
      )}

      {(filtersActive ? filtered : items).map((item) => {
        const ext = extractionState(item);
        return (
          <Card key={item.id} style={{ cursor: "pointer", padding: 12 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }} onClick={() => onOpen(item.id)}>
              {item.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.thumbnail}
                  alt=""
                  style={{
                    width: 84,
                    height: 56,
                    objectFit: "cover",
                    borderRadius: 8,
                    flexShrink: 0,
                    background: C.bg,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 84,
                    height: 56,
                    borderRadius: 8,
                    flexShrink: 0,
                    background: C.bg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: C.dim,
                    fontFamily: sans,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                  }}
                >
                  {kindTile[item.kind]}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    lineHeight: 1.4,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {item.title}
                </div>
                <div
                  style={{
                    marginTop: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                    color: C.dim,
                    fontFamily: sans,
                    flexWrap: "wrap",
                  }}
                >
                  <span>{item.siteName || kindFallbackSite[item.kind]}</span>
                  <span>·</span>
                  <span style={{ color: statusColor[item.status], fontWeight: 600 }}>
                    {statusLabel[item.status]}
                  </span>
                  {ext === "pending" && (
                    <>
                      <span>·</span>
                      <span style={{ color: C.amber, display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span
                          className="lc-pulse"
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            background: C.amber,
                            display: "inline-block",
                          }}
                        />
                        extracting…
                      </span>
                    </>
                  )}
                  {ext === "failed" && (
                    <>
                      <span>·</span>
                      <span title="We couldn't extract the text; the companion will discuss from the title and your account">
                        {item.kind === "book" ? "couldn't open" : "no text"}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void retry(item.id);
                        }}
                        disabled={retryingId !== null || !online}
                        style={{
                          background: "none",
                          border: `1px solid ${C.line}`,
                          borderRadius: 999,
                          color: retryingId === item.id ? C.amber : C.dim,
                          cursor: retryingId ? "default" : "pointer",
                          fontFamily: sans,
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "2px 10px",
                        }}
                      >
                        {retryingId === item.id ? "Retrying…" : "Retry"}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void onDelete(item.id);
                }}
                aria-label={`Remove ${item.title}`}
                style={{
                  background: "none",
                  border: "none",
                  color: C.dim,
                  cursor: "pointer",
                  fontSize: 18,
                  padding: "4px 6px",
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>
          </Card>
        );
      })}

      {bookSearchOpen && (
        <BookSearch
          topicName={topic.name}
          online={online}
          onPick={onAddBook}
          onClose={() => setBookSearchOpen(false)}
        />
      )}

      {suggestOpen && (
        <SuggestPanel
          topicId={topic.id}
          online={online}
          onPick={onAddBook}
          onClose={() => setSuggestOpen(false)}
        />
      )}
    </div>
  );
}
