"use client";

import { useEffect, useRef, useState } from "react";
import { C, sans, serif, Card, Eyebrow, Btn, Spinner } from "./lamp-ui";

// What a picked book sends to POST /api/library. Gutenberg picks carry a
// textUrl and read in-app; Open Library picks are link-only cards.
export type BookPick = {
  provider: "gutenberg" | "openlibrary";
  ref: string;
  title: string;
  author?: string;
  thumbnail?: string;
  url: string;
  textUrl?: string;
};

type Result = BookPick & { readable: boolean };

// Both APIs are fetched from the BROWSER on purpose: the user's IP isn't a
// datacenter IP, and both send permissive CORS headers.
async function searchBooks(query: string): Promise<Result[]> {
  const [gutendex, openlib] = await Promise.allSettled([
    // Gutendex search is slow from a cold cache — give it room.
    fetch(`https://gutendex.com/books?search=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(20_000),
    }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))),
    fetch(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10&fields=key,title,author_name,cover_i`,
      { signal: AbortSignal.timeout(20_000) }
    ).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))),
  ]);

  const results: Result[] = [];
  if (gutendex.status === "fulfilled") {
    type GutendexBook = {
      id: number;
      title: string;
      authors?: { name: string }[];
      formats?: Record<string, string>;
    };
    for (const b of ((gutendex.value.results ?? []) as GutendexBook[]).slice(0, 8)) {
      const formats = b.formats ?? {};
      const textUrl = Object.entries(formats).find(
        ([k, v]) => k.startsWith("text/plain") && !v.endsWith(".zip")
      )?.[1];
      results.push({
        provider: "gutenberg",
        ref: String(b.id),
        title: b.title,
        author: b.authors?.[0]?.name,
        thumbnail: formats["image/jpeg"],
        url: `https://www.gutenberg.org/ebooks/${b.id}`,
        textUrl,
        readable: !!textUrl,
      });
    }
  }
  if (openlib.status === "fulfilled") {
    type OpenLibBook = { key: string; title: string; author_name?: string[]; cover_i?: number };
    const seen = new Set(results.map((r) => `${r.title} ${r.author ?? ""}`.toLowerCase()));
    for (const b of ((openlib.value.docs ?? []) as OpenLibBook[]).slice(0, 8)) {
      if (seen.has(`${b.title} ${b.author_name?.[0] ?? ""}`.toLowerCase())) continue;
      results.push({
        provider: "openlibrary",
        ref: b.key,
        title: b.title,
        author: b.author_name?.[0],
        thumbnail: b.cover_i ? `https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg` : undefined,
        url: `https://openlibrary.org${b.key}`,
        readable: false,
      });
    }
  }
  if (gutendex.status === "rejected" && openlib.status === "rejected") {
    throw new Error("Couldn't reach the book catalogs. Check your connection and try again.");
  }
  return results;
}

// In-app book finder: Project Gutenberg (readable right here) + Open Library
// (link-only). Opened from the library's "find more" row.
export default function BookSearch({
  topicName,
  online,
  onPick,
  onClose,
}: {
  topicName: string;
  online: boolean;
  onPick: (book: BookPick) => Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(topicName);
  const [results, setResults] = useState<Result[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [addedRefs, setAddedRefs] = useState<Set<string>>(new Set());
  const [addingRef, setAddingRef] = useState<string | null>(null);
  const ranInitial = useRef(false);

  const search = async (q: string) => {
    const term = q.trim();
    if (!term || searching || !online) return;
    setSearching(true);
    setError("");
    try {
      setResults(await searchBooks(term));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed. Try again.");
    }
    setSearching(false);
  };

  // Search the topic name right away — usually what you want.
  useEffect(() => {
    if (ranInitial.current) return;
    ranInitial.current = true;
    void search(topicName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async (book: Result) => {
    if (addingRef || addedRefs.has(book.ref)) return;
    setAddingRef(book.ref);
    setError("");
    try {
      await onPick(book);
      setAddedRefs((s) => new Set(s).add(book.ref));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that book. Try again.");
    }
    setAddingRef(null);
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
            <Eyebrow>Find a book</Eyebrow>
            <div style={{ flex: 1 }} />
            <button
              onClick={onClose}
              aria-label="Close book search"
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
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search(query)}
              placeholder="Title, author, or subject..."
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
            <Btn onClick={() => search(query)} disabled={searching || !query.trim() || !online}>
              {searching ? "..." : "Search"}
            </Btn>
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: C.dim, lineHeight: 1.5 }}>
            Free books from Project Gutenberg read right here, page by page, with the companion.
            Open Library matches link out to borrowing options.
          </div>
          {error && <div style={{ marginTop: 10, color: C.danger, fontSize: 13 }}>{error}</div>}
          {searching && (
            <div style={{ marginTop: 14 }}>
              <Spinner label="Searching the catalogs..." />
            </div>
          )}

          {results && !searching && results.length === 0 && (
            <div style={{ marginTop: 14, color: C.dim, fontSize: 14 }}>
              Nothing found — try a broader term or an author&apos;s name.
            </div>
          )}

          {results && !searching && results.length > 0 && (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              {results.map((b) => (
                <div
                  key={`${b.provider}:${b.ref}`}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    borderTop: `1px solid ${C.line}`,
                    paddingTop: 10,
                  }}
                >
                  {b.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={b.thumbnail}
                      alt=""
                      style={{ width: 40, height: 56, objectFit: "cover", borderRadius: 6, flexShrink: 0, background: C.bg }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 40,
                        height: 56,
                        borderRadius: 6,
                        flexShrink: 0,
                        background: C.bg,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: C.dim,
                        fontSize: 18,
                      }}
                    >
                      📖
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: serif, fontSize: 15, lineHeight: 1.35 }}>{b.title}</div>
                    <div style={{ marginTop: 3, fontSize: 12, color: C.dim, fontFamily: sans }}>
                      {b.author ?? "Unknown author"}
                      {" · "}
                      <span style={{ color: b.readable ? C.sage : C.dim }}>
                        {b.readable ? "readable here" : "link only"}
                      </span>
                    </div>
                  </div>
                  <Btn
                    variant={addedRefs.has(b.ref) ? "ghost" : "solid"}
                    onClick={() => void add(b)}
                    disabled={addingRef !== null || addedRefs.has(b.ref) || !online}
                    style={{ padding: "7px 12px", fontSize: 13, flexShrink: 0 }}
                  >
                    {addedRefs.has(b.ref) ? "Added ✓" : addingRef === b.ref ? "Adding..." : "Add"}
                  </Btn>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
