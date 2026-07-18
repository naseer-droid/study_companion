"use client";

import { useEffect, useRef, useState } from "react";
import type { LibraryItem } from "@/lib/types";
import { extractionState } from "@/lib/types";
import { C, serif, sans, Btn, Spinner, Eyebrow, Linkify } from "./lamp-ui";

// Chat with the companion about one library item. Messages are owned by the
// parent; each exchange also rewrites the topic's shared memory server-side.
export default function DiscussPanel({
  item,
  online,
  onSend,
  onSetStatus,
  onPaste,
  seedDraft,
  onSeedConsumed,
}: {
  item: LibraryItem;
  online: boolean;
  onSend: (message: string) => Promise<void>;
  onSetStatus: (status: LibraryItem["status"]) => Promise<void>;
  onPaste?: (text: string) => Promise<void>;
  seedDraft?: string;
  onSeedConsumed?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");
  const [pasting, setPasting] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [item.discussion.length, item.id]);

  // A passage quoted from the reader ("Discuss this") seeds the draft.
  useEffect(() => {
    if (!seedDraft) return;
    setDraft((d) => `> ${seedDraft}\n\n${d}`);
    inputRef.current?.focus();
    onSeedConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedDraft]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending || !online) return;
    setSending(true);
    setError("");
    try {
      await onSend(text);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that. Try again.");
    }
    setSending(false);
  };

  const medium = { youtube: "video", article: "article", book: "book" }[item.kind];
  const ext = extractionState(item);

  const savePaste = async () => {
    const text = pasteDraft.trim();
    if (!text || pasting || !online || !onPaste) return;
    setPasting(true);
    setError("");
    try {
      await onPaste(text);
      setPasteOpen(false);
      setPasteDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that. Try again.");
    }
    setPasting(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${C.line}`,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <Eyebrow>Discuss</Eyebrow>
        <div style={{ flex: 1 }} />
        <Btn
          variant="ghost"
          style={{ padding: "6px 10px", fontSize: 12 }}
          disabled={!online}
          onClick={() => void onSetStatus(item.status === "done" ? "reading" : "done")}
        >
          {item.status === "done" ? "Reopen" : "Mark done"}
        </Btn>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16, minHeight: 0 }}>
        {item.discussion.length === 0 && (
          <div style={{ color: C.dim, fontSize: 14, lineHeight: 1.6, fontFamily: sans }}>
            {item.hasContent
              ? item.kind === "book"
                ? "Ask anything about this book — the companion is reading the same page you are."
                : `Ask anything about this ${medium} — the companion has ${
                    item.kind === "youtube" ? "the transcript" : "the full text"
                  } too.`
              : ext === "pending"
                ? `Still fetching this ${medium}'s text in the background — you can start the conversation now.`
                : `The companion couldn't get this ${medium}'s text, but tell it what you took from it and think it through together.`}
            {!item.hasContent && ext === "failed" && item.kind !== "book" && onPaste && (
              <div style={{ marginTop: 10 }}>
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
                  Or paste the text so the companion can read it
                </button>
                {pasteOpen && (
                  <div style={{ marginTop: 8 }}>
                    <textarea
                      value={pasteDraft}
                      onChange={(e) => setPasteDraft(e.target.value)}
                      rows={4}
                      placeholder={
                        item.kind === "youtube"
                          ? "Paste the transcript here..."
                          : "Paste the article text here..."
                      }
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
                      <Btn
                        onClick={savePaste}
                        disabled={pasting || !pasteDraft.trim() || !online}
                        style={{ padding: "8px 14px", fontSize: 13 }}
                      >
                        {pasting ? "Saving..." : "Save the text"}
                      </Btn>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {item.discussion.map((m, i) => (
          <div
            key={i}
            style={{
              marginBottom: 10,
              background: m.role === "user" ? C.panel : C.panel2,
              border: `1px solid ${m.role === "user" ? C.line : "#3A4560"}`,
              borderRadius: m.role === "user" ? "14px 14px 14px 4px" : "14px 14px 4px 14px",
              padding: "10px 12px",
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: m.role === "user" ? C.dim : C.amber,
                marginBottom: 4,
                fontFamily: sans,
              }}
            >
              {m.role === "user" ? "You" : "Companion"}
            </div>
            <div
              style={{
                fontSize: 14,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                fontFamily: m.role === "user" ? sans : serif,
              }}
            >
              <Linkify text={m.text} />
            </div>
          </div>
        ))}
        {sending && (
          <div style={{ marginBottom: 10 }}>
            <Spinner label="The companion is thinking..." />
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div style={{ padding: 12, borderTop: `1px solid ${C.line}`, flexShrink: 0 }}>
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
          placeholder={`What did you make of this ${medium}?`}
          rows={2}
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
            resize: "none",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <Btn onClick={send} disabled={sending || !draft.trim() || !online} style={{ padding: "8px 14px" }}>
            {sending ? "Sending..." : "Send"}
          </Btn>
          {error && <div style={{ color: C.danger, fontSize: 12, fontFamily: sans }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}
