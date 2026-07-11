import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  supabaseEnabled,
} from "@/lib/supabase/config";

// Refreshes the Supabase session on every request (required by @supabase/ssr)
// and gates the app: unauthenticated users are sent to /login, unauthenticated
// API calls get a 401. In local mode (no Supabase env) it does nothing.
export async function middleware(request: NextRequest) {
  if (!supabaseEnabled) return NextResponse.next();

  let supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // getClaims() verifies the JWT and refreshes an expired session.
  // Never trust getSession() in server code.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const path = request.nextUrl.pathname;
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/api/keepalive");

  if (!signedIn && !isPublic) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  // Skip static assets and the PWA surface (manifest, service worker, icons)
  // so the app stays installable from the login screen.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js|icons/).*)",
  ],
};
