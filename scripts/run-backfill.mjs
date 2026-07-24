// One-time revenue backfill runner (P2).
// Reads CRON_SECRET (and optional PUBLIC_BASE_URL) from .env.local, then hits
// the deployed /api/cron/backfill-revenue route once per month, Jan→Jul 2026.
// The route is idempotent (safe to re-run) and PII-free. Monthly chunks keep
// each call under the 300s function limit (8 properties × ~30 days per call).
//
// Usage:  node scripts/run-backfill.mjs
// Requires .env.local at repo root with:  CRON_SECRET=<value from Vercel>
// Optional override:                      PUBLIC_BASE_URL=https://dashboard.rentstayable.com

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- load .env.local -------------------------------------------------------
const env = {};
try {
  for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  console.error("Could not read .env.local at repo root.");
  process.exit(1);
}

const SECRET = env.CRON_SECRET;
const BASE = (env.PUBLIC_BASE_URL || "https://dashboard.rentstayable.com").replace(/\/$/, "");

if (!SECRET) {
  console.error("CRON_SECRET is missing from .env.local. Add:  CRON_SECRET=<value from Vercel>");
  process.exit(1);
}

// --- month chunks --------------------------------------------------------
// Usage: node scripts/run-backfill.mjs [year] [startMonth] [endMonth]
//   default 2026 1 7 (this year, Jan→Jul). For last-year YoY: 2025 1 12.
const YEAR = Number(process.argv[2] ?? 2026);
const MO_START = Number(process.argv[3] ?? 1);
const MO_END = Number(process.argv[4] ?? 7);
const chunks = [];
for (let mo = MO_START; mo <= MO_END; mo++) {
  const start = `${YEAR}-${String(mo).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(YEAR, mo, 0)).getUTCDate(); // day 0 of next month
  const end = `${YEAR}-${String(mo).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  chunks.push({ start, end });
}

console.log(`Backfilling revenue via ${BASE}  (${chunks.length} monthly chunks)\n`);

let totalRows = 0;
for (const { start, end } of chunks) {
  const url = `${BASE}/api/cron/backfill-revenue?start=${start}&end=${end}`;
  process.stdout.write(`  ${start} → ${end}  ... `);
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${SECRET}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      console.log(`FAILED (${res.status}) ${JSON.stringify(body)}`);
      continue;
    }
    totalRows += body.rowsWritten ?? 0;
    console.log(`ok  days=${body.days} rows=${body.rowsWritten} props=${body.properties}`);
  } catch (e) {
    console.log(`ERROR ${e.message}`);
  }
}

console.log(`\nDone. Total rows written: ${totalRows}`);
