// ONE-OFF: lower Jacksonville North's banked out-of-order from the removed
// sellable override (107/day) to what Cloudbeds actually reports.
//
//   npx tsx scripts/correct-jn-override-ooo.mts 2026-08-01 2026-08-06
//   npx tsx scripts/correct-jn-override-ooo.mts 2026-08-01 2026-08-06 --apply
//
// THIS LOWERS BANKED HISTORY, which every other guard in this codebase forbids
// (observeBlocks upserts with greatest(); restateSnapshot freezes `ooo` once a
// day has nights). Both exist because room blocks erode — a smaller re-read is
// normally lost information rather than a correction.
//
// Why the exception is justified here, specifically:
//   - The 107 was never a Cloudbeds reading. It came from sellableOverrides
//     (20 of 127 sellable), which existed only because /getRoomBlocks was read
//     unpaged and appeared to report 20 out-of-service rooms.
//   - Paged, Cloudbeds reports 102-104 for these days, and Kyle's calendar
//     screenshots count 104 red bars at JN room-for-room on 08/07.
//   - 104 OOO + 3 blocked_dates = the 107. The override measured UNSELLABLE;
//     the field it fed is OUT-OF-ORDER only, and our report counts those 3
//     rooms again under Other blocks. That double-count is what drove JN's
//     Available to -2.
// So this is not erosion. It is removing a number we invented.
//
// Guards, all deliberate:
//   - Only rows whose ooo_source = 'override' are touched. A row already sourced
//     from Cloudbeds is left exactly alone.
//   - Only lowers to a SUCCESSFUL paged read; a failed read skips the day.
//   - Refuses finalized rows (is_final) — closed months are a separate decision.
//   - Prints every change and writes nothing without --apply.
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const { getBlockNights, readKey } = await import("../lib/cloudbeds.ts");
const { neon } = await import("@neondatabase/serverless");

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const pos = argv.filter((a) => !a.startsWith("--"));
const START = pos[0] || "2026-08-01";
const END = pos[1] || "2026-08-06";

const sql = neon(process.env.DATABASE_URL!);
const key = readKey("JN");
if (!key) throw new Error("no CLOUDBEDS_API_KEY_JN");

const rows = (await sql`
  select to_char(stay_date,'YYYY-MM-DD') as d, ooo, other_blocks, inventory, is_final, ooo_source,
         transient_nights + lease_nights as nights
    from report_daily_snapshot
   where property_code = 'JN' and stay_date between ${START} and ${END}
   order by stay_date
`) as Array<{ d: string; ooo: number; other_blocks: number; inventory: number; is_final: boolean; ooo_source: string; nights: number }>;

console.log(`\nJN OVERRIDE CORRECTION  ${START}..${END}   ${APPLY ? "APPLYING" : "DRY RUN"}\n`);
console.log(`date        banked  paged   avail before -> after   src        note`);

const plan: { d: string; from: number; to: number }[] = [];
for (const r of rows) {
  const res = await getBlockNights(key, r.d, r.d);
  if (!res.ok) {
    console.log(`${r.d}  ${String(r.ooo).padStart(6)}     --                          ${r.ooo_source.padEnd(9)}  READ FAILED — skipped`);
    continue;
  }
  const paged = res.data.ooo;
  const occ = Number(r.nights) + Number(r.other_blocks);
  const before = r.inventory - occ - r.ooo;
  const after = r.inventory - occ - paged;
  let note = "";
  if (r.is_final) note = "is_final — refused";
  else if (r.ooo_source !== "override") note = "not override-sourced — left alone";
  else if (paged >= r.ooo) note = "paged not lower — nothing to do";
  else { note = "will lower"; plan.push({ d: r.d, from: r.ooo, to: paged }); }
  console.log(`${r.d}  ${String(r.ooo).padStart(6)}  ${String(paged).padStart(5)}   ${String(before).padStart(12)} -> ${String(after).padEnd(5)}   ${r.ooo_source.padEnd(9)}  ${note}`);
}

console.log(`\n${plan.length} day(s) to lower, ${plan.reduce((s, p) => s + (p.from - p.to), 0)} out-of-order room-nights removed.`);

if (!APPLY) {
  console.log(`Nothing written. Re-run with --apply.`);
} else {
  let written = 0;
  for (const p of plan) {
    // Conditioned on ooo_source='override' in the UPDATE too, so a concurrent
    // capture that legitimately re-sourced the row wins over this correction.
    const res = (await sql`
      update report_daily_snapshot
         set ooo = ${p.to},
             ooo_source = 'cloudbeds',
             ooo_observed_at = now(),
             updated_at = now()
       where property_code = 'JN' and stay_date = ${p.d}
         and is_final = false and ooo_source = 'override'
      returning 1 as ok`) as { ok: number }[];
    if (res.length) written++;
  }
  console.log(`WROTE ${written} row(s); ooo_source now 'cloudbeds'.`);
}
