// One definition of "how current is this", attached to every tool result.
//
// This is the most important property in the MCP surface (spec §7). A model
// handed a bare number will state it as today's, confidently, and there is no
// page around the answer to carry a caveat the way the dashboard has. The
// `note` is written as a sentence precisely so the model can quote it.

import { getFinalThrough, getSnapshotFreshness, type EliseSyncStatus } from "@/lib/db";
import { eliseBanner, formatWhen } from "@/lib/elise-status";
import { PROPERTIES } from "@/config/properties";
import type { Freshness } from "./types";

const ACTIVE_COUNT = PROPERTIES.filter((p) => p.active === true).length;

/** Pure half of snapshotFreshness, so the wording is testable without a DB. */
export function describeSnapshot(
  f: { latestCapturedDate: string | null; propertiesOnLatest: number },
  finalThrough: string | null,
): Freshness {
  if (!f.latestCapturedDate) {
    return {
      source: "snapshot",
      asOf: null,
      finalThrough,
      note: "No days have been captured yet, so there are no figures to report.",
    };
  }
  const partial =
    f.propertiesOnLatest > 0 && f.propertiesOnLatest < ACTIVE_COUNT
      ? ` Only ${f.propertiesOnLatest} of ${ACTIVE_COUNT} properties captured on that day, so it is incomplete.`
      : "";
  const final = finalThrough
    ? ` Figures through ${finalThrough} are final; later days can still move as the ledger settles.`
    : " No month has been closed yet, so every figure can still move.";
  return {
    source: "snapshot",
    asOf: f.latestCapturedDate,
    finalThrough,
    note: `Figures are from banked daily snapshots, last captured ${f.latestCapturedDate}.${partial}${final}`,
  };
}

export async function snapshotFreshness(): Promise<Freshness> {
  const [f, finalThrough] = await Promise.all([getSnapshotFreshness(), getFinalThrough()]);
  return describeSnapshot(f, finalThrough);
}

export function liveFreshness(nowIso: string): Freshness {
  return {
    source: "live",
    asOf: nowIso,
    note: `Read live from Cloudbeds right now (${nowIso}). This is today's state, not a banked figure.`,
  };
}

/** Reuses the SAME classification and wording the dashboard shows
 *  (`eliseBanner` in lib/elise-status.ts), so Rob is never told one thing in
 *  chat and another on /ops.
 *
 *  This switches on `banner.kind` and ONLY `banner.kind` — it does not
 *  re-derive "failing" / "stale" / "never" from the raw `status` fields.
 *  That re-derivation is exactly what broke here once already: a version
 *  that branched on `status.lastAttemptOk` / `status.lastSuccessAt` directly
 *  collapsed "never attempted" and "attempted, always failed" into one
 *  generic sentence (losing the reason — Critical 1) and let a `stale`
 *  status fall through to the healthy branch with no caveat at all
 *  (Critical 2). `eliseBanner` already did this classification; a second
 *  definition of it here can only drift from the first.
 *
 *  `banner.headline` is the dashboard's short sentence for the kind.
 *  `banner.note` (present for "never" and "failing") is the longer reason —
 *  currently the standing EliseAI credential block. It is appended in EVERY
 *  kind that has one, never dropped, because "why is it broken" is the
 *  question this module exists to answer alongside "is it broken". */
export function describeElise(status: EliseSyncStatus, nowIso: string): Freshness {
  const banner = eliseBanner(status, nowIso);

  switch (banner.kind) {
    // Never attempted at all. No data to date — `asOf` stays null.
    case "never":
      return {
        source: "elise",
        asOf: null,
        note: `${banner.headline} ${banner.note ?? ""}`.trim(),
      };

    // Failing now. `status.lastSuccessAt` may still be null here (it has
    // never once succeeded) or set (it broke after working) — `asOf` follows
    // whichever is true, and the reason is appended either way.
    case "failing":
      return {
        source: "elise",
        asOf: status.lastSuccessAt,
        note: status.lastSuccessAt
          ? `${banner.headline} The newest leasing data on hand is from ${formatWhen(status.lastSuccessAt, nowIso)}. ${banner.note ?? ""}`.trim()
          : `${banner.headline} ${banner.note ?? ""}`.trim(),
      };

    // Succeeded, but long enough ago that /ops would already be flagging it.
    // Chat must carry the same caveat instead of presenting old data as current.
    case "stale":
      return {
        source: "elise",
        asOf: status.lastSuccessAt,
        note: `${banner.headline} Last successful sync was ${formatWhen(status.lastSuccessAt ?? "", nowIso)}.`,
      };

    // Healthy: no caveat. A module that cries stale on fresh data gets ignored
    // the day it needs to be believed.
    case null:
      return {
        source: "elise",
        asOf: status.lastSuccessAt,
        note: `Leasing data last synced from EliseAI at ${formatWhen(status.lastSuccessAt ?? "", nowIso)}.`,
      };

    // Exhaustiveness check: a fifth `kind` added to eliseBanner must fail
    // `tsc` right here, not fall through and silently drop a caveat — which
    // is precisely how this module broke twice already.
    default: {
      const _exhaustive: never = banner.kind;
      return _exhaustive;
    }
  }
}

export function smartsheetFreshness(nowIso: string): Freshness {
  return {
    source: "smartsheet",
    asOf: nowIso,
    note: `Read live from Smartsheet at ${nowIso}.`,
  };
}
