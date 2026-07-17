"use client";

import { useEffect, useRef, useState } from "react";
import type { LibraryItem } from "@/lib/types";
import { C, serif, sans, Btn, Spinner, Eyebrow } from "./lamp-ui";

// Chat with the companion about one library item. Messages are owned by the
// parent; each exchange also rewrites the topic's shared memory server-side.
export default function DiscussPanel({
  item,
  online,
  onSend,
  onSetStatus,
}: {
  item: LibraryItem;
  online: boolean;
  onSend: (message: string) => Promise<void>;
  onSetStatus: (status: LibraryItem["status"]) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [item.discussion.length, item.id]);

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

  const medium = item.kind === "youtube" ? "video" : "article";

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
              ? `Ask anything about this ${medium} — the companion has ${
                  item.kind === "youtube" ? "the transcript" : "the full text"
                } too.`
              : `The companion couldn't get this ${medium}'s text, but tell it what you took from it and think it through together.`}
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
              {m.text}
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
