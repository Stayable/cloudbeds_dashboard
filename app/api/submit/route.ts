import { NextResponse } from "next/server";
import { checkBotId } from "botid/server";
import { insertSubmission } from "@/lib/db";
import { allow } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

const TEAMS = ["Crystal", "Remote Property Managers", "Property Managers & Attendants", "Other"];

export async function POST(req: Request) {
  // 1) Bot check (Vercel BotID). Off-Vercel/dev returns isBot:false.
  const verdict = await checkBotId();
  if (verdict.isBot) return NextResponse.json({ ok: false, error: "Bot detected" }, { status: 403 });

  // 2) Light rate limit by client IP.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allow(`submit:${ip}`, 5, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
  }

  // 3) Parse + validate.
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const role = typeof body?.role === "string" ? body.role.trim() : "";
  const team = typeof body?.team === "string" ? body.team.trim() : "";
  const metrics = Array.isArray(body?.metrics)
    ? (body!.metrics as unknown[]).filter((m): m is string => typeof m === "string")
    : [];
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";

  if (!name || !role || !team) {
    return NextResponse.json({ ok: false, error: "name, role, and team are required" }, { status: 400 });
  }
  if (!TEAMS.includes(team)) {
    return NextResponse.json({ ok: false, error: "invalid team" }, { status: 400 });
  }
  if (metrics.length < 1) {
    return NextResponse.json({ ok: false, error: "select at least one metric" }, { status: 400 });
  }

  // 4) Persist.
  try {
    await insertSubmission({ name, role, team, metrics, notes: notes || undefined });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "could not save submission" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
