// Throwaway live-validation script (Task 3) — run with `npx tsx scripts/probe-revenue-report-inputs.mts`,
// then DELETE before committing. Imports the real production code
// (lib/cloudbeds.ts getRevenueReportInputs) and runs it against live
// Davenport (318197) for asOf=2026-07-19, comparing to Monica's targets.
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const { getRevenueReportInputs, reportRanges } = await import("../lib/cloudbeds.ts");

const ASOF = "2026-07-19";
console.log("reportRanges:", JSON.stringify(reportRanges(ASOF), null, 2));

const t0 = Date.now();
const { actual, onTheBooks } = await getRevenueReportInputs(ASOF);
console.log(`\ngetRevenueReportInputs took ${Date.now() - t0}ms`);

const dp = actual.find((a: any) => a.code === "DP");
if (!dp) {
  console.error("No Davenport (DP) in actual[] — key/config missing?");
  process.exit(1);
}

function printRow(label: string, row: any) {
  console.log(`\n--- ${label} ---`);
  console.log(
    `Occupied=${row.occupied}  Transient=${row.transientNights}  Lease=${row.leaseNights}  OOO=${row.ooo}  OtherBlocks=${row.otherBlocks}  Available=${row.available}  Inventory=${row.inventory}`,
  );
  console.log(
    `RoomRev=$${row.roomRev.toFixed(2)}  Transient$=${row.transientRev.toFixed(2)}  Lease$=${row.leaseRev.toFixed(2)}`,
  );
}

printRow("Yesterday (actual)", dp.yesterday.actual);
console.log("LY Yesterday:", dp.yesterday.lastYear ? "present" : "null");
printRow("MTD (actual)", dp.mtd.actual);
console.log("LY MTD:", dp.mtd.lastYear ? "present" : "null");
printRow("YTD (actual)", dp.ytd.actual);
console.log("LY YTD:", dp.ytd.lastYear ? "present" : "null");

console.log("\n=== Monica targets ===");
console.log(
  "Yesterday: Occupied 95, Transient 10, Lease 84, OOO 2, Available 56, Inventory 153, RoomRev $3,198.18 (T $492.05 / L $2,706.13)",
);
console.log("MTD: Occupied 2003, OOO 105, Inventory 2893, RoomRev $73,070.69");
console.log("YTD: Occupied 19455, OOO 7181, Inventory 30255, RoomRev $680,954.87");

const dpBooks = onTheBooks.find((a: any) => a.code === "DP");
console.log("\n=== On-the-books (7 forward days) ===");
for (const d of dpBooks?.days ?? []) {
  console.log(
    `${d.date}: Transient=${d.row.transientNights} Lease=${d.row.leaseNights} OOO=${d.row.ooo} RoomRev=$${d.row.roomRev.toFixed(2)}`,
  );
}
