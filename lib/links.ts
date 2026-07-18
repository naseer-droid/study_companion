// Shared link helpers — used by the browser (Linkify, resource cards) and by
// library ingestion, so Medium opens readable no matter who shared the URL.

// Medium articles are paywalled for most readers; the freedium mirror serves
// the same text openly.
export const FREEDIUM_MIRROR = "https://freedium-mirror.cfd";

// Publications that live on Medium's platform under their own domain — the
// hostname alone doesn't say "medium", but the paywall is the same.
// (towardsdatascience.com is deliberately absent: it left Medium in 2025.)
const MEDIUM_CUSTOM_DOMAINS = new Set([
  "betterprogramming.pub",
  "levelup.gitconnected.com",
  "javascript.plainenglish.io",
  "python.plainenglish.io",
  "uxdesign.cc",
  "bootcamp.uxdesign.cc",
  "itnext.io",
  "codeburst.io",
  "proandroiddev.com",
  "infosecwriteups.com",
]);

export function isMediumUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return (
      host === "medium.com" ||
      host.endsWith(".medium.com") || // includes link.medium.com short links
      MEDIUM_CUSTOM_DOMAINS.has(host)
    );
  } catch {
    return false;
  }
}

// Medium → the mirror; everything else (including already-mirrored URLs)
// passes through unchanged.
export function readerUrl(url: string): string {
  if (url.startsWith(`${FREEDIUM_MIRROR}/`)) return url;
  return isMediumUrl(url) ? `${FREEDIUM_MIRROR}/${url}` : url;
}

// Fallback when a resource has no stored URL (all pre-v3.1 topics).
export function searchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
