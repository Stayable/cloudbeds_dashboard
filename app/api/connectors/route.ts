import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, verifyCookie } from "@/lib/auth";
import {
  generateToken,
  hashToken,
  connectorUrl,
  insertToken,
  countLiveTokens,
  MAX_LIVE_TOKENS,
} from "@/lib/mcp/tokens";

export const dynamic = "force-dynamic";

const MAX_EMAIL = 200;
const MAX_LABEL = 120;

// Deliberately loose: this is a typo guard on an internal dropdown, not an
// identity check. Requires a dot-separated TLD of at least two characters.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;

/** Issue a connector URL. Admin only — the /connectors page's rendering choice
 *  is presentation; THIS is the gate. The raw token is returned exactly once
 *  and never stored, logged, or recoverable. */
export async function POST(req: Request) {
  const level = await verifyCookie((await cookies()).get(AUTH_COOKIE)?.value);
  if (level !== "admin") {
    return NextResponse.json({ ok: false, error: "not authorised" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const rawLabel = typeof body?.label === "string" ? body.label.trim() : "";
  const label = rawLabel || null;

  if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "a valid email is required" }, { status: 400 });
  }
  if (label && label.length > MAX_LABEL) {
    return NextResponse.json(
      { ok: false, error: `label must be ${MAX_LABEL} characters or fewer` },
      { status: 400 },
    );
  }

  try {
    if ((await countLiveTokens()) >= MAX_LIVE_TOKENS) {
      return NextResponse.json(
        { ok: false, error: `at most ${MAX_LIVE_TOKENS} live tokens — revoke one first` },
        { status: 400 },
      );
    }
    const token = generateToken();
    await insertToken({ email, label, tokenHash: hashToken(token) });
    // The ONLY time this value exists outside the caller's browser. Never
    // logged: the catch below returns a fixed string for that reason.
    return NextResponse.json({ ok: true, url: connectorUrl(token) });
  } catch {
    return NextResponse.json({ ok: false, error: "could not issue a URL" }, { status: 500 });
  }
}
