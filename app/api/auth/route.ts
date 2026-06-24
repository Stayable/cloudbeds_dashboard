import { NextResponse } from "next/server";
import { AUTH_COOKIE, tokenFor } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const basePin = process.env.DASHBOARD_PIN;
  const execPin = process.env.EXEC_PIN;
  if (!basePin) {
    return NextResponse.json({ ok: false, error: "PIN gate not configured" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { pin?: unknown } | null;
  const pin = typeof body?.pin === "string" ? body.pin : "";

  // Determine the highest level this PIN unlocks. Exec PIN wins if it matches.
  let level: "base" | "exec" | null = null;
  if (execPin && pin === execPin) level = "exec";
  else if (pin === basePin) level = "base";

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
