// Repair banked out-of-order figures that were short because /getRoomBlocks was
// read unpaged (20 blocks per page — see getRoomBlocksPaged in lib/cloudbeds.ts,
// fixed 08/07/26 in 022d6af). Every day banked before that fix could be short at
// any property with more than 20 block records in the window; measured, that is
// KE and JN, plus one room of `other` at OR.
//
//   npx tsx scripts/repair-ooo-pagination.mts 2026-08-01 2026-08-06            # dry run
//   npx tsx scripts/repair-ooo-pagination.mts 2026-08-01 2026-08-06 --apply
//   npx tsx scripts/repair-ooo-pagination.mts 2026-01-01 2026-07-31 --include-final
//
// SAFETY, in order of how much it matters:
//
//  1. RAISE-ONLY. A day is written only where the newly paged figure is HIGHER
//     than what is banked. Room blocks have no as-of query — /getRoomBlocks
//     returns records as they exist now, so an expired block that someone tidied
//     up has simply vanished. A lower re-read is lost information, not a
//     correction (lib/db.ts restateSnapshot says the same, and it is why the
//     nightly pass freezes `ooo`). This script therefore CANNOT lower JN's
//     override-derived 107 to the true ~104; that would need a deliberate
//     overwrite, which is a separate decision.
//  2. A FAILED READ IS NEVER A WRITE. getBlockNights returning !ok skips the day
//     entirely. The four 429-zeros of July came from treating a failure as a 0.
//  3. FINALIZED MONTHS ARE SKIPPED unless --include-final is passed. Jan-Jul 2026
//     are is_final = true.
//  4. `other_blocks` IS DELIBERATELY NOT TOUCHED. It is a sum of the block half
//     and the comp half (room-nights whose room rate nets $0), and only the
//     block half is short. Overwriting the total with a block-only figure would
//     silently drop the comp component. OR's one missing `other` room is left
//     wrong rather than fixed by widening this script's write contract.
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const { getBlockNights, readKey } = await import("../lib/cloudbeds.ts");
const { PROPERTIES } = await import("../config/properties.ts");
const { neon } = await import("@neondatabase/serverless");

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const INCLUDE_FINAL = argv.includes("--include-final");
const positional = argv.filter((a) => !a.startsWith("--"));
const START = positional[0] || "2026-08-01";
const END = positional[1] || "2026-08-06";
const ONLY = positional[2] ? positional[2].toUpperCase().split(",") : null;

const sql = neon(process.env.DATABASE_URL!);

const days: string[] = [];
for (let d = new Date(`${START}T00:00:00Z`); d <= new Date(`${END}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
  days.push(d.toISOString().slice(0, 10));
}

const banked = (await sql`
  select property_code, to_char(stay_date, 'YYYY-MM-DD') as stay_date, ooo, is_final, ooo_source
    from report_daily_snapshot
   where stay_date between ${START} and ${END}
`) as Array<{ property_code: string; stay_date: string; ooo: number; is_final: boolean; ooo_source: string }>;
const bankedBy = new Map(banked.map((r) => [`${r.property_code}|${r.stay_date}`, r]));

type Plan = { code: string; id: string; date: string; from: number; to: number; final: boolean; source: string };
const plan: Plan[] = [];
const skipped: string[] = [];
let read = 0, failed = 0, unchanged = 0, lower = 0;

for (const p of PROPERTIES) {
  if (p.active !== true) continue;
  if (ONLY && !ONLY.includes(p.code)) continue;
  const key = readKey(p.code);
  if (!key) { skipped.push(`${p.code}: no key`); continue; }

  for (const date of days) {
    const bk = bankedBy.get(`${p.code}|${date}`);
    if (!bk) { skipped.push(`${p.code} ${date}: no banked row`); continue; }
    if (bk.is_final && !INCLUDE_FINAL) { skipped.push(`${p.code} ${date}: is_final`); continue; }

    const res = await getBlockNights(key, date, date);
    read++;
    if (!res.ok) { failed++; skipped.push(`${p.code} ${date}: block read FAILED (${res.error}) — not written`); continue; }

    const fresh = res.data.ooo;
    if (fresh > bk.ooo) plan.push({ code: p.code, id: p.id, date, from: bk.ooo, to: fresh, final: bk.is_final, source: bk.ooo_source });
    else if (fresh < bk.ooo) lower++;
    else unchanged++;
  }
}

console.log(`\nOOO PAGINATION REPAIR — ${START}..${END}${ONLY ? ` (${ONLY.join(",")})` : ""}`);
console.log(`${APPLY ? "APPLYING" : "DRY RUN"}${INCLUDE_FINAL ? " · including finalized months" : ""}\n`);
console.log(`days read ${read} · would raise ${plan.length} · already correct ${unchanged} · re-read LOWER (left alone) ${lower} · failed ${failed}`);

if (plan.length) {
  console.log(`\nprop  id      date          banked -> paged   delta  src`);
  for (const r of plan) {
    console.log(`${r.code.padEnd(4)}  ${r.id.padEnd(6)}  ${r.date}   ${String(r.from).padStart(5)} -> ${String(r.to).padEnd(5)}  +${r.to - r.from}${r.final ? "   (FINAL)" : ""}   ${r.source}`);
  }
  const byProp = new Map<string, { days: number; nights: number }>();
  for (const r of plan) {
    const e = byProp.get(r.code) ?? { days: 0, nights: 0 };
    e.days++; e.nights += r.to - r.from;
    byProp.set(r.code, e);
  }
  console.log(`\nper property: ${[...byProp.entries()].map(([c, e]) => `${c} +${e.nights} room-nights over ${e.days}d`).join(" · ")}`);
  console.log(`TOTAL: +${plan.reduce((s, r) => s + (r.to - r.from), 0)} out-of-order room-nights`);
}

if (lower) {
  console.log(`\n${lower} day(s) re-read LOWER than banked and were left untouched — blocks erode, so the`);
  console.log(`banked figure is the better record (raise-only, same rule as the nightly restatement).`);
}

if (!APPLY) {
  console.log(`\nNothing written. Re-run with --apply to write ${plan.length} row(s).`);
} else if (!plan.length) {
  console.log(`\nNothing to write.`);
} else {
  let written = 0;
  for (const r of plan) {
    // greatest() in SQL as well as in the plan above: belt and braces against a
    // concurrent capture having raised the row between the read and this write.
    const rows = (await sql`
      update report_daily_snapshot
         set ooo = greatest(ooo, ${r.to}),
             ooo_source = 'cloudbeds',
             ooo_observed_at = now(),
             updated_at = now()
       where property_code = ${r.code} and stay_date = ${r.date}
      returning 1 as ok`) as { ok: number }[];
    if (rows.length) written++;
  }
  console.log(`\nWROTE ${written} row(s). ooo_source stamped 'cloudbeds' — these figures now come from paged block records.`);
}
