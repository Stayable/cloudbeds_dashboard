import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, verifyCookie } from "@/lib/auth";
import { insertFeedback } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Require an exec session (a base/other session must not post).
  const level = await verifyCookie((await cookies()).get(AUTH_COOKIE)?.value);
  if (level !== "exec") {
    return NextResponse.json({ ok: false, error: "exec access required" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { notes?: unknown } | null;
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
  if (!notes) return NextResponse.json({ ok: false, error: "notes required" }, { status: 400 });

  try {
    await insertFeedback(notes);
  } catch {
    return NextResponse.json({ ok: false, error: "could not save feedback" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
