// Remove stale rows from elise_funnel_daily. DRY RUN unless --apply.
//
//   npx tsx scripts/purge-elise-funnel.mts                # report only
//   npx tsx scripts/purge-elise-funnel.mts --retired --apply
//   npx tsx scripts/purge-elise-funnel.mts --overlap --apply
//
// WHY THIS EXISTS (08/07/26). The funnel source moved from PROSPECT_EVENTS_RISE8
// to EVENTS_LEASING_RISE8. The table is keyed (building_id, day, event_type), so:
//
//   * RETIRED types (prospect, prospect_engaged, application_started,
//     lease_completed, …) are simply dead rows no stage reads. Safe to delete any
//     time; --retired does that.
//   * OVERLAP types (tour_booked, tour_attended, application_approved) exist in
//     BOTH vocabularies. The old query bucketed by UTC date and did not
//     de-duplicate; the new one buckets by property-local date and does. Where the
//     two disagree on the day, BOTH rows survive and reads sum them — which is why
//     June 2026 rendered 286 tours booked against EliseAI's 223.
//     --overlap deletes those three types outright. They come back CORRECT on the
//     next successful sync, so only run it when the Snowflake credential works.
//
// Rows written before the `updated_at` column existed have it defaulted to the
// migration time, so age alone cannot separate them — hence deleting by type.
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const { neon } = await import("@neondatabase/serverless");
const { FUNNEL_STAGES } = await import("../lib/leasing.ts");

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("No DATABASE_URL(_UNPOOLED) in .env.local");
  process.exit(1);
}
const sql = neon(url);
const apply = process.argv.includes("--apply");

const CURRENT = new Set<string>([...FUNNEL_STAGES.map((s) => s.key), "prospect_canceled"]);
const OVERLAP = ["tour_booked", "tour_attended", "application_approved"];

const rows = (await sql`
  select event_type, count(*) as rows, sum(n) as total,
         min(day)::text as first_day, max(day)::text as last_day
  from elise_funnel_daily group by event_type order by sum(n) desc
`) as { event_type: string; rows: number; total: number; first_day: string; last_day: string }[];

console.log("event_type                rows    total  span                     class");
const retired: string[] = [];
for (const r of rows) {
  const cls = !CURRENT.has(r.event_type) ? "RETIRED" : OVERLAP.includes(r.event_type) ? "overlap (may be mixed)" : "current";
  if (cls === "RETIRED") retired.push(r.event_type);
  console.log(
    `${r.event_type.padEnd(24)} ${String(r.rows).padStart(5)} ${String(r.total).padStart(8)}  ` +
      `${r.first_day}..${r.last_day}  ${cls}`,
  );
}

const targets = process.argv.includes("--retired") ? retired : process.argv.includes("--overlap") ? OVERLAP : [];
if (!targets.length) {
  console.log("\nNothing selected. Pass --retired or --overlap (add --apply to actually delete).");
  process.exit(0);
}
console.log(`\n${apply ? "DELETING" : "WOULD DELETE"} event types: ${targets.join(", ")}`);
if (!apply) {
  console.log("Dry run — re-run with --apply.");
  process.exit(0);
}
const res = (await sql`delete from elise_funnel_daily where event_type = any(${targets}) returning 1`) as unknown[];
console.log(`Deleted ${res.length} row(s).`);
if (process.argv.includes("--overlap")) {
  console.log("Now re-run the sync: npx tsx scripts/elise-sync.mts");
}
