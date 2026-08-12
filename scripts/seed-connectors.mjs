// One-shot seed for the connector-tokens release (spec 2026-08-12).
//
// Does two things, both idempotent:
//   1. Sets the `admin` PIN (ILLUSTRIOUS), which gates /connectors.
//   2. Migrates the existing shared MCP_SECRET into mcp_tokens as an ordinary
//      row, so Rob's and Kate's connectors keep working and can later be
//      retired with a click instead of a Vercel edit and a redeploy.
//
// Run:  node scripts/seed-connectors.mjs
//
// NOTE: this writes to PRODUCTION. Local, preview and production share one
// DATABASE_URL (established session 9p). Both writes are additive.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("No DATABASE_URL(_UNPOOLED) in .env.local");
  process.exit(1);
}
const sql = neon(url);

// --- 1. the admin PIN --------------------------------------------------------
const ADMIN_PIN = "ILLUSTRIOUS";
await sql`
  insert into dashboard_pins (level, pin, updated_at)
  values ('admin', ${ADMIN_PIN}, now())
  on conflict (level) do update set pin = excluded.pin, updated_at = now()
`;
console.log("dashboard_pins: admin PIN set.");

// --- 2. the legacy shared URL ------------------------------------------------
// Kate shares this URL with Rob today. Recording it as Rob's with the sharing
// in the label keeps the page honest: a null owner would lose the fact that it
// is his original connector.
let legacySecret;
try {
  legacySecret = readFileSync(new URL("../.secrets/mcp-secret.txt", import.meta.url), "utf8").trim();
} catch {
  console.error(
    "Could not read .secrets/mcp-secret.txt — copy the value from Vercel's\n" +
      "MCP_SECRET env var into that file first, or Rob's and Kate's existing\n" +
      "connectors will stop working when MCP_SECRET is removed.",
  );
  process.exit(1);
}
if (legacySecret.length < 32) {
  console.error("The value in .secrets/mcp-secret.txt is too short to be the real secret.");
  process.exit(1);
}

const legacyHash = createHash("sha256").update(legacySecret, "utf8").digest("hex");
const existing = await sql`select id from mcp_tokens where token_hash = ${legacyHash}`;
if (existing.length > 0) {
  console.log(`mcp_tokens: legacy row already present (id ${existing[0].id}).`);
} else {
  const [row] = await sql`
    insert into mcp_tokens (email, label, token_hash)
    values ('rb@rise8companies.com', 'legacy shared URL — also used by Kate', ${legacyHash})
    returning id
  `;
  console.log(`mcp_tokens: legacy row inserted (id ${row.id}).`);
}

// Never print the secret or the token itself — only ever the hash's prefix, and
// only so the operator can match this row to the one on the page.
console.log(`Legacy hash starts ${legacyHash.slice(0, 8)}…`);
