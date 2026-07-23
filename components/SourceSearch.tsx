"use client";

import { useEffect, useRef, useState } from "react";
import type { Topic } from "@/lib/types";
import { readerUrl, urlKey } from "@/lib/links";
import { C, sans, serif, Card, Eyebrow, Btn, Spinner } from "./lamp-ui";

// v3.5 in-app source finder: real YouTube/article search via /api/discover,
// replacing the old external search-link chips. Structure mirrors BookSearch
// (overlay, query box, add-per-row); adding hands the URL to the normal
// library flow, so extraction/transcripts work exactly as if pasted.

export type SourceKind = "video" | "article";

type DiscoverResult = {
  title: string;
  url: string;
  source: string;
  thumbnail?: string;
  channel?: string;
  duration?: string;
  views?: number;
  ageText?: string;
  publishedAt?: string;
  snippet?: string;
  siteName?: string;
};

const compactViews = (n?: number): string | undefined =>
  typeof n === "number" && Number.isFinite(n)
    ? new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n)
    : undefined;

// Relative age from an ISO date (API path); the scrape path already gives text.
const relativeAge = (iso?: string): string | undefined => {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days} day${days > 1 ? "s" : ""} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? "s" : ""} ago`;
  const years = Math.floor(days / 365);
  return `${years} year${years > 1 ? "s" : ""} ago`;
};

const videoMeta = (r: DiscoverResult): string => {
  const parts: string[] = [];
  const v = compactViews(r.views);
  if (v) parts.push(`${v} views`);
  const age = r.ageText || relativeAge(r.publishedAt);
  if (age) parts.push(age);
  if (r.duration) parts.push(r.duration);
  if (r.channel) parts.push(r.channel);
  return parts.join(" · ");
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

// Article group headers, in display order. Anything unrecognised is "Web".
const ARTICLE_GROUPS = ["Web", "Medium", "dev.to", "Wikipedia"] as const;
const groupOf = (r: DiscoverResult): (typeof ARTICLE_GROUPS)[number] =>
  r.siteName === "Medium" || r.siteName === "dev.to" || r.siteName === "Wikipedia" ? r.siteName : "Web";

export default function SourceSearch({
  topic,
  online,
  initialQuery,
  initialKind,
  onAdd,
  onClose,
}: {
  topic: Topic;
  online: boolean;
  initialQuery: string;
  initialKind: SourceKind;
  onAdd: (url: string) => Promise<void>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<SourceKind>(initialKind);
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<DiscoverResult[] | null>(null);
  const [note, setNote] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [addedKeys, setAddedKeys] = useState<Set<string>>(new Set());
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const ranInitial = useRef(false);

  const inLibrary = new Set((topic.library ?? []).map((i) => urlKey(i.url)));

  const search = async (q: string, k: SourceKind) => {
    const term = q.trim();
    if (!term || !online) return;
    setSearching(true);
    setError("");
    setNote("");
    try {
      const res = await fetch(
        `/api/discover?q=${encodeURIComponent(term)}&kind=${k}`,
        { signal: AbortSignal.timeout(30_000) }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed. Try again.");
      setResults(data.results ?? []);
      if (data.note) setNote(data.note);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed. Try again.");
    }
    setSearching(false);
  };

  // Search the seeded query right away — usually what you want.
  useEffect(() => {
    if (ranInitial.current) return;
    ranInitial.current = true;
    void search(initialQuery, initialKind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchKind = (k: SourceKind) => {
    if (k === kind || searching) return;
    setKind(k);
    setResults(null);
    void search(query, k);
  };

  const add = async (r: DiscoverResult) => {
    const key = urlKey(r.url);
    if (addingKey || addedKeys.has(key) || inLibrary.has(key)) return;
    setAddingKey(key);
    setError("");
    try {
      await onAdd(r.url);
      setAddedKeys((s) => new Set(s).add(key));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that. Try again.");
    }
    setAddingKey(null);
  };

  // Seed chips: the topic itself + the next open roadmap steps.
  const seeds = [
    topic.name,
    ...topic.roadmap
      .filter((s) => !s.done)
      .slice(0, 3)
      .map((s) => `${topic.name} ${s.title}`),
  ];

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
    whiteSpace: "nowrap",
  });

  const renderRow = (r: DiscoverResult) => {
    const key = urlKey(r.url);
    const added = addedKeys.has(key) || inLibrary.has(key);
    const meta = kind === "video" ? videoMeta(r) : hostOf(r.url);
    return (
      <div
        key={key}
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          borderTop: `1px solid ${C.line}`,
          paddingTop: 10,
        }}
      >
        {kind === "video" &&
          (r.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={r.thumbnail}
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
                fontSize: 18,
              }}
            >
              ▶
            </div>
          ))}
        <div style={{ flex: 1, minWidth: 0 }}>
          <a
            href={readerUrl(r.url)}
            target="_blank"
            rel="noreferrer"
            style={{
              fontFamily: serif,
              fontSize: 15,
              lineHeight: 1.35,
              color: C.ink,
              textDecoration: "none",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {r.title} <span style={{ color: C.dim, fontSize: 12 }}>↗</span>
          </a>
          {meta && (
            <div style={{ marginTop: 3, fontSize: 12, color: C.dim, fontFamily: sans }}>{meta}</div>
          )}
          {r.snippet && (
            <div
              style={{
                marginTop: 3,
                fontSize: 12,
                color: C.dim,
                fontFamily: sans,
                lineHeight: 1.45,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {r.snippet}
            </div>
          )}
        </div>
        <Btn
          variant={added ? "ghost" : "solid"}
          onClick={() => void add(r)}
          disabled={addingKey !== null || added || !online}
          style={{ padding: "7px 12px", fontSize: 13, flexShrink: 0 }}
        >
          {added ? "Added ✓" : addingKey === key ? "Adding..." : "Add"}
        </Btn>
      </div>
    );
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(10,14,22,0.75)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "6vh 16px 16px",
        overflowY: "auto",
      }}
    >
      {/* stop clicks inside the panel from closing the overlay */}
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 560 }}>
        <Card style={{ width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Eyebrow>Find sources</Eyebrow>
            <div style={{ flex: 1 }} />
            <button
              onClick={onClose}
              aria-label="Close source search"
              style={{
                background: "none",
                border: "none",
                color: C.dim,
                cursor: "pointer",
                fontSize: 18,
                padding: "2px 6px",
              }}
            >
              ×
            </button>
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <button onClick={() => switchKind("video")} style={chip(kind === "video")}>
              ▶ Videos
            </button>
            <button onClick={() => switchKind("article")} style={chip(kind === "article")}>
              📄 Articles
            </button>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search(query, kind)}
              placeholder={kind === "video" ? "Search YouTube..." : "Search the web..."}
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
            <Btn onClick={() => search(query, kind)} disabled={searching || !query.trim() || !online}>
              {searching ? "..." : "Search"}
            </Btn>
          </div>

          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {seeds.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setQuery(s);
                  void search(s, kind);
                }}
                disabled={searching}
                style={chip(false)}
              >
                {s.length > 42 ? s.slice(0, 40) + "…" : s}
              </button>
            ))}
          </div>

          {error && <div style={{ marginTop: 10, color: C.danger, fontSize: 13 }}>{error}</div>}
          {searching && (
            <div style={{ marginTop: 14 }}>
              <Spinner label={kind === "video" ? "Searching YouTube..." : "Searching the web..."} />
            </div>
          )}

          {results && !searching && results.length === 0 && (
            <div style={{ marginTop: 14, color: C.dim, fontSize: 14 }}>
              {note || "Nothing found — try different words."}
            </div>
          )}

          {results && !searching && results.length > 0 && kind === "video" && (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              {results.map((r) => renderRow(r))}
            </div>
          )}

          {results && !searching && results.length > 0 && kind === "article" && (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 16 }}>
              {ARTICLE_GROUPS.map((g) => {
                const rows = results.filter((r) => groupOf(r) === g);
                if (!rows.length) return null;
                return (
                  <div key={g}>
                    <div
                      style={{
                        fontFamily: sans,
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: C.dim,
                      }}
                    >
                      {g}
                    </div>
                    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 10 }}>
                      {rows.map((r) => renderRow(r))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 12, fontSize: 12, color: C.dim, lineHeight: 1.5 }}>
            Add puts it on your Study Room shelf — the text or transcript is pulled out in the
            background so the companion can read along.
          </div>
        </Card>
      </div>
    </div>
  );
}
