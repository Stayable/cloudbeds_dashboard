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
    <section className="rounded-[10px] border border-line bg-surface p-5 shadow-card sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">Account</p>
          <h2 className="mt-1 text-lg font-semibold text-txt">Change your PIN</h2>
        </div>
        {!open && (
          <button
            onClick={() => { setOpen(true); setStatus("idle"); }}
            className="shrink-0 rounded-[7px] border border-lineStrong px-3 py-1.5 text-[12.5px] font-semibold text-txt2 transition-colors hover:border-accent hover:text-accent"
          >
            Change PIN
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <p className="text-sm text-txt2">
            Updates the PIN for this dashboard. You&apos;ll stay signed in; use the new PIN next time.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="password" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value)}
              placeholder="New PIN (min 4 chars)"
              className="w-full rounded-[7px] border border-lineStrong bg-surface px-3 py-2 text-[13px] text-txt outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            <input
              type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm new PIN"
              className={
                "w-full rounded-lg border px-3 py-2 text-txt outline-none focus:ring-2 " +
                (mismatch ? "border-neg focus:border-neg focus:ring-neg/40" : "border-lineStrong focus:border-accent focus:ring-accent/20")
              }
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit" disabled={!canSubmit}
              className="rounded-[7px] bg-accent px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {status === "saving" ? "Saving…" : "Save new PIN"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-sm font-medium text-txt2 hover:text-txt">
              Cancel
            </button>
            {mismatch && <span className="text-sm text-neg">PINs don&apos;t match</span>}
            {status === "done" && <span className="text-sm text-pos">PIN updated.</span>}
            {status === "error" && <span className="text-sm text-neg">{errorMsg}</span>}
          </div>
        </form>
      )}
    </section>
  );
}
