import { PageHead } from "@/components/ui";
import SectionNav, { type NavItem } from "@/components/SectionNav";
import ChangePin from "@/components/ChangePin";
import BeaOosExplorer, { type BeaProperty } from "@/components/BeaOosExplorer";
import ExportMenu from "@/components/ExportMenu";
import { getPortfolio, getPortfolioOoo } from "@/lib/cloudbeds";
import { buildMatrix, exportFilename } from "@/lib/export";
import { easternToday } from "@/lib/dates";

// Bea (Ops Support) — tailored to her two selections: out-of-service rooms and
// property local time. Gated to the bea level (BEA_PIN) OR exec/CEO.
export const dynamic = "force-dynamic";

const NAV: NavItem[] = [
  { id: "oos", label: "Out of service", n: 1 },
  { id: "localtime", label: "Local time", n: 2 },
];

// Section header. The step number ties back to the numbered rail on the left.
function SectionHeading({ n, title, sub }: { n: number; title: string; sub: string }) {
  return (
    <div className="mb-3.5 flex items-start gap-2.5 border-b border-line pb-3">
      <span className="mt-1 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] bg-surface3 text-[10px] font-semibold text-txt3">
        {n}
      </span>
      <div>
        <h2 className="text-[19px] font-semibold tracking-[-.02em] text-txt">{title}</h2>
        <p className="mt-[3px] text-[12.5px] text-txt3">{sub}</p>
      </div>
    </div>
  );
}

export default async function BeaPage() {
  const asOf = easternToday();
  const [portfolio, ooo] = await Promise.all([getPortfolio(), getPortfolioOoo(asOf)]);

  const oooByCode = new Map(ooo.map((o) => [o.property.code, o]));
  const rows = portfolio.map((pd) => {
    const d = pd.result?.ok ? pd.result.data : null;
    const o = oooByCode.get(pd.property.code);
    const oooRooms = o?.result?.ok ? o.result.data : null;
    return {
      id: pd.property.id,
      code: pd.property.code,
      name: pd.property.name,
      county: pd.property.county,
      configured: pd.configured,
      oooRooms, // OooRoom[] | null
      oooError: o?.result && !o.result.ok ? o.result.error : null,
      localTime: d ? d.property_now : null,
      tz: d ? d.timezone : null,
    };
  });
  const oosProps: BeaProperty[] = rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    county: r.county,
    configured: r.configured,
    rooms: r.oooRooms,
    error: r.oooError,
  }));

  const localTimeMatrix = buildMatrix<(typeof rows)[number]>(
    [
      { header: "Property", value: (r) => r.name },
      { header: "Local time", value: (r) => r.localTime ?? "" },
      { header: "Time zone", value: (r) => r.tz ?? "" },
    ],
    rows,
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <PageHead
        eyebrow="Stayable · Operations Support"
        title={<>Bea&apos;s View</>}
        sub={<>Out-of-service rooms and current property time — live.</>}
      />

      <div className="mt-4 lg:flex lg:items-start lg:gap-[18px]">
        <SectionNav items={NAV} />

        <div className="min-w-0 flex-1">
          <section id="oos" className="mb-10 scroll-mt-32 lg:scroll-mt-28">
            <SectionHeading n={1} title="Out-of-service rooms" sub="Live · pick a property → reasons, then rooms" />
            <BeaOosExplorer properties={oosProps} asOf={asOf} />
          </section>

          <section id="localtime" className="mb-10 scroll-mt-32 lg:scroll-mt-28">
            <div className="flex items-start justify-between gap-3">
              <SectionHeading n={2} title="Property local time" sub="Live · current time at each property" />
              <ExportMenu
                filename={exportFilename("LocalTime", null, asOf)}
                title="Property local time"
                matrix={localTimeMatrix}
              />
            </div>
            <div className="overflow-x-auto rounded-[10px] border border-line bg-surface shadow-card">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="bg-chrome text-left text-[10px] font-semibold uppercase tracking-[.07em] text-white/70">
                    <th className="px-4 py-3 font-semibold">Property</th>
                    <th className="px-4 py-3 font-semibold">Local time</th>
                    <th className="px-4 py-3 font-semibold">Time zone</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.code} className="border-t border-line">
                      <td className="px-4 py-3 font-medium text-txt">{r.name}</td>
                      <td className="px-4 py-3 text-txt">
                        {r.localTime ?? <span className="text-txt3">awaiting key</span>}
                      </td>
                      <td className="px-4 py-3 text-txt2">{r.tz ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="mb-6 text-xs text-txt3">
            Live, read-only · cached up to 10 min. Out-of-service rooms are blocks active today;
            room numbers are inventory only (no guest data). Only properties with a configured
            Cloudbeds key report (Davenport today).
          </p>

          <ChangePin />
        </div>
      </div>
    </main>
  );
}
