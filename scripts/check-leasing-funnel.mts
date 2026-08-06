// End-to-end check of what /ops §2 will actually render: reads the Neon rollup
// and runs it through the REAL buildLeasingViews, then compares June 2026 to
// EliseAI's reference numbers. Needs Neon only — no Snowflake — so it still works
// when the data-share credential is stale.
//
//   npx tsx scripts/check-leasing-funnel.mts [from] [to]
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const { getEliseFunnel, getElisePipeline } = await import("../lib/db.ts");
const { buildLeasingViews, FUNNEL_STAGES, STAGE } = await import("../lib/leasing.ts");

const from = process.argv[2] ?? "2026-06-01";
const to = process.argv[3] ?? "2026-06-30";

const funnel = await getEliseFunnel(from, to);
const pipeline = await getElisePipeline();
console.log(`Neon rollup ${from}..${to}: ${funnel.length} rows, ${pipeline.length} pipeline rows`);

const seen = new Map<string, number>();
for (const r of funnel) seen.set(r.eventType, (seen.get(r.eventType) ?? 0) + r.n);
console.log("\nevent types present in the window:");
for (const [t, n] of [...seen].sort((a, b) => b[1] - a[1])) {
  const known = FUNNEL_STAGES.some((s) => s.key === t) ? "" : "   (not a funnel stage)";
  console.log(`   ${t.padEnd(24)} ${String(n).padStart(6)}${known}`);
}

const views = buildLeasingViews(funnel, pipeline);
const all = views.find((v) => v.key === "ALL");
if (!all) {
  console.log("\nNo ALL view — the rollup is empty for this window.");
  process.exit(1);
}
const n = (key: string) => all.stages.find((s) => s.key === key)?.n ?? 0;

// EliseAI's reference figures for June 2026, portfolio-wide.
const REFERENCE: Record<string, number> = {
  [STAGE.leads]: 1863,
  [STAGE.engaged]: 781,
  [STAGE.toursBooked]: 223,
  [STAGE.toursAttended]: 90,
  [STAGE.appsStarted]: 274,
  [STAGE.appsApproved]: 146,
  [STAGE.leased]: 146,
};
const isJune = from === "2026-06-01" && to === "2026-06-30";

console.log("\nALL view, as /ops §2 will render it:");
let mismatch = 0;
for (const s of FUNNEL_STAGES) {
  const ours = n(s.key);
  if (!isJune) {
    console.log(`   ${s.label.padEnd(16)} ${String(ours).padStart(6)}`);
    continue;
  }
  const ref = REFERENCE[s.key];
  const ok = ours === ref;
  if (!ok) mismatch++;
  console.log(`   ${s.label.padEnd(16)} ours ${String(ours).padStart(6)}  Elise ${String(ref).padStart(6)}  ${ok ? "MATCH" : "*** MISMATCH ***"}`);
}
console.log(`   Cancelled        ${String(all.cancelled).padStart(6)}   (from PROSPECT_EVENTS — no equivalent in EVENTS_LEASING)`);
console.log(
  `\nrates: lead→tour ${all.leadToTour}%  tour→lease ${all.tourToLease}%  lead→lease ${all.leadToLease}%  ` +
    `attendance recorded ${all.tourAttendanceRecorded}%`,
);
if (isJune) console.log(mismatch === 0 ? "\nPARITY CONFIRMED against EliseAI's own figures." : `\n${mismatch} stage(s) do not match.`);
