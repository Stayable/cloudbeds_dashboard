"use client";

import { useState } from "react";

// Self-service "Change PIN" for the current dashboard. The server derives WHICH
// PIN to change from the signed cookie, so this only ever changes the logged-in
// user's own PIN. Robust submit (try/catch + timeout).
export default function ChangePin() {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const mismatch = confirm.length > 0 && pin !== confirm;
  const canSubmit = pin.length >= 4 && pin === confirm && status !== "saving";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setErrorMsg("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch("/api/change-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
        signal: controller.signal,
      });
      if (res.ok) {
        setStatus("done");
        setPin("");
        setConfirm("");
      } else {
        const b = await res.json().catch(() => ({}));
        setErrorMsg(b?.error || "Could not update PIN.");
        setStatus("error");
      }
    } catch {
      setErrorMsg("Could not reach the server. Try again.");
      setStatus("error");
    } finally {
      clearTimeout(timeout);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Account</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">Change your PIN</h2>
        </div>
        {!open && (
          <button
            onClick={() => { setOpen(true); setStatus("idle"); }}
            className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Change PIN
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <p className="text-sm text-slate-500">
            Updates the PIN for this dashboard. You&apos;ll stay signed in; use the new PIN next time.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="password" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value)}
              placeholder="New PIN (min 4 chars)"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <input
              type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm new PIN"
              className={
                "w-full rounded-lg border px-3 py-2 text-slate-900 outline-none focus:ring-2 " +
                (mismatch ? "border-red-400 focus:border-red-400 focus:ring-red-200" : "border-slate-300 focus:border-accent focus:ring-accent/20")
              }
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit" disabled={!canSubmit}
              className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {status === "saving" ? "Saving…" : "Save new PIN"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-sm font-medium text-slate-500 hover:text-slate-700">
              Cancel
            </button>
            {mismatch && <span className="text-sm text-red-600">PINs don&apos;t match</span>}
            {status === "done" && <span className="text-sm text-emerald-600">PIN updated.</span>}
            {status === "error" && <span className="text-sm text-red-600">{errorMsg}</span>}
          </div>
        </form>
      )}
    </section>
  );
}
