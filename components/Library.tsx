"use client";

import { useState } from "react";
import type { LibraryItem, Topic } from "@/lib/types";
import { extractionState } from "@/lib/types";
import { searchUrl, youtubeSearchUrl } from "@/lib/links";
import { C, sans, Card, Eyebrow, Btn, Spinner } from "./lamp-ui";
import BookSearch, { type BookPick } from "./BookSearch";

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

type StatusFilter = "all" | "unread" | "done";
type KindFilter = "all" | "youtube" | "article" | "book";

// A small external-link chip for the "find more" row.
function SearchChip({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{
        fontFamily: sans,
        fontSize: 12,
        fontWeight: 600,
        padding: "6px 12px",
        borderRadius: 999,
        border: `1px solid ${C.line}`,
        color: C.dim,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      {label} ↗
    </a>
  );
}

// The Study Room shelf: paste article/YouTube/Drive links or pick books, tap
// to read/watch with the companion. Item mutations are owned by the parent
// (StudyLamp).
export default function Library({
  topic,
  online,
  onAdd,
  onAddBook,
  onOpen,
  onDelete,
  onRetry,
}: {
  topic: Topic;
  online: boolean;
  onAdd: (url: string) => Promise<void>;
  onAddBook: (book: BookPick) => Promise<void>;
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
    if (statusFilter === "unread" && item.status !== "unread") return false;
    if (statusFilter === "done" && item.status !== "done") return false;
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

  // "Find more": search links built from the topic + its next open roadmap
  // steps — a nudge toward the next thing worth looking up, not an LLM call.
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
            placeholder="Paste an article, YouTube, Drive or .epub/.txt book link..."
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
          feel free to move on. Articles open in a clean reader, videos play right here (with the
          transcript), books read page by page — including Google Drive or public .epub/.txt links.
          The companion reads along either way.
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
              <SearchChip href={youtubeSearchUrl(topic.name)} label={`▶ ${topic.name}`} />
              <SearchChip href={searchUrl(topic.name)} label={`G ${topic.name}`} />
              {openSteps.map((s) => (
                <SearchChip
                  key={s.id}
                  href={youtubeSearchUrl(`${topic.name} ${s.title}`)}
                  label={`▶ ${s.title}`}
                />
              ))}
              <button onClick={() => setBookSearchOpen(true)} style={chip(false)}>
                📚 Books
              </button>
            </div>
          )}
        </div>
      </Card>

      {items.length >= 4 && (
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
    </div>
  );
}
