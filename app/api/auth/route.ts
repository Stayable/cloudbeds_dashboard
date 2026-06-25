import { NextResponse } from "next/server";
import { AUTH_COOKIE, tokenFor, USER_PINS, type Level } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const basePin = process.env.DASHBOARD_PIN;
  const execPin = process.env.EXEC_PIN;
  if (!basePin) {
    return NextResponse.json({ ok: false, error: "PIN gate not configured" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { pin?: unknown } | null;
  const pin = typeof body?.pin === "string" ? body.pin : "";

  // Determine the level this PIN unlocks. Exec wins, then any per-user PIN, then base.
  let level: Level | null = null;
  if (execPin && pin === execPin) level = "exec";
  else {
    const user = USER_PINS.find((u) => process.env[u.envVar] && pin === process.env[u.envVar]);
    if (user) level = user.level;
    else if (pin === basePin) level = "base";
  }

  if (!level) return NextResponse.json({ ok: false }, { status: 401 });

  const res = NextResponse.json({ ok: true, level });
  res.cookies.set(AUTH_COOKIE, await tokenFor(level, pin), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
