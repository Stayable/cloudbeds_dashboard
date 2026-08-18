// One-off: post a TEST Due-Out Room Walk List to the Power Automate flow behind
// TEAMS_FLOW_URL_DUEOUT, built from LIVE Cloudbeds data.
//
// PII-FREE: room numbers and counts only. No guest names are requested from the
// API at any point (CLAUDE.md §5 rule 2 — the /bea §3 exception does not reach
// this surface). Balances are deliberately omitted too: this list exists to
// schedule inspections, not to chase money.
//
// Body shape is a guess that is being TESTED here: a top-level Adaptive Card,
// which is what the flow behind TEAMS_FLOW_URL has consumed since 2026-07-22.
// If this flow was built differently the POST will still return 2xx (Power
// Automate accepts the trigger and fails downstream), so a 202 proves delivery
// to the flow and NOT that anything rendered. Check the channel.
//
// Run:  node scripts/send-due-out-test.mjs [YYYY-MM-DD]
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const FLOW = process.env.TEAMS_FLOW_URL_DUEOUT;
if (!FLOW) {
  console.error("TEAMS_FLOW_URL_DUEOUT is not set in .env.local — nothing sent.");
  process.exit(1);
}

const easternToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());

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

/** Rooms due out on `day` that Cloudbeds still reports as In-House — i.e. rooms
 *  that will need walking. Returns null on a failed read so the card can say
 *  "unavailable" instead of a manufactured zero (the failure mode that produced
 *  months of wrong out-of-order figures). */
async function dueOutRooms(key, prop, day) {
  let res;
  try {
    res = await fetch(`${DI}/reports/query/data?mode=Run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "X-PROPERTY-ID": prop,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        property_ids: [Number(prop)],
        dataset_id: 3,
        // `reservation_balance_due_amount`, not `reservation_id` — the latter is
        // a dimension, and asking for it as a measure makes the whole query 400.
        // That is exactly how the first test post went out reading "unavailable"
        // for all 8 properties.
        columns: [{ cdf: { column: "reservation_balance_due_amount" } }],
        group_rows: [
          { cdf: { column: "reservation_number" } },
          { cdf: { column: "room_numbers" } },
        ],
        filters: {
          and: [
            { cdf: { column: "checkout_date" }, operator: "equals", value: day },
            { cdf: { column: "reservation_status" }, operator: "equals", value: "In-House" },
          ],
        },
        settings: { totals: false, details: true },
      }),
    });
  } catch {
    return null;
  }
  if (res.status !== 200) return null;

  const body = await res.json().catch(() => null);
  const index = Array.isArray(body?.index) ? body.index : [];

  // One reservation can hold several rooms, comma-joined in `room_numbers`. The
  // walk list is per ROOM, so split — a 12-reservation day was 16 rooms on
  // Jacksonville West. De-dupe because a room can appear on two reservations.
  const rooms = new Set();
  const seenRes = new Set();
  for (const r of index) {
    const [resNo, roomField] = (Array.isArray(r) ? r : [r]).map((v) => String(v ?? ""));
    if (!resNo || seenRes.has(resNo)) continue;
    seenRes.add(resNo);
    for (const room of roomField.split(",").map((s) => s.trim()).filter(Boolean)) rooms.add(room);
  }
  // Numeric-aware sort so 106 precedes 1102 and the walk runs in door order.
  return [...rooms].sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b));
}

const results = [];
for (const p of PROPERTIES) {
  const key = process.env[`CLOUDBEDS_API_KEY_${p.code}`];
  results.push({ ...p, rooms: key ? await dueOutRooms(key, p.api, DAY) : null });
}

const pretty = new Date(`${DAY}T12:00:00Z`).toLocaleDateString("en-US", {
  weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
});
const total = results.reduce((n, r) => n + (r.rooms?.length ?? 0), 0);
const failed = results.filter((r) => r.rooms === null);

const facts = results.map((r) => ({
  title: `${r.name} (${r.id})`,
  value:
    r.rooms === null
      ? "unavailable — Cloudbeds did not respond"
      : r.rooms.length === 0
        ? "no rooms due out"
        : `${r.rooms.length} room${r.rooms.length === 1 ? "" : "s"} — ${r.rooms.join(", ")}`,
}));

const card = {
  type: "AdaptiveCard",
  $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
  version: "1.4",
  body: [
    {
      type: "TextBlock",
      text: "TEST — Due-Out Room Walk List",
      weight: "Bolder",
      size: "Large",
      wrap: true,
    },
    {
      type: "TextBlock",
      text: "This is a test of an automated 9:00 AM delivery. **No action is required.** Please reply if it reached the right people.",
      wrap: true,
      color: "Attention",
    },
    { type: "TextBlock", text: pretty, weight: "Bolder", wrap: true, spacing: "Medium" },
    {
      type: "TextBlock",
      text: `${total} room${total === 1 ? "" : "s"} scheduled to check out across ${results.length - failed.length} properties.`,
      wrap: true,
    },
    { type: "FactSet", facts },
    {
      type: "TextBlock",
      text:
        "Source: Cloudbeds, reservations still In-House with a checkout date of the stay date shown. " +
        "Rooms only — no guest details. A room already vacated before the list was built does not appear." +
        (failed.length ? ` **${failed.length} property read(s) failed and are shown as unavailable, not as zero.**` : ""),
      wrap: true,
      isSubtle: true,
      size: "Small",
      spacing: "Medium",
    },
  ],
};

console.log(JSON.stringify(card, null, 2));

// REFUSE TO SEND A CARD THAT IS ENTIRELY FAILURES. A list of eight
// "unavailable" rows is worse than no message: it trains the reader to ignore
// the 9am post. Learned the hard way — the first test post did exactly this.
if (failed.length === results.length) {
  console.error(`\nNOT SENT: all ${results.length} property reads failed. Fix the read, then re-run.`);
  process.exit(1);
}

console.log(`\nPosting to TEAMS_FLOW_URL_DUEOUT (workflow c026d847…)…`);

const r = await fetch(FLOW, {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(card),
});
const text = await r.text();
console.log(`HTTP ${r.status}`);
console.log(text.slice(0, 1000) || "(empty body)");
