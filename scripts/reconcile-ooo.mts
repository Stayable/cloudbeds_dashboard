// OOO RECONCILIATION — three independent views of "out of order", side by side,
// per property per stay date. Kyle, 08/07/26: the daily report is held until the
// OOO line is reconciled, and with Monica's workbook gone (CLAUDE.md §6) there is
// no external referee — so this settles it against Cloudbeds itself.
//
//   npx tsx scripts/reconcile-ooo.mts [start] [end]
//   npx tsx scripts/reconcile-ooo.mts 2026-08-01 2026-08-06 --csv out.csv
//
// THE THREE VIEWS, and why they are not the same question:
//
//   BANKED   report_daily_snapshot.ooo — what /report actually printed. The max
//            observed on or after the stay date (raise-only), so it reflects
//            whatever the crons saw, including any config override.
//   BLOCKS   live getBlockNights().ooo — "a room block record of type
//            out_of_service exists for that room-night". This is our source.
//   DI       Data Insights dataset 7, derived as
//                capacity * (1 - occupancy / adjusted_occupancy)
//            — "room STATUS says the room was not sellable". DI drops the count
//            columns over the API (session-3 finding: bare -> omitted,
//            modifier:"sum" -> 400), so it has to be derived. Validated at KE
//            for July 2026 against Monica's raw export, exact on 30 of 31 days.
//
// A room out of service with no block against it appears in DI and not in
// BLOCKS. That difference is the whole reconciliation: at KE it was ~7 rooms,
// the same species as JN's unblocked renovation rooms.
//
// Read-only in both directions: no Cloudbeds writes, no DB writes, no guest
// fields requested.
import { readFileSync, writeFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const { getBlockNights, readKey } = await import("../lib/cloudbeds.ts");
const { PROPERTIES } = await import("../config/properties.ts");
const { neon } = await import("@neondatabase/serverless");

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const csvFlag = process.argv.indexOf("--csv");
const csvPath = csvFlag > -1 ? process.argv[csvFlag + 1] : null;
const START = args[0] || "2026-08-01";
const END = args[1] || "2026-08-06";

const DI_BASE = "https://api.cloudbeds.com/datainsights/v1.1";

/** DI dataset-7 daily occupancy / adjusted_occupancy / capacity for one property. */
async function diOutOfService(apiKey: string, apiPropertyId: string, start: string, end: string) {
  const body = {
    property_ids: [Number(apiPropertyId)],
    dataset_id: 7,
    columns: [
      { cdf: { column: "occupancy" } },
      { cdf: { column: "mfd_occupancy" } },
    ],
    group_rows: [{ cdf: { column: "stay_date" }, modifier: "day" }],
    filters: {
      and: [
        { cdf: { column: "stay_date" }, operator: "greater_than_or_equal", value: start },
        { cdf: { column: "stay_date" }, operator: "less_than_or_equal", value: end },
      ],
    },
    settings: { totals: false, details: false },
  };

  const res = await fetch(`${DI_BASE}/reports/query/data?mode=Run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-PROPERTY-ID": apiPropertyId,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false as const, error: `HTTP ${res.status} ${text.slice(0, 200)}` };

  const parsed = JSON.parse(text) as {
    records?: Record<string, Record<string, { aggregated?: number }>>;
  };
  const records = parsed.records ?? {};
  const num = (cell?: { aggregated?: number }) =>
    typeof cell?.aggregated === "number" ? cell.aggregated : null;

  // Which columns came back matters as much as the values — DI omits rather
  // than errors, so a silently missing column would otherwise read as a zero.
  const columns = new Set<string>();
  for (const day of Object.values(records)) for (const k of Object.keys(day)) columns.add(k);

  const byDate = new Map<string, { occ: number | null; adj: number | null }>();
  for (const [date, r] of Object.entries(records)) {
    // `mfd_occupancy` is dataset 7's maintenance-adjusted occupancy: the same
    // rooms sold over a denominator that excludes out-of-service rooms. So
    // occ/mfd_occ is the ratio of the two denominators, and the OOS count falls
    // out of it — see the caller, which supplies capacity from OUR inventory
    // because dataset 7 drops every count column including `capacity`.
    byDate.set(date, { occ: num(r.occupancy), adj: num(r.mfd_occupancy) });
  }
  return { ok: true as const, columns: [...columns].sort(), byDate };
}

const days: string[] = [];
for (let d = new Date(`${START}T00:00:00Z`); d <= new Date(`${END}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
  days.push(d.toISOString().slice(0, 10));
}

// BANKED
const sql = neon(process.env.DATABASE_URL!);
const banked = (await sql`
  select property_code, to_char(stay_date, 'YYYY-MM-DD') as stay_date,
         ooo, other_blocks, inventory, ooo_source, ooo_eod, ooo_flash
    from report_daily_snapshot
   where stay_date between ${START} and ${END}
`) as Array<{
  property_code: string; stay_date: string; ooo: number; other_blocks: number;
  inventory: number; ooo_source: string; ooo_eod: number | null; ooo_flash: number | null;
}>;
const bankedBy = new Map(banked.map((r) => [`${r.property_code}|${r.stay_date}`, r]));

type Row = {
  code: string; id: string; date: string;
  bankedOoo: number | null; bankedOther: number | null; oooSource: string | null;
  blocksOoo: number | null; blocksOther: number | null;
  diOos: number | null; diCap: number | null;
};
const rows: Row[] = [];
const notes: string[] = [];

for (const p of PROPERTIES) {
  if (p.active !== true) continue;
  const key = readKey(p.code);
  if (!key || !p.apiPropertyId) {
    notes.push(`${p.code} (${p.id}): no key or no apiPropertyId — skipped`);
    continue;
  }

  const [blocks, di] = await Promise.all([
    getBlockNights(key, START, END),
    diOutOfService(key, p.apiPropertyId, START, END),
  ]);

  if (!blocks.ok) notes.push(`${p.code} (${p.id}): BLOCKS failed — ${blocks.error}`);
  if (!di.ok) notes.push(`${p.code} (${p.id}): DI failed — ${di.error}`);
  else {
    const missing = ["occupancy", "mfd_occupancy"].filter((c) => !di.columns.includes(c));
    if (missing.length) notes.push(`${p.code} (${p.id}): DI omitted column(s) ${missing.join(", ")} — derivation not trustworthy`);
  }

  // getBlockNights returns totals over the whole window, not per day, so the
  // per-day BLOCKS column comes from one call per day. Sequential per property
  // to stay clear of the rate limit that banked four zeros in July.
  for (const date of days) {
    const bk = bankedBy.get(`${p.code}|${date}`);
    const dayBlocks = await getBlockNights(key, date, date);
    const diDay = di.ok ? di.byDate.get(date) : undefined;

    // Capacity term: our banked inventory for that day. Deliberately ours and
    // not DI's — DI's own capacity wobbled 168/169/171/175 at KE where the real
    // number is 167 (TODO 08/04 item 8), and it is dropped over the API anyway.
    // Without an inventory figure the derivation is reported as null, never as 0.
    const cap = bk?.inventory ?? null;
    const oos =
      diDay && diDay.occ !== null && diDay.adj !== null && diDay.adj !== 0 && cap !== null
        ? cap * (1 - diDay.occ / diDay.adj)
        : null;

    rows.push({
      code: p.code, id: p.id, date,
      bankedOoo: bk?.ooo ?? null,
      bankedOther: bk?.other_blocks ?? null,
      oooSource: bk?.ooo_source ?? null,
      blocksOoo: dayBlocks.ok ? dayBlocks.data.ooo : null,
      blocksOther: dayBlocks.ok ? dayBlocks.data.other : null,
      diOos: oos,
      diCap: cap,
    });
  }
}

const f = (v: number | null, d = 0) => (v === null ? "  --" : v.toFixed(d).padStart(4));
console.log(`\nOOO RECONCILIATION  ${START} .. ${END}`);
console.log(`banked = what /report printed · blocks = live out_of_service records · DI = capacity x (1 - occ/adjOcc)\n`);
console.log(`prop  id      date        banked  blocks    DI   DI-blocks  banked-blocks  src`);
for (const r of rows) {
  const dDiBlocks = r.diOos !== null && r.blocksOoo !== null ? r.diOos - r.blocksOoo : null;
  const dBankBlocks = r.bankedOoo !== null && r.blocksOoo !== null ? r.bankedOoo - r.blocksOoo : null;
  console.log(
    `${r.code.padEnd(4)}  ${r.id.padEnd(6)}  ${r.date}  ${f(r.bankedOoo)}    ${f(r.blocksOoo)}  ${f(r.diOos, 1)}     ${f(dDiBlocks, 1)}          ${f(dBankBlocks)}   ${r.oooSource ?? "-"}`,
  );
}

// Per-property means over the window: the daily noise matters less than whether
// a property has a standing gap.
console.log(`\nPER-PROPERTY MEAN OVER ${days.length} DAYS`);
console.log(`prop  id      banked  blocks    DI   DI-blocks   verdict`);
const mean = (xs: (number | null)[]) => {
  const ok = xs.filter((x): x is number => x !== null);
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
};
for (const p of PROPERTIES) {
  if (p.active !== true) continue;
  const mine = rows.filter((r) => r.code === p.code);
  if (!mine.length) continue;
  const mb = mean(mine.map((r) => r.bankedOoo));
  const mbl = mean(mine.map((r) => r.blocksOoo));
  const md = mean(mine.map((r) => r.diOos));
  const gap = md !== null && mbl !== null ? md - mbl : null;
  const verdict =
    gap === null ? "incomplete data"
    : Math.abs(gap) < 1 ? "agrees"
    : gap > 0 ? `${gap.toFixed(1)} rooms unsellable with NO block`
    : `${Math.abs(gap).toFixed(1)} rooms blocked but DI counts them sellable`;
  console.log(`${p.code.padEnd(4)}  ${p.id.padEnd(6)}  ${f(mb, 1)}    ${f(mbl, 1)}  ${f(md, 1)}     ${f(gap, 1)}   ${verdict}`);
}

if (notes.length) {
  console.log(`\nNOTES / FAILURES (a failed read is NOT a zero):`);
  for (const n of notes) console.log(`  - ${n}`);
}

if (csvPath) {
  const header = "property_code,property_id,stay_date,banked_ooo,banked_other,blocks_ooo,blocks_other,di_oos,di_capacity,ooo_source\n";
  const body = rows
    .map((r) => [r.code, r.id, r.date, r.bankedOoo, r.bankedOther, r.blocksOoo, r.blocksOther,
                 r.diOos === null ? "" : r.diOos.toFixed(2), r.diCap, r.oooSource ?? ""].join(","))
    .join("\n");
  writeFileSync(csvPath, header + body + "\n");
  console.log(`\nCSV written: ${csvPath}`);
}
