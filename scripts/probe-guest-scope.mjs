// Does the key's "Guest" permission differ between the v1.3 API and Data Insights?
// Read-only. Proves access WITHOUT printing names/emails (uses counts / identifiers only).
const KEY = process.env.CLOUDBEDS_API_KEY_DP || process.env.CLOUDBEDS_API_KEY;
const PROP = "318197";
const V13 = "https://hotels.cloudbeds.com/api/v1.3";
const DI = "https://api.cloudbeds.com/datainsights/v1.1";
const H = { Authorization: `Bearer ${KEY}`, Accept: "application/json" };

async function v13(path) {
  const r = await fetch(`${V13}${path}`, { headers: H });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  // report only status + success + message + count, never the row payload
  const s = j && typeof j === "object" ? { success: j.success, message: j.message, count: j.count ?? (Array.isArray(j.data) ? j.data.length : undefined) } : j;
  return { http: r.status, ...s };
}

async function diCount(datasetId, label) {
  // Ask for a single identifier column for yesterday — returns row presence, not PII text.
  const body = {
    property_ids: [Number(PROP)], dataset_id: datasetId,
    columns: [{ cdf: { column: "reservation_number" } }],
    filters: { and: [{ cdf: { column: "checkin_date" }, operator: "greater_than_or_equal", value: "2026-06-01" }] },
    settings: { totals: false, details: true },
  };
  const r = await fetch(`${DI}/reports/query/data?mode=Preview`, {
    method: "POST",
    headers: { ...H, "X-PROPERTY-ID": PROP, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  const rows = j?.records ? Object.keys(j.records).length : (j?.aggregated_count ?? undefined);
  return { dataset: label, http: r.status, success: j?.success, message: j?.message, rowsSeen: rows, type: j?.type };
}

console.log("--- v1.3 endpoints (map to permissions-page toggles) ---");
console.log("getGuestList     ", JSON.stringify(await v13("/getGuestList")));
console.log("getGuestsByStatus", JSON.stringify(await v13("/getGuestsByStatus")));
console.log("getReservations  ", JSON.stringify(await v13("/getReservations")));
console.log("getRoomTypes     ", JSON.stringify(await v13("/getRoomTypes")));

console.log("\n--- Data Insights guest plane ---");
console.log(JSON.stringify(await diCount(2, "2 Guests")));
console.log(JSON.stringify(await diCount(3, "3 Reservations")));
