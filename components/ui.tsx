// Shared UI primitives for the Stayable Operating Dashboard.
//
// Transcribed from the design source ("Property management dashboard system/
// Stayable Operating Dashboard.dc.html") so the sizes, weights, radii and
// spacing are the design's, not re-invented per page. Everything here is a
// SERVER component (no "use client") — client pages can still render them.
//
// Rules of the system:
//   • one card elevation (shadow-card), one card radius (rounded-[10px]/[12px])
//   • labels are 10.5px, uppercase, tracking-[.08em], txt3, semibold
//   • numbers are 27px/semibold in a KPI, 21px in a mini stat, tabular
//   • deltas are always chips — colour carries good/bad, never the number alone
//   • status colour is a function of occupancy, defined once in `occColor`

import type { ReactNode } from "react";

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */

export function Card({
  children,
  className = "",
  as: Tag = "div",
  id,
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section";
  /** Set when the card is also a scroll anchor for SectionNav. */
  id?: string;
}) {
  return (
    <Tag id={id} className={`rounded-[10px] border border-line bg-surface shadow-card ${className}`}>
      {children}
    </Tag>
  );
}

/** Card header strip — title + optional hint, divided from the body. */
export function CardHead({
  title,
  hint,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3.5">
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold tracking-[-.01em] text-txt">{title}</div>
        {hint && <div className="mt-0.5 text-[11.5px] text-txt3">{hint}</div>}
      </div>
      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </div>
  );
}

/** The 10.5px uppercase label used above every number in the system. */
export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3 ${className}`}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chips — the only way a delta is shown                                      */
/* -------------------------------------------------------------------------- */

export type ChipTone = "pos" | "neg" | "flat";

const CHIP_TONE: Record<ChipTone, string> = {
  pos: "text-pos bg-posbg",
  neg: "text-neg bg-negbg",
  flat: "text-txt2 bg-surface2",
};

export function Chip({
  tone = "flat",
  children,
  className = "",
}: {
  tone?: ChipTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-[5px] px-[7px] py-0.5 text-[11px] font-semibold ${CHIP_TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Percent-change chip: ▲/▼ + magnitude. `inverse` flips which direction is
 *  good (e.g. out-of-order rooms falling is good). Returns a flat "—" chip when
 *  there's no comparable prior figure — never a fabricated 0%. */
export function DeltaChip({
  current,
  prior,
  inverse = false,
  className = "",
}: {
  current: number | null;
  prior: number | null;
  inverse?: boolean;
  className?: string;
}) {
  if (current == null || prior == null || prior === 0)
    return (
      <Chip tone="flat" className={className}>
        —
      </Chip>
    );
  const d = ((current - prior) / Math.abs(prior)) * 100;
  const flat = Math.abs(d) < 0.15;
  const good = inverse ? d < 0 : d > 0;
  const tone: ChipTone = flat ? "flat" : good ? "pos" : "neg";
  return (
    <Chip tone={tone} className={className}>
      {flat ? "" : d > 0 ? "▲ " : "▼ "}
      {Math.abs(d).toFixed(1)}%
    </Chip>
  );
}

/** Point-difference chip for figures already expressed in percent (occupancy),
 *  or any absolute movement with a unit ("pt", " rms", " days"). */
export function PointChip({
  delta,
  unit = "pt",
  inverse = false,
  className = "",
}: {
  delta: number | null;
  unit?: string;
  inverse?: boolean;
  className?: string;
}) {
  if (delta == null)
    return (
      <Chip tone="flat" className={className}>
        —
      </Chip>
    );
  const flat = Math.abs(delta) < 0.05;
  const good = inverse ? delta < 0 : delta > 0;
  const tone: ChipTone = flat ? "flat" : good ? "pos" : "neg";
  return (
    <Chip tone={tone} className={className}>
      {flat ? "" : delta > 0 ? "▲ " : "▼ "}
      {Math.abs(delta).toFixed(1)}
      {unit}
    </Chip>
  );
}

/* -------------------------------------------------------------------------- */
/* KPI tiles                                                                  */
/* -------------------------------------------------------------------------- */

/** The standard KPI card: label, big tabular number, optional delta chip and
 *  sub-line. Used in a `grid-cols-[repeat(auto-fit,minmax(168px,1fr))]` row. */
export function Kpi({
  label,
  value,
  sub,
  chip,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  chip?: ReactNode;
}) {
  return (
    <div className="rounded-[10px] border border-line bg-surface px-4 py-3.5 shadow-card">
      <Label>{label}</Label>
      <div className="mt-2.5 flex items-end gap-2">
        <div className="text-[27px] font-semibold leading-none tracking-[-.03em] text-txt">
          {value}
        </div>
        {chip && <div className="mb-[3px]">{chip}</div>}
      </div>
      {sub && <div className="mt-[7px] text-[11.5px] text-txt3">{sub}</div>}
    </div>
  );
}

/** Navy KPI — the one emphasised tile in a row (portfolio headline). Sits on
 *  chrome navy in both themes, so its foreground is literal white. */
export function KpiNavy({
  label,
  value,
  sub,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="rounded-[10px] bg-chrome px-4 py-3.5 text-white shadow-card">
      <div className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-white/60">
        {label}
      </div>
      <div className="mt-2.5 text-[27px] font-semibold leading-none tracking-[-.03em]">{value}</div>
      {sub && <div className="mt-[7px] text-[11.5px] text-white/50">{sub}</div>}
    </div>
  );
}

/** Small stat inside a grouped card ("Portfolio at a glance"). */
export function MiniStat({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div>
      <div className="mb-[3px] text-[10.5px] font-semibold tracking-[.04em] text-txt3">{label}</div>
      <div className="text-[21px] font-semibold tracking-[-.02em] text-txt">{value}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Status: occupancy → colour, dots, bars                                     */
/* -------------------------------------------------------------------------- */

/** Occupancy status thresholds, defined ONCE. `occ` is a percentage (0–100).
 *  ≥85 healthy · ≥72 watch · below that, attention. Null = no data. */
export function occColor(occ: number | null): string {
  if (occ == null) return "bg-lineStrong";
  if (occ >= 85) return "bg-pos";
  if (occ >= 72) return "bg-warn";
  return "bg-neg";
}

export function StatusDot({ occ, square = false }: { occ: number | null; square?: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 ${square ? "rounded-[2px]" : "rounded-full"} ${occColor(occ)}`}
    />
  );
}

/** Horizontal progress bar on a surface3 trough. `pct` is 0–100 and is clamped;
 *  `tone` defaults to the occupancy status colour for `pct`. */
export function Bar({
  pct,
  tone,
  height = 6,
}: {
  pct: number | null;
  tone?: string;
  height?: number;
}) {
  const w = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div
      className="w-full overflow-hidden rounded-full bg-surface3"
      style={{ height: `${height}px` }}
    >
      <div
        className={`h-full rounded-full ${tone ?? occColor(pct)}`}
        style={{ width: `${w}%` }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Segmented control                                                          */
/* -------------------------------------------------------------------------- */

/** Track for a segmented control. Buttons inside use `segButton(active)`. */
export function SegTrack({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex gap-0.5 rounded-[7px] border border-line bg-surface2 p-0.5 ${className}`}
    >
      {children}
    </div>
  );
}

export function segButton(active: boolean): string {
  return (
    "h-[26px] whitespace-nowrap rounded-[5px] px-3 text-xs font-semibold transition-colors " +
    (active
      ? "bg-surface text-accent shadow-seg"
      : "bg-transparent text-txt2 hover:text-txt")
  );
}

/* -------------------------------------------------------------------------- */
/* Tables                                                                     */
/* -------------------------------------------------------------------------- */

/** Header cell style shared by every table in the system: 10px uppercase on a
 *  surface2 band with a strong bottom rule. Alignment classes are spelled out
 *  (not interpolated) so Tailwind's scanner can see them. */
const TH_ALIGN = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
} as const;

export function thClass(align: keyof typeof TH_ALIGN = "left", sticky = false): string {
  return (
    "whitespace-nowrap border-b border-lineStrong bg-surface2 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[.07em] text-txt3 " +
    TH_ALIGN[align] +
    (sticky ? " sticky left-0 z-[2]" : "")
  );
}

/** Scroll container for a wide table — the table scrolls, the page never does. */
export function TableScroll({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

/* -------------------------------------------------------------------------- */
/* Page furniture                                                             */
/* -------------------------------------------------------------------------- */

/** Navy page header used at the top of each surface. */
export function PageHead({
  eyebrow,
  title,
  sub,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-[10px] bg-chrome px-5 py-4 text-white shadow-card">
      <div className="min-w-0">
        {eyebrow && (
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[.1em] text-[#7FA8DA]">
            {eyebrow}
          </div>
        )}
        <div className="text-[17px] font-semibold tracking-[-.015em] sm:text-xl">{title}</div>
        {sub && <div className="mt-[3px] text-xs text-[#7FA8DA]">{sub}</div>}
      </div>
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** Ghost button that sits ON navy chrome (header actions, exports). */
export const chromeButton =
  "inline-flex h-8 items-center rounded-md border border-chromeLine bg-white/[.06] px-3 text-xs font-semibold text-chromeText transition-colors hover:bg-white/[.14]";

/** Neutral button on a light surface. */
export const surfaceButton =
  "inline-flex h-8 items-center rounded-md border border-lineStrong bg-surface px-3 text-xs font-semibold text-txt2 transition-colors hover:border-accent hover:text-accent";

/** Section title + sub, used above a block of cards. */
export function SectionTitle({
  title,
  sub,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="text-[15px] font-semibold tracking-[-.01em] text-txt">{title}</div>
        {sub && <div className="mt-0.5 text-xs text-txt3">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

/** Left rail shell (properties on /report, sections on /ops). Sticks below the
 *  chrome on lg+, becomes a horizontal scroller on small screens. */
export function Rail({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <nav className="mb-4 lg:mb-0 lg:w-[236px] lg:shrink-0">
      <div className="overflow-hidden rounded-[10px] border border-line bg-surface shadow-card lg:sticky lg:top-[104px]">
        <div className="hidden border-b border-line px-3.5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[.09em] text-txt3 lg:block">
          {title}
        </div>
        <div className="flex overflow-x-auto lg:block lg:overflow-visible">{children}</div>
      </div>
    </nav>
  );
}

/** Row style for a Rail item — active state is a blue left edge + surface2. */
export function railRowClass(active: boolean): string {
  return (
    "block w-full shrink-0 border-l-[3px] px-3.5 py-2.5 text-left transition-colors " +
    (active
      ? "border-accent bg-surface2 text-txt"
      : "border-transparent text-txt2 hover:bg-surface2")
  );
}

/** Freshness strip — green when the store is current, amber when it isn't. */
export function FreshnessStrip({
  current,
  title,
  detail,
  trailing,
}: {
  current: boolean;
  title: ReactNode;
  detail?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div
      className={
        "flex flex-wrap items-center gap-x-2.5 gap-y-1 border-x border-b border-line px-5 py-2.5 " +
        (current ? "bg-posbg text-pos" : "bg-warnbg text-warn")
      }
    >
      <span
        className={"inline-block h-[7px] w-[7px] rounded-full " + (current ? "bg-pos" : "bg-warn")}
      />
      <span className="text-[12.5px] font-semibold">{title}</span>
      {detail && <span className="text-[12.5px] opacity-85">{detail}</span>}
      {trailing && <span className="ml-auto text-[11.5px] opacity-70">{trailing}</span>}
    </div>
  );
}

/** Inline notice — used for "awaiting key", "no data", error states. */
export function Notice({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "warn" | "neg";
  children: ReactNode;
}) {
  const tones = {
    muted: "border-line bg-surface2 text-txt3",
    warn: "border-warn/30 bg-warnbg text-warn",
    neg: "border-neg/30 bg-negbg text-neg",
  } as const;
  return (
    <div className={`rounded-[10px] border px-4 py-6 text-center text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}
