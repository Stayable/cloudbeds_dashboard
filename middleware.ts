import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, pinToken } from "@/lib/auth";

// Gate every route behind a PIN cookie. Disabled (open) when DASHBOARD_PIN is
// not set, so a misconfigured deploy never locks itself out. Protects the app
// AND /api/diagnostics; lets /login and /api/auth through so users can sign in.
export async function middleware(req: NextRequest) {
  const pin = process.env.DASHBOARD_PIN;
  if (!pin) return NextResponse.next();

  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (token && token === (await pinToken(pin))) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Protect everything except the login page, the auth endpoint, Next internals
  // and static files.
  matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
