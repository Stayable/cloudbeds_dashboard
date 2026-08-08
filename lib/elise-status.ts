// Turns a stored EliseAI sync status into the banner the dashboard shows.
//
// WHY THIS IS A PURE FUNCTION AND NOT A HARDCODED STRING IN THE COMPONENT:
// commit 1fac49f made the /ops §2 empty-stage warning data-driven precisely so it
// would "clear itself as soon as a sync repopulates the stages rather than
// becoming a stale hardcoded banner." Kyle asked (08/08/26) for the dashboard to
// state the error AND that we are waiting on EliseAI — which is exactly the kind
// of sentence that decision was guarding against, because it stays on screen,
// confidently wrong, long after they reply.
//
// The resolution: the human sentence lives in BLOCKED_NOTE, and it is rendered
// ONLY while the stored status says the last attempt failed. A successful sync
// makes the whole banner — note included — disappear with no code change. The
// hardcoded text physically cannot outlive its truth.
import type { EliseSyncStatus } from "@/lib/db";

/** The one human-authored sentence. Everything else in the banner is derived.
 *  `since` exists so the banner can say how long we have been waiting rather
 *  than implying the block is fresh. Update or delete this when the situation
 *  changes; it is inert whenever syncs are succeeding. */
export const BLOCKED_NOTE = {
  since: "2026-08-07",
  note: "Waiting on EliseAI for a new Snowflake credential — the reader account's password was rejected and the account had been temporarily locked by repeated failed logins, so the nightly sync is disabled until a working password is in hand.",
} as const;

export type EliseBanner = {
  /** "failing" = last attempt errored · "never" = nothing has ever run ·
   *  "stale" = last attempt succeeded but the data is old · null = healthy. */
  kind: "failing" | "never" | "stale" | null;
  headline: string;
  /** Derived detail lines — last success, the raw error, how many nights. */
  details: string[];
  /** The human note, present only when `kind === "failing"` or `"never"`. */
  note: string | null;
};

/** Whole UTC CALENDAR days between two timestamps — deliberately not elapsed
 *  hours floored.
 *
 *  A sync at 08/06 17:07 read at 08/08 17:00 is 1.99 elapsed days, which floors
 *  to "1 day ago" and UNDERSTATES how old the data is. For a staleness warning
 *  the safe direction is to overstate, and calendar days are also how people
 *  actually speak: two dates have passed, so it is "2 days ago". The cost is that
 *  a sync three hours ago that crossed midnight UTC also reads "1 day ago" —
 *  accepted, because erring toward "older than you think" is the point.
 *
 *  Exported because "2 days ago" vs "1 day ago" is the part readers act on. */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  const dayOf = (ms: number) => Math.floor(ms / 86_400_000); // UTC midnight index
  return Math.max(0, dayOf(to) - dayOf(from));
}

/** Format a timestamp for display, in UTC.
 *
 *  PARSES rather than slices. Slicing assumes ISO input, and this fed on a value
 *  that arrives from Neon as a JS Date — `String(date)` is
 *  "Sun Aug 09 2026 00:50:00 GMT+0800", which sliced to "Sun Aug 09 2026  UTC"
 *  and leaked local time. `lib/db.ts` now normalises at the boundary; this
 *  parses anyway, so a future caller passing a raw Date string cannot
 *  reintroduce the same wrong output. Exported for that regression test. */
export function formatWhen(ts: string, nowIso: string): string {
  const parsed = new Date(ts);
  const stamp = Number.isNaN(parsed.getTime())
    ? "unknown time"
    : parsed.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const d = daysBetween(ts, nowIso);
  if (d === 0) return `${stamp} (today)`;
  return `${stamp} (${d} day${d === 1 ? "" : "s"} ago)`;
}

const when = formatWhen;

/** Snowflake error text is long and carries a request UUID that means nothing to
 *  a reader. Keep the first sentence, drop the bracketed correlation id. */
export function tidyError(error: string): string {
  const noId = error.replace(/\s*\[[0-9a-f-]{16,}\]\s*$/i, "").trim();
  const firstSentence = noId.split(/(?<=\.)\s/)[0] ?? noId;
  return firstSentence.length > 200 ? firstSentence.slice(0, 197) + "…" : firstSentence;
}

/**
 * Compose the banner. `staleAfterDays` only applies to the healthy-but-old case;
 * a failing sync is always reported regardless of age.
 *
 * Returns `kind: null` when there is nothing to say — the caller renders nothing.
 */
export function eliseBanner(
  status: EliseSyncStatus,
  nowIso: string,
  staleAfterDays = 2,
): EliseBanner {
  const noteLine = `${BLOCKED_NOTE.note} (since ${BLOCKED_NOTE.since})`;

  // Nothing has ever run. Distinct from failing: there is no error to show, and
  // "no data yet" is a different problem from "data stopped arriving".
  if (status.lastAttemptAt === null) {
    return {
      kind: "never",
      headline: "Leasing data has never synced.",
      details: ["No sync attempt has been recorded."],
      note: noteLine,
    };
  }

  if (status.lastAttemptOk === false) {
    const details = [`Last attempt ${when(status.lastAttemptAt, nowIso)} — failed.`];
    details.push(
      status.lastSuccessAt
        ? `Newest data we hold is from the last successful sync, ${when(status.lastSuccessAt, nowIso)}.`
        : "No sync has ever succeeded, so there is no data behind this section.",
    );
    if (status.lastError) details.push(`Reported error: ${tidyError(status.lastError)}`);
    if (status.consecutiveFailures > 1) {
      details.push(`${status.consecutiveFailures} consecutive failed attempts — this is not a one-off blip.`);
    }
    return {
      kind: "failing",
      headline: "Leasing data is not updating.",
      details,
      note: noteLine,
    };
  }

  // Last attempt succeeded. Only speak up if what we hold has gone old — and say
  // nothing about credentials, because nothing is wrong with them.
  if (status.lastSuccessAt && daysBetween(status.lastSuccessAt, nowIso) > staleAfterDays) {
    return {
      kind: "stale",
      headline: "Leasing data may be out of date.",
      details: [`Last successful sync ${when(status.lastSuccessAt, nowIso)}.`],
      note: null,
    };
  }

  return { kind: null, headline: "", details: [], note: null };
}
