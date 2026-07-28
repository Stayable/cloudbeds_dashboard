import type { ReactNode } from "react";

// The secondary band directly under the top chrome: the page's scope / period
// controls on the left, a freshness note on the right. Sticks below the 56px
// nav so the controls stay reachable while a long table scrolls.
//
// Pages compose it — there is no global scope state in this app; each surface
// owns its own filters (e.g. PeriodControls writes to the query string).
export default function ControlBar({
  children,
  note,
  standalone = false,
}: {
  children?: ReactNode;
  note?: ReactNode;
  /** Set on surfaces with no top chrome (the isolated /elise level), where the
   *  bar is the first thing on the page rather than sitting under the 56px nav. */
  standalone?: boolean;
}) {
  return (
    <div
      className={
        "sticky z-30 border-b border-line bg-surface " + (standalone ? "top-0" : "top-14")
      }
    >
      <div className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
        {children}
        {note && <div className="ml-auto text-[11.5px] text-txt3">{note}</div>}
      </div>
    </div>
  );
}

/** The 10.5px uppercase caption that labels a control group in the bar. */
export function ControlLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10.5px] font-semibold uppercase tracking-[.09em] text-txt3">
      {children}
    </span>
  );
}

/** Vertical hairline between control groups. */
export function ControlDivider() {
  return <span className="hidden h-[22px] w-px bg-line sm:block" />;
}
