// Pure, deterministic template-based observations for the four ops category
// PDFs (Occupancy, Leasing, Reviews, OOO). No I/O -- callers pass in views
// already built by lib/occupancy.ts (buildOccProperties), lib/leasing.ts
// (buildLeasingViews), lib/reviews.ts (buildReviewsView), and
// lib/cloudbeds.ts (getPortfolioOoo). Numbers are formatted through
// lib/ops-pdf-kit's pct/int so the strings read consistently with the tables
// they sit beside. Every function guards empty input and returns a single
// friendly string instead of throwing.
import type { OccProperty } from "@/components/OccupancyView";
import { displayOcc } from "@/lib/occupancy";
import { STAGE, type LeasingView } from "@/lib/leasing";
import type { ReviewsView } from "@/lib/reviews";
import { summarizeOoo, type PropertyOoo } from "@/lib/cloudbeds";
import { pct, int } from "@/lib/ops-pdf-kit";

const LOW_OCC_THRESHOLD = 65; // percent -- OccProperty occupancy fields are 0-100, not fractions
const OOO_DRAG_THRESHOLD = 0.1; // fraction of capacity out of service
const UNSPECIFIED_REASON = "Unspecified";

/** The displayed occupancy %. Single definition in lib/occupancy.ts — this was
 *  a third copy of the same formula and they drifted; see displayOcc(). */
const effOcc = displayOcc;

/** Occupancy leader/laggard, sub-threshold flags, OOO-drag flags, and the
 *  capacity-weighted portfolio occupancy. Excludes properties flagged
 *  `excludeDefault` (matches the dashboard's default portfolio average) and
 *  properties with no reading for the period. */
export function occupancyInsights(props: OccProperty[]): string[] {
  const eligible = props.filter((p) => !p.excludeDefault && effOcc(p) !== null);
  if (eligible.length === 0) return ["No occupancy data for this period."];

  const out: string[] = [];
  const ranked = [...eligible].sort((a, b) => (effOcc(b) ?? 0) - (effOcc(a) ?? 0));
  const leader = ranked[0];
  const laggard = ranked[ranked.length - 1];

  out.push(`${leader.name} leads the portfolio at ${pct((effOcc(leader) ?? 0) / 100)} occupancy.`);
  if (laggard.code !== leader.code) {
    out.push(`${laggard.name} trails the portfolio at ${pct((effOcc(laggard) ?? 0) / 100)} occupancy.`);
  }

  for (const p of eligible.filter((p) => (effOcc(p) ?? 0) < LOW_OCC_THRESHOLD)) {
    out.push(
      `${p.name} is below the ${LOW_OCC_THRESHOLD}% occupancy target at ${pct((effOcc(p) ?? 0) / 100)}.`,
    );
  }

  for (const p of eligible) {
    if (!p.live) continue;
    const cap = p.live.capacity || p.capacity;
    if (!cap) continue;
    const oooShare = p.live.outOfService / cap;
    if (oooShare > OOO_DRAG_THRESHOLD) {
      out.push(
        `${p.name} has ${int(p.live.outOfService)} rooms out of order (${pct(oooShare)} of capacity) -- an occupancy drag.`,
      );
    }
  }

  let num = 0;
  let den = 0;
  for (const p of eligible) {
    const occ = effOcc(p);
    if (occ === null || p.capacity <= 0) continue;
    const eff = Math.max(0, p.capacity + p.adjustment);
    num += occ * eff;
    den += eff;
  }
  if (den > 0) out.push(`Portfolio weighted occupancy: ${pct(num / den / 100)}.`);

  return out;
}

/** Best/worst lead-to-lease conversion, stalled funnels (leads with zero
 *  leases), the property with the most cancellations, and the portfolio
 *  lead-to-lease rate (from the "ALL" view). */
export function leasingInsights(views: LeasingView[]): string[] {
  const perProperty = views.filter((v) => v.key !== "ALL");
  const all = views.find((v) => v.key === "ALL");
  if (perProperty.length === 0 && !all) return ["No leasing data for this period."];

  const out: string[] = [];

  const withRate = perProperty.filter((v) => v.leadToLease !== null);
  if (withRate.length > 0) {
    const ranked = [...withRate].sort((a, b) => (b.leadToLease ?? 0) - (a.leadToLease ?? 0));
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    out.push(`${best.label} converts leads to leases best at ${pct((best.leadToLease ?? 0) / 100)}.`);
    if (worst.key !== best.key) {
      out.push(`${worst.label} converts leads to leases worst at ${pct((worst.leadToLease ?? 0) / 100)}.`);
    }
  }

  for (const v of perProperty) {
    const leads = v.stages.find((s) => s.key === STAGE.leads)?.n ?? 0;
    const leased = v.stages.find((s) => s.key === STAGE.leased)?.n ?? 0;
    if (leads > 0 && leased === 0) {
      out.push(`${v.label} has ${int(leads)} leads and zero leases this period -- stalled funnel.`);
    }
  }

  const withCancels = perProperty.filter((v) => v.cancelled > 0);
  if (withCancels.length > 0) {
    const top = [...withCancels].sort((a, b) => b.cancelled - a.cancelled)[0];
    out.push(`${top.label} has the most cancellations at ${int(top.cancelled)}.`);
  }

  if (all && all.leadToLease !== null) {
    out.push(`Portfolio lead-to-lease conversion: ${pct(all.leadToLease / 100)}.`);
  }

  return out.length > 0 ? out : ["No leasing data for this period."];
}

/** Property with the most 1-star reviews, unaddressed-response count, and the
 *  trend vs the prior equal-length window. */
export function reviewsInsights(view: ReviewsView): string[] {
  if (view.total === 0 && view.priorTotal === 0 && view.byProperty.length === 0) {
    return ["No 1-star review data for this period."];
  }

  const out: string[] = [];

  const top = view.byProperty.find((p) => p.count > 0);
  if (top) {
    out.push(`${top.property} has the most 1-star reviews this period (${int(top.count)}).`);
  }

  const unaddressed = view.total - view.responded;
  if (unaddressed > 0) {
    out.push(`${int(unaddressed)} of ${int(view.total)} 1-star reviews have no manager response.`);
  } else if (view.total > 0) {
    out.push(`All ${int(view.total)} 1-star reviews this period have a manager response.`);
  }

  if (view.total > view.priorTotal) {
    out.push(`1-star reviews are up vs the prior period (${int(view.total)} vs ${int(view.priorTotal)}).`);
  } else if (view.total < view.priorTotal) {
    out.push(`1-star reviews are down vs the prior period (${int(view.total)} vs ${int(view.priorTotal)}).`);
  } else {
    out.push(`1-star reviews are flat vs the prior period (${int(view.total)}).`);
  }

  return out;
}

function totalBlockedCount(p: PropertyOoo): number {
  return p.result?.ok ? p.result.data.length : 0;
}

/** Property with the most TOTAL blocked rooms (Out-of-Order + Other combined
 *  -- not just the out_of_service subset), the portfolio Out-of-Order-vs-Other
 *  split, and the top block reason (across every category). Only properties
 *  with a successful blocks read are considered.
 *
 *  Reworked for the OOO-vs-Other breakdown (Kyle's decision,
 *  ooo-breakdown-brief.md): the dashboard used to under-report vs ops (Bea)
 *  because it only counted out_of_service blocks. "Most blocked" now ranks by
 *  TOTAL so a property with many "other" blocks (e.g. owner holds) still
 *  surfaces, and a dedicated line reconciles the OOO/Other split. */
export function oooInsights(ooo: PropertyOoo[]): string[] {
  const withData = ooo.filter((p) => p.configured && p.result?.ok);
  if (withData.length === 0) return ["No out-of-order data for this period."];

  const out: string[] = [];

  const ranked = [...withData].sort((a, b) => totalBlockedCount(b) - totalBlockedCount(a));
  const top = ranked[0];
  if (totalBlockedCount(top) > 0) {
    out.push(`${top.property.name} has the most blocked rooms (${int(totalBlockedCount(top))}).`);
  }

  let portfolioOoo = 0;
  let portfolioOther = 0;
  for (const p of withData) {
    if (!p.result?.ok) continue;
    const s = summarizeOoo(p.result.data);
    portfolioOoo += s.ooo;
    portfolioOther += s.other;
  }
  out.push(
    `Portfolio total blocked rooms: ${int(portfolioOoo + portfolioOther)} (${int(portfolioOoo)} out-of-order, ${int(portfolioOther)} other blocks).`,
  );

  const reasonCounts = new Map<string, number>();
  for (const p of withData) {
    if (!p.result?.ok) continue;
    for (const room of p.result.data) {
      const trimmed = room.reason?.trim();
      const reason = trimmed && trimmed !== "—" ? trimmed : UNSPECIFIED_REASON;
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }
  if (reasonCounts.size > 0) {
    const [topReason, topReasonCount] = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    out.push(`Top block reason: ${topReason} (${int(topReasonCount)} rooms).`);
  }

  return out;
}
