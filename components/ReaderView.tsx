"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import type { LibraryItem } from "@/lib/types";
import { extractionState } from "@/lib/types";
import { C, serif, sans, Btn, Spinner } from "./lamp-ui";

function youtubeEmbed(url: string): { id: string; start: number } | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    let id: string | null = null;
    if (host === "youtu.be") {
      id = u.pathname.slice(1).split("/")[0] || null;
    } else if (host === "youtube.com") {
      if (u.pathname === "/watch") id = u.searchParams.get("v");
      else {
        const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/);
        id = m ? m[2] : null;
      }
    }
    if (!id) return null;
    // Carry a pasted timestamp (?t=1m32s / ?t=57 / ?start=57) into the embed.
    let start = 0;
    const t = u.searchParams.get("t") ?? u.searchParams.get("start");
    if (t) {
      const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
      if (m) start = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
    }
    return { id, start };
  } catch {
    return null;
  }
}

// Recovery affordances for items whose extraction failed: retry the server
// pipeline, or paste the text (article body / YouTube's Show-Transcript copy)
// yourself.
function RecoveryBox({
  kind,
  online,
  onRetry,
  onPaste,
}: {
  kind: "article" | "youtube" | "book"; // book: retry re-probes, no paste
  online: boolean;
  onRetry: () => Promise<void>;
  onPaste?: (text: string) => Promise<void>;
}) {
  const [retrying, setRetrying] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");

  const retry = async () => {
    if (retrying || !online) return;
    setRetrying(true);
    setNote("");
    try {
      await onRetry();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Still couldn't get the text.");
    }
    setRetrying(false);
  };

  const save = async () => {
    const text = pasteDraft.trim();
    if (!text || saving || !online || !onPaste) return;
    setSaving(true);
    setNote("");
    try {
      await onPaste(text);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't save that. Try again.");
      setSaving(false);
      return;
    }
    setSaving(false);
    setPasteOpen(false);
    setPasteDraft("");
  };

  return (
    <div style={{ marginTop: 16, fontFamily: sans }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Btn variant="ghost" onClick={retry} disabled={retrying || !online} style={{ padding: "8px 14px", fontSize: 13 }}>
          {retrying ? "Retrying…" : kind === "book" ? "Try opening it again" : "Retry extraction"}
        </Btn>
        {kind !== "book" && (
        <button
          onClick={() => setPasteOpen(!pasteOpen)}
          style={{
            background: "none",
            border: "none",
            color: C.amber,
            cursor: "pointer",
            fontFamily: sans,
            fontSize: 13,
            padding: 0,
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          {kind === "youtube" ? "Paste the transcript yourself" : "Paste the text yourself"}
        </button>
        )}
      </div>
      {retrying && (
        <div style={{ marginTop: 10 }}>
          <Spinner label="Trying again to pull out the text..." />
        </div>
      )}
      {pasteOpen && (
        <div style={{ marginTop: 10 }}>
          {kind === "youtube" && (
            <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.5, marginBottom: 6 }}>
              On YouTube: description → &quot;Show transcript&quot; → select it all and copy it here.
            </div>
          )}
          <textarea
            value={pasteDraft}
            onChange={(e) => setPasteDraft(e.target.value)}
            rows={5}
            placeholder={kind === "youtube" ? "Paste the transcript here..." : "Paste the article text here..."}
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
          <div style={{ marginTop: 8 }}>
            <Btn onClick={save} disabled={saving || !pasteDraft.trim() || !online} style={{ padding: "8px 14px", fontSize: 13 }}>
              {saving ? "Saving..." : "Save the text"}
            </Btn>
          </div>
        </div>
      )}
      {note && <div style={{ marginTop: 8, color: C.danger, fontSize: 12 }}>{note}</div>}
    </div>
  );
}

// Full-screen reading/watching room. The discussion panel rides alongside
// (side panel on desktop, slide-up sheet on phones — CSS in globals.css).
export default function ReaderView({
  item,
  online,
  onClose,
  onRetry,
  onPaste,
  onQuote,
  bookChunk,
  onBookChunk,
  panel,
}: {
  item: LibraryItem;
  online: boolean;
  onClose: () => void;
  onRetry: () => Promise<void>;
  onPaste: (text: string) => Promise<void>;
  onQuote: (text: string) => void;
  bookChunk: number;
  onBookChunk: (chunk: number) => void;
  panel: ReactNode;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [bookText, setBookText] = useState<string | null>(null);
  const [bookTotal, setBookTotal] = useState(0);
  const [bookLoading, setBookLoading] = useState(false);
  const [bookError, setBookError] = useState("");
  const [pill, setPill] = useState<{ top: number; left: number; text: string } | null>(null);
  const articleRef = useRef<HTMLElement | null>(null);

  const ext = extractionState(item);

  // Article text is fetched on demand — load() never ships it. Keyed on
  // hasContent so a successful retry/paste triggers the fetch by itself.
  useEffect(() => {
    if (item.kind !== "article" || !item.hasContent) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/library/content?itemId=${encodeURIComponent(item.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setContent(typeof d?.content === "string" ? d.content : "");
      })
      .catch(() => {
        if (!cancelled) setContent("");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, item.kind, item.hasContent]);

  // Books stream one chunk at a time — nothing is stored, so every page turn
  // asks the server to resolve the source live.
  useEffect(() => {
    if (item.kind !== "book" || !item.hasContent) return;
    let cancelled = false;
    setBookLoading(true);
    setBookError("");
    fetch(`/api/library/book?itemId=${encodeURIComponent(item.id)}&chunk=${bookChunk}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`error ${r.status}`))))
      .then((d) => {
        if (cancelled) return;
        setBookText(typeof d?.text === "string" ? d.text : "");
        setBookTotal(typeof d?.totalChunks === "number" ? d.totalChunks : 0);
        // The server clamps out-of-range requests (a stored position can
        // outlive a reparse) — follow its answer.
        if (typeof d?.chunk === "number" && d.chunk !== bookChunk) onBookChunk(d.chunk);
      })
      .catch(() => {
        if (!cancelled) setBookError("Couldn't fetch this part of the book. Check your connection and try again.");
      })
      .finally(() => {
        if (!cancelled) setBookLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.kind, item.hasContent, bookChunk]);

  // "Discuss this" pill on text selection inside the article/book text.
  useEffect(() => {
    let timer: number | undefined;
    const update = () => {
      const sel = window.getSelection();
      const root = articleRef.current;
      if (!sel || sel.isCollapsed || !root || !sel.anchorNode || !root.contains(sel.anchorNode)) {
        setPill(null);
        return;
      }
      const text = sel.toString().trim();
      if (!text) {
        setPill(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const top = rect.top > 70 ? rect.top - 46 : rect.bottom + 10;
      setPill({
        top,
        left: Math.min(Math.max(12, rect.left + rect.width / 2 - 62), window.innerWidth - 140),
        text: text.slice(0, 600),
      });
    };
    const scheduled = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 250);
    };
    document.addEventListener("selectionchange", scheduled);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", scheduled);
    };
  }, []);

  const quoteSelection = () => {
    if (!pill) return;
    onQuote(pill.text);
    window.getSelection()?.removeAllRanges();
    setPill(null);
    setSheetOpen(true);
  };

  const embed = item.kind === "youtube" ? youtubeEmbed(item.url) : null;

  const articleStyle: React.CSSProperties = {
    maxWidth: "65ch",
    margin: "0 auto",
    padding: "24px 20px 64px",
    fontFamily: serif,
    fontSize: 18,
    lineHeight: 1.75,
    color: C.ink,
    whiteSpace: "pre-wrap",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: C.bg,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          borderBottom: `1px solid ${C.line}`,
          flexShrink: 0,
        }}
      >
        <Btn variant="ghost" onClick={onClose} style={{ padding: "8px 12px" }}>
          ← Library
        </Btn>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: serif,
              fontSize: 17,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.title}
          </div>
          {item.siteName && (
            <div style={{ color: C.dim, fontSize: 12, fontFamily: sans }}>{item.siteName}</div>
          )}
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          style={{ color: C.dim, fontSize: 12, fontFamily: sans, flexShrink: 0 }}
        >
          Original ↗
        </a>
      </header>

      <div className="lc-reader-body">
        <div className="lc-reader-main" onScroll={() => setPill(null)}>
          {item.kind === "youtube" ? (
            <div style={{ maxWidth: 860, margin: "0 auto", padding: 16 }}>
              {embed ? (
                <div
                  style={{
                    position: "relative",
                    paddingTop: "56.25%",
                    borderRadius: 12,
                    overflow: "hidden",
                    background: "#000",
                  }}
                >
                  <iframe
                    src={`https://www.youtube.com/embed/${embed.id}${embed.start ? `?start=${embed.start}` : ""}`}
                    title={item.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                  />
                </div>
              ) : (
                <div style={{ color: C.dim, fontSize: 14, fontFamily: sans, lineHeight: 1.6 }}>
                  This video can&apos;t be embedded —{" "}
                  <a href={item.url} target="_blank" rel="noreferrer" style={{ color: C.amber }}>
                    watch it on YouTube ↗
                  </a>{" "}
                  and come back to discuss it.
                </div>
              )}
              <div
                style={{
                  marginTop: 14,
                  color: C.dim,
                  fontSize: 13,
                  fontFamily: sans,
                  lineHeight: 1.6,
                }}
              >
                {item.hasContent
                  ? "The companion has the transcript — open the discussion and talk about what you just watched."
                  : ext === "pending"
                    ? "Still fetching the transcript in the background — you can start watching."
                    : "No transcript was available for this one, but the companion can still discuss it from the title and your account."}
              </div>
              {ext === "failed" && !item.hasContent && (
                <RecoveryBox kind="youtube" online={online} onRetry={onRetry} onPaste={onPaste} />
              )}
            </div>
          ) : item.kind === "book" ? (
            <div style={{ paddingBottom: 76 }}>
              {!item.hasContent ? (
                <div
                  style={{
                    maxWidth: "65ch",
                    margin: "0 auto",
                    padding: "40px 20px",
                    color: C.dim,
                    fontSize: 15,
                    fontFamily: sans,
                    lineHeight: 1.7,
                  }}
                >
                  {ext === "pending" ? (
                    <Spinner label="Opening the ebook for the first time..." />
                  ) : ext === "failed" ? (
                    <>
                      We couldn&apos;t open this ebook (is the Drive file shared as &quot;anyone with
                      the link&quot;, and a .txt or .epub?).{" "}
                      <a href={item.url} target="_blank" rel="noreferrer" style={{ color: C.amber }}>
                        Open the original ↗
                      </a>
                      <RecoveryBox kind="book" online={online} onRetry={onRetry} />
                    </>
                  ) : (
                    <>
                      This one lives on{" "}
                      <a href={item.url} target="_blank" rel="noreferrer" style={{ color: C.amber }}>
                        {item.siteName || "its own site"} ↗
                      </a>{" "}
                      — read it there and discuss it here; the companion follows from the title and
                      your account.
                    </>
                  )}
                </div>
              ) : bookLoading && bookText === null ? (
                <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
                  <Spinner label="Opening the book..." />
                </div>
              ) : bookError ? (
                <div
                  style={{
                    maxWidth: "65ch",
                    margin: "0 auto",
                    padding: "40px 20px",
                    color: C.dim,
                    fontSize: 15,
                    fontFamily: sans,
                    lineHeight: 1.7,
                  }}
                >
                  {bookError}
                </div>
              ) : (
                <article ref={articleRef} style={{ ...articleStyle, opacity: bookLoading ? 0.5 : 1 }}>
                  {bookText}
                </article>
              )}
            </div>
          ) : loading ? (
            <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
              <Spinner label="Laying out the article..." />
            </div>
          ) : content ? (
            <article ref={articleRef} style={articleStyle}>
              {content}
            </article>
          ) : (
            <div
              style={{
                maxWidth: "65ch",
                margin: "0 auto",
                padding: "40px 20px",
                color: C.dim,
                fontSize: 15,
                fontFamily: sans,
                lineHeight: 1.7,
              }}
            >
              {ext === "pending" ? (
                <Spinner label="Still pulling out the text in the background..." />
              ) : (
                <>
                  We couldn&apos;t extract the text of this page (it may be paywalled or app-only).{" "}
                  <a href={item.url} target="_blank" rel="noreferrer" style={{ color: C.amber }}>
                    Read the original ↗
                  </a>{" "}
                  — then tell the companion what you took from it in the discussion.
                  <RecoveryBox kind="article" online={online} onRetry={onRetry} onPaste={onPaste} />
                </>
              )}
            </div>
          )}
        </div>

        <div className={`lc-discuss-side${sheetOpen ? " open" : ""}`}>
          <button
            className="lc-sheet-close"
            onClick={() => setSheetOpen(false)}
            aria-label="Close discussion"
          >
            ×
          </button>
          {panel}
        </div>
      </div>

      {item.kind === "book" && item.hasContent && bookTotal > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            padding: "10px 16px",
            background: C.bg,
            borderTop: `1px solid ${C.line}`,
            fontFamily: sans,
            fontSize: 13,
            color: C.dim,
            zIndex: 2,
          }}
          className="lc-book-pager"
        >
          <Btn
            variant="ghost"
            onClick={() => onBookChunk(Math.max(0, bookChunk - 1))}
            disabled={bookChunk <= 0 || bookLoading}
            style={{ padding: "6px 12px", fontSize: 13 }}
          >
            ‹ Prev
          </Btn>
          <span>
            page {bookChunk + 1} of {bookTotal}
          </span>
          <Btn
            variant="ghost"
            onClick={() => onBookChunk(Math.min(bookTotal - 1, bookChunk + 1))}
            disabled={bookChunk >= bookTotal - 1 || bookLoading}
            style={{ padding: "6px 12px", fontSize: 13 }}
          >
            Next ›
          </Btn>
        </div>
      )}

      {pill && (
        <button
          onClick={quoteSelection}
          onTouchEnd={(e) => {
            e.preventDefault();
            quoteSelection();
          }}
          style={{
            position: "fixed",
            top: pill.top,
            left: pill.left,
            zIndex: 80,
            background: C.amber,
            color: "#1B1406",
            border: "none",
            borderRadius: 999,
            padding: "8px 16px",
            fontFamily: sans,
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
          }}
        >
          Discuss this
        </button>
      )}

      {!sheetOpen && (
        <button className="lc-discuss-fab" onClick={() => setSheetOpen(true)}>
          Discuss
        </button>
      )}
    </div>
  );
}
