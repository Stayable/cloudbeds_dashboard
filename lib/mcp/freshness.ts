// One definition of "how current is this", attached to every tool result.
//
// This is the most important property in the MCP surface (spec §7). A model
// handed a bare number will state it as today's, confidently, and there is no
// page around the answer to carry a caveat the way the dashboard has. The
// `note` is written as a sentence precisely so the model can quote it.

import { getFinalThrough, getSnapshotFreshness, type EliseSyncStatus } from "@/lib/db";
import { eliseBanner } from "@/lib/elise-status";
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

/** Reuses the SAME wording the dashboard shows for a failing sync (`eliseBanner`
 *  in lib/elise-status.ts), so Rob is never told one thing in chat and another
 *  on /ops. `eliseBanner.headline` carries the short "Leasing data is not
 *  updating."/"...has never synced." sentence; `.note` carries the longer
 *  credential-specific detail (BLOCKED_NOTE). We fold `headline` in verbatim
 *  rather than re-deriving our own wording for the same fact. */
export function describeElise(status: EliseSyncStatus, nowIso: string): Freshness {
  const banner = eliseBanner(status, nowIso);

  // Nothing has ever synced: there is no "newest data we hold" to date-stamp.
  if (!status.lastSuccessAt) {
    return {
      source: "elise",
      asOf: null,
      note: `${banner.headline} There are no leasing figures to report.`,
    };
  }

  // A failing (or never-run-since-last-success) sync: state the failure AND
  // how old the data we are about to quote actually is. This is the case the
  // whole module exists for — the numbers are real but stale, and nothing in
  // a chat reply would otherwise say so.
  if (status.lastAttemptOk === false) {
    return {
      source: "elise",
      asOf: status.lastSuccessAt,
      note: `${banner.headline} The newest leasing data on hand is from ${status.lastSuccessAt}. ${banner.note ?? ""}`.trim(),
    };
  }

  // Healthy: last attempt succeeded, data is current as of that sync.
  return {
    source: "elise",
    asOf: status.lastSuccessAt,
    note: `Leasing data last synced from EliseAI at ${status.lastSuccessAt}.`,
  };
}

export function smartsheetFreshness(nowIso: string): Freshness {
  return {
    source: "smartsheet",
    asOf: nowIso,
    note: `Read live from Smartsheet at ${nowIso}.`,
  };
}
