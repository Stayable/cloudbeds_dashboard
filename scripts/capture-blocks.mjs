// Run the end-of-day room-block capture against the deployed route, the way the
// 03:00 UTC cron does. Reads CRON_SECRET + a base URL from .env.local.
//   node scripts/capture-blocks.mjs [YYYY-MM-DD] [baseUrl]
// Default base URL is the local dev/prod server on :3000; pass the production
// origin to hit the deployed one.
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const date = process.argv[2];
const base = process.argv[3] ?? "http://localhost:3000";
const url = `${base}/api/cron/capture-blocks${date ? `?date=${date}` : ""}`;

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
});
console.log(res.status, JSON.stringify(await res.json(), null, 1));
