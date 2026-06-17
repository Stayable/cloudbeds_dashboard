import { NextResponse } from "next/server";
import { AUTH_COOKIE, pinToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const expected = process.env.DASHBOARD_PIN;
  if (!expected) {
    // Gate disabled — nothing to verify against.
    return NextResponse.json({ ok: false, error: "PIN gate not configured" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { pin?: unknown } | null;
  const pin = typeof body?.pin === "string" ? body.pin : "";

  if (pin !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await pinToken(expected), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
