// Backfill token_preview for connector rows minted before that column existed.
//
// WHY THIS EXISTS: mcp_tokens stores only the SHA-256 hash of each token, so a
// preview cannot be derived from the database. Rows issued before the preview
// column was added show "—" on /connectors forever unless the original URL is
// supplied from outside — which is what this script is for. It is a one-shot
// migration aid, not part of normal operation.
//
// USAGE
//   1. Create .secrets/token-backfill.txt (gitignored — .secrets/ is in
//      .gitignore). One connector URL per line, exactly as you sent it. Bare
//      64-hex tokens also work. Blank lines and lines starting with # are
//      ignored.
//   2. node scripts/backfill-token-previews.mjs
//   3. DELETE .secrets/token-backfill.txt afterwards. Those lines are live
//      credentials; there is no reason to keep a file full of them on disk.
//
// SAFETY
//   - Never prints a token, a URL, or a full hash. Only row id, email, preview.
//   - Only fills rows where token_preview IS NULL — it cannot overwrite or
//     corrupt an existing preview, so re-running is harmless.
//   - A line matching no row is reported and skipped, never inserted. This
//     script cannot create a token; it only annotates one that already exists.
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

// Keep in step with PREVIEW_EDGE and tokenPreview() in lib/mcp/tokens.ts. A
// mismatch here would produce previews that do not match newly-minted ones.
const EDGE = 6;
const previewOf = (t) => (t.length <= EDGE * 2 ? "…" : `${t.slice(0, EDGE)}…${t.slice(-EDGE)}`);

let lines;
try {
  lines = readFileSync(new URL("../.secrets/token-backfill.txt", import.meta.url), "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
} catch {
  console.error(
    "Could not read .secrets/token-backfill.txt.\n" +
      "Create it with one connector URL per line (see this file's header), then re-run.",
  );
  process.exit(1);
}

if (lines.length === 0) {
  console.error(".secrets/token-backfill.txt has no usable lines.");
  process.exit(1);
}

let filled = 0;
let already = 0;
let unmatched = 0;

for (const [i, raw] of lines.entries()) {
  // Accept a full URL or a bare token; the token is the last path segment.
  const token = raw.split("/").pop().trim();
  if (!/^[0-9a-f]{64}$/i.test(token)) {
    console.log(`line ${i + 1}: not a 64-hex token — skipped`);
    unmatched += 1;
    continue;
  }
  const hash = createHash("sha256").update(token.toLowerCase(), "utf8").digest("hex");
  const rows = await sql`
    update mcp_tokens set token_preview = ${previewOf(token.toLowerCase())}
    where token_hash = ${hash} and token_preview is null
    returning id, email, token_preview
  `;
  if (rows.length === 1) {
    console.log(`line ${i + 1}: id ${rows[0].id} (${rows[0].email}) -> ${rows[0].token_preview}`);
    filled += 1;
    continue;
  }
  // No update: either the row already had a preview, or the token matches nothing.
  const existing = await sql`select id, email, token_preview from mcp_tokens where token_hash = ${hash}`;
  if (existing.length === 1) {
    console.log(`line ${i + 1}: id ${existing[0].id} (${existing[0].email}) already had ${existing[0].token_preview} — left alone`);
    already += 1;
  } else {
    console.log(`line ${i + 1}: no row matches this token — skipped`);
    unmatched += 1;
  }
}

console.log(`\n${filled} filled, ${already} already set, ${unmatched} unmatched.`);

const remaining = await sql`
  select id, email from mcp_tokens
  where token_preview is null and revoked_at is null
  order by id
`;
if (remaining.length === 0) {
  console.log("Every live row now has a preview.");
} else {
  console.log("Live rows still without a preview (their URLs were not supplied):");
  for (const r of remaining) console.log(`  id=${r.id} ${r.email}`);
}
console.log("\nNow DELETE .secrets/token-backfill.txt — it is a file full of live credentials.");
