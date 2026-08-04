// Count UNIQUE NAMED GUESTS across all 8 Stayable properties, for the insurance
// application. Read-only.
//
//   node scripts/count-unique-guests.mjs [--json out.json]
//
// METHOD (every choice here changes the number, so it is all stated):
//   Source is v1.3 /getGuestList, paged. That endpoint returns one row per
//   GUEST-PER-RESERVATION, not per person — `total` is therefore NOT a guest
//   count. We reduce to people as follows:
//     * dedupe on `guestID`            — a repeat visitor is one guest
//     * collapse `isMerged` records onto `newGuestID` — Cloudbeds merges
//       duplicate profiles; counting both sides double-counts one human
//     * require a non-empty `guestName` — Kyle's rule ("as long as we have a
//       name"), which also drops `isAnonymized` (GDPR-scrubbed) records
//     * ALL reservation statuses are included — checked in, checked out,
//       pending, cancelled, no-show. The endpoint is the guest master and is
//       not status-filtered.
//
// CROSS-PROPERTY: guest IDs are issued per property, so the same human who
// stayed at two properties holds two IDs. The portfolio figure is therefore
// reported BOTH ways: sum of per-property uniques (upper bound), and deduped on
// normalized email / name+email (lower bound). Insurance usually wants the
// upper bound for exposure, but both are shown so the choice is explicit.
//
// PII: names and emails are read in memory to dedupe and are NEVER printed or
// written. Output is counts only, so the result is safe to hand to a broker.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const PROPS = [
  { code: "DP", id: "44199", name: "Davenport" },
  { code: "LL", id: "4645", name: "Lakeland" },
  { code: "KE", id: "2295", name: "Kissimmee East" },
  { code: "KW", id: "5399", name: "Kissimmee West" },
  { code: "JW", id: "6802", name: "Jacksonville West" },
  { code: "JN", id: "812", name: "Jacksonville North" },
  { code: "SA", id: "2535", name: "St. Augustine" },
  { code: "OR", id: "8700", name: "Orlando OBT" },
];

const V13 = "https://hotels.cloudbeds.com/api/v1.3";
const PAGE_SIZE = 100; // verified working; larger sizes are not documented
const MAX_PAGES = 2000; // backstop against a pagination loop

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET with a bounded retry on 429/5xx, mirroring lib/cloudbeds cbGet. */
async function get(key, path, attempt = 0) {
  const res = await fetch(`${V13}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 10000)
      : Math.min(500 * 2 ** attempt, 8000) + Math.random() * 250;
    await sleep(wait);
    return get(key, path, attempt + 1);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* leave null */ }
  return { status: res.status, json };
}

const normEmail = (s) => (s || "").trim().toLowerCase();
// Names are only ever hashed, never retained, so a debug dump cannot leak them.
const nameKey = (s) =>
  createHash("sha256")
    .update((s || "").trim().toLowerCase().replace(/\s+/g, " "))
    .digest("hex")
    .slice(0, 32);

const perProperty = [];
const globalEmails = new Set();
const globalNameEmail = new Set();
let grandRecords = 0;

// Per-year buckets, keyed on the YEAR THE GUEST RECORD WAS CREATED (dateCreated).
// That is the year we acquired the person's data, which is what an insurance
// application is asking about. Because Cloudbeds mints a new guest profile per
// booking, it also approximates bookings made that year.
const yearRecords = new Map(); // year -> named record count
const yearPeople = new Map(); // year -> Set of nameHash|email seen that year
const bumpYear = (year, personKey) => {
  yearRecords.set(year, (yearRecords.get(year) ?? 0) + 1);
  if (!yearPeople.has(year)) yearPeople.set(year, new Set());
  yearPeople.get(year).add(personKey);
};

for (const p of PROPS) {
  const key = process.env[`CLOUDBEDS_API_KEY_${p.code}`];
  if (!key) {
    perProperty.push({ ...p, error: "no API key configured" });
    continue;
  }

  // guestID -> { named: bool, email, nameHash }
  const guests = new Map();
  const mergedFrom = new Map(); // oldID -> newID
  let records = 0;
  let anonymized = 0;
  let nameless = 0;
  let mergedRecords = 0;
  let reported = null;
  let firstCreated = null;
  let lastCreated = null;
  let failed = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { status, json } = await get(key, `/getGuestList?pageNumber=${page}&pageSize=${PAGE_SIZE}`);
    if (status !== 200 || !json?.success) {
      failed = `HTTP ${status}${json?.message ? ` — ${json.message}` : ""}`;
      break;
    }
    if (reported === null && typeof json.total === "number") reported = json.total;
    const rows = Array.isArray(json.data) ? json.data : [];
    if (rows.length === 0) break;

    for (const r of rows) {
      records++;
      const created = String(r.dateCreated ?? "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(created)) {
        if (!firstCreated || created < firstCreated) firstCreated = created;
        if (!lastCreated || created > lastCreated) lastCreated = created;
      }

      if (r.isAnonymized === true || r.isAnonymized === 1 || r.isAnonymized === "1") anonymized++;

      // A merged record's identity belongs to newGuestID.
      const isMerged = r.isMerged === true || r.isMerged === 1 || r.isMerged === "1";
      let id = String(r.guestID ?? "");
      if (isMerged && r.newGuestID) {
        mergedRecords++;
        mergedFrom.set(id, String(r.newGuestID));
        id = String(r.newGuestID);
      }
      if (!id) continue;

      const name = String(r.guestName ?? "").trim();
      if (!name) { nameless++; continue; } // no name -> excluded per the rule

      const email = normEmail(r.guestEmail);
      const nh = nameKey(name);

      const prev = guests.get(id);
      if (!prev) {
        guests.set(id, { email, nameHash: nh });
      } else if (!prev.email && r.guestEmail) {
        prev.email = email;
      }

      // Year bucket. Only rows with a usable created date can be attributed.
      const year = created.slice(0, 4);
      if (/^\d{4}$/.test(year)) bumpYear(year, `${nh}|${email}`);
      else bumpYear("unknown", `${nh}|${email}`);
    }

    // DO NOT stop on a short page. Cloudbeds returns pages shorter than
    // pageSize mid-run (server-side filtering after paging), and breaking on
    // that truncated the first run of this script by 8,263 records / 8.7% —
    // worst at JN (-3,217) and OR (-2,454), which also made their most recent
    // guest look years old. Only an EMPTY page ends the walk.
  }

  // Any ID that was later revealed to be a merge source must not stand alone.
  for (const [oldId, newId] of mergedFrom) {
    if (guests.has(oldId) && guests.has(newId)) guests.delete(oldId);
  }

  for (const g of guests.values()) {
    if (g.email) {
      globalEmails.add(g.email);
      globalNameEmail.add(`${g.nameHash}|${g.email}`);
    } else {
      // No email: fall back to the name hash so they still count once globally.
      globalNameEmail.add(`${g.nameHash}|`);
    }
  }

  grandRecords += records;
  perProperty.push({
    ...p,
    reportedTotal: reported,
    records,
    uniqueNamed: guests.size,
    withEmail: [...guests.values()].filter((g) => g.email).length,
    anonymized,
    nameless,
    mergedRecords,
    firstCreated,
    lastCreated,
    error: failed,
  });

  const last = perProperty[perProperty.length - 1];
  // `total` is NOT a servable-row count. Verified on DP 08/05/26: the endpoint
  // serves 1,175 rows (pages 1-12) then returns empty pages indefinitely, while
  // total stays 1,338. The 163 difference is records Cloudbeds counts but will
  // not return — anonymized / merged / deleted profiles filtered server-side.
  // They have no retrievable name, so a name-based count cannot include them.
  // "held" below is that difference, and it is expected, not a defect.
  const gap = reported === null ? null : reported - records;
  console.log(
    `${p.name.padEnd(19)} (${p.id.padEnd(5)}) ` +
      (failed
        ? `ERROR ${failed}`
        : `served ${String(records).padStart(6)} of ${String(reported ?? "?").padStart(6)} ` +
          `${gap === 0 ? "(all)     " : gap === null ? "(no total)" : `(${gap} held)`.padStart(10)} · ` +
          `unique named ${String(guests.size).padStart(6)} · ` +
          `email ${String(last.withEmail).padStart(6)} · nameless ${String(nameless).padStart(4)} · ` +
          `anon ${String(anonymized).padStart(4)} · merged ${String(mergedRecords).padStart(4)} · ` +
          `created ${firstCreated ?? "?"}..${lastCreated ?? "?"}`),
  );
}

const ok = perProperty.filter((p) => !p.error);
const sumUnique = ok.reduce((n, p) => n + p.uniqueNamed, 0);
const sumReported = ok.reduce((n, p) => n + (p.reportedTotal ?? 0), 0);
const shortfall = sumReported - grandRecords;
const firstEver = ok.map((p) => p.firstCreated).filter(Boolean).sort()[0] ?? "?";
const lastEver = ok.map((p) => p.lastCreated).filter(Boolean).sort().at(-1) ?? "?";

console.log("\n" + "=".repeat(78));
console.log(`PROPERTIES REPORTING          ${ok.length} of ${PROPS.length}`);
console.log(
  `RECORDS SERVED BY THE API     ${grandRecords.toLocaleString()} of ${sumReported.toLocaleString()} that Cloudbeds counts` +
    `\n                              ${shortfall.toLocaleString()} are counted but never served (anonymized / merged /` +
    `\n                              deleted). Verified on DP: pages past the end return empty` +
    `\n                              indefinitely while total holds. Not retrievable, so not nameable.`,
);
console.log(`GUEST-RESERVATION RECORDS     ${grandRecords.toLocaleString()}  (not a people count)`);
console.log(`UNIQUE NAMED GUESTS (sum)     ${sumUnique.toLocaleString()}  <- per-property unique, summed`);
console.log(`  deduped on email portfolio-wide   ${globalEmails.size.toLocaleString()}  (guests WITH an email only)`);
console.log(`  deduped on name+email             ${globalNameEmail.size.toLocaleString()}  (all named guests)`);
console.log(`GUEST RECORDS CREATED         ${firstEver} .. ${lastEver}`);
console.log("=".repeat(78));
// --- Per-year table ---------------------------------------------------------
// Rows sum to the portfolio record total, but the PEOPLE column does NOT sum to
// the portfolio people figure: someone who booked in 2024 and again in 2026 is
// counted in both years. Each row answers "that year", not a slice of a whole.
const years = [...yearRecords.keys()].sort();
console.log(`\nBY YEAR (year the guest record was created)`);
console.log(`  year   named records   distinct people`);
for (const y of years) {
  console.log(
    `  ${y.padEnd(6)} ${String(yearRecords.get(y)).padStart(13)}   ${String(yearPeople.get(y).size).padStart(15)}`,
  );
}
const yearSum = years.reduce((n, y) => n + yearRecords.get(y), 0);
console.log(`  ${"TOTAL".padEnd(6)} ${String(yearSum).padStart(13)}   ${String(globalNameEmail.size).padStart(15)}`);
if (yearSum !== grandRecords) {
  console.log(`  [!] year rows sum to ${yearSum} but records total ${grandRecords} — investigate`);
}

console.log(
  `\nAll reservation statuses included (checked in / out, pending, cancelled, no-show).` +
    `\nNameless and GDPR-anonymized records excluded. Merged duplicates collapsed.` +
    `\nGuest IDs are per property, so the summed figure counts a guest once PER PROPERTY` +
    `\nvisited; the name+email figure is the portfolio-wide distinct-person estimate.`,
);

const jsonIdx = process.argv.indexOf("--json");
if (jsonIdx > -1 && process.argv[jsonIdx + 1]) {
  const out = {
    generatedFor: "insurance application",
    method: "v1.3 /getGuestList, deduped on guestID, merges collapsed, nameless+anonymized excluded, all statuses",
    propertiesReporting: ok.length,
    completeness: {
      servedByApi: grandRecords,
      countedByCloudbeds: sumReported,
      heldBackNotRetrievable: shortfall,
      note: "total is not a servable-row count; the held-back records are anonymized/merged/deleted and have no retrievable name",
    },
    guestReservationRecords: grandRecords,
    uniqueNamedGuestsSummed: sumUnique,
    portfolioDedupedOnEmail: globalEmails.size,
    portfolioDedupedOnNameEmail: globalNameEmail.size,
    guestRecordsCreatedFrom: firstEver,
    guestRecordsCreatedTo: lastEver,
    byYear: years.map((y) => ({ year: y, namedRecords: yearRecords.get(y), distinctPeople: yearPeople.get(y).size })),
    perProperty: perProperty.map(({ code, id, name, ...rest }) => ({ code, propertyId: id, name, ...rest })),
  };
  writeFileSync(process.argv[jsonIdx + 1], JSON.stringify(out, null, 2));
  console.log(`\nwrote ${process.argv[jsonIdx + 1]} (counts only, no PII)`);
}
