"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { LibraryItem } from "@/lib/types";
import { extractionState, parseTranscript, looksLikeHtml, stripHtml } from "@/lib/types";
import { FREEDIUM_MIRROR } from "@/lib/links";
import { videoEmbed } from "@/lib/embed";
import { C, serif, sans, Btn, Spinner } from "./lamp-ui";

// Compact A−/A+ font-size control in the reader header.
function fontBtn(disabled: boolean): React.CSSProperties {
  return {
    background: "transparent",
    border: `1px solid ${C.line}`,
    borderRadius: 8,
    color: C.dim,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
    fontFamily: sans,
    fontSize: 13,
    fontWeight: 700,
    padding: "6px 9px",
  };
}

// mm:ss (or h:mm:ss) for transcript timestamps.
function fmtTime(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

// v3.4: the stored transcript, shown to the learner. Segment transcripts render
// as tappable rows that seek the player; legacy plain-text transcripts render
// as one searchable block. Collapsed by default so the video stays the focus.
function TranscriptPanel({
  content,
  onSeek,
}: {
  content: string;
  onSeek: (t: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState(false);
  const segments = parseTranscript(content);
  const plain = segments ? segments.map((s) => s.text).join(" ") : content;
  const query = q.trim().toLowerCase();
  const rows = segments
    ? query
      ? segments.filter((s) => s.text.toLowerCase().includes(query))
      : segments
    : [];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plain);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — no-op
    }
  };

  return (
    <div style={{ marginTop: 16, borderTop: `1px solid ${C.line}`, paddingTop: 12, fontFamily: sans }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "none",
          border: "none",
          color: C.dim,
          fontFamily: sans,
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          padding: 0,
        }}
      >
        Transcript {open ? "▾" : "▸"}
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search the transcript…"
              style={{
                flex: 1,
                minWidth: 0,
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
            <Btn variant="ghost" onClick={copy} style={{ padding: "8px 12px", fontSize: 13, flexShrink: 0 }}>
              {copied ? "Copied" : "Copy"}
            </Btn>
          </div>
          {segments ? (
            <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
              {rows.length === 0 ? (
                <div style={{ color: C.dim, fontSize: 13, padding: "6px 2px" }}>No lines match.</div>
              ) : (
                rows.map((s, i) => (
                  <button
                    key={`${s.t}-${i}`}
                    onClick={() => onSeek(s.t)}
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "baseline",
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: "6px 4px",
                      borderRadius: 6,
                      color: C.ink,
                      fontFamily: sans,
                    }}
                  >
                    <span style={{ color: C.amber, fontVariantNumeric: "tabular-nums", fontSize: 12, flexShrink: 0, minWidth: 48 }}>
                      {fmtTime(s.t)}
                    </span>
                    <span style={{ fontSize: 14, lineHeight: 1.55 }}>{s.text}</span>
                  </button>
                ))
              )}
            </div>
          ) : (
            <div
              style={{
                maxHeight: 320,
                overflowY: "auto",
                whiteSpace: "pre-wrap",
                color: C.ink,
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              {plain}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
  onLogLearned,
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
  onLogLearned?: () => void; // v3.3: jump to the journal, prefilled "Watched: …"
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
  const [seekTime, setSeekTime] = useState<number | null>(null); // transcript → player seek
  const [mode, setMode] = useState<"reader" | "original">("reader"); // Freedium embed toggle
  const [fontScale, setFontScale] = useState(1);
  const [toc, setToc] = useState<{ id: string; text: string; level: number }[]>([]);
  const [exported, setExported] = useState(false);
  const articleRef = useRef<HTMLElement | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);

  const ext = extractionState(item);

  // Pasted/uploaded Markdown notes have a synthetic about: URL — there is no
  // original page to link to or embed.
  const hasOriginal = !item.url.startsWith("about:");

  // Reading time + word count from the rendered article text (content is HTML
  // for articles by the time it reaches the reader; transcripts are excluded).
  const readingStats = useMemo(() => {
    if (item.kind !== "article" || !content) return null;
    const text = looksLikeHtml(content) ? stripHtml(content) : content;
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return words ? { words, mins: Math.max(1, Math.ceil(words / 200)) } : null;
  }, [item.kind, content]);

  // Build a table of contents from the rendered headings after each article
  // loads; assign stable ids so the entries can scroll to their section. Hidden
  // for short pieces (fewer than 2 headings).
  useEffect(() => {
    if (item.kind !== "article" || !content) {
      setToc([]);
      return;
    }
    const el = articleRef.current;
    if (!el) return;
    const heads = Array.from(el.querySelectorAll("h2, h3")) as HTMLElement[];
    const entries = heads
      .map((h, i) => {
        const text = (h.textContent || "").trim();
        if (!h.id) {
          h.id =
            `sec-${i}-` +
            text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
        }
        return { id: h.id, text, level: h.tagName === "H3" ? 3 : 2 };
      })
      .filter((e) => e.text);
    setToc(entries.length >= 2 ? entries : []);
  }, [content, item.kind, item.id]);

  const exportMarkdown = async () => {
    try {
      const res = await fetch(`/api/library/content?itemId=${encodeURIComponent(item.id)}&as=md`);
      const data = res.ok ? await res.json() : null;
      const md = typeof data?.markdown === "string" ? data.markdown : "";
      if (!md) return;
      try {
        await navigator.clipboard.writeText(md);
        setExported(true);
        window.setTimeout(() => setExported(false), 1800);
      } catch {
        // clipboard blocked (insecure context) — fall back to a file download
        const blob = new Blob([md], { type: "text/markdown" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${(item.title || "article").replace(/[^\w.-]+/g, "-").slice(0, 60)}.md`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } catch {
      // network hiccup — silently ignore; the button can be pressed again
    }
  };
  // Medium items were rewritten to the Freedium mirror at ingestion, so their
  // stored URL is embeddable (Medium itself sets X-Frame-Options); offer to
  // view the real page inline. Non-mirror articles keep only "Original ↗".
  const canEmbedOriginal = item.kind === "article" && item.url.startsWith(`${FREEDIUM_MIRROR}/`);
  const showReaderControls = item.kind === "article" || item.kind === "book";

  // Reader font size persists across items/sessions (client-side only).
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem("lamp-reader-fontsize"));
      if (saved >= 0.8 && saved <= 1.6) setFontScale(saved);
    } catch {
      // storage unavailable — keep default
    }
  }, []);
  const changeFont = (delta: number) => {
    setFontScale((v) => {
      const next = Math.min(1.6, Math.max(0.8, Math.round((v + delta) * 100) / 100));
      try {
        window.localStorage.setItem("lamp-reader-fontsize", String(next));
      } catch {
        // fine — just won't persist
      }
      return next;
    });
  };

  // A new item resets the transient view state (seek target, embed toggle).
  useEffect(() => {
    setSeekTime(null);
    setMode("reader");
  }, [item.id]);

  // Article text / video transcript are fetched on demand — load() never ships
  // them. Keyed on hasContent so a successful retry/paste triggers the fetch by
  // itself. (v3.4: transcripts are now shown, so YouTube fetches content too.)
  useEffect(() => {
    if ((item.kind !== "article" && item.kind !== "youtube") || !item.hasContent) return;
    let cancelled = false;
    setContent(null);
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

  // Articles resume where you left off (scroll position lives client-side only,
  // mirroring the book page-position behaviour).
  useEffect(() => {
    if (item.kind !== "article" || content === null) return;
    const main = mainRef.current;
    if (!main) return;
    let pos = 0;
    try {
      pos = Number(window.localStorage.getItem(`lamp-article-pos-${item.id}`) ?? 0) || 0;
    } catch {
      // storage unavailable — start at the top
    }
    if (pos > 0) requestAnimationFrame(() => main.scrollTo({ top: pos }));
  }, [item.id, item.kind, content]);

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
  // Non-YouTube video hosts (Vimeo/Dailymotion/Vidyard/direct file) also carry
  // kind "youtube"; when it isn't a real YouTube URL, resolve their player here.
  const otherEmbed =
    item.kind === "youtube" && !embed
      ? (() => {
          try {
            return videoEmbed(new URL(item.url));
          } catch {
            return null;
          }
        })()
      : null;

  const onMainScroll = () => {
    setPill(null);
    const main = mainRef.current;
    if (main && item.kind === "article") {
      try {
        window.localStorage.setItem(`lamp-article-pos-${item.id}`, String(Math.round(main.scrollTop)));
      } catch {
        // fine — position just won't persist
      }
    }
  };

  const articleStyle: React.CSSProperties = {
    maxWidth: "65ch",
    margin: "0 auto",
    padding: "24px 20px 64px",
    fontFamily: serif,
    fontSize: 18 * fontScale,
    lineHeight: 1.75,
    color: C.ink,
    whiteSpace: "pre-wrap",
  };
  // Rendered HTML flows as normal markup (headings/lists/images), not pre-wrap.
  const htmlArticleStyle: React.CSSProperties = { ...articleStyle, whiteSpace: "normal" };

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
          {(item.siteName || readingStats) && (
            <div style={{ color: C.dim, fontSize: 12, fontFamily: sans }}>
              {[
                item.siteName,
                readingStats ? `~${readingStats.mins} min read` : null,
                readingStats ? `${readingStats.words.toLocaleString()} words` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          )}
        </div>
        {item.kind === "youtube" && onLogLearned && (
          <Btn variant="ghost" onClick={onLogLearned} style={{ padding: "8px 12px", fontSize: 13, flexShrink: 0 }}>
            Log what I learned
          </Btn>
        )}
        {canEmbedOriginal && (
          <Btn
            variant="ghost"
            onClick={() => setMode((m) => (m === "reader" ? "original" : "reader"))}
            style={{ padding: "8px 12px", fontSize: 13, flexShrink: 0 }}
          >
            {mode === "reader" ? "Original page" : "Reader"}
          </Btn>
        )}
        {showReaderControls && mode === "reader" && (
          <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
            <button
              onClick={() => changeFont(-0.1)}
              disabled={fontScale <= 0.8}
              aria-label="Smaller text"
              title="Smaller text"
              style={fontBtn(fontScale <= 0.8)}
            >
              A−
            </button>
            <button
              onClick={() => changeFont(0.1)}
              disabled={fontScale >= 1.6}
              aria-label="Larger text"
              title="Larger text"
              style={fontBtn(fontScale >= 1.6)}
            >
              A+
            </button>
          </div>
        )}
        {item.kind === "article" && item.hasContent && mode === "reader" && (
          <Btn
            variant="ghost"
            onClick={exportMarkdown}
            style={{ padding: "8px 12px", fontSize: 13, flexShrink: 0 }}
          >
            {exported ? "Copied ✓" : "Copy as MD"}
          </Btn>
        )}
        {hasOriginal && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            style={{ color: C.dim, fontSize: 12, fontFamily: sans, flexShrink: 0 }}
          >
            Original ↗
          </a>
        )}
      </header>

      <div className="lc-reader-body">
        <div ref={mainRef} className="lc-reader-main" onScroll={onMainScroll}>
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
                    // Remount on seek so a tapped timestamp starts the player
                    // at that moment (start= only applies on load).
                    key={seekTime ?? "base"}
                    src={`https://www.youtube.com/embed/${embed.id}?start=${
                      seekTime ?? embed.start
                    }${seekTime != null ? "&autoplay=1" : ""}`}
                    title={item.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                  />
                </div>
              ) : otherEmbed ? (
                otherEmbed.kind === "file" ? (
                  <video
                    src={otherEmbed.embedUrl}
                    controls
                    style={{ width: "100%", borderRadius: 12, background: "#000", display: "block" }}
                  />
                ) : (
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
                      src={otherEmbed.embedUrl}
                      title={item.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                      allowFullScreen
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                    />
                  </div>
                )
              ) : (
                <div style={{ color: C.dim, fontSize: 14, fontFamily: sans, lineHeight: 1.6 }}>
                  This video can&apos;t be embedded —{" "}
                  <a href={item.url} target="_blank" rel="noreferrer" style={{ color: C.amber }}>
                    open it in a new tab ↗
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
                  ? "The companion has the transcript — read it below (tap a time to jump the video), or open the discussion to talk about what you watched."
                  : ext === "pending"
                    ? "Still fetching the transcript in the background — you can start watching."
                    : "No transcript was available for this one, but the companion can still discuss it from the title and your account."}
              </div>
              {item.hasContent && content && (
                <TranscriptPanel content={content} onSeek={setSeekTime} />
              )}
              {item.hasContent && content === null && loading && (
                <div style={{ marginTop: 14 }}>
                  <Spinner label="Loading the transcript…" />
                </div>
              )}
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
          ) : canEmbedOriginal && mode === "original" ? (
            <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              <div
                style={{
                  padding: "8px 16px",
                  color: C.dim,
                  fontSize: 12,
                  fontFamily: sans,
                  borderBottom: `1px solid ${C.line}`,
                }}
              >
                Viewing the original page. Switch to <strong style={{ color: C.ink }}>Reader</strong> to
                select text and discuss it.
              </div>
              <iframe
                src={item.url}
                title={item.title}
                style={{ flex: 1, width: "100%", minHeight: "82vh", border: 0, background: "#fff" }}
              />
            </div>
          ) : loading ? (
            <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
              <Spinner label="Laying out the article..." />
            </div>
          ) : content ? (
            looksLikeHtml(content) ? (
              <>
                {toc.length > 0 && (
                  <details
                    style={{
                      maxWidth: "65ch",
                      margin: "16px auto 0",
                      padding: "0 20px",
                      fontFamily: sans,
                    }}
                  >
                    <summary
                      style={{
                        cursor: "pointer",
                        color: C.dim,
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                      }}
                    >
                      Contents
                    </summary>
                    <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }}>
                      {toc.map((h) => (
                        <li key={h.id} style={{ margin: "2px 0" }}>
                          <button
                            onClick={() =>
                              document
                                .getElementById(h.id)
                                ?.scrollIntoView({ behavior: "smooth", block: "start" })
                            }
                            style={{
                              background: "none",
                              border: "none",
                              padding: `2px 0 2px ${h.level === 3 ? 16 : 0}px`,
                              color: C.dim,
                              fontFamily: sans,
                              fontSize: 13,
                              lineHeight: 1.5,
                              textAlign: "left",
                              cursor: "pointer",
                            }}
                          >
                            {h.text}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <article
                  ref={articleRef}
                  className="lc-article-html"
                  style={htmlArticleStyle}
                  dangerouslySetInnerHTML={{ __html: content }}
                />
              </>
            ) : (
              <article ref={articleRef} style={articleStyle}>
                {content}
              </article>
            )
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
