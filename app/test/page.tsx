import IntakeForm from "@/components/IntakeForm";
import { PageHead } from "@/components/ui";
import { CATALOG_BY_CATEGORY } from "@/config/catalog-sample";

// Public, no PIN (excluded in middleware matcher). Fully static — no Cloudbeds
// calls, no env needed to render. Sample values only (watermarked SAMPLE).
export const dynamic = "force-static";

export default function TestPage() {
  return (
    <main className="mx-auto max-w-[1120px] animate-fadeup px-4 pb-16 pt-5 sm:px-6">
      <PageHead
        eyebrow="Stayable · Dashboard Requirements"
        title="Tell us what to put on your dashboard"
        sub="Browse the available metrics, pick the ones your team needs, and submit. No login required."
      />

      <div className="mt-4 rounded-[10px] border border-warn/40 bg-warnbg px-4 py-3 text-[12.5px] text-warn">
        Please submit your selections within <span className="font-semibold">24 hours</span> if you can.
        The form stays open — there is no hard deadline.
      </div>

      <div className="mb-4 mt-3 rounded-[10px] border border-line bg-surface2 px-4 py-3 text-[12.5px] leading-relaxed text-txt2">
        <span className="font-semibold text-txt">Note:</span> not every metric below will appear on
        your final dashboard. Availability depends on your role and permissions — some of these will be
        hidden or removed depending on who you are. Pick what you&apos;d find useful; we&apos;ll scope the
        live view to what your role is allowed to see.
      </div>

      <IntakeForm groups={CATALOG_BY_CATEGORY} />

      <p className="mt-8 text-xs text-txt3">
        All values on this page are SAMPLE data for illustration only — not live Cloudbeds figures. No guest
        personal data is shown anywhere on this site.
      </p>
    </main>
  );
}
