import { NextResponse } from "next/server";
import { AUTH_COOKIE, signLevel, homeForLevel, canAccess, safeNextPath } from "@/lib/auth";
import { findLevelByPin } from "@/lib/pins";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Rate limit by client IP. This matters more than it used to: a guessed PIN
  // now yields a connector URL (minted from /connectors) that keeps working
  // AFTER the PIN is rotated, so a credential can outlive the credential that
  // minted it. 10/60s, not /api/submit's 5/60s: this is a login shared by a
  // small team who may sit behind one office NAT, and a failed attempt is far
  // more likely to be a typo than an attack — 10/minute still throttles
  // automated grinding to zero.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allow(`auth:${ip}`, 10, 60_000)) {
    // Same 429 shape regardless of PIN validity — never reveal whether the
    // submitted PIN was correct.
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as { pin?: unknown; next?: unknown } | null;
  const pin = typeof body?.pin === "string" ? body.pin : "";
  const next = typeof body?.next === "string" ? body.next : "";

  const level = await findLevelByPin(pin);
  if (!level) return NextResponse.json({ ok: false }, { status: 401 });

  // Route the user to their own dashboard, unless they were bounced from a
  // specific page they're allowed to see (honor ?next then).
  const safeNext = safeNextPath(next);
  const redirect = safeNext !== "/" && canAccess(level, safeNext) ? safeNext : homeForLevel(level);

  const res = NextResponse.json({ ok: true, level, redirect });
  res.cookies.set(AUTH_COOKIE, await signLevel(level), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
