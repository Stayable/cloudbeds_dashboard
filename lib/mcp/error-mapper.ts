// ONE translation from an internal error string to a plain sentence a
// third-party desktop client is allowed to see.
//
// Final review, Important 1: server.ts already refuses to leak a THROWN
// error's detail (a caller mistake gets its own McpArgError message; anything
// else becomes "the data source did not respond as expected" — see server.ts's
// catch block). But three tools were returning an upstream error STRING
// inside their `data` payload instead of throwing, and that path was never
// scrubbed — tools-ops.ts's get_contractor_schedule could literally hand back
// "SMARTSHEET_API_TOKEN is not set" (an internal env-var name) to Rob's Claude
// Desktop. Spec §8: never a credential, connection string, internal path or
// stack trace, because the reply leaves our infrastructure entirely.
//
// This is the ONE definition, imported everywhere an upstream result carries
// an in-band `error: string` — not a fifth place restating the same idea
// (MEMORY.md "Duplicated definitions fail silently").

export type UpstreamSource = "smartsheet" | "cloudbeds" | "elise";

/** Matches "SOME_ENV_VAR is not set" / "is not configured" — the shape every
 *  "no credential present" message in this repo uses (lib/smartsheet.ts,
 *  lib/contractor-schedule.ts). Deliberately broad rather than an exact string
 *  match, so a new "X_TOKEN is not set" message written later is still caught. */
const NOT_CONFIGURED_PATTERN = /is not (set|configured)/i;

const LABEL: Record<UpstreamSource, string> = {
  smartsheet: "Smartsheet",
  cloudbeds: "Cloudbeds",
  elise: "EliseAI",
};

/**
 * Map a raw upstream error string to a short, safe sentence. The raw text is
 * logged server-side (recoverable from Vercel logs) but never returned —
 * only ONE of two fixed sentences per source ever reaches the caller, so
 * there is no way for an env-var name, a connection string, a stack trace or
 * an internal path to ride along inside it.
 */
export function mapUpstreamError(source: UpstreamSource, raw: string | null | undefined): string {
  if (!raw) return `${LABEL[source]} did not respond.`;
  console.error(`[mcp] ${source} error:`, raw);
  return NOT_CONFIGURED_PATTERN.test(raw)
    ? `${LABEL[source]} is not configured for this dashboard.`
    : `${LABEL[source]} is not reachable right now.`;
}
