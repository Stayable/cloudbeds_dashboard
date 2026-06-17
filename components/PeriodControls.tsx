"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const PRESETS: { key: string; label: string }[] = [
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
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
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);

  function go(params: Record<string, string>) {
    router.push(`/?${new URLSearchParams(params).toString()}`);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Presets */}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => {
          const active = p.key === preset;
          return (
            <button
              key={p.key}
              onClick={() => go({ preset: p.key })}
              className={
                "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors " +
                (active
                  ? "bg-ink text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100")
              }
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Custom range */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-slate-500">
          From
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-0.5 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          To
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className="mt-0.5 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-accent"
          />
        </label>
        <button
          onClick={() => from && to && go({ preset: "custom", start: from, end: to })}
          className={
            "rounded-lg px-3 py-2 text-xs font-semibold transition-colors " +
            (preset === "custom"
              ? "bg-accent text-white"
              : "bg-accent/10 text-accent hover:bg-accent/20")
          }
        >
          Apply range
        </button>
      </div>
    </div>
  );
}
