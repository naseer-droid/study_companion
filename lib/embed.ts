// Non-YouTube video embedding (v3.7). Maps a handful of embeddable video hosts
// to a player URL so their links become playable video cards on the shelf.
// YouTube keeps its own richer path (transcript seek) in extract.ts/ReaderView;
// this covers the rest. Transcript extraction stays YouTube-only — these items
// carry no text and the companion discusses them from the title.

export type VideoEmbed = { host: string; embedUrl: string; kind: "iframe" | "file" };

// Pure URL→player mapping. Returns null for anything not recognised (including
// YouTube, which is handled separately). Never fetches — safe to call on any URL.
export function videoEmbed(u: URL): VideoEmbed | null {
  const host = u.hostname.replace(/^www\./, "");

  // Vimeo — vimeo.com/<id> or player.vimeo.com/video/<id>
  if (host === "vimeo.com") {
    const m = u.pathname.match(/^\/(\d+)/);
    if (m) return { host: "Vimeo", embedUrl: `https://player.vimeo.com/video/${m[1]}`, kind: "iframe" };
  }
  if (host === "player.vimeo.com") {
    const m = u.pathname.match(/^\/video\/(\d+)/);
    if (m) return { host: "Vimeo", embedUrl: `https://player.vimeo.com/video/${m[1]}`, kind: "iframe" };
  }

  // Dailymotion — dailymotion.com/video/<id> or dai.ly/<id>
  if (host === "dailymotion.com") {
    const m = u.pathname.match(/^\/video\/([a-z0-9]+)/i);
    if (m) return { host: "Dailymotion", embedUrl: `https://www.dailymotion.com/embed/video/${m[1]}`, kind: "iframe" };
  }
  if (host === "dai.ly") {
    const id = u.pathname.slice(1).split("/")[0];
    if (id) return { host: "Dailymotion", embedUrl: `https://www.dailymotion.com/embed/video/${id}`, kind: "iframe" };
  }

  // Vidyard — the watch-page share id IS the player uuid (verified), so
  // <sub>.hubs.vidyard.com/watch/<id> / share.vidyard.com/watch/<id> /
  // play.vidyard.com/<id>.html all map to the same player page.
  if (host === "vidyard.com" || host.endsWith(".vidyard.com")) {
    const m = u.pathname.match(/\/watch\/([\w-]+)/) || u.pathname.match(/^\/([\w-]+)\.html/);
    if (m) return { host: "Vidyard", embedUrl: `https://play.vidyard.com/${m[1]}.html`, kind: "iframe" };
  }

  // Direct video file — play it in a native <video> element.
  if (/\.(mp4|webm|ogv)$/i.test(u.pathname)) {
    return { host, embedUrl: u.href, kind: "file" };
  }

  return null;
}

// Best-effort title/thumbnail via each host's keyless oEmbed. One fetch, and a
// miss just leaves the card titled by its hostname. Never throws.
export async function videoEmbedMeta(
  url: string,
  embed: VideoEmbed
): Promise<{ title?: string; thumbnail?: string }> {
  const oembedUrl =
    embed.host === "Vimeo"
      ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`
      : embed.host === "Dailymotion"
        ? `https://www.dailymotion.com/services/oembed?format=json&url=${encodeURIComponent(url)}`
        : embed.host === "Vidyard"
          ? `https://api.vidyard.com/dashboard/v1.1/oembed?format=json&url=${encodeURIComponent(url)}`
          : null;
  if (!oembedUrl) return {};
  try {
    const res = await fetch(oembedUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return {};
    const d = await res.json();
    return {
      title: typeof d.title === "string" && d.title ? d.title : undefined,
      thumbnail: typeof d.thumbnail_url === "string" && d.thumbnail_url ? d.thumbnail_url : undefined,
    };
  } catch {
    return {};
  }
}
