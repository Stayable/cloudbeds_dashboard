"use client";

import { useState } from "react";
import type { CatalogMetric } from "@/config/catalog-sample";

const TEAMS = ["Crystal", "Remote Property Managers", "Property Managers & Attendants", "Rob", "Other"];

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
    // Hard timeout so a hung network request can never leave the button stuck
    // on "Submitting…" — it always resolves to done or an actionable error.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, role, team: team === "Other" ? "Other" : team, metrics, notes: composedNotes }),
        signal: controller.signal,
      });
      if (res.ok) {
        setStatus("done");
      } else {
        const b = await res.json().catch(() => ({}));
        setErrorMsg(b?.error || "Something went wrong. Please try again.");
        setStatus("error");
      }
    } catch (err) {
      setErrorMsg(
        err instanceof DOMException && err.name === "AbortError"
          ? "The request timed out. Please check your connection and try again."
          : "Could not reach the server. Please try again.",
      );
      setStatus("error");
    } finally {
      clearTimeout(timeout);
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-[10px] border border-pos/40 bg-posbg p-6 text-center">
        <p className="text-lg font-semibold text-pos">Thank you — your selections were recorded.</p>
        <p className="mt-1 text-sm text-pos">
          {metrics.length} metric{metrics.length === 1 ? "" : "s"} submitted. You can close this page.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">Name *</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 w-full rounded-[7px] border border-lineStrong bg-surface px-3 py-2 text-[13px] text-txt outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>
        <label className="block">
          <span className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">Role *</span>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            required
            className="mt-1 w-full rounded-[7px] border border-lineStrong bg-surface px-3 py-2 text-[13px] text-txt outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>
        <label className="block">
          <span className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">Team *</span>
          <select
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            required
            className="mt-1 w-full rounded-[7px] border border-lineStrong bg-surface px-3 py-2 text-[13px] text-txt outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
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
          <span className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">Your team</span>
          <input
            value={otherTeam}
            onChange={(e) => setOtherTeam(e.target.value)}
            className="mt-1 w-full rounded-[7px] border border-lineStrong bg-surface px-3 py-2 text-[13px] text-txt outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>
      )}

      <div>
        <p className="text-sm font-semibold text-txt">
          Which metrics do you want on your dashboard? <span className="text-txt3">(pick at least one)</span>
        </p>
        <p className="mt-0.5 text-xs text-txt2">
          Values shown are <span className="font-semibold">SAMPLE</span> data — not live figures.
        </p>
        <div className="mt-3 space-y-5">
          {groups.map((g) => (
            <fieldset key={g.category}>
              <legend className="mb-2 text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">
                {g.category}
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {g.metrics.map((m) => (
                  <label
                    key={m.key}
                    className={
                      "flex cursor-pointer items-start gap-3 rounded-lg border bg-surface p-3 transition " +
                      (selected[m.key] ? "border-accent ring-1 ring-accent/30" : "border-line hover:border-lineStrong")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={!!selected[m.key]}
                      onChange={() => toggle(m.key)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-txt">{m.name}</span>
                      <span className="block text-xs text-txt2">{m.explanation}</span>
                      <span className="mt-1 inline-block rounded bg-surface2 px-1.5 py-0.5 text-[11px] font-medium text-txt2">
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
        <span className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-[7px] border border-lineStrong bg-surface px-3 py-2 text-[13px] text-txt outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </label>

      {status === "error" && <p className="text-sm text-neg">{errorMsg}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-[7px] bg-accent px-5 py-3 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {status === "saving" ? "Submitting…" : "Submit selections"}
        </button>
        <span className="text-xs text-txt3">{metrics.length} selected</span>
      </div>
    </form>
  );
}
