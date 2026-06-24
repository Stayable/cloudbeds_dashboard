// One-off probe: enumerate everything the current key can read.
// Read-only. Run:  node scripts/probe-data.mjs
// Key source (first found): CLOUDBEDS_API_KEY_DP, then CLOUDBEDS_API_KEY.
// Davenport API propertyID = 318197.

const KEY = process.env.CLOUDBEDS_API_KEY_DP || process.env.CLOUDBEDS_API_KEY;
const PROP = process.env.PROBE_PROPERTY_ID || "318197"; // Davenport
if (!KEY) {
  console.error("No key. Set CLOUDBEDS_API_KEY_DP (or CLOUDBEDS_API_KEY) in the env first.");
  process.exit(1);
}

const V13 = "https://hotels.cloudbeds.com/api/v1.3";
const DI = "https://api.cloudbeds.com/datainsights/v1.1";
const H = { Authorization: `Bearer ${KEY}`, Accept: "application/json" };

async function get(url, extra = {}) {
  try {
    const r = await fetch(url, { headers: { ...H, ...extra } });
    const t = await r.text();
    let j; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j };
  } catch (e) {
    return { status: 0, body: String(e) };
  }
}

console.log("=== v1.3 getHotels ===");
console.log(JSON.stringify(await get(`${V13}/getHotels`), null, 2));

console.log("\n=== v1.3 getDashboard (Davenport) ===");
console.log(JSON.stringify((await get(`${V13}/getDashboard`)).body, null, 2));

console.log("\n=== Data Insights: GET /datasets ===");
const ds = await get(`${DI}/datasets`, { "X-PROPERTY-ID": PROP });
console.log(JSON.stringify(ds, null, 2));

// For each dataset id we can see, list its columns.
const list = Array.isArray(ds.body?.data) ? ds.body.data
  : Array.isArray(ds.body) ? ds.body : [];
for (const d of list) {
  const id = d.id ?? d.dataset_id ?? d.datasetID;
  if (id == null) continue;
  console.log(`\n=== Data Insights: GET /datasets/${id} (${d.name ?? "?"}) ===`);
  const cols = await get(`${DI}/datasets/${id}`, { "X-PROPERTY-ID": PROP });
  console.log(JSON.stringify(cols, null, 2));
}
