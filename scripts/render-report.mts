// Render the Monica-format Occupancy Report PDF for one or more asOf stay dates
// into outputs/, using the same builder + renderer the cron and /report use.
//
//   npx tsx scripts/render-report.mts 2026-08-02
//   npx tsx scripts/render-report.mts 2026-07-31 2026-08-01 2026-08-02
//
// `asOf` is the STAY date (the "Yesterday" column). The file is named for
// asOf + 1, which is how Monica names hers — so a 3-day Monday catch-up is
// Friday/Saturday/Sunday's stay dates.
//
// Pair with `python scripts/diff-reports.py "<hers.pdf>" "<ours.pdf>"`.
//
// Read-only against Cloudbeds except for the forward on-the-books rows that
// buildRevenueReport already upserts (revenue/inventory only, never ooo).
//
// NOTE: the Yesterday column is always a LIVE single-day fetch, even for a past
// asOf (getRevenueReportInputs). Re-rendering an old date therefore re-queries
// room blocks rather than reading the banked max-observed `ooo`, so it can drift
// a room or two from what `scripts/show-snapshot.mjs` shows for that day.
import { readFileSync, writeFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const { buildRevenueReport } = await import("../lib/cloudbeds.ts");
const { renderReportPdf } = await import("../lib/report-pdf.ts");
const { reportFileBase } = await import("../lib/revenue-report.ts");

const days = process.argv.slice(2);
if (!days.length) throw new Error("pass one or more YYYY-MM-DD stay dates");

for (const [i, day] of days.entries()) {
  if (i > 0) await new Promise((r) => setTimeout(r, 45_000)); // 429 breathing room
  const t0 = Date.now();
  const report = await buildRevenueReport(day);
  const name = `${reportFileBase(report.asOf)}.pdf`;
  writeFileSync(new URL(`../outputs/${name}`, import.meta.url), renderReportPdf(report));

  const zeroOoo = report.actual.filter((p: any) => !p.yesterday.actual.ooo);
  console.log(
    `${day} -> outputs/${name}  (${report.actual.length}/8 properties, ${Date.now() - t0}ms)` +
      (zeroOoo.length ? `  [ZERO OOO — suspect 429: ${zeroOoo.map((p: any) => p.code).join(",")}]` : ""),
  );
  for (const p of report.actual) {
    const y = p.yesterday.actual;
    const ytd = p.ytd.actual;
    console.log(
      `    ${p.code.padEnd(3)} y: occ=${String(y.occupied).padStart(4)} inv=${String(y.inventory).padStart(4)}` +
        ` ooo=${String(y.ooo).padStart(4)} rev=${y.roomRev.toFixed(2).padStart(10)}` +
        `   ytd: occ=${String(ytd.occupied).padStart(6)} inv=${String(ytd.inventory).padStart(6)}` +
        ` ooo=${String(ytd.ooo).padStart(6)} rev=${ytd.roomRev.toFixed(2).padStart(12)}`,
    );
  }
}
