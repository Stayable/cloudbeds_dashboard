import { NextResponse } from "next/server";
import { checkBotId } from "botid/server";
import { insertSubmission } from "@/lib/db";
import { allow } from "@/lib/ratelimit";
import { CATALOG } from "@/config/catalog-sample";

export const dynamic = "force-dynamic";

const TEAMS = ["Crystal", "Remote Property Managers", "Property Managers & Attendants", "Other"];

// Input length caps (applied after trim).
const MAX_NAME = 120;
const MAX_ROLE = 120;
const MAX_TEAM = 120;
const MAX_NOTES = 2000;
const MAX_METRICS = 200;

// Valid metric keys derived from the catalog — client/server parity.
const VALID_METRIC_KEYS = new Set(CATALOG.map((m) => m.key));

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
  const rawMetrics = Array.isArray(body?.metrics)
    ? (body!.metrics as unknown[]).filter((m): m is string => typeof m === "string").slice(0, MAX_METRICS)
    : [];
  const notes = typeof body?.notes === "string" ? body.notes.trim() : "";

  if (!name || !role || !team) {
    return NextResponse.json({ ok: false, error: "name, role, and team are required" }, { status: 400 });
  }
  if (!TEAMS.includes(team)) {
    return NextResponse.json({ ok: false, error: "invalid team" }, { status: 400 });
  }

  // Length caps (after trim).
  if (name.length > MAX_NAME) {
    return NextResponse.json({ ok: false, error: `name must be ${MAX_NAME} characters or fewer` }, { status: 400 });
  }
  if (role.length > MAX_ROLE) {
    return NextResponse.json({ ok: false, error: `role must be ${MAX_ROLE} characters or fewer` }, { status: 400 });
  }
  if (team.length > MAX_TEAM) {
    return NextResponse.json({ ok: false, error: `team must be ${MAX_TEAM} characters or fewer` }, { status: 400 });
  }
  if (notes.length > MAX_NOTES) {
    return NextResponse.json({ ok: false, error: `notes must be ${MAX_NOTES} characters or fewer` }, { status: 400 });
  }

  // Filter metrics to catalog-known keys only; require ≥1 valid metric.
  const metrics = rawMetrics.filter((k) => VALID_METRIC_KEYS.has(k));
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
