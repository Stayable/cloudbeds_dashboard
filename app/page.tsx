import OccupancyView from "@/components/OccupancyView";
import PeriodControls from "@/components/PeriodControls";
import ZonesSection, { type ZoneProperty } from "@/components/ZonesSection";
import ControlBar, { ControlLabel } from "@/components/ControlBar";
import SectionNav, { type NavItem } from "@/components/SectionNav";
import { Bar, Label, MiniStat } from "@/components/ui";
import { dayCount, resolveRange } from "@/lib/dates";
import { getPortfolio, getPortfolioInsights, getPortfolioRooms } from "@/lib/cloudbeds";
import { buildOccProperties } from "@/lib/occupancy";
import { buildZoneGroups } from "@/lib/zones";
import { ZONE_CONFIG } from "@/config/zones";

const NAV: NavItem[] = [
  { id: "portfolio", label: "Portfolio", n: 1 },
  { id: "by-property", label: "By property", n: 2 },
  { id: "detail", label: "Detail", n: 3 },
  { id: "zones", label: "Zones", n: 4 },
];

// Render per-request so runtime env vars (CLOUDBEDS_API_KEY_*) are always read
// live — upstream Cloudbeds calls are still cached 10 min (Next data cache).
export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; start?: string; end?: string }>;
}) {
  const sp = await searchParams;
  const { preset, start, end } = resolveRange(sp.preset, sp.start, sp.end);

  const [portfolio, insights, rooms] = await Promise.all([
    getPortfolio(),
    getPortfolioInsights(start, end),
    getPortfolioRooms(end),
  ]);

  const properties = buildOccProperties(portfolio, insights);

  // Room inventory grouped into buildings/zones (ROOM-ZONING.md → config/zones.ts).
  const zoneProperties: ZoneProperty[] = rooms.map((pr): ZoneProperty => {
    const { property, configured, result } = pr;
    const base = { code: property.code, name: property.name, id: property.id };
    if (!configured || !result)
      return { ...base, configured: false, total: 0, occupiedTotal: 0, oooTotal: 0, groups: [] };
    if (!result.ok)
      return { ...base, configured: true, error: result.error, total: 0, occupiedTotal: 0, oooTotal: 0, groups: [] };
    const list = result.data;
    const groups = buildZoneGroups(list, ZONE_CONFIG[property.code] ?? []);
    return {
      ...base,
      configured: true,
      total: list.length,
      occupiedTotal: list.filter((r) => r.occupied && !r.ooo).length,
      oooTotal: list.filter((r) => r.ooo).length,
      groups,
    };
  });

  const reportingCount = properties.filter((p) => p.rawOcc !== null).length;
  const configuredCount = properties.filter((p) => p.configured).length;
  const days = dayCount(start, end);
  const rangeLabel = start === end ? start : `${start} → ${end}`;

  // Today's live portfolio snapshot (getDashboard) — always TODAY's figures
  // regardless of the selected occupancy range. `arrivals`/`departures` come
  // back as STRINGS per property; only properties that answered are summed, and
  // `props` records how many did, so the hero can state what it's based on.
  // OOO vs other blocks comes from roomBlocks (out_of_service vs blocked_dates)
  // — roomsBlocked is the combined figure.
  const today = portfolio.reduce(
    (acc, pd) => {
      if (!pd.result?.ok) return acc;
      const d = pd.result.data;
      const arrivals = parseInt(d.arrivals, 10);
      const departures = parseInt(d.departures, 10);
      return {
        arrivals: acc.arrivals + (Number.isFinite(arrivals) ? arrivals : 0),
        arrivalsConfirmed: acc.arrivalsConfirmed + (d.arrivalsConfirmed || 0),
        departures: acc.departures + (Number.isFinite(departures) ? departures : 0),
        stayovers: acc.stayovers + (d.stayovers || 0),
        inHouse: acc.inHouse + (d.inHouse || 0),
        guests: acc.guests + (d.guestsInHouse || 0),
        blocked: acc.blocked + (d.roomsBlocked || 0),
        ooo: acc.ooo + (d.roomBlocks?.out_of_service || 0),
        otherBlocks: acc.otherBlocks + (d.roomBlocks?.blocked_dates || 0),
        bookings: acc.bookings + (d.bookings || 0),
        // Real room count, not d.capacity — the dashboard aggregate over-reports
        // at some properties (see getPhysicalRoomCount).
        capacity: acc.capacity + (pd.physicalRooms?.count || d.capacity || 0),
        props: acc.props + 1,
      };
    },
    {
      arrivals: 0,
      arrivalsConfirmed: 0,
      departures: 0,
      stayovers: 0,
      inHouse: 0,
      guests: 0,
      blocked: 0,
      ooo: 0,
      otherBlocks: 0,
      bookings: 0,
      capacity: 0,
      props: 0,
    },
  );

  // Per-property share of today's arrivals, as the segmented bar under the hero
  // number. Properties with no arrivals contribute no segment.
  const arrivalSplit = portfolio
    .map((pd) => {
      if (!pd.result?.ok) return null;
      const n = parseInt(pd.result.data.arrivals, 10);
      if (!Number.isFinite(n) || n <= 0) return null;
      return { code: pd.property.code, name: pd.property.name, n };
    })
    .filter((x): x is { code: string; name: string; n: number } => x !== null);

  return (
    <>
      <ControlBar note={`${reportingCount} of ${configuredCount} properties reporting · Eastern`}>
        <ControlLabel>Period</ControlLabel>
        <PeriodControls preset={preset} start={start} end={end} />
      </ControlBar>

      <main className="mx-auto max-w-[1560px] animate-fadeup px-4 pb-16 pt-5 sm:px-6">
        {/* Live portfolio snapshot — today, pinned above the range-based views. */}
        <div className="mb-4 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr]">
          <div className="flex min-h-[150px] flex-col justify-between rounded-xl bg-chrome px-5 py-5 text-white shadow-card">
            <div className="text-[10.5px] font-semibold uppercase tracking-[.1em] text-[#7FA8DA]">
              Arrivals today · portfolio
            </div>
            <div className="mt-3 flex items-end gap-3.5">
              <div className="text-[56px] font-semibold leading-[.9] tracking-[-.03em]">
                {today.arrivals}
              </div>
              <div className="pb-2 text-[12.5px] leading-snug text-[#9FC2E8]">
                {today.departures} departures
                <br />
                {today.stayovers} stayovers
              </div>
            </div>
            <div className="mt-4 flex h-1.5 gap-1.5">
              {arrivalSplit.length === 0 ? (
                <div className="h-1.5 flex-1 rounded-full bg-white/10" />
              ) : (
                arrivalSplit.map((s) => (
                  <div
                    key={s.code}
                    title={`${s.name}: ${s.n} arrivals`}
                    className="h-1.5 rounded-full bg-accent"
                    style={{ flex: s.n }}
                  />
                ))
              )}
            </div>
            <div className="mt-2.5 text-[11px] text-[#6E96C9]">
              {today.arrivalsConfirmed} confirmed · {today.props} of {configuredCount} properties
              answered
            </div>
          </div>

          <div className="flex min-h-[150px] flex-col justify-between rounded-xl border border-line bg-surface px-5 py-5 shadow-card">
            <Label>Rooms in house · today</Label>
            <div className="mt-3 flex items-end gap-3">
              <div className="text-[52px] font-semibold leading-[.9] tracking-[-.03em] text-txt">
                {today.inHouse}
              </div>
              <div className="pb-2 text-[12.5px] leading-snug text-txt2">
                {today.guests} guests
                <br />
                {today.bookings} booked today
              </div>
            </div>
            <div className="mt-3.5">
              <Bar
                pct={today.capacity > 0 ? (today.inHouse / today.capacity) * 100 : null}
                tone="bg-accent"
                height={8}
              />
              <div className="mt-2 flex justify-between text-[11.5px] text-txt2">
                <span>
                  {today.inHouse} of {today.capacity} rooms
                </span>
                <span>{today.blocked} blocked</span>
              </div>
            </div>
          </div>

          <div className="min-h-[150px] rounded-xl border border-line bg-surface px-5 py-5 shadow-card">
            <Label className="mb-3.5">Portfolio at a glance</Label>
            <div className="grid grid-cols-2 gap-x-2.5 gap-y-3.5">
              <MiniStat label="ROOMS OUT OF ORDER" value={today.ooo} />
              <MiniStat label="OTHER BLOCKS" value={today.otherBlocks} />
              <MiniStat label="TOTAL INVENTORY" value={today.capacity} />
              <MiniStat label="PROPERTIES LIVE" value={`${today.props} / ${properties.length}`} />
            </div>
          </div>
        </div>

        <div className="mb-3 text-xs text-txt3">
          Occupancy below is the daily average over {rangeLabel} · {days} day
          {days === 1 ? "" : "s"} · Eastern. The snapshot cards above are always today&apos;s.
        </div>

        <div className="lg:flex lg:gap-[18px]">
          <SectionNav items={NAV} />
          <div className="min-w-0 flex-1 space-y-6">
            <OccupancyView properties={properties} exportDate={end} />
            <ZonesSection properties={zoneProperties} exportDate={end} />
          </div>
        </div>

        <p className="mt-6 text-[11.5px] leading-relaxed text-txt3">
          Occupancy is the daily average over the selected range (Cloudbeds Data Insights).
          Aggregated metrics only · no guest PII · read-only · cached up to 10 min.
        </p>
      </main>
    </>
  );
}
