// Read-only: search DI dataset column catalogues by regex. Metadata only — no
// row data, no guest values.
//   node scripts/probe-di-columns.mjs "tax|exempt" [CODE] [datasets...]
// Generalises probe-due-date-cols.mjs, which hardcodes its four searches.
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const [, , pattern, codeArg, ...dsArgs] = process.argv;
if (!pattern) {
  console.error('usage: node scripts/probe-di-columns.mjs "<regex>" [CODE] [dataset ids...]');
  process.exit(1);
}
const CODE = (codeArg || "DP").toUpperCase();
const DATASETS = dsArgs.length ? dsArgs.map(Number) : [1, 3];
const API_ID = { DP: "318197", LL: "210972", KE: "210986", KW: "210969", JW: "210987", JN: "206628", SA: "208155", OR: "210971" };
const KEY = process.env[`CLOUDBEDS_API_KEY_${CODE}`];
const DI = "https://api.cloudbeds.com/datainsights/v1.1";
const H = { Authorization: `Bearer ${KEY}`, "X-PROPERTY-ID": API_ID[CODE], Accept: "application/json" };
const re = new RegExp(pattern, "i");

for (const ds of DATASETS) {
  const detail = await (await fetch(`${DI}/datasets/${ds}`, { headers: H })).json();
  const cols = (detail.cdfs ?? []).flatMap((g) => (g.cdfs ?? []).map((c) => ({ column: c.column, type: c.type, name: c.name })));
  const hits = cols.filter((c) => re.test(c.column) || re.test(c.name ?? ""));
  console.log(`\n## dataset ${ds} (${detail.name ?? "?"}) — ${hits.length} of ${cols.length} columns match /${pattern}/i`);
  for (const c of hits) console.log(`   ${c.column}  [${c.type}]  ${c.name ?? ""}`);
}
