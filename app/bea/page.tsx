import Link from "next/link";
import SectionNav, { type NavItem } from "@/components/SectionNav";
import ChangePin from "@/components/ChangePin";
import BeaOosExplorer, { type BeaProperty } from "@/components/BeaOosExplorer";
import { getPortfolio, getPortfolioOoo } from "@/lib/cloudbeds";
import { easternToday } from "@/lib/dates";

// Bea (Ops Support) — tailored to her two selections: out-of-service rooms and
// property local time. Gated to the bea level (BEA_PIN) OR exec/CEO.
export const dynamic = "force-dynamic";

const NAV: NavItem[] = [
  { id: "oos", label: "Out of service", n: 1 },
  { id: "localtime", label: "Local time", n: 2 },
];

function SectionHeading({ n, title, sub }: { n: number; title: string; sub: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
        {n}
      </span>
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-500">{sub}</p>
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
    code: r.code,
    name: r.name,
    county: r.county,
    configured: r.configured,
    rooms: r.oooRooms,
    error: r.oooError,
  }));

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 rounded-xl bg-ink px-5 py-4 text-white shadow-sm sm:mb-8 sm:px-6 sm:py-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-widest text-white/60">
            Stayable · Operations Support
          </p>
          <Link
            href="/"
            className="shrink-0 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/20"
          >
            ← Dashboard
          </Link>
        </div>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Bea&apos;s View</h1>
        <p className="mt-1 text-sm text-white/70">
          Out-of-service rooms and current property time — live.
        </p>
      </header>

      <div className="lg:flex lg:gap-8">
        <SectionNav items={NAV} />

        <div className="min-w-0 flex-1">
          <section id="oos" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading n={1} title="Out-of-service rooms" sub="Live · pick a property → reasons, then rooms" />
            <BeaOosExplorer properties={oosProps} />
          </section>

          <section id="localtime" className="mb-10 scroll-mt-20 lg:scroll-mt-6">
            <SectionHeading n={2} title="Property local time" sub="Live · current time at each property" />
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="bg-ink text-left text-xs uppercase tracking-wide text-white/70">
                    <th className="px-4 py-3 font-medium">Property</th>
                    <th className="px-4 py-3 font-medium">Local time</th>
                    <th className="px-4 py-3 font-medium">Time zone</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.code} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-medium text-slate-900">{r.name}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {r.localTime ?? <span className="text-slate-400">awaiting key</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{r.tz ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="mb-6 text-xs text-slate-400">
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
