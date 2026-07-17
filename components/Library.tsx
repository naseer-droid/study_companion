"use client";

import { useState } from "react";
import type { LibraryItem, Topic } from "@/lib/types";
import { C, sans, Card, Eyebrow, Btn, Spinner } from "./lamp-ui";

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

// The Study Room shelf: paste article/YouTube links, tap to read/watch with
// the companion. Item mutations are owned by the parent (StudyLamp).
export default function Library({
  topic,
  online,
  onAdd,
  onOpen,
  onDelete,
}: {
  topic: Topic;
  online: boolean;
  onAdd: (url: string) => Promise<void>;
  onOpen: (itemId: string) => void;
  onDelete: (itemId: string) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

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

  const items = topic.library ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card>
        <Eyebrow>Add to the library</Eyebrow>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Paste an article or YouTube link..."
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
            {adding ? "Fetching..." : "Add"}
          </Btn>
        </div>
        {adding && (
          <div style={{ marginTop: 12 }}>
            <Spinner label="Fetching the page and pulling out the text..." />
          </div>
        )}
        {error && <div style={{ marginTop: 10, color: C.danger, fontSize: 13 }}>{error}</div>}
        <div style={{ marginTop: 10, fontSize: 12, color: C.dim, lineHeight: 1.5 }}>
          Articles open in a clean reader; videos play right here. Either way, the companion reads
          or watches along — open one and discuss it together.
        </div>
      </Card>

      {items.length === 0 && !adding && (
        <div style={{ color: C.dim, fontSize: 14, lineHeight: 1.6, padding: "4px 2px" }}>
          Nothing on the shelf yet. Found a good article or video about {topic.name}? Paste the
          link above and it becomes part of what we&apos;re learning together.
        </div>
      )}

      {items.map((item) => (
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
                {item.kind === "youtube" ? "VIDEO" : "ARTICLE"}
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
                }}
              >
                <span>{item.siteName || (item.kind === "youtube" ? "YouTube" : "Link")}</span>
                <span>·</span>
                <span style={{ color: statusColor[item.status], fontWeight: 600 }}>
                  {statusLabel[item.status]}
                </span>
                {!item.hasContent && (
                  <>
                    <span>·</span>
                    <span title="We couldn't extract the text; the companion will discuss from the title and your account">
                      no text
                    </span>
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
      ))}
    </div>
  );
}
