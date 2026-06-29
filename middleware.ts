import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, canAccess, gateEnabled, requiredLevel, verifyCookie } from "@/lib/auth";

// Only the per-user dashboards (/crystal, /monica, /bea) and /rob (exec) are
// gated. The home / and everything else are PUBLIC (view-only aggregate data).
// The cookie is a signed level token, verified here with no DB read.
export async function middleware(req: NextRequest) {
  // Public: home + any base-level route.
  if (requiredLevel(req.nextUrl.pathname) === "base") return NextResponse.next();
  if (!gateEnabled()) return NextResponse.next();

  const level = await verifyCookie(req.cookies.get(AUTH_COOKIE)?.value);
  if (level && canAccess(level, req.nextUrl.pathname)) {
    return NextResponse.next();
  }
  const url = req.nextUrl.clone();
  const next = req.nextUrl.pathname + req.nextUrl.search;
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Protect everything except: login, auth endpoint, the PUBLIC intake page and
  // its write endpoint, the feedback + crystal-note APIs (which self-check their
  // own token inline), Next internals, and static files.
  matcher: [
    "/((?!login|api/auth|api/submit(?:/.*)?|api/feedback(?:/.*)?|api/crystal-note(?:/.*)?|api/change-pin(?:/.*)?|api/reviews-window(?:/.*)?|test(?:/.*)?|_next/static|_next/image|favicon.ico|robots.txt).*)",
  ],
};
