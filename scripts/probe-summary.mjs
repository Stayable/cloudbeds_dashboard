// Compact inventory of every Data Insights dataset + column the key can read.
// Read-only. Run after exporting the key (see probe-data.mjs).
const KEY = process.env.CLOUDBEDS_API_KEY_DP || process.env.CLOUDBEDS_API_KEY;
const PROP = process.env.PROBE_PROPERTY_ID || "318197";
const DI = "https://api.cloudbeds.com/datainsights/v1.1";
const H = { Authorization: `Bearer ${KEY}`, Accept: "application/json", "X-PROPERTY-ID": PROP };

async function get(url) {
  const r = await fetch(url, { headers: H });
  return JSON.parse(await r.text());
}

const ds = await get(`${DI}/datasets`);
const list = Array.isArray(ds) ? ds : ds.data ?? [];
const out = {};
for (const d of list) {
  const detail = await get(`${DI}/datasets/${d.id}`);
  const cats = {};
  for (const group of detail.cdfs ?? []) {
    cats[group.category] = (group.cdfs ?? []).map((c) => ({
      column: c.column, name: c.name, kind: c.kind,
    }));
  }
  out[d.id] = { name: d.name, categories: cats };
}
console.log(JSON.stringify(out, null, 1));
