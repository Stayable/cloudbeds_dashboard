import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, canAccess, gateEnabled, verifyCookie } from "@/lib/auth";

// Role-based gate. The cookie is a signed level token, so we verify it here
// without any DB read. Open only if no signing secret exists (never in prod).
// /test + /api/submit are public (excluded in the matcher).
export async function middleware(req: NextRequest) {
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
    "/((?!login|api/auth|api/submit(?:/.*)?|api/feedback(?:/.*)?|api/crystal-note(?:/.*)?|api/change-pin(?:/.*)?|test(?:/.*)?|_next/static|_next/image|favicon.ico|robots.txt).*)",
  ],
};
