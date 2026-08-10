// The MCP endpoint's only gate: a secret path segment.
//
// Kyle chose this over OAuth 2.1 on 08/11/26 (spec §3). The URL IS the
// credential, so the comparison must not leak length or content through timing,
// and it must fail closed — a missing env var making every request valid would
// publish the portfolio's numbers to the internet.

/** Shortest value we will accept as a real secret. Anything shorter is a typo
 *  or a placeholder like "changeme"; refusing it turns a guessable endpoint
 *  into a dead one. */
const MIN_SECRET_LENGTH = 32;

export function mcpSecretOk(candidate: string | undefined): boolean {
  const expected = process.env.MCP_SECRET ?? "";
  if (expected.length < MIN_SECRET_LENGTH) return false; // fail closed
  if (!candidate || candidate.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
