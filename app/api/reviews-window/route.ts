import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, verifyCookie } from "@/lib/auth";
import { setSetting } from "@/lib/db";

export const dynamic = "force-dynamic";

// Save the LOCKED 1-star reviews date window for the Operations Dashboard. The
// window is shared (Neon-persisted) and applies to everyone viewing /ops. Only
// ops/exec may set it — the level is derived from the signed cookie, never the
// client. Self-checks its own auth (excluded from the middleware matcher).
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  const level = await verifyCookie((await cookies()).get(AUTH_COOKIE)?.value);
  if (level !== "ops" && level !== "exec") {
    return NextResponse.json({ ok: false, error: "not authorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { from?: unknown; to?: unknown } | null;
  const from = typeof body?.from === "string" ? body.from : "";
  const to = typeof body?.to === "string" ? body.to : "";
  if (!YMD.test(from) || !YMD.test(to)) {
    return NextResponse.json({ ok: false, error: "Dates must be YYYY-MM-DD" }, { status: 400 });
  }
  // Guard against a reversed range.
  const [f, t] = from <= to ? [from, to] : [to, from];

  try {
    await setSetting("ops_reviews_window", JSON.stringify({ from: f, to: t }));
  } catch {
    return NextResponse.json({ ok: false, error: "Could not save the window" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, from: f, to: t });
}
