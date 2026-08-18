// Read-only probe: the Due-Out Room Walk List.
//
// Which ROOMS are scheduled to check out today, per property. PII-FREE by
// construction — `primary_guest_full_name` is never requested. The /bea §3
// guest-name exception does NOT extend here (CLAUDE.md §5 rule 2).
//
// Measures three things the build depends on and none of which are assumed:
//   1. does DI dataset 3 accept `equals` on checkout_date at all;
//   2. how far the In-House-filtered list diverges from the unfiltered one
//      (i.e. how many due-outs have already physically departed by run time);
//   3. whether either count reconciles to getDashboard's own `departures`
//      figure, which comes from a completely separate endpoint.
//
// Run:  node scripts/probe-due-outs.mjs [YYYY-MM-DD]
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

// Eastern civil date, not UTC — a UTC date rolls over at 8pm ET and would ask
// Cloudbeds for tomorrow's due-outs during an evening run.
const easternToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const DAY = process.argv[2] ?? easternToday();

const PROPERTIES = [
  { id: "44199", code: "DP", api: "318197", name: "Davenport" },
  { id: "4645", code: "LL", api: "210972", name: "Lakeland" },
  { id: "2295", code: "KE", api: "210986", name: "Kissimmee East" },
  { id: "5399", code: "KW", api: "210969", name: "Kissimmee West" },
  { id: "6802", code: "JW", api: "210987", name: "Jacksonville West" },
  { id: "812", code: "JN", api: "206628", name: "Jacksonville North" },
  { id: "2535", code: "SA", api: "208155", name: "St. Augustine" },
  { id: "8700", code: "OR", api: "210971", name: "Orlando OBT" },
];

const DI = "https://api.cloudbeds.com/datainsights/v1.1";
const CB = "https://api.cloudbeds.com/api/v1.3";

async function post(url, key, prop, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "X-PROPERTY-ID": prop,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  try {
    return { status: r.status, body: JSON.parse(t) };
  } catch {
    return { status: r.status, body: t };
  }
}

/** Due-out reservations for `day`. `inHouseOnly` toggles the status clause so
 *  the two populations can be compared rather than guessed at. */
async function dueOuts(key, prop, day, inHouseOnly) {
  const and = [{ cdf: { column: "checkout_date" }, operator: "equals", value: day }];
  if (inHouseOnly) and.push({ cdf: { column: "reservation_status" }, operator: "equals", value: "In-House" });

  const res = await post(`${DI}/reports/query/data?mode=Run`, key, prop, {
    property_ids: [Number(prop)],
    dataset_id: 3,
    columns: [{ cdf: { column: "reservation_balance_due_amount" } }],
    group_rows: [
      { cdf: { column: "reservation_number" } },
      { cdf: { column: "room_numbers" } },
      { cdf: { column: "reservation_status" } },
    ],
    filters: { and },
    settings: { totals: false, details: true },
  });
  if (res.status !== 200) return { error: `HTTP ${res.status}`, raw: res.body };

  const index = Array.isArray(res.body?.index) ? res.body.index : [];
  const balances = res.body?.records?.reservation_balance_due_amount ?? [];
  const seen = new Set();
  const rows = [];
  index.forEach((r, i) => {
    const [resNo, rooms, status] = (Array.isArray(r) ? r : [r]).map((v) => String(v ?? ""));
    if (!resNo || seen.has(resNo)) return;
    seen.add(resNo);
    rows.push({ resNo, rooms, status, balance: typeof balances[i] === "number" ? balances[i] : 0 });
  });
  return { rows };
}

/** getDashboard's own departures count — an independent endpoint, so it is a
 *  real cross-check rather than the same number read twice. */
async function dashboardDepartures(key, prop) {
  const r = await fetch(`${CB}/getDashboard?propertyID=${prop}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "X-PROPERTY-ID": prop },
  });
  const t = await r.text();
  try {
    const j = JSON.parse(t);
    const d = j?.data ?? j;
    return { departures: d?.departures ?? null, confirmed: d?.departuresConfirmed ?? null };
  } catch {
    return { departures: null, confirmed: null };
  }
}

console.log(`Due-out probe for ${DAY} (Eastern civil date)\n`);

for (const p of PROPERTIES) {
  const key = process.env[`CLOUDBEDS_API_KEY_${p.code}`];
  if (!key) {
    console.log(`${p.name} (${p.id}) — no API key configured, skipped`);
    continue;
  }

  const [inHouse, all, dash] = await Promise.all([
    dueOuts(key, p.api, DAY, true),
    dueOuts(key, p.api, DAY, false),
    dashboardDepartures(key, p.api),
  ]);

  console.log(`=== ${p.name} (${p.id}) ===`);
  if (inHouse.error || all.error) {
    console.log(`  QUERY FAILED: ${inHouse.error ?? all.error}`);
    console.log(`  ${JSON.stringify(inHouse.raw ?? all.raw).slice(0, 400)}`);
    continue;
  }

  const statusMix = {};
  for (const r of all.rows) statusMix[r.status] = (statusMix[r.status] ?? 0) + 1;

  console.log(`  due out today, In-House only : ${inHouse.rows.length}`);
  console.log(`  due out today, any status    : ${all.rows.length}  ${JSON.stringify(statusMix)}`);
  console.log(`  getDashboard departures      : ${dash.departures} (confirmed ${dash.confirmed})`);
  console.log(
    `  rooms (In-House): ${inHouse.rows.map((r) => r.rooms).filter(Boolean).join(", ") || "(none)"}`,
  );
  const owing = inHouse.rows.filter((r) => r.balance > 0.005);
  if (owing.length) {
    console.log(`  ${owing.length} of those carry a balance: ${owing.map((r) => `${r.rooms}=$${r.balance.toFixed(2)}`).join(", ")}`);
  }
  console.log("");
}
