// Raw /getRoomBlocks dump for one property + date: every block, its
// roomBlockType, its reason, and the rooms in it. Exists so the calendar's
// visual states can be matched to the API types by eye — the API returns no
// colour, so "red = out_of_service / grey = blocked_dates" is an assumption
// until someone reads it off the UI against this list.
//
//   npx tsx scripts/dump-blocks.mts JN 2026-08-07
//
// PII-free: room blocks carry room numbers and maintenance reasons, no guests.
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const { readKey } = await import("../lib/cloudbeds.ts");
const { PROPERTIES } = await import("../config/properties.ts");

const CODE = (process.argv[2] || "JN").toUpperCase();
const DATE = process.argv[3] || "2026-08-07";

const p = PROPERTIES.find((x) => x.code === CODE);
if (!p) throw new Error(`unknown code ${CODE}`);
const key = readKey(p.code);
if (!key) throw new Error(`no key for ${CODE}`);

// Same call the report makes. endDate is EXCLUSIVE (verified live 07/22), so a
// single stay date asks for [DATE, DATE+1).
const next = new Date(`${DATE}T00:00:00Z`);
next.setUTCDate(next.getUTCDate() + 1);
const endExclusive = next.toISOString().slice(0, 10);

// PAGED. This script originally read page 1 only, which is exactly the bug it
// was written to investigate — it reported 20 blocks at JN where there are 110.
type Block = { roomBlockID?: string; roomBlockType?: string; roomBlockReason?: string; startDate?: string; endDate?: string; rooms?: Array<{ roomID: string; roomName?: string }> };
const PAGE = 100;
const blocks: Block[] = [];
let status = 0;
for (let page = 1; page <= 40; page++) {
  const url = new URL("https://api.cloudbeds.com/api/v1.3/getRoomBlocks");
  url.searchParams.set("startDate", DATE);
  url.searchParams.set("endDate", endExclusive);
  url.searchParams.set("pageNumber", String(page));
  url.searchParams.set("pageSize", String(PAGE));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  status = res.status;
  const json = (await res.json()) as { success?: boolean; data?: { roomBlocks?: Block[] }; message?: string };
  if (!json.success) {
    console.log(`FAILED on page ${page}: HTTP ${res.status} ${json.message ?? JSON.stringify(json).slice(0, 300)}`);
    process.exit(1);
  }
  const batch = json.data?.roomBlocks ?? [];
  blocks.push(...batch);
  if (batch.length < PAGE) break;
}

console.log(`\n${p.name} (${p.id})  blocks active on ${DATE}   HTTP ${status}   ${blocks.length} block records (paged)`);
const byType = new Map<string, { blocks: number; rooms: number; reasons: Map<string, number> }>();

for (const b of blocks) {
  const type = b.roomBlockType || "(unspecified)";
  const n = (b.rooms ?? []).length;
  const agg = byType.get(type) ?? { blocks: 0, rooms: 0, reasons: new Map() };
  agg.blocks += 1;
  agg.rooms += n;
  const reason = b.roomBlockReason || "(no reason given)";
  agg.reasons.set(reason, (agg.reasons.get(reason) ?? 0) + n);
  byType.set(type, agg);
}

console.log(`\nBY TYPE — this is exactly how the report splits the two lines:`);
for (const [type, agg] of [...byType.entries()].sort((a, b) => b[1].rooms - a[1].rooms)) {
  const line = type === "out_of_service" ? "counted as OOO" : "counted as Other blocks";
  console.log(`\n  ${type}  —  ${agg.rooms} rooms across ${agg.blocks} block(s)   [${line}]`);
  for (const [reason, count] of [...agg.reasons.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(count).padStart(4)}  ${reason}`);
  }
}

const oooRooms = byType.get("out_of_service")?.rooms ?? 0;
const otherRooms = [...byType.entries()].filter(([t]) => t !== "out_of_service").reduce((s, [, a]) => s + a.rooms, 0);
console.log(`\nTOTALS on ${DATE}:  OOO ${oooRooms}   ·   other block types ${otherRooms}   ·   all blocked ${oooRooms + otherRooms}`);
console.log(`(the report's "Other blocks" line ALSO folds in comp room-nights from revenue, which are not blocks and not in this dump)`);

// /getRoomBlocks returns internal roomIDs (`<roomTypeID>-<seq>`), which mean
// nothing on the calendar. Resolve them to room CODES via /getRooms (paged) so
// the list can be checked room by room against what the calendar shows.
const nameById = new Map<string, string>();
for (let page = 1; page <= 20; page++) {
  const u = new URL("https://api.cloudbeds.com/api/v1.3/getRooms");
  u.searchParams.set("pageNumber", String(page));
  u.searchParams.set("pageSize", "100");
  const r = await fetch(u, { headers: { Authorization: `Bearer ${key}` } });
  const j = (await r.json()) as { success?: boolean; data?: Array<{ rooms?: Array<{ roomID: string; roomName: string }> }> };
  if (!j.success) break;
  const batch = (j.data ?? []).flatMap((x) => x.rooms ?? []);
  for (const rm of batch) nameById.set(rm.roomID, rm.roomName);
  if (batch.length < 100) break;
}

const numeric = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
};
const listRooms = (type: string) =>
  [...new Set(blocks.filter((b) => (b.roomBlockType ?? "") === type).flatMap((b) => (b.rooms ?? []).map((r) => nameById.get(r.roomID) ?? `?${r.roomID}`)))]
    .sort((a, b2) => numeric(a) - numeric(b2) || a.localeCompare(b2));

const oooList = listRooms("out_of_service");
const otherTypes = [...new Set(blocks.map((b) => b.roomBlockType ?? "(unspecified)"))].filter((t) => t !== "out_of_service");
console.log(`\nOOO ROOM NUMBERS (${oooList.length} distinct) — count these against the RED bars:`);
console.log(`  ${oooList.join(", ")}`);
for (const t of otherTypes) {
  const l = listRooms(t);
  console.log(`\n${t} ROOM NUMBERS (${l.length} distinct) — the GREY bars:`);
  console.log(`  ${l.join(", ")}`);
}
