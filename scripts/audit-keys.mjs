// Re-audit every property's Cloudbeds API key: for each CLOUDBEDS_API_KEY_<CODE>
// in the environment, ping getHotels (read-only) and report OK / error / no key.
// Mirrors lib/cloudbeds.ts auth + envelope handling. Read-only — never writes.
//
// Local run sees only keys present in the env file. NOTE: `vercel env pull` does
// NOT help here — every app var (incl. all CLOUDBEDS_API_KEY_*) is marked
// Sensitive in Vercel, so pull returns the NAMES with EMPTY values. To audit all
// 8 locally you must paste the real key values into the env file. Otherwise audit
// via the live dashboard (home shows "N of 8 reporting"; tabs show key errors).
//   node scripts/audit-keys.mjs                 # reads ../.env.local
//   node scripts/audit-keys.mjs path/to/envfile # reads a specific file
import { readFileSync } from "node:fs";

const envFileArg = process.argv[2];
const envFile = envFileArg ?? new URL("../.env.local", import.meta.url);
for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const BASE_URL = "https://hotels.cloudbeds.com/api/v1.3";

// Keep in sync with config/properties.ts (code, name, expected API propertyID).
const PROPERTIES = [
  { code: "DP", name: "Davenport", apiPropertyId: "318197" },
  { code: "LL", name: "Lakeland", apiPropertyId: "210972" },
  { code: "KE", name: "Kissimmee East", apiPropertyId: "210986" },
  { code: "KW", name: "Kissimmee West", apiPropertyId: "210969" },
  { code: "JW", name: "Jacksonville West", apiPropertyId: "210987" },
  { code: "JN", name: "Jacksonville North", apiPropertyId: "206628" },
  { code: "SA", name: "St. Augustine", apiPropertyId: "208155" },
  { code: "OR", name: "Orlando OBT", apiPropertyId: "210971" },
];

function readKey(code) {
  const direct = process.env[`CLOUDBEDS_API_KEY_${code}`];
  if (direct && direct.trim()) return direct.trim();
  if (code === "DP" && process.env.CLOUDBEDS_API_KEY?.trim()) return process.env.CLOUDBEDS_API_KEY.trim();
  return null;
}

async function probe(apiKey) {
  let res;
  try {
    res = await fetch(`${BASE_URL}/getHotels`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
  } catch (e) {
    return { ok: false, detail: `network error: ${e}` };
  }
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* raw */ }
  if (!res.ok) return { ok: false, detail: `HTTP ${res.status}: ${String(text).slice(0, 120)}` };
  if (parsed && typeof parsed === "object" && "success" in parsed) {
    if (!parsed.success) return { ok: false, detail: `success:false — ${parsed.message ?? "?"}` };
    const data = parsed.data;
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    const ids = rows.map((h) => `${h.propertyName ?? "?"} (${h.propertyID ?? "?"})`);
    return { ok: true, detail: ids.join(", ") || "ok, no rows" };
  }
  return { ok: true, detail: "ok (no envelope)" };
}

console.log(`Auditing ${PROPERTIES.length} property keys against ${BASE_URL}\n`);
let okCount = 0, errCount = 0, missingCount = 0;
for (const p of PROPERTIES) {
  const key = readKey(p.code);
  const label = `${p.code.padEnd(3)} ${p.name.padEnd(20)}`;
  if (!key) { console.log(`${label} ⊘  no key in env`); missingCount++; continue; }
  const r = await probe(key);
  if (r.ok) {
    const mismatch = !r.detail.includes(`(${p.apiPropertyId})`) ? "  ⚠ propertyID mismatch (expected " + p.apiPropertyId + ")" : "";
    console.log(`${label} ✓  ${r.detail}${mismatch}`);
    okCount++;
  } else {
    console.log(`${label} ✗  ${r.detail}`);
    errCount++;
  }
}
console.log(`\nSummary: ${okCount} OK · ${errCount} error · ${missingCount} no key (of ${PROPERTIES.length})`);
