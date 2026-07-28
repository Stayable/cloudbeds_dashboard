"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { SegTrack, segButton } from "@/components/ui";

// Period selector for the sticky ControlBar. Presets are a segmented control;
// "Custom…" reveals the two date inputs inline rather than always occupying a
// second row (the design keeps the bar to one line).
const PRESETS: { key: string; label: string }[] = [
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7" },
  { key: "last30", label: "Last 30" },
  { key: "month", label: "This month" },
];

export default function PeriodControls({
  preset,
  start,
  end,
}: {
  preset: string;
  start: string;
  end: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);
  const [openCustom, setOpenCustom] = useState(preset === "custom");

  function go(params: Record<string, string>) {
    // Stay on the current path (/, /ops, …) so the date filter doesn't bounce
    // the user back to the base dashboard.
    router.push(`${pathname}?${new URLSearchParams(params).toString()}`);
  }

  const dateInput =
    "h-[26px] rounded-[5px] border border-lineStrong bg-surface px-2 text-xs text-txt outline-none focus:border-accent";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegTrack>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => {
              setOpenCustom(false);
              go({ preset: p.key });
            }}
            className={segButton(p.key === preset)}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpenCustom((v) => !v)}
          className={segButton(preset === "custom")}
        >
          Custom…
        </button>
      </SegTrack>

      {openCustom && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            aria-label="From date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className={dateInput}
          />
          <span className="text-xs text-txt3">→</span>
          <input
            type="date"
            aria-label="To date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className={dateInput}
          />
          <button
            type="button"
            onClick={() => from && to && go({ preset: "custom", start: from, end: to })}
            className="h-[26px] rounded-[5px] bg-accent px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
