"use client";

import { useEffect, useRef, useState } from "react";
import { C, sans, serif, Card, Eyebrow, Btn, Spinner } from "./lamp-ui";
import type { BookPick } from "./BookSearch";

type Book = {
  title: string;
  author?: string;
  why: string;
  cover?: string;
  rating?: number;
  pages?: number;
  blurb?: string;
  infoLink?: string;
  pick?: BookPick;
};

// Book suggestions (v3.7): the companion names the good books for this topic,
// enriched with real covers/ratings/blurbs. Public-domain picks read in-app
// (Add); anything else can be saved as a link-only card or looked up to obtain
// a copy the learner then pastes into the shelf.
export default function SuggestPanel({
  topicId,
  online,
  onPick,
  onClose,
}: {
  topicId: string;
  online: boolean;
  onPick: (book: BookPick) => Promise<void>;
  onClose: () => void;
}) {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const ranInitial = useRef(false);

  const suggest = async () => {
    if (loading || !online) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/books/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error || "Couldn't get suggestions. Try again.");
      setBooks(Array.isArray(d.books) ? d.books : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't get suggestions. Try again.");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (ranInitial.current) return;
    ranInitial.current = true;
    void suggest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async (key: string, pick: BookPick) => {
    if (addingKey || added.has(key)) return;
    setAddingKey(key);
    setError("");
    try {
      await onPick(pick);
      setAdded((s) => new Set(s).add(key));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that book. Try again.");
    }
    setAddingKey(null);
  };

  // A modern/paywalled pick saved as a link-only card the learner opens
  // externally — Google Books info page when we have it, else a web search.
  const savePick = (b: Book): BookPick => {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(
      `${b.title} ${b.author ?? ""} book`.trim()
    )}`;
    const link = b.infoLink || searchUrl;
    return { provider: "openlibrary", ref: link, title: b.title, author: b.author, url: link, thumbnail: b.cover };
  };

  const findCopyUrl = (b: Book): string =>
    `https://www.google.com/search?q=${encodeURIComponent(`${b.title} ${b.author ?? ""} ebook`.trim())}`;

  const loaded = books !== null;
  const empty = loaded && books.length === 0;

  const metaLine = (b: Book) => {
    const parts: string[] = [];
    if (typeof b.rating === "number") parts.push(`★ ${b.rating.toFixed(1)}`);
    if (typeof b.pages === "number") parts.push(`${b.pages} pages`);
    return parts.join(" · ");
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
            <Eyebrow>What to read next</Eyebrow>
            <div style={{ flex: 1 }} />
            <button
              onClick={onClose}
              aria-label="Close suggestions"
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
          {error && <div style={{ marginTop: 10, color: C.danger, fontSize: 13 }}>{error}</div>}
          {loading && (
            <div style={{ marginTop: 14 }}>
              <Spinner label="The companion is looking over the shelves..." />
            </div>
          )}

          {loaded && !empty && (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
              {books.map((b, i) => {
                const key = b.pick ? `gutenberg:${b.pick.ref}` : `save:${i}`;
                const meta = metaLine(b);
                return (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      gap: 12,
                      borderTop: `1px solid ${C.line}`,
                      paddingTop: 12,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {b.cover ? (
                      <img
                        src={b.cover}
                        alt=""
                        style={{ width: 52, height: 78, objectFit: "cover", borderRadius: 4, flexShrink: 0, background: C.line }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 52,
                          height: 78,
                          borderRadius: 4,
                          flexShrink: 0,
                          background: C.line,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: C.dim,
                          fontSize: 20,
                        }}
                      >
                        📖
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: serif, fontSize: 15, lineHeight: 1.35 }}>{b.title}</div>
                      <div style={{ marginTop: 3, fontSize: 12, color: C.dim, fontFamily: sans }}>
                        {b.author ?? "Unknown author"}
                        {meta ? ` · ${meta}` : ""}
                      </div>
                      {b.why && (
                        <div style={{ marginTop: 5, fontSize: 13, color: C.ink, fontStyle: "italic", lineHeight: 1.5 }}>
                          {b.why}
                        </div>
                      )}
                      {b.blurb && (
                        <div style={{ marginTop: 5, fontSize: 12.5, color: C.dim, lineHeight: 1.5 }}>{b.blurb}</div>
                      )}
                      <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        {b.pick ? (
                          <Btn
                            variant={added.has(key) ? "ghost" : "solid"}
                            onClick={() => void add(key, b.pick!)}
                            disabled={addingKey !== null || added.has(key) || !online}
                            style={{ padding: "6px 12px", fontSize: 13 }}
                          >
                            {added.has(key) ? "Added ✓" : addingKey === key ? "Adding..." : "Add — read here"}
                          </Btn>
                        ) : (
                          <Btn
                            variant={added.has(key) ? "ghost" : "solid"}
                            onClick={() => void add(key, savePick(b))}
                            disabled={addingKey !== null || added.has(key) || !online}
                            style={{ padding: "6px 12px", fontSize: 13 }}
                          >
                            {added.has(key) ? "Saved ✓" : addingKey === key ? "Saving..." : "Save for later"}
                          </Btn>
                        )}
                        <a
                          href={findCopyUrl(b)}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 13, color: C.dim, fontFamily: sans, textDecoration: "none" }}
                        >
                          Find a copy ↗
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {empty && (
            <div style={{ marginTop: 14, color: C.dim, fontSize: 14, lineHeight: 1.6 }}>
              Nothing obvious comes to mind for this topic yet — try the catalog search instead.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
