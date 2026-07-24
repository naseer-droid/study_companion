import { NextResponse } from "next/server";
import { getRequestStorage } from "@/lib/storage";
import { assertPublicHttpUrl, UA } from "@/lib/extract";

// Image proxy for the reader. Article images are hotlinked by URL, and two
// things routinely stop them from loading in-app: (1) mixed content — an http
// image on our https page is blocked by the browser; (2) hotlink/referrer
// protection — the origin refuses requests that don't come from its own pages.
// Proxying fixes both: the browser sees a same-origin https image, and we fetch
// server-side with a browser UA and a same-origin Referer. Auth keeps it from
// being an open proxy.
//
// Security: because we fetch server-side and re-serve same-origin, two things
// must hold. (a) SSRF — the SSRF guard (assertPublicHttpUrl) is re-checked on
// EVERY redirect hop, since a public URL can 3xx to an internal address
// (cloud metadata, RFC1918); we follow redirects manually to do that. (b) XSS
// — an SVG (image/svg+xml) can carry <script> that would run in OUR origin if
// opened directly, so active/document types are rejected and the response is
// hardened (nosniff + a locked-down CSP) even for allowed types.
export const maxDuration = 20;

const MAX_BYTES = 8_000_000; // 8MB — generous for article imagery, caps abuse
const MAX_HOPS = 4;
const CACHE = "public, max-age=604800, s-maxage=604800, immutable"; // 7 days
// Active/document content that must never be served from our origin, even when
// it arrives with an image/* label. SVG is the classic same-origin XSS vector.
const UNSAFE_TYPE = /^(?:image\/svg|text\/|application\/(?:xhtml|xml|javascript|ecmascript))/i;

// Follow redirects by hand so the SSRF guard runs against each hop's URL, not
// just the caller-supplied one.
async function fetchFollowingSafely(startUrl: string): Promise<Response> {
  let current = startUrl;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    assertPublicHttpUrl(current);
    const origin = new URL(current).origin;
    const res = await fetch(current, {
      headers: {
        "user-agent": UA,
        accept: "image/avif,image/webp,image/apng,image/png,image/jpeg,image/gif,image/*;q=0.8",
        referer: `${origin}/`,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("redirect without a location");
      current = new URL(loc, current).toString(); // re-validated at the top of the next hop
      continue;
    }
    return res;
  }
  throw new Error("too many redirects");
}

export async function GET(req: Request) {
  const ctx = await getRequestStorage();
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const target = new URL(req.url).searchParams.get("url") ?? "";
  if (!target) return NextResponse.json({ error: "Missing url." }, { status: 400 });

  try {
    assertPublicHttpUrl(target);
  } catch {
    return NextResponse.json({ error: "That image can't be fetched." }, { status: 400 });
  }

  try {
    const res = await fetchFollowingSafely(target);
    if (!res.ok) return NextResponse.json({ error: `image returned ${res.status}` }, { status: 502 });

    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/") || UNSAFE_TYPE.test(type)) {
      return NextResponse.json({ error: "not a supported image" }, { status: 415 });
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared && declared > MAX_BYTES) {
      return NextResponse.json({ error: "image too large" }, { status: 413 });
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "image too large" }, { status: 413 });
    }
    return new Response(buf, {
      status: 200,
      headers: {
        "content-type": type,
        "content-length": String(buf.byteLength),
        "cache-control": CACHE,
        // Defense in depth: don't let the browser sniff the bytes into an
        // active type, and neuter any active content if one slips the checks.
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox; style-src 'unsafe-inline'",
        "content-disposition": 'inline; filename="image"',
      },
    });
  } catch {
    return NextResponse.json({ error: "Couldn't load that image." }, { status: 502 });
  }
}
