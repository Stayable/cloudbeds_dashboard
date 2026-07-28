// Settle "how many rooms does this property actually have?" against the room
// list itself, rather than against whoever's spreadsheet.
//
// WHY: our banked inventory comes from `getDashboard` capacity. For Kissimmee
// East that reads 168 while Monica's workbook says 167 — every day, all year
// (207 phantom room-nights YTD, ~0.4pp of occupancy, and it also shifts the
// "% Occupied Adjusted (less 20 rms)" line). One of the two is wrong and neither
// source can adjudicate itself.
//
// Three numbers per property, so a disagreement points at its own cause:
//   dashboardCapacity  - what /getDashboard reports (what we bank today)
//   roomsListed        - rows in /getRooms (the actual room inventory)
//   roomsSellable      - roomsListed minus rooms blocked out_of_service today
//
// If roomsListed == dashboardCapacity but Monica says one fewer, a room exists in
// Cloudbeds that the property does not sell — fix it AT THE SOURCE (block it
// out_of_service or remove it from inventory) rather than hardcoding 167.
//
// Read-only. Needs a key per property, so run it where the full key set lives
// (Vercel, or locally once every CLOUDBEDS_API_KEY_<CODE> is set) — with only
// CLOUDBEDS_API_KEY_DP present it audits Davenport and reports the rest as
// unconfigured.
//   node scripts/audit-room-counts.mjs
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const BASE = "https://hotels.cloudbeds.com/api/v1.3";

// Mirrors config/properties.ts. `monica` is her workbook's MOST RECENT 2026
// per-day inventory (parsed by scripts/parse-monica-counts.py) — the comparison
// target, not an authority. Use the latest value, not the modal one: Davenport
// moved 151 -> 150 -> 152 -> 153 during 2026, so comparing today's Cloudbeds
// capacity against the year's most common figure invents a disagreement.
const PROPS = [
  { code: "DP", id: "44199", name: "Davenport", monica: 153 },
  { code: "LL", id: "4645", name: "Lakeland", monica: 157 },
  { code: "KE", id: "2295", name: "Kissimmee East", monica: 167 },
  { code: "KW", id: "5399", name: "Kissimmee West", monica: 160 },
  { code: "JW", id: "6802", name: "Jacksonville West", monica: 133 },
  { code: "JN", id: "812", name: "Jacksonville North", monica: 127 },
  { code: "SA", id: "2535", name: "St. Augustine", monica: 140 },
  { code: "OR", id: "8700", name: "Orlando OBT", monica: 135 },
];

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

async function cb(key, path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
  return j;
}

const rows = [];
for (const p of PROPS) {
  const key = process.env[`CLOUDBEDS_API_KEY_${p.code}`] || (p.code === "DP" ? process.env.CLOUDBEDS_API_KEY : null);
  if (!key) {
    rows.push({ property: `${p.name} (${p.id})`, status: "no key configured", monica: p.monica });
    continue;
  }
  try {
    const [dash, roomList, blocks] = await Promise.all([
      cb(key, "/getDashboard"),
      // /getRooms is PAGINATED (default page ~20). Not paging through it is why a
      // first cut of this audit reported 20 rooms at a 153-room property — page
      // until a short page, same as getRoomNameMap in lib/cloudbeds.ts.
      (async () => {
        const all = [];
        const PAGE = 100;
        for (let page = 1; page <= 20; page++) {
          const j = await cb(key, "/getRooms", { pageNumber: String(page), pageSize: String(PAGE) });
          const batch = (j?.data ?? []).flatMap((entry) => entry?.rooms ?? []);
          all.push(...batch);
          if (batch.length < PAGE) break;
        }
        return all;
      })(),
      cb(key, "/getRoomBlocks", { startDate: today, endDate: today }),
    ]);

    const roomsListed = roomList.length;
    const oooToday = new Set(
      (blocks?.roomBlocks ?? [])
        .filter((b) => b.roomBlockType === "out_of_service")
        .flatMap((b) => (b.rooms ?? []).map((r) => r.roomID ?? r.roomId ?? r.roomName)),
    );
    const dashboardCapacity = Number(dash?.data?.capacity ?? dash?.capacity ?? NaN);

    rows.push({
      property: `${p.name} (${p.id})`,
      dashboardCapacity,
      roomsListed,
      roomsSellable: roomsListed - oooToday.size,
      monica: p.monica,
      dashVsRooms: Number.isFinite(dashboardCapacity) ? dashboardCapacity - roomsListed : "n/a",
      dashVsMonica: Number.isFinite(dashboardCapacity) ? dashboardCapacity - p.monica : "n/a",
    });
  } catch (e) {
    rows.push({ property: `${p.name} (${p.id})`, status: String(e.message ?? e), monica: p.monica });
  }
}

console.table(rows);

const disputed = rows.filter((r) => typeof r.dashVsMonica === "number" && r.dashVsMonica !== 0);
if (disputed.length === 0) {
  console.log("\nEvery audited property agrees with the workbook.");
} else {
  console.log("\nDisagreements to resolve at the SOURCE (do not hardcode the spreadsheet value):");
  for (const r of disputed) {
    console.log(`  ${r.property}: getDashboard ${r.dashboardCapacity}, /getRooms ${r.roomsListed}, workbook ${r.monica}`);
    if (r.dashVsRooms === 0) {
      console.log(`    -> Cloudbeds lists ${r.roomsListed} rooms and the property reports ${r.monica}. Identify the extra room and either block it out_of_service or remove it from inventory.`);
    } else {
      console.log(`    -> getDashboard and /getRooms disagree by ${r.dashVsRooms}; treat /getRooms as the room-level truth and raise the discrepancy with Cloudbeds.`);
    }
  }
}
