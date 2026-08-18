// Preview the rows that would seed a new `MM.DD` sheet in DDF Refund <year>.xlsx.
//
//   npx tsx scripts/preview-ddf-sheet.mts [YYYY-MM-DD]
//
// READ-ONLY IN EVERY SENSE. It touches Cloudbeds read endpoints and prints; it
// does not open, modify or upload the workbook. The workbook is edited live by
// the team all day — nothing here may write to it.
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const { getDueOutDetail } = await import("../lib/due-outs.ts");
const { buildDdfRows, ddfSheetName, DDF_HEADERS } = await import("../lib/ddf-sheet.ts");
const { PROPERTIES } = await import("../config/properties.ts");
const { readKey } = await import("../lib/cloudbeds.ts");
const { easternToday } = await import("../lib/dates.ts");

const day = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? easternToday();

const sources = await Promise.all(
  PROPERTIES.map(async (property) => {
    const key = readKey(property.code);
    if (!key || !property.apiPropertyId) return { property, reservations: null };
    const res = await getDueOutDetail(key, property.apiPropertyId, day);
    return { property, reservations: res.ok ? res.data : null };
  }),
);

const rows = buildDdfRows(day, sources);

// --tsv writes a paste-ready block. Tab-separated because pasting TSV into
// Excel splits into columns with no import dialog — the point is that a human
// can put this in the sheet in one keystroke while the automated path is still
// blocked on a flow edit.
if (process.argv.includes("--tsv")) {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const tsv = rows.map((r) => r.join("\t")).join("\r\n");
  mkdirSync(new URL("../outputs/", import.meta.url), { recursive: true });
  const name = `DDFSeed_Stayable_${day.slice(5, 7)}${day.slice(8, 10)}${day.slice(2, 4)}.tsv`;
  writeFileSync(new URL(`../outputs/${name}`, import.meta.url), tsv, "utf8");
  console.log(`Wrote outputs/${name} — ${rows.length} rows, paste into A2.\n`);
}
const w = [22, 6, 12, 14, 14, 14, 12];
const line = (cells: readonly string[]) => cells.map((c, i) => String(c).padEnd(w[i])).join(" ");

console.log(`Eastern today : ${easternToday()}`);
console.log(`Would create sheet: "${ddfSheetName(day)}"  (${rows.length} rows)\n`);
console.log(line(DDF_HEADERS));
console.log("-".repeat(w.reduce((a, b) => a + b + 1, 0)));
for (const r of rows) console.log(line(r));
console.log(`\nName column is blank by design — flip includeGuestNames only if that decision is made.`);
