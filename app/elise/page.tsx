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
          views <code className="rounded bg-surface3 px-1">PROSPECT_EVENTS_RISE8</code> (funnel) and{" "}
          <code className="rounded bg-surface3 px-1">PROSPECTS_RISE8</code> (current pipeline).
        </li>
        <li>
          Funnel = <code className="rounded bg-surface3 px-1">COUNT(*)</code> of events grouped by building,{" "}
          <code className="rounded bg-surface3 px-1">EVENT_DATETIME::DATE</code>, and{" "}
          <code className="rounded bg-surface3 px-1">EVENT_TYPE</code>. No de-duplication; no{" "}
          <code className="rounded bg-surface3 px-1">is_interest</code>/<code className="rounded bg-surface3 px-1">is_ignored</code>/spam
          filtering.
        </li>
        <li>
          Stage mapping: prospect → Leads, prospect_engaged → Engaged, tour_booked → Tours booked, tour_attended → Tours
          attended, application_started → Apps started, application_approved → Apps approved, lease_completed → Leased,
          prospect_canceled → Cancelled.
        </li>
        <li>
          Day bucketing uses <code className="rounded bg-surface3 px-1">EVENT_DATETIME::DATE</code> (a{" "}
          <code className="rounded bg-surface3 px-1">TIMESTAMP_NTZ</code>, not converted to Eastern) — totals near
          midnight may differ by ~1 day from a property-local dashboard.
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
