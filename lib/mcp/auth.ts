// The MCP endpoint's only gate: a token in the URL path, looked up by hash.
//
// Kyle chose a secret-in-the-URL over OAuth on 08/11/26 and confirmed it on
// 08/12/26 after verifying that Claude Desktop's Add-custom-connector dialog
// offers no field for an arbitrary header (spec §3). The URL IS the credential.
//
// Replaced the single MCP_SECRET env var on 08/12/26. Two things got simpler:
// there is no length-leaking timing concern any more, because the value handed
// to Postgres is already a SHA-256 digest and leaks nothing about its preimage;
// and there is ONE code path, because the old shared secret was migrated into
// the table as an ordinary row rather than kept as a fallback branch.
//
// Node runtime only — never imported by middleware, unlike lib/auth.ts.
import {
  hashToken,
  shouldTouch,
  findLiveTokenByHash,
  touchToken,
} from "./tokens";

/** Shortest value that could be one of our tokens (we mint 64 hex chars).
 *  Anything shorter is a typo or a probe, so reject it without a query. */
export const MIN_TOKEN_LENGTH = 32;

export type McpCaller = {
  id: number;
  email: string | null;
  label: string | null;
};

/** The caller behind this token, or null if the token is unknown, revoked,
 *  malformed, or the database is unreachable. Never throws — every failure
 *  path is a null, which the route turns into a 404. */
export async function resolveMcpToken(
  candidate: string | undefined,
): Promise<McpCaller | null> {
  if (!candidate || candidate.length < MIN_TOKEN_LENGTH) return null;
  try {
    const row = await findLiveTokenByHash(hashToken(candidate));
    if (!row) return null;
    if (shouldTouch(row.lastUsedAt, Date.now())) {
      // Its own try/catch: a failed bookkeeping write must not turn a valid
      // call into a 404.
      try {
        await touchToken(row.id);
      } catch {
        /* bookkeeping only */
      }
    }
    return { id: row.id, email: row.email, label: row.label };
  } catch {
    return null; // fail closed
  }
}
