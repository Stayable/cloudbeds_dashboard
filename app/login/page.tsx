"use client";

import { useState } from "react";

// PIN gate. Deliberately its own visual world: a navy field with a single glass
// card, no app chrome (Nav self-hides without a valid cookie). Fixed dark
// palette — this screen is the same in both themes, so the colours here are
// literal rather than tokens.
export default function LoginPage() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(false);
    const next = new URLSearchParams(window.location.search).get("next") ?? "";
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin, next }),
    });
    if (res.ok) {
      // The server decides the destination: the user's own dashboard, or the
      // originally-requested page if they're allowed to see it.
      const { redirect } = (await res.json().catch(() => ({}))) as { redirect?: string };
      window.location.assign(redirect || "/"); // hard nav so the cookie applies before middleware
    } else {
      setLoading(false);
      setError(true);
      setPin("");
    }
  }

  return (
    <main
      className="grid min-h-screen place-items-center px-6 py-10"
      style={{ background: "linear-gradient(180deg,#041E42 0%,#062B5C 100%)" }}
    >
      <div className="w-full max-w-[392px] animate-fadeup">
        <div className="mb-8 flex items-baseline gap-2.5">
          <span className="text-[26px] font-bold tracking-[-.02em] text-white">stayable</span>
          <span className="h-[7px] w-[7px] -translate-y-0.5 rounded-full bg-gold" />
          <span className="text-[11px] font-semibold uppercase tracking-[.16em] text-[#7FA8DA]">
            Operating Dashboard
          </span>
        </div>

        <div className="rounded-xl border border-[#12386B] bg-white/[.04] p-7">
          <h1 className="text-[15px] font-semibold text-white">Enter access PIN</h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[#7FA8DA]">
            Internal, read-only. Aggregate metrics only — no guest data.
          </p>

          <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
            <input
              type="password"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                setError(false);
              }}
              placeholder="Access PIN"
              aria-label="Access PIN"
              className="h-12 w-full rounded-[9px] border border-[#12386B] bg-white/[.04] px-4 text-[15px] font-semibold tracking-[.22em] text-white outline-none transition-colors placeholder:tracking-normal placeholder:text-[#5C82B4] focus:border-accent focus:bg-accent/10"
            />
            <button
              type="submit"
              disabled={loading || pin.length === 0}
              className="h-11 rounded-[9px] bg-accent text-[13.5px] font-semibold text-white transition-colors hover:bg-[#0A7FD1] disabled:opacity-50"
            >
              {loading ? "Checking…" : "Unlock dashboard"}
            </button>
          </form>

          {error && <p className="mt-3 text-xs text-[#FF9BAA]">Incorrect PIN. Try again.</p>}

          <button
            type="button"
            onClick={() => {
              // Return to wherever they came from (e.g. the base dashboard when
              // they hit a per-user PIN prompt without that access). Falls back
              // to the base dashboard if there's no history to go back to.
              if (window.history.length > 1) window.history.back();
              else window.location.assign("/");
            }}
            className="mt-3 h-10 w-full rounded-[9px] border border-[#12386B] text-xs font-semibold text-[#8FB3DD] transition-colors hover:border-[#2A5C9E] hover:text-white"
          >
            ← Back
          </button>

          <p className="mt-5 text-center text-[11.5px] text-[#5C82B4]">
            Issued by RISE8 IT
          </p>
        </div>
      </div>
    </main>
  );
}
