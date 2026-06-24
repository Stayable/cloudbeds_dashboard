import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, decideAccess, expectedTokens } from "@/lib/auth";

// Role-based PIN gate. Disabled (open) when DASHBOARD_PIN is unset, so a
// misconfigured deploy never locks itself out. /test and /api/submit are the
// public surfaces (excluded in the matcher). /exec needs the exec token.
export async function middleware(req: NextRequest) {
  const expected = await expectedTokens();
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (decideAccess(req.nextUrl.pathname, token, expected) === "allow") {
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
    "/((?!login|api/auth|api/submit(?:/.*)?|api/feedback(?:/.*)?|api/crystal-note(?:/.*)?|test(?:/.*)?|_next/static|_next/image|favicon.ico|robots.txt).*)",
  ],
};
