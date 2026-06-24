import IntakeForm from "@/components/IntakeForm";
import { CATALOG_BY_CATEGORY } from "@/config/catalog-sample";

// Public, no PIN (excluded in middleware matcher). Fully static — no Cloudbeds
// calls, no env needed to render. Sample values only (watermarked SAMPLE).
export const dynamic = "force-static";

export default function TestPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 rounded-xl bg-ink px-5 py-4 text-white shadow-sm sm:mb-8 sm:px-6 sm:py-5">
        <p className="text-xs font-medium uppercase tracking-widest text-white/60">
          Stayable · Dashboard Requirements
        </p>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Tell us what to put on your dashboard</h1>
        <p className="mt-1 text-sm text-white/70">
          Browse the available metrics, pick the ones your team needs, and submit. No login required.
        </p>
      </header>

      <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Please submit your selections within <span className="font-semibold">24 hours</span> if you can.
        The form stays open — there is no hard deadline.
      </div>

      <IntakeForm groups={CATALOG_BY_CATEGORY} />

      <p className="mt-8 text-xs text-slate-400">
        All values on this page are SAMPLE data for illustration only — not live Cloudbeds figures. No guest
        personal data is shown anywhere on this site.
      </p>
    </main>
  );
}
