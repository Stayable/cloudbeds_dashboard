import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, canAccess, gateEnabled, verifyCookie } from "@/lib/auth";

// Everything under the gate now requires a PIN — the home / is gated at the
// `base` level (MAIN pin), not public. Only the paths excluded in `matcher`
// below (login, /test, the public write APIs, the cron endpoint) stay open.
// The cookie is a signed level token, verified here with no DB read.
/** OAuth discovery paths an MCP client probes (RFC 9728 / RFC 8414). We
 *  deliberately do NOT use OAuth — the credential is the token in the MCP URL's
 *  path — so these must answer "nothing here". */
export const OAUTH_DISCOVERY_PREFIX = "/.well-known/oauth";

export async function middleware(req: NextRequest) {
  // Answer 404 BEFORE the gate. Without this these paths fell through to the PIN
  // redirect and served /login's 200 HTML, which Claude Desktop read as "an
  // authorization server exists here". It then attempted OAuth Dynamic Client
  // Registration against a login page and failed with "Couldn't register with
  // <server>'s sign-in service. You can try again, or add an OAuth Client ID" —
  // reported 08/13/26 against two different connector URLs, because the cause is
  // origin-wide and has nothing to do with which token is in the path.
  // A 404 tells the client there is no OAuth here, so it uses the URL as given.
  if (req.nextUrl.pathname.startsWith(OAUTH_DISCOVERY_PREFIX)) {
    return new NextResponse(null, { status: 404 });
  }

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
  // Vercel with no cookie), the MCP endpoint (self-checks a secret in its own
  // path — it is called by Claude Desktop, which has no cookie and no PIN),
  // Next internals, and static files.
  matcher: [
    "/((?!login|api/auth|api/cron(?:/.*)?|api/mcp/.*|api/submit(?:/.*)?|api/feedback(?:/.*)?|api/crystal-note(?:/.*)?|api/report-file(?:/.*)?|api/change-pin(?:/.*)?|api/reviews-window(?:/.*)?|test(?:/.*)?|_next/static|_next/image|favicon.ico|robots.txt).*)",
  ],
};
