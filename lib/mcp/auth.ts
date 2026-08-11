// The MCP endpoint's only gate: a secret path segment.
//
// Kyle chose this over OAuth 2.1 on 08/11/26 (spec §3). The URL IS the
// credential, so the comparison must not leak length or content through timing,
// and it must fail closed — a missing env var making every request valid would
// publish the portfolio's numbers to the internet.
//
// This module runs only inside the route handler (Node runtime), never inside
// middleware — unlike lib/auth.ts, which is edge-safe on purpose because
// middleware imports it. That is why this file can reach for node:crypto
// instead of Web Crypto.
import { createHash, timingSafeEqual } from "node:crypto";

/** Shortest value we will accept as a real secret. Anything shorter is a typo
 *  or a placeholder like "changeme"; refusing it turns a guessable endpoint
 *  into a dead one. */
const MIN_SECRET_LENGTH = 32;

// Comparing digests rather than the raw strings is what stops response time
// from revealing the secret's length: both digests are always 32 bytes, so
// timingSafeEqual runs the same number of comparisons regardless of how long
// (or short) the candidate was — there is no length check to short-circuit on.
const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

export function mcpSecretOk(candidate: string | undefined): boolean {
  const expected = process.env.MCP_SECRET ?? "";
  if (expected.length < MIN_SECRET_LENGTH) return false; // fail closed
  if (candidate === undefined) return false;
  return timingSafeEqual(digest(candidate), digest(expected));
}
