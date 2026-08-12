// Confirms the legacy MCP secret in .secrets/ matches the row in mcp_tokens.
// If this fails, removing MCP_SECRET from Vercel would break Rob's and Kate's
// connectors. Prints no secret and no token — only the hash prefix.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const sql = neon(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);

const secret = readFileSync(new URL("../.secrets/mcp-secret.txt", import.meta.url), "utf8").trim();
const hash = createHash("sha256").update(secret, "utf8").digest("hex");

const rows = await sql`
  select id, email, label, revoked_at from mcp_tokens
  where token_hash = ${hash} and revoked_at is null
`;
if (rows.length !== 1) {
  console.error(`FAIL: ${rows.length} live rows match hash ${hash.slice(0, 8)}… (expected 1).`);
  console.error("Rob's and Kate's existing connectors would NOT work.");
  process.exit(1);
}
console.log(`OK: legacy URL resolves to id ${rows[0].id}, ${rows[0].email} — ${rows[0].label}`);
