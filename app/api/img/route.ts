import { NextResponse } from "next/server";
import { getRequestStorage } from "@/lib/storage";
import { assertPublicHttpUrl, UA } from "@/lib/extract";

// Image proxy for the reader. Article images are hotlinked by URL, and two
// things routinely stop them from loading in-app: (1) mixed content — an http
// image on our https page is blocked by the browser; (2) hotlink/referrer
// protection — the origin refuses requests that don't come from its own pages.
// Proxying fixes both: the browser sees a same-origin https image, and we fetch
// server-side with a browser UA and a same-origin Referer. The SSRF guard
// (assertPublicHttpUrl) keeps this from becoming a path to internal addresses,
// and auth keeps it from being an open proxy.
export const maxDuration = 20;

const MAX_BYTES = 8_000_000; // 8MB — generous for article imagery, caps abuse
const CACHE = "public, max-age=604800, s-maxage=604800, immutable"; // 7 days

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
    const origin = new URL(target).origin;
    const res = await fetch(target, {
      headers: {
        "user-agent": UA,
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        referer: `${origin}/`,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return NextResponse.json({ error: `image returned ${res.status}` }, { status: 502 });

    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) {
      return NextResponse.json({ error: "not an image" }, { status: 415 });
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
        "cache-control": CACHE,
        "content-length": String(buf.byteLength),
      },
    });
  } catch {
    return NextResponse.json({ error: "Couldn't load that image." }, { status: 502 });
  }
}
