import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, gateEnabled, verifyCookie } from "@/lib/auth";
import { insertCrystalNote } from "@/lib/db";

export const dynamic = "force-dynamic";

// Notes box on /crystal. Gated to a crystal OR exec session (same as who can
// reach /crystal). No PII — submitter-entered text only.
export async function POST(req: Request) {
  const level = await verifyCookie((await cookies()).get(AUTH_COOKIE)?.value);
  const allowed = !gateEnabled() || level === "crystal" || level === "exec";
  if (!allowed) {
    return NextResponse.json({ ok: false, error: "crystal access required" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { notes?: unknown } | null;
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
  if (!notes) return NextResponse.json({ ok: false, error: "notes required" }, { status: 400 });
  if (notes.length > 2000) {
    return NextResponse.json({ ok: false, error: "notes must be 2000 characters or fewer" }, { status: 400 });
  }

  try {
    await insertCrystalNote(notes);
  } catch {
    return NextResponse.json({ ok: false, error: "could not save note" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
