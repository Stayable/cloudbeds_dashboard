import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, canAccess, gateEnabled, verifyCookie } from "@/lib/auth";

// Everything under the gate now requires a PIN — the home / is gated at the
// `base` level (MAIN pin), not public. Only the paths excluded in `matcher`
// below (login, /test, the public write APIs, the cron endpoint) stay open.
// The cookie is a signed level token, verified here with no DB read.
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
  // own token inline), the report-file download (also self-checks — it is how
  // the Teams card links the PDF/Excel without handing the MAIN pin to the
  // Revenue chat), the cron endpoint (self-checks CRON_SECRET; called by
  // Vercel with no cookie), Next internals, and static files.
  matcher: [
    "/((?!login|api/auth|api/cron(?:/.*)?|api/submit(?:/.*)?|api/feedback(?:/.*)?|api/crystal-note(?:/.*)?|api/report-file(?:/.*)?|api/change-pin(?:/.*)?|api/reviews-window(?:/.*)?|test(?:/.*)?|_next/static|_next/image|favicon.ico|robots.txt).*)",
  ],
};
