// Verify the Due-Out Room Walk List end to end through the REAL lib functions
// (getPortfolioDueOuts + buildDueOutCard + postAdaptiveCard) — the same code
// path /api/cron/due-outs runs at 9:00 AM ET.
//
//   npx tsx scripts/check-due-outs.mts [YYYY-MM-DD] [--send]
//
// Read-only against Cloudbeds. Prints by default; --send posts to the flow
// behind TEAMS_FLOW_URL_DUEOUT. Dates default to TODAY IN EASTERN — never the
// server's UTC date, which runs a day ahead every evening.
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const { getPortfolioDueOuts, buildDueOutCard } = await import("../lib/due-outs.ts");
const { renderDueOutXlsx, dueOutFileName } = await import("../lib/due-out-xlsx.ts");
const { postAdaptiveCard } = await import("../lib/teams.ts");
const { easternToday } = await import("../lib/dates.ts");

const send = process.argv.includes("--send");
const test = !process.argv.includes("--live");
const day = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? easternToday();

console.log(`Eastern today : ${easternToday()}`);
console.log(`Stay date     : ${day}\n`);

const rows = await getPortfolioDueOuts(day);
for (const r of rows) {
  const label = `${r.property.name} (${r.property.id})`.padEnd(28);
  console.log(
    r.rooms === null
      ? `${label} UNAVAILABLE — read failed`
      : `${label} ${String(r.rooms.length).padStart(2)} rooms / ${r.reservations} res  ${r.rooms.join(", ")}`,
  );
}

const total = rows.reduce((n, r) => n + (r.rooms?.length ?? 0), 0);
const failed = rows.filter((r) => r.rooms === null);
console.log(`\nTOTAL: ${total} rooms; ${failed.length} property read(s) failed`);

if (process.argv.includes("--xlsx")) {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const generated = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());
  const buf = await renderDueOutXlsx(day, rows, generated);
  mkdirSync(new URL("../outputs/", import.meta.url), { recursive: true });
  const out = new URL(`../outputs/${dueOutFileName(day)}`, import.meta.url);
  writeFileSync(out, buf);
  console.log(`\nWrote ${dueOutFileName(day)} (${(buf.length / 1024).toFixed(1)} KB) to outputs/`);
}

if (!send) {
  console.log("\n(dry run — pass --send to post)");
  process.exit(0);
}
if (failed.length === rows.length) {
  console.error("\nNOT SENT: every property read failed.");
  process.exit(1);
}

// Opens the workbook, not a tab — sheet 08.15 does not exist until the flow
// creates it. `DDF_WORKBOOK_URL` lives in .env.local because a share link with
// an `?e=` token is a credential-ish thing, not a public address.
const workbookUrl = process.env.DDF_WORKBOOK_URL;
const result = await postAdaptiveCard(buildDueOutCard(day, rows, { test, workbookUrl }), [], {
  envVar: "TEAMS_FLOW_URL_DUEOUT",
});
console.log(`\nPOST ${result.ok ? "OK" : "FAILED"} — HTTP ${result.status}${result.detail ? ` (${result.detail})` : ""}`);
console.log(result.ok ? "Flow ACCEPTED the trigger. That is not proof it rendered — check the channel." : "");
