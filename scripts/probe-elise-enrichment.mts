// Read-only: does fetchEliseEnrichment() still work? The 08/07/26 sync reported
// "enrichment metric rows: 0" with a Snowflake error, and runEliseSync()
// deliberately swallows enrichment failures so the funnel still syncs — which
// means this leg can fail silently. Prints the real error.
//
//   npx tsx scripts/probe-elise-enrichment.mts
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const { fetchEliseEnrichment } = await import("../lib/snowflake.ts");
try {
  const r = await fetchEliseEnrichment();
  console.log("OK — rows:", r.rows.length, "skipped:", r.skipped);
  const byMetric = new Map<string, number>();
  for (const row of r.rows) byMetric.set(row.metric, (byMetric.get(row.metric) ?? 0) + 1);
  for (const [m, n] of [...byMetric].sort()) console.log(`   ${m}: ${n} rows`);
} catch (e) {
  console.log("ENRICHMENT FAILED:", String((e as Error)?.message ?? e));
}
