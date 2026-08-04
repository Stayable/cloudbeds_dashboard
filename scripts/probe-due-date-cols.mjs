// Read-only: dump dataset 1 (Finances) + 3 (Reservations) column lists, looking
// for (a) a real rent/payment DUE-DATE column, (b) a join key shared by both,
// (c) anything lease-cycle related. Prints column metadata only — no row data,
// no guest values. Run: node scripts/probe-due-date-cols.mjs [CODE]
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const CODE = (process.argv[2] || "LL").toUpperCase();
const API_ID = { DP: "318197", LL: "210972", KE: "210986", KW: "210969", JW: "210987", JN: "206628", SA: "208155", OR: "210971" };
const KEY = process.env[`CLOUDBEDS_API_KEY_${CODE}`];
const PROP = API_ID[CODE];
const DI = "https://api.cloudbeds.com/datainsights/v1.1";
const H = { Authorization: `Bearer ${KEY}`, "X-PROPERTY-ID": PROP, Accept: "application/json" };

for (const ds of [1, 3]) {
  const detail = await (await fetch(`${DI}/datasets/${ds}`, { headers: H })).json();
  const cols = (detail.cdfs ?? []).flatMap((g) => (g.cdfs ?? []).map((c) => ({ column: c.column, type: c.type, name: c.name })));
  console.log(`\n########## dataset ${ds} (${detail.name ?? "?"}) — ${cols.length} columns ##########`);
  const show = (label, re) => {
    const hits = cols.filter((c) => re.test(c.column) || re.test(c.name ?? ""));
    console.log(`\n## ${label}  (${hits.length})`);
    for (const c of hits) console.log(`   ${c.column}  [${c.type}]  ${c.name ?? ""}`);
  };
  show("DUE / owed / outstanding / aging", /due|owed|outstanding|aging|overdue|arrear/i);
  show("identifiers (join keys)", /identifier|_number$|_id$|^id$|reservation_number|invoice/i);
  show("lease / cycle / recurring / term", /lease|cycle|recurr|term|frequen|monthly|weekly|schedule/i);
  show("all date columns", /date|datetime/i);
}
