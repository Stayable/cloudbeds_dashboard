// PII-FREE aggregate sync: EliseAI Snowflake data share → Neon, for local runs
// and backfills. Production runs the same code via app/api/cron/elise-sync.
//
//   npx tsx scripts/elise-sync.mts
//
// REPLACES scripts/elise-sync.mjs, which kept its OWN COPY of the Snowflake SQL.
// On 08/07/26 the funnel moved from PROSPECT_EVENTS_RISE8 to EVENTS_LEASING_RISE8
// and that duplicate silently re-synced the OLD vocabulary — a run reported
// "9,791 rows upserted" and populated none of the new stages. This script now
// calls runEliseSync() from lib/elise-sync.ts, so there is exactly one definition
// of what the sync does and it cannot drift from production again.
//
// Note it also runs the enrichment pass (the .mjs did not); that is what the
// nightly cron does, which is the behaviour worth mirroring.
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
// The lib reads DATABASE_URL; prefer the unpooled URL for a long-running script.
if (process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;

const { runEliseSync } = await import("../lib/elise-sync.ts");

const r = await runEliseSync();
console.log("Sync complete.");
console.log(`  funnel rows upserted:   ${r.funnel}`);
console.log(`  snapshot rows written:  ${r.snapshot}`);
console.log(`  enrichment metric rows: ${r.metrics}`);
console.log(`  rows skipped (unmapped building): ${r.skipped}`);
