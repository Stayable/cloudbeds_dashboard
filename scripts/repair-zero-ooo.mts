// Repair property-days whose out-of-order was banked as 0 by a rate-limited
// block fetch. `getRoomBlocks` failures are treated as 0 by the caller, and
// blocks are frozen at first capture, so a 429 during the flash cron banked a
// permanent zero. Confirmed to have happened four times in production
// (KE/LL/SA 2026-07-20, LL 2026-06-12) — see TODO 08/04/26 item 6.
//
//   npx tsx scripts/repair-zero-ooo.mts            # dry run, prints the plan
//   npx tsx scripts/repair-zero-ooo.mts --apply    # writes
//
// Safe by construction: `observeBlocks` upserts `ooo` with greatest(), so a
// re-query can only RAISE a figure, never lower one. It also only touches the
// listed property-days — not the whole portfolio for those dates, which would
// stamp ooo_observed_at on rows the nightly cron legitimately owns.
//
// The cause is fixed going forward: cbGet now retries 429/5xx (commit a35e707).
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const { getBlockNights, getPhysicalRoomCount, readKey } = await import("../lib/cloudbeds.ts");
const { observeBlocks } = await import("../lib/db.ts");
const { PROPERTIES } = await import("../config/properties.ts");
const { overrideOooNights } = await import("../lib/service-windows.ts");

/** Zero-OOO days found between non-zero neighbours at the same property. */
const TARGETS: { code: string; date: string }[] = [
  { code: "KE", date: "2026-07-20" },
  { code: "LL", date: "2026-07-20" },
  { code: "SA", date: "2026-07-20" },
  { code: "LL", date: "2026-06-12" },
];

const apply = process.argv.includes("--apply");
console.log(apply ? "APPLYING" : "DRY RUN (pass --apply to write)");

for (const t of TARGETS) {
  const property = PROPERTIES.find((p: any) => p.code === t.code);
  const key = readKey(t.code);
  if (!property || !key || !property.apiPropertyId) {
    console.log(`  ${t.code} ${t.date}  SKIP — no key or config`);
    continue;
  }
  const rooms = await getPhysicalRoomCount(key);
  const blocks = await getBlockNights(key, t.date, t.date);
  if (!blocks.ok) {
    console.log(`  ${t.code} ${t.date}  SKIP — block fetch failed: ${blocks.error}`);
    continue;
  }
  const overrideOoo = overrideOooNights(property, t.date, t.date, rooms.count);
  const ooo = Math.max(blocks.data.ooo, overrideOoo);
  const source = overrideOoo > blocks.data.ooo ? "override" : "cloudbeds";
  console.log(
    `  ${t.code} ${t.date}  ooo 0 -> ${ooo} [${source}]  other=${blocks.data.other}  ` +
      `types=${JSON.stringify(blocks.data.byType)}`,
  );
  if (!ooo) {
    console.log("      (still 0 — leaving alone rather than writing a zero)");
    continue;
  }
  if (apply) {
    await observeBlocks(t.code, t.date, {
      ooo,
      blocksByType: blocks.data.byType,
      oooSource: source,
      pass: "eod",
    });
    console.log("      written");
  }
}
