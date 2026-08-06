// Verify Bea's §3 balance-due table end to end through the REAL lib function
// (getPortfolioBalanceDue), including the two-query join on reservation_number.
//
//   npx tsx scripts/check-balance-due.mts [asOf]
//
// Read-only. Masks guest names by default so the output is safe to paste; pass
// --names to print them (only when you need to eyeball the join).
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const { getPortfolioBalanceDue } = await import("../lib/balance-due.ts");
const { easternToday } = await import("../lib/dates.ts");

const showNames = process.argv.includes("--names");
const asOf = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? easternToday();
const mask = (s: string) => (showNames ? s : s.replace(/[^\s,.-]/g, "*"));
const money = (n: number) => `$${n.toFixed(2)}`;

console.log(`Balance due as of ${asOf}${showNames ? "" : "  (names masked; --names to reveal)"}\n`);

const portfolio = await getPortfolioBalanceDue(asOf);
let grand = 0;
let grandRows = 0;
let joinMisses = 0;
let overdue = 0;
let overdueMoney = 0;

for (const p of portfolio) {
  const tag = `${p.property.name} (${p.property.id})`;
  if (!p.configured) { console.log(`${tag}: awaiting key`); continue; }
  if (!p.result?.ok) { console.log(`${tag}: ERROR ${p.result?.error ?? "unknown"}`); continue; }
  const s = p.result.data;
  grand += s.total;
  grandRows += s.rows.length;
  const missing = s.rows.filter((r) => !r.checkin || !r.ratePlan).length;
  joinMisses += missing;
  console.log(
    `${tag}: ${money(s.total)} over ${s.rows.length} of ${s.inHouseCount} in-house ` +
      `(${s.leaseCount} lease / ${s.transientCount} transient` +
      `${s.creditCount ? `, ${s.creditCount} in credit ${money(s.creditTotal)}` : ""})` +
      `${s.overdueCount ? `  [${s.overdueCount} past checkout, ${money(s.overdueTotal)}]` : ""}` +
      `${missing ? `  [${missing} row(s) missing check-in/rate-plan]` : ""}`,
  );
  overdue += s.overdueCount;
  overdueMoney += s.overdueTotal;
  // Show the top three plus every overstay — the latter are the rows the old
  // date-window filter used to hide, so they are what a re-run must prove.
  const shown = new Set<string>();
  for (const r of [...s.rows.slice(0, 3), ...s.rows.filter((x) => x.departure !== "future")]) {
    if (shown.has(r.reservationNumber)) continue;
    shown.add(r.reservationNumber);
    console.log(
      `    ${mask(r.guest).slice(0, 26).padEnd(27)} room ${r.rooms.padEnd(10)} ` +
        `${money(r.balanceDue).padStart(11)}  ${r.leaseClass.padEnd(14)} ` +
        `in ${r.checkin || "?"} out ${r.checkout || "?"}` +
        `${r.departure === "overdue" ? "  <= PAST CHECKOUT" : r.departure === "today" ? "  <= LEAVING TODAY" : ""}`,
    );
  }
  if (s.rows.length > shown.size) console.log(`    … ${s.rows.length - shown.size} more`);
}

console.log(`\nPORTFOLIO: ${money(grand)} across ${grandRows} reservations`);
console.log(`STILL IN-HOUSE PAST CHECKOUT: ${overdue} reservation(s), ${money(overdueMoney)}`);
console.log(joinMisses === 0
  ? "JOIN: every row resolved check-in + rate plan."
  : `JOIN: ${joinMisses} row(s) did not resolve — check the reservation_number join.`);
