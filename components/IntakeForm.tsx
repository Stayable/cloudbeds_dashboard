"use client";

import { useState } from "react";
import { BotIdClient } from "botid/client";
import type { CatalogMetric } from "@/config/catalog-sample";

const TEAMS = ["Crystal", "Remote Property Managers", "Property Managers & Attendants", "Other"];

export default function IntakeForm({
  groups,
}: {
  groups: { category: string; metrics: CatalogMetric[] }[];
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [team, setTeam] = useState("");
  const [otherTeam, setOtherTeam] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const metrics = Object.keys(selected).filter((k) => selected[k]);
  const toggle = (k: string) => setSelected((s) => ({ ...s, [k]: !s[k] }));
  const effectiveTeam = team === "Other" ? otherTeam.trim() : team;
  const canSubmit =
    name.trim() && role.trim() && effectiveTeam && metrics.length > 0 && status !== "saving";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setErrorMsg("");
    const trimmedOther = otherTeam.trim();
    const composedNotes =
      team === "Other" && trimmedOther
        ? notes.trim()
          ? `[Team: ${trimmedOther}] ${notes.trim()}`
          : `[Team: ${trimmedOther}]`
        : notes;
    const res = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, role, team: team === "Other" ? "Other" : team, metrics, notes: composedNotes }),
    });
    if (res.ok) {
      setStatus("done");
    } else {
      const b = await res.json().catch(() => ({}));
      setErrorMsg(b?.error || "Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <p className="text-lg font-semibold text-emerald-900">Thank you — your selections were recorded.</p>
        <p className="mt-1 text-sm text-emerald-700">
          {metrics.length} metric{metrics.length === 1 ? "" : "s"} submitted. You can close this page.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* Register the public write path for BotID protection. */}
      <BotIdClient protect={[{ path: "/api/submit", method: "POST" }]} />

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Name *</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Role *</span>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Team *</span>
          <select
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          >
            <option value="">Select…</option>
            {TEAMS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>

      {team === "Other" && (
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Your team</span>
          <input
            value={otherTeam}
            onChange={(e) => setOtherTeam(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>
      )}

      <div>
        <p className="text-sm font-semibold text-slate-900">
          Which metrics do you want on your dashboard? <span className="text-slate-400">(pick at least one)</span>
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          Values shown are <span className="font-semibold">SAMPLE</span> data — not live figures.
        </p>
        <div className="mt-3 space-y-5">
          {groups.map((g) => (
            <fieldset key={g.category}>
              <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                {g.category}
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {g.metrics.map((m) => (
                  <label
                    key={m.key}
                    className={
                      "flex cursor-pointer items-start gap-3 rounded-lg border bg-white p-3 transition " +
                      (selected[m.key] ? "border-accent ring-1 ring-accent/30" : "border-slate-200 hover:border-slate-300")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={!!selected[m.key]}
                      onChange={() => toggle(m.key)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-900">{m.name}</span>
                      <span className="block text-xs text-slate-500">{m.explanation}</span>
                      <span className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                        SAMPLE: {m.sample}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </label>

      {status === "error" && <p className="text-sm text-red-600">{errorMsg}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-lg bg-ink px-5 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {status === "saving" ? "Submitting…" : "Submit selections"}
        </button>
        <span className="text-xs text-slate-400">{metrics.length} selected</span>
      </div>
    </form>
  );
}
