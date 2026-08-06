import PeriodControls from "@/components/PeriodControls";
import ControlBar, { ControlLabel } from "@/components/ControlBar";
import { PageHead } from "@/components/ui";
import LeasingSection from "@/components/LeasingSection";
import { resolveRange, easternToday } from "@/lib/dates";
import { buildLeasingViews } from "@/lib/leasing";
import { getEliseFunnel, getElisePipeline, eliseFunnelConfigured } from "@/lib/db";

// Isolated EliseAI support view — leasing funnel + pipeline ONLY, as read from
// the Snowflake data share. Gated to the `elise` level (PIN in Neon
// dashboard_pins), which is FULLY ISOLATED (lib/auth.ts RESTRICTED_LEVELS): it
// reaches this route and nothing else in the app. No "← Dashboard" link — there
// is no dashboard to go back to at this level. Exists so EliseAI support can
// reconcile our numbers against their in-app dashboard; see the methodology
// note below for exactly how the rollup is computed.
export const dynamic = "force-dynamic";

function MethodologyNote() {
  return (
    <div className="rounded-[10px] border border-line bg-surface2 p-5 text-sm text-txt2">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-txt2">
        How these numbers are computed
      </p>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          Source: EliseAI Snowflake data share <code className="rounded bg-surface3 px-1">RISE8_DATA.DA</code> —
          views <code className="rounded bg-surface3 px-1">EVENTS_LEASING_RISE8</code> (funnel) and{" "}
          <code className="rounded bg-surface3 px-1">PROSPECTS_RISE8</code> (current pipeline). The funnel moved off{" "}
          <code className="rounded bg-surface3 px-1">PROSPECT_EVENTS_RISE8</code> on 08/07/26: EliseAI confirmed{" "}
          <code className="rounded bg-surface3 px-1">EVENTS_LEASING</code> is what their own Leasing Dashboard reads.
        </li>
        <li>
          Funnel = de-duplicated on{" "}
          <code className="rounded bg-surface3 px-1">(GLOBAL_SESSION_ID, EVENT_TYPE)</code> keeping the earliest event,
          then filtered to <code className="rounded bg-surface3 px-1">is_interest = false</code>, grouped by building,
          property-local day and <code className="rounded bg-surface3 px-1">EVENT_TYPE</code>. Raw rows are ~4.6× the
          de-duplicated count, so this is the whole difference between matching their dashboard and not.
        </li>
        <li>
          Stage mapping: state → Leads, first_lead_engagement → Engaged, tour_booked → Tours booked, tour_attended →
          Tours attended, lease_applied → Apps started, application_approved → Apps approved, lease_signed → Leased.
          Cancelled still comes from <code className="rounded bg-surface3 px-1">PROSPECT_EVENTS_RISE8</code>{" "}
          (prospect_canceled) because <code className="rounded bg-surface3 px-1">EVENTS_LEASING</code> carries no
          cancellation event.
        </li>
        <li>
          Day bucketing converts <code className="rounded bg-surface3 px-1">EVENT_DATETIME</code> (stored UTC) to{" "}
          <code className="rounded bg-surface3 px-1">America/New_York</code>, which is the local timezone of all eight
          properties — so a day here is the same day EliseAI shows.
        </li>
        <li>
          Verified 08/07/26 against EliseAI&apos;s own reference query: all seven stages match to the row for June 2026
          (1,863 leads · 781 engaged · 223 tours booked · 90 attended · 274 apps started · 146 approved · 146 signed).
        </li>
        <li>
          Known limits, measured rather than assumed:{" "}
          <code className="rounded bg-surface3 px-1">application_approved</code> and{" "}
          <code className="rounded bg-surface3 px-1">lease_signed</code> are always emitted together (671/671 all-time),
          so approved → signed carries no information; and tour attendance is under-recorded (1,660 booked vs 566
          attended all-time), which is why Tour → Lease is measured against tours <em>booked</em>.
        </li>
        <li>Refreshed nightly (~24h lag); this page reads a Neon rollup, not Snowflake live.</li>
      </ul>
    </div>
  );
}

export default async function ElisePage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; start?: string; end?: string }>;
}) {
  const sp = await searchParams;
  const { preset, start, end } = resolveRange(sp.preset, sp.start, sp.end);
  const asOf = easternToday();

  const [eliseFunnel, elisePipeline, eliseReady] = await Promise.all([
    getEliseFunnel(start, end),
    getElisePipeline(),
    eliseFunnelConfigured(),
  ]);

  const leasingViews = buildLeasingViews(eliseFunnel, elisePipeline);

  const rangeLabel = start === end ? start : `${start} → ${end}`;

  return (
    <>
      {/* This level has no top chrome (Nav self-hides for restricted levels), so
          the control bar sits at the very top of the viewport here. */}
      <ControlBar standalone note={`${rangeLabel} · Eastern`}>
        <ControlLabel>Period</ControlLabel>
        <PeriodControls preset={preset} start={start} end={end} />
      </ControlBar>

      <main className="mx-auto max-w-[1120px] animate-fadeup px-4 pb-16 pt-5 sm:px-6">
        <PageHead
          eyebrow="Stayable · EliseAI"
          title={<>EliseAI Leasing — Snowflake Data Share</>}
          sub={<>Funnel + pipeline as our dashboard reads it from the Snowflake share · Eastern presets</>}
        />

        <div className="mt-4">
          <LeasingSection configured={eliseReady} views={leasingViews} from={start} to={end} asOf={end} />
        </div>

        <div className="mt-4">
          <MethodologyNote />
        </div>

        <p className="mt-4 text-[11.5px] text-txt3">
          Aggregate-only · no guest PII · refreshed nightly.
        </p>
      </main>
    </>
  );
}
