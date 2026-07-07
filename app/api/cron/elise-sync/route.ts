import { NextResponse } from "next/server";
import { runEliseSync } from "@/lib/elise-sync";

// Nightly EliseAI → Neon leasing-funnel sync (Vercel Cron; see vercel.json).
// PII-free aggregates only. Guarded by CRON_SECRET: Vercel Cron sends
// `Authorization: Bearer <CRON_SECRET>` automatically when the env var is set;
// if it's unset the route is open (dev). snowflake-sdk needs the Node runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // Snowflake warehouse cold-start can take a few seconds

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }
  try {
    const result = await runEliseSync();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
