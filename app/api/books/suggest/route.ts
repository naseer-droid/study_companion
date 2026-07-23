import { NextResponse } from "next/server";
import { getRequestStorage } from "@/lib/storage";
import { askModel, errorMessage } from "@/lib/llm";
import { bookSuggestPrompt } from "@/lib/prompts";

// Book suggestions (v3.7): the companion names the genuinely good books for a
// topic, and the route enriches each with real metadata. Model output is NEVER
// trusted raw for the reader — a suggestion only becomes a one-tap in-app Add
// when Gutendex confirms a readable public-domain text; everything else carries
// a Google Books cover/rating/blurb and stays a link-only save-or-find card.
export const maxDuration = 60;

type Suggestion = { title: string; author?: string; why: string };

type Book = Suggestion & {
  cover?: string;
  rating?: number;
  pages?: number;
  blurb?: string;
  infoLink?: string;
  pick?: {
    provider: "gutenberg";
    ref: string;
    title: string;
    author?: string;
    thumbnail?: string;
    url: string;
    textUrl: string;
  };
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

type BookMeta = Pick<Book, "cover" | "rating" | "pages" | "blurb" | "infoLink">;

const clip = (s: string): string => (s.length > 200 ? `${s.slice(0, 200).trimEnd()}…` : s);

// Cover/rating/pages/blurb: Google Books first (per spec), Open Library as a
// keyless fallback — the anonymous Google Books quota is shared and 429s often,
// and OL is lenient. Whichever answers, missing fields fall through to OL.
async function resolveMeta(title: string, author?: string): Promise<BookMeta> {
  const g = await resolveGoogleBooks(title, author);
  if (g.cover || g.rating !== undefined || g.pages !== undefined) return g;
  const o = await resolveOpenLibrary(title, author);
  return {
    cover: g.cover ?? o.cover,
    rating: g.rating ?? o.rating,
    pages: g.pages ?? o.pages,
    blurb: g.blurb ?? o.blurb,
    infoLink: g.infoLink ?? o.infoLink,
  };
}

// Open Library search — keyless and generous. cover_i → cover image,
// ratings_average, number_of_pages_median, work key, first sentence as blurb.
async function resolveOpenLibrary(title: string, author?: string): Promise<BookMeta> {
  try {
    const params = new URLSearchParams({
      title,
      limit: "1",
      fields: "title,cover_i,ratings_average,number_of_pages_median,key,first_sentence",
    });
    if (author) params.set("author", author);
    const res = await fetch(`https://openlibrary.org/search.json?${params.toString()}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return {};
    const data = await res.json();
    const doc = (data.docs ?? [])[0] as
      | {
          cover_i?: number;
          ratings_average?: number;
          number_of_pages_median?: number;
          key?: string;
          first_sentence?: string[] | string;
        }
      | undefined;
    if (!doc) return {};
    const sentence = Array.isArray(doc.first_sentence)
      ? doc.first_sentence[0]
      : typeof doc.first_sentence === "string"
        ? doc.first_sentence
        : undefined;
    return {
      cover: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : undefined,
      rating: typeof doc.ratings_average === "number" ? Math.round(doc.ratings_average * 10) / 10 : undefined,
      pages: typeof doc.number_of_pages_median === "number" ? doc.number_of_pages_median : undefined,
      blurb: sentence ? clip(sentence) : undefined,
      infoLink: doc.key ? `https://openlibrary.org${doc.key}` : undefined,
    };
  } catch {
    return {};
  }
}

// Google Books (keyless) — cover, rating, page count, blurb, info link. Best
// effort: a miss just leaves the suggestion without enrichment.
async function resolveGoogleBooks(title: string, author?: string): Promise<BookMeta> {
  try {
    const q = author
      ? `intitle:${title}+inauthor:${author}`
      : `intitle:${title}`;
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=1&country=US`,
      { signal: AbortSignal.timeout(12_000) }
    );
    if (!res.ok) return {};
    const data = await res.json();
    const info = data.items?.[0]?.volumeInfo as
      | {
          imageLinks?: { thumbnail?: string; smallThumbnail?: string };
          averageRating?: number;
          pageCount?: number;
          description?: string;
          infoLink?: string;
        }
      | undefined;
    if (!info) return {};
    const rawCover = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail;
    const cover = rawCover ? rawCover.replace(/^http:/, "https:") : undefined;
    const blurb = typeof info.description === "string" ? clip(info.description) : undefined;
    return {
      cover,
      rating: typeof info.averageRating === "number" ? info.averageRating : undefined,
      pages: typeof info.pageCount === "number" && info.pageCount > 0 ? info.pageCount : undefined,
      blurb,
      infoLink: typeof info.infoLink === "string" ? info.infoLink : undefined,
    };
  } catch {
    return {};
  }
}

// Top Gutendex hit → a readable pick, but only when the hit's title actually
// resembles the suggestion (Gutendex search is loose) and a plain-text format
// exists — unresolved suggestions still render, just without an Add button.
async function resolveGutenberg(title: string, author?: string): Promise<Book["pick"]> {
  try {
    const q = author ? `${title} ${author}` : title;
    const res = await fetch(`https://gutendex.com/books?search=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    type GutendexBook = {
      id: number;
      title: string;
      authors?: { name: string }[];
      formats?: Record<string, string>;
    };
    const hit = ((data.results ?? []) as GutendexBook[]).find((b) => {
      const suggestion = norm(title);
      const candidate = norm(b.title ?? "");
      return suggestion.length >= 4 && (candidate.includes(suggestion) || suggestion.includes(candidate));
    });
    if (!hit) return undefined;
    const formats = hit.formats ?? {};
    const textUrl = Object.entries(formats).find(
      ([k, v]) => k.startsWith("text/plain") && !v.endsWith(".zip")
    )?.[1];
    if (!textUrl) return undefined;
    return {
      provider: "gutenberg",
      ref: String(hit.id),
      title: hit.title,
      author: hit.authors?.[0]?.name,
      thumbnail: formats["image/jpeg"],
      url: `https://www.gutenberg.org/ebooks/${hit.id}`,
      textUrl,
    };
  } catch {
    return undefined; // catalog slow/unreachable — the suggestion renders unresolved
  }
}

function asSuggestions(value: unknown): Suggestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s) => s && typeof s === "object" && typeof (s as Record<string, unknown>).title === "string")
    .slice(0, 6)
    .map((s) => {
      const r = s as Record<string, unknown>;
      return {
        title: (r.title as string).trim(),
        author: typeof r.author === "string" && r.author.trim() ? r.author.trim() : undefined,
        why: typeof r.why === "string" ? r.why.trim() : "",
      };
    })
    .filter((s) => s.title);
}

export async function POST(req: Request) {
  try {
    const ctx = await getRequestStorage();
    if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    const topicId = typeof body.topicId === "string" ? body.topicId : "";
    if (!topicId) return NextResponse.json({ error: "Missing topicId." }, { status: 400 });

    const data = await ctx.storage.load(ctx.userId);
    const topic = data.topics.find((t) => t.id === topicId);
    if (!topic) return NextResponse.json({ error: "Topic not found." }, { status: 404 });

    const openSteps = topic.roadmap.filter((s) => !s.done).slice(0, 3).map((s) => s.title);

    const raw = await askModel(bookSuggestPrompt(topic.name, openSteps));
    const parsed = (raw ?? {}) as Record<string, unknown>;

    // Each suggestion resolves Google Books + Gutendex in parallel; suggestions
    // resolve concurrently with each other too.
    const books: Book[] = await Promise.all(
      asSuggestions(parsed.books).map(async (s) => {
        const [meta, pick] = await Promise.all([
          resolveMeta(s.title, s.author),
          resolveGutenberg(s.title, s.author),
        ]);
        return { ...s, ...meta, pick };
      })
    );

    return NextResponse.json({ books });
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}
