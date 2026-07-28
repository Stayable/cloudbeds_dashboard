// Build the reconciliation workbook for Monica: every property x period x metric,
// her published figure against ours, with the delta and the cause.
//
// Inputs are both real, neither invented:
//   - her figures, parsed straight out of the PDF she circulated
//   - ours, read live from the Neon snapshot store
//
// Usage:
//   node scripts/build-variance-workbook.mjs <monica-figures.json> <ours.json> <out.xlsx>
// where monica-figures.json comes from scripts/parse-monica-pdf.py and ours.json
// from scripts/probe-monica-parity.mjs.
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";

const [figuresPath, oursPath, outPath] = process.argv.slice(2);
if (!figuresPath || !oursPath || !outPath) {
  console.error("Usage: node scripts/build-variance-workbook.mjs <monica.json> <ours.json> <out.xlsx>");
  process.exit(1);
}

const FONT = "Arial";
const TITLE_FILL = "FF0F1E33";
const HEADER_FILL = "FF1F3864";
const LABEL_FILL = "FFD9E1F2";
const BAD_FILL = "FFF4B0B0";
const WATCH_FILL = "FFFCE4B6";
const OK_FILL = "FFE2EFDA";
const COUNT_FMT = "#,##0;[Red](#,##0)";
const CURRENCY_FMT = "$#,##0.00;[Red]($#,##0.00)";
const PCT_FMT = "0.0%";
const BORDER = { style: "thin", color: { argb: "FFBFBFBF" } };

const NAMES = {
  LL: "Lakeland (4645)", JW: "Jacksonville West (6802)", KE: "Kissimmee East (2295)",
  KW: "Kissimmee West (5399)", OR: "Orlando OBT (8700)", SA: "St. Augustine (2535)",
  DP: "Davenport (44199)", JN: "Jacksonville North (812)",
};

const METRICS = [
  ["occupied", "Occupied", COUNT_FMT],
  ["transientNights", "  Transient nights", COUNT_FMT],
  ["leaseNights", "  Lease nights", COUNT_FMT],
  ["otherBlocks", "Other blocks", COUNT_FMT],
  ["ooo", "Out-of-Order", COUNT_FMT],
  ["available", "Available", COUNT_FMT],
  ["inventory", "Inventory", COUNT_FMT],
  ["pOcc", "% Occupied", PCT_FMT],
  ["pOoo", "% Out-of-Order", PCT_FMT],
  ["pAvail", "% Available", PCT_FMT],
  ["roomRev", "Room Revenue", CURRENCY_FMT],
  ["transientRev", "  Transient revenue", CURRENCY_FMT],
  ["leaseRev", "  Lease revenue", CURRENCY_FMT],
  ["adrCombined", "ADR Combined", CURRENCY_FMT],
  ["adrTransient", "ADR Transient", CURRENCY_FMT],
  ["adrLease", "ADR Lease", CURRENCY_FMT],
  ["revpar", "RevPAR", CURRENCY_FMT],
];

// Materiality: a delta smaller than this is noise, not a finding.
const TOL = { pct: 0.001, money: 0.02, count: 0.5 };
const kind = (fmt) => (fmt === PCT_FMT ? "pct" : fmt === CURRENCY_FMT ? "money" : "count");

const monica = JSON.parse(readFileSync(figuresPath, "utf8"));
const oursRows = JSON.parse(readFileSync(oursPath, "utf8"));

const byProp = new Map();
for (const r of oursRows) {
  if (!byProp.has(r.property_code)) byProp.set(r.property_code, new Map());
  byProp.get(r.property_code).set(r.stay_date, r);
}

const addDays = (d, n) => {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

function sumRange(code, start, end) {
  const acc = { transientNights: 0, leaseNights: 0, otherBlocks: 0, ooo: 0, inventory: 0, transientRev: 0, leaseRev: 0 };
  const rows = byProp.get(code);
  if (!rows) return acc;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const r = rows.get(d);
    if (!r) continue;
    acc.transientNights += r.transient_nights;
    acc.leaseNights += r.lease_nights;
    acc.otherBlocks += r.other_blocks;
    acc.ooo += r.ooo;
    acc.inventory += r.inventory;
    acc.transientRev += Number(r.transient_rev);
    acc.leaseRev += Number(r.lease_rev);
  }
  return acc;
}

function derive(i) {
  const occupied = i.transientNights + i.leaseNights + i.otherBlocks;
  const available = i.inventory - occupied - i.ooo;
  const roomRev = i.transientRev + i.leaseRev;
  const d = (n, dd) => (dd ? n / dd : 0);
  return {
    ...i, occupied, available, roomRev,
    pOcc: d(occupied, i.inventory), pOoo: d(i.ooo, i.inventory), pAvail: d(available, i.inventory),
    adrCombined: d(roomRev, occupied), adrTransient: d(i.transientRev, i.transientNights),
    adrLease: d(i.leaseRev, i.leaseNights), revpar: d(roomRev, i.inventory),
  };
}

// Cause attribution — each string is a finding established in the 07/28/26
// analysis, not a guess. Applied by (metric, property) so the workbook explains
// itself without a covering memo.
function cause(code, metric, delta, period) {
  if (delta == null) return "";
  if (code === "JN" && (metric === "ooo" || metric === "pOoo" || metric === "available" || metric === "pAvail")) {
    return "JN: ~107 of 127 rooms unsellable but only 20 blocked in Cloudbeds. Config override applied; fix at source by blocking the rooms.";
  }
  if (metric === "inventory" && code === "KE") {
    return "KE: Cloudbeds getDashboard reports 168 rooms, workbook says 167. Unresolved — run scripts/audit-room-counts.mjs against the room list.";
  }
  if (metric === "transientNights" || metric === "adrTransient") {
    return "Nights were counted from dataset-3 'In-House', which drops guests who checked out before the 06:00 capture. Now sourced from dataset-1 room-rate rows; restated forward from 2026-07-24.";
  }
  if (metric === "transientRev" || metric === "leaseRev" || metric === "roomRev") {
    return period === "Yesterday"
      ? "Revenue keeps posting after our 06:00 capture. Nightly restatement now re-derives the trailing 31 days."
      : "Accumulation of daily capture-timing differences; closes as the restatement pass runs.";
  }
  if (metric === "otherBlocks") {
    return "Block-type taxonomy differs. Composition now stored per roomBlockType (blocks_by_type) for drill-down.";
  }
  return "";
}

const wb = new ExcelJS.Workbook();
wb.creator = "RISE8 Companies";
wb.created = new Date();

// ---------------------------------------------------------------- Variance tab
const ws = wb.addWorksheet("Variance", { views: [{ state: "frozen", ySplit: 4, xSplit: 3 }] });
ws.columns = [
  { width: 26 }, { width: 11 }, { width: 30 }, { width: 16 }, { width: 16 },
  { width: 15 }, { width: 11 }, { width: 74 },
];

const title = ws.getCell("A1");
title.value = `Stayable — dashboard vs. Occupancy Report reconciliation · as of ${monica.asOf}`;
title.font = { name: FONT, bold: true, size: 13, color: { argb: "FFFFFFFF" } };
title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TITLE_FILL } };
ws.mergeCells("A1:H1");
ws.getRow(1).height = 24;

const sub = ws.getCell("A2");
sub.value =
  "Their figures parsed from the circulated PDF; ours read from the snapshot store. " +
  "Deltas beyond materiality are shaded and carry a cause. Green = agrees.";
sub.font = { name: FONT, italic: true, size: 9, color: { argb: "FF444444" } };
ws.mergeCells("A2:H2");

const head = ["Property", "Period", "Metric", "Report (theirs)", "Dashboard (ours)", "Delta", "Delta %", "Cause / action"];
head.forEach((h, i) => {
  const c = ws.getCell(4, i + 1);
  c.value = h;
  c.font = { name: FONT, bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  c.alignment = { vertical: "middle", wrapText: true };
  c.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
});
ws.getRow(4).height = 28;

let r = 5;
let material = 0;
let agreed = 0;

for (const code of Object.keys(NAMES)) {
  const propRow = ws.getRow(r++);
  propRow.getCell(1).value = NAMES[code];
  propRow.getCell(1).font = { name: FONT, bold: true, size: 10.5 };
  propRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LABEL_FILL } };
  ws.mergeCells(`A${propRow.number}:H${propRow.number}`);

  for (const [period, start, end] of [
    ["Yesterday", monica.asOf, monica.asOf],
    ["MTD", monica.asOf.slice(0, 8) + "01", monica.asOf],
    ["YTD", monica.asOf.slice(0, 4) + "-01-01", monica.asOf],
  ]) {
    const ours = derive(sumRange(code, start, end));
    const theirs = monica.properties?.[code]?.[period] ?? {};

    for (const [metric, label, fmt] of METRICS) {
      const mv = theirs[metric];
      const ov = ours[metric];
      if (mv == null && (ov == null || ov === 0)) continue;
      const delta = mv == null || ov == null ? null : ov - mv;
      const k = kind(fmt);
      const isMaterial = delta != null && Math.abs(delta) > TOL[k];
      if (delta != null) (isMaterial ? material++ : agreed++);

      const row = ws.getRow(r++);
      row.getCell(1).value = "";
      row.getCell(2).value = period;
      row.getCell(3).value = label;
      row.getCell(4).value = mv ?? null;
      row.getCell(5).value = ov ?? null;
      row.getCell(6).value = delta;
      row.getCell(7).value = delta != null && mv ? delta / Math.abs(mv) : null;
      row.getCell(8).value = isMaterial ? cause(code, metric, delta, period) : "";

      [4, 5, 6].forEach((c) => (row.getCell(c).numFmt = fmt));
      row.getCell(7).numFmt = "0.0%;[Red](0.0%)";
      for (let c = 1; c <= 8; c++) {
        const cell = row.getCell(c);
        cell.font = { name: FONT, size: 9.5 };
        cell.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
      }
      row.getCell(3).alignment = { indent: label.startsWith("  ") ? 1 : 0 };
      row.getCell(8).alignment = { wrapText: true, vertical: "top" };
      if (delta != null) {
        const fill = !isMaterial ? OK_FILL : Math.abs(row.getCell(7).value ?? 0) >= 0.02 ? BAD_FILL : WATCH_FILL;
        row.getCell(6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      }
    }
  }
}

ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: r - 1, column: 8 } };

// ------------------------------------------------------------------ Status tab
const st = wb.addWorksheet("Findings & status");
st.columns = [{ width: 5 }, { width: 46 }, { width: 62 }, { width: 15 }, { width: 44 }];
const stTitle = st.getCell("A1");
stTitle.value = "Seven findings — cause, fix and status";
stTitle.font = { name: FONT, bold: true, size: 13, color: { argb: "FFFFFFFF" } };
stTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TITLE_FILL } };
st.mergeCells("A1:E1");
st.getRow(1).height = 24;

["#", "Finding", "Cause", "Status", "Remaining action"].forEach((h, i) => {
  const c = st.getCell(3, i + 1);
  c.value = h;
  c.font = { name: FONT, bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  c.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
});

const FINDINGS = [
  [1, "JN out-of-order read 20/day vs 107; 89 rooms shown bookable at a property that can sell none",
   "OOO came only from Cloudbeds out_of_service blocks; ~87 renovation rooms were never blocked",
   "Fixed (stopgap)", "Block the renovation rooms in Cloudbeds, then delete the config override. Sellable count of 20 is inferred — confirm with the property."],
  [2, "Inventory denominators wrong: JN 2026 YTD 26,289 vs 14,859; DP Last-Year occupancy off 33.4pp",
   "Today's capacity was stamped on every past day, including months a property was dark, and capacity genuinely moves",
   "Fixed", "None. In-service windows in config; per-day inventory seeded from the workbook; 486 phantom rows cleared."],
  [3, "Transient nights undercounted (DP 7 vs 18 on 7/26) while that day's revenue matched to the cent",
   "Nights came from dataset-3 reservation_status = In-House, which drops guests who checked out before the 06:00 capture",
   "Fixed", "Nights now come from the same dataset-1 query as revenue. Historical days before 2026-07-24 keep the workbook's counts."],
  [4, "Yesterday revenue off up to 13%, in both directions",
   "Our figure was frozen at the 06:00 capture and never revisited; the ledger keeps posting for days",
   "Fixed", "Nightly restatement of the trailing 31 days, then permanent freeze once the month closes."],
  [5, "Transient/lease revenue split diverged (portfolio YTD -3.5% / +1.2%) though the total agreed to 0.06%",
   "Mostly capture timing (lease bills up front, transient keeps posting). KE additionally shows dollars moving between buckets",
   "Partly fixed", "Run the split probe with the KE key over ~5 past dates to separate reclassification from source difference."],
  [6, "Kissimmee East inventory 168 (ours) vs 167 (report), every day, all year",
   "Unresolved: getDashboard reports 168; the workbook says 167",
   "Open", "Run scripts/audit-room-counts.mjs with the KE key. If Cloudbeds lists 168, find the extra room and fix it at source."],
  [7, "Other blocks differ (OR 11 MTD vs 0; LL +3; SA -4)",
   "Both sides collapse a block-type taxonomy into one bucket, with different rules",
   "Fixed (visibility)", "Composition now stored per roomBlockType. Agree the bucket mapping so the two lines are defined identically."],
];

let sr = 4;
for (const f of FINDINGS) {
  const row = st.getRow(sr++);
  f.forEach((v, i) => {
    const c = row.getCell(i + 1);
    c.value = v;
    c.font = { name: FONT, size: 9.5 };
    c.alignment = { wrapText: true, vertical: "top" };
    c.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
  });
  const status = String(f[3]);
  row.getCell(4).fill = {
    type: "pattern", pattern: "solid",
    fgColor: { argb: status === "Open" ? BAD_FILL : status.startsWith("Partly") ? WATCH_FILL : OK_FILL },
  };
  row.height = 58;
}

const note = st.getCell(`B${sr + 1}`);
note.value =
  "Also for discussion: Cloudbeds holds $125,911.92 of Jacksonville North room revenue on days " +
  "(May-Nov 2025) with zero occupancy, which the Occupancy Report excludes entirely. We have kept it " +
  "and left the inventory at zero, so the difference is visible rather than reconciled away.";
note.font = { name: FONT, italic: true, size: 9.5 };
note.alignment = { wrapText: true, vertical: "top" };
st.mergeCells(`B${sr + 1}:E${sr + 3}`);

await wb.xlsx.writeFile(outPath);
console.log(`Wrote ${outPath}`);
console.log(`  ${material} material variances, ${agreed} metric/period/property cells in agreement.`);
