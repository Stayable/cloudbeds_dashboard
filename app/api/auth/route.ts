import { NextResponse } from "next/server";
import { AUTH_COOKIE, signLevel, homeForLevel, canAccess, safeNextPath } from "@/lib/auth";
import { findLevelByPin } from "@/lib/pins";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
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
