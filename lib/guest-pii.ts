// WHO MAY SEE GUEST NAMES. This is the ONE definition — every surface that
// shows guest PII asks this function, and nothing re-implements the judgement.
//
// Per `duplicated-definitions-fail-silently`: one meaning with two definitions
// gives green tests and wrong production. A privacy rule copied into six page
// components is exactly that shape, and the copy that drifts is the leak. If you
// need this decision somewhere new, import it. Do not re-derive it.
//
// HISTORY (do not re-litigate, but do not lose either):
//   - Until 08/04/26 the rule was absolute: no guest PII anywhere, enforced by
//     the API key's scopes.
//   - 08/04/26 — Kyle authorised ONE exception, `/bea` §3 Balance due, because
//     chasing rent arrears is impossible without naming who owes it. The Guest /
//     Data Insights Guests scopes had to be retained, so the key stopped being
//     the guardrail and code plus the PIN gate became it. See lib/balance-due.ts.
//   - 09/01/26 — Kyle widened it to all internal STAFF levels, for the Home
//     arrivals & departures report. That is what this file encodes. CLAUDE.md §5
//     rule 2 was rewritten to match; the old "does not generalise" wording is
//     superseded, not merely contradicted.
//
// TWO EXCLUSIONS, BOTH LOAD-BEARING — neither is an oversight:
//
//   1. `elise` is an EXTERNAL VENDOR level (EliseAI support), listed in
//      lib/auth.ts RESTRICTED_LEVELS. Guest names there would hand Stayable
//      guest data to a third party. "All dashboards" never meant this one.
//
//   2. `null` covers `/report`'s file tokens, which are UNAUTHENTICATED BY
//      DESIGN. signFileToken mints 30-day PIN-less links so the daily Teams card
//      works without giving the Revenue chat the MAIN pin, and its comment says
//      that is safe precisely because the report carries no guest PII. Any
//      token-only path resolves to no level and must therefore resolve to false.
//
// Teams and the MCP tool surface are out of scope entirely and keep their own
// guards: lib/due-outs.ts is PII-free by construction because it posts to a
// channel, and lib/mcp/server.test.ts enforces assertNoGuestPii over every tool
// schema. Nothing here relaxes either.

import { type Level } from "@/lib/auth";

/**
 * Levels permitted to see guest names.
 *
 * DELIBERATELY AN ALLOWLIST, NOT A DENYLIST. A level added to `ALL_LEVELS` in
 * future is denied guest PII until someone adds it here on purpose — so the
 * failure mode of forgetting is "a staff member sees less than they should",
 * never "a vendor sees guest names". A denylist fails the other way, and the
 * other way is the one that matters. There is a test that iterates `ALL_LEVELS`
 * so a new level forces this decision rather than inheriting access.
 */
export const GUEST_PII_LEVELS: ReadonlySet<Level> = new Set<Level>([
  "base", // Home — the MAIN pin. The widest-held staff credential, still staff.
  "exec", // CEO
  "admin", // connector administration
  "crystal", // VP Ops
  "monica", // Revenue
  "bea", // Ops Support — the original exception, now covered by the general rule
  "ops", // Operations viewer
]);

/**
 * May `level` see guest names?
 *
 * `null` / `undefined` mean "no authenticated level" — unauthenticated requests
 * and `/report`'s file-token path — and always return false. An unrecognised
 * level returns false too: unknown is not a reason to permit.
 */
export function canViewGuestPii(level: Level | null | undefined): boolean {
  if (!level) return false;
  return GUEST_PII_LEVELS.has(level);
}
