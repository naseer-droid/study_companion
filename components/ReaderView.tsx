"use client";

import { ReactNode, useEffect, useState } from "react";
import type { LibraryItem } from "@/lib/types";
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

// Full-screen reading/watching room. The discussion panel rides alongside
// (side panel on desktop, slide-up sheet on phones — CSS in globals.css).
export default function ReaderView({
  item,
  onClose,
  panel,
}: {
  item: LibraryItem;
  onClose: () => void;
  panel: ReactNode;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Article text is fetched on demand — load() never ships it.
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

  const embed = item.kind === "youtube" ? youtubeEmbed(item.url) : null;

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
        <div className="lc-reader-main">
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
                    src={`https://www.youtube-nocookie.com/embed/${embed.id}${embed.start ? `?start=${embed.start}` : ""}`}
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
                  : "No transcript was available for this one, but the companion can still discuss it from the title and your account."}
              </div>
            </div>
          ) : loading ? (
            <div style={{ padding: 40, display: "flex", justifyContent: "center" }}>
              <Spinner label="Laying out the article..." />
            </div>
          ) : content ? (
            <article
              style={{
                maxWidth: "65ch",
                margin: "0 auto",
                padding: "24px 20px 64px",
                fontFamily: serif,
                fontSize: 18,
                lineHeight: 1.75,
                color: C.ink,
                whiteSpace: "pre-wrap",
              }}
            >
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
              We couldn&apos;t extract the text of this page (it may be paywalled or app-only).{" "}
              <a href={item.url} target="_blank" rel="noreferrer" style={{ color: C.amber }}>
                Read the original ↗
              </a>{" "}
              — then tell the companion what you took from it in the discussion.
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

      {!sheetOpen && (
        <button className="lc-discuss-fab" onClick={() => setSheetOpen(true)}>
          Discuss
        </button>
      )}
    </div>
  );
}
