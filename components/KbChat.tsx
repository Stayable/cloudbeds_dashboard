"use client";

// The floating "Ask the knowledgebase" widget — chat icon, lower right.
//
// DELIBERATELY STATELESS ACROSS RELOADS. There is no thread history and no
// "continue previous conversation" (cut by Kyle 08/19/26): the PIN cookie is a
// signed LEVEL, not a person, so there is no identity to hang a thread on, and
// persisting transcripts would store far more free-typed text than the search
// box ever did. Turns live in component state and die with the tab.
//
// Every answer carries feedback buttons. Those are not a training loop — nothing
// here trains a model. They build a replayable eval set, and more usefully a
// content-gap list: a "not covered" on a question the KB should answer is the
// next document to go and write.

import { useEffect, useRef, useState } from "react";
import { KB_FEEDBACK_REASONS } from "@/lib/kb-feedback-reasons";

type Citation = { slug: string; anchor: string };

type Turn = {
  question: string;
  answer: string;
  answered: boolean;
  unverified?: boolean;
  citations: Citation[];
  /** kb_feedback row id; null when the answer could not be recorded, in which
   *  case no verdict can attach and the buttons are hidden rather than lying. */
  id: number | null;
  verdict?: "up" | "down";
  reason?: string;
};

function titleFromSlug(slug: string): string {
  return slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export default function KbChat() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  // Escape closes — a floating panel that traps the reader is worse than none.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setQuestion("");
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/kb/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json?.error ?? "Something went wrong.");
        setQuestion(q); // give the question back rather than losing their typing
        return;
      }
      setTurns((t) => [
        ...t,
        {
          question: q,
          answer: json.answer,
          answered: json.answered,
          unverified: json.unverified,
          citations: json.citations ?? [],
          id: json.id ?? null,
        },
      ]);
    } catch {
      setError("Could not reach the assistant.");
      setQuestion(q);
    } finally {
      setBusy(false);
    }
  }

  async function vote(i: number, helpful: boolean, reason?: string) {
    const turn = turns[i];
    if (turn.id === null) return;
    // Optimistic: the verdict is a courtesy to us, not something the reader
    // should have to wait on or retry.
    setTurns((t) =>
      t.map((x, j) => (j === i ? { ...x, verdict: helpful ? "up" : "down", reason } : x)),
    );
    try {
      await fetch("/api/kb/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: turn.id, helpful, reason }),
      });
    } catch {
      /* a lost verdict is not worth interrupting anyone over */
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask the knowledgebase"
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{ background: "rgb(var(--navy))", boxShadow: "var(--shadow)" }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-5 right-5 z-50 flex w-[min(26rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border"
      style={{
        background: "rgb(var(--surface))",
        borderColor: "rgb(var(--line))",
        boxShadow: "var(--shadow)",
        maxHeight: "min(34rem, calc(100vh - 6rem))",
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ background: "rgb(var(--chrome))", color: "rgb(var(--chrome-text))" }}
      >
        <div>
          <div className="text-sm font-semibold">Ask the knowledgebase</div>
          <div className="text-[11px] opacity-70">Answers come only from the KB — never from guesswork</div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="rounded p-1 text-lg leading-none opacity-70 hover:opacity-100"
        >
          ×
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {turns.length === 0 && !busy && (
          <p className="text-sm" style={{ color: "rgb(var(--txt-3))" }}>
            Ask about check-in, deposits, pet fees, house rules, a property&apos;s contact details, or
            anything else in the knowledgebase. If it isn&apos;t in there, it will say so rather than
            guess.
          </p>
        )}

        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <div className="text-sm font-semibold" style={{ color: "rgb(var(--txt))" }}>
              {t.question}
            </div>

            <div
              className="rounded-lg px-3 py-2 text-sm"
              style={{
                background: "rgb(var(--surface-2))",
                color: "rgb(var(--txt))",
              }}
            >
              <p className="whitespace-pre-wrap">{t.answer}</p>

              {!t.answered && (
                <p className="mt-2 text-[11px] font-medium" style={{ color: "rgb(var(--warn))" }}>
                  Not answered from the knowledgebase.
                </p>
              )}

              {t.citations.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {t.citations.map((c) => (
                    <a
                      key={`${c.slug}#${c.anchor}`}
                      href={`/kb/${c.slug}#${c.anchor}`}
                      className="rounded px-1.5 py-0.5 text-[11px] underline-offset-2 hover:underline"
                      style={{ background: "rgb(var(--surface-3))", color: "rgb(var(--txt-2))" }}
                    >
                      {titleFromSlug(c.slug)}
                    </a>
                  ))}
                </div>
              )}

              {t.citations.length === 0 && !t.answered && (
                <a
                  href="/kb"
                  className="mt-2 inline-block text-[11px] underline"
                  style={{ color: "rgb(var(--blue))" }}
                >
                  Browse the knowledgebase →
                </a>
              )}
            </div>

            {t.id !== null && (
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                {t.verdict === undefined ? (
                  <>
                    <span style={{ color: "rgb(var(--txt-3))" }}>Did this answer your question?</span>
                    <button
                      type="button"
                      onClick={() => vote(i, true)}
                      className="rounded border px-2 py-0.5 hover:brightness-95"
                      style={{ borderColor: "rgb(var(--line))", color: "rgb(var(--txt-2))" }}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => vote(i, false)}
                      className="rounded border px-2 py-0.5 hover:brightness-95"
                      style={{ borderColor: "rgb(var(--line))", color: "rgb(var(--txt-2))" }}
                    >
                      No
                    </button>
                  </>
                ) : t.verdict === "down" && !t.reason ? (
                  <>
                    <span style={{ color: "rgb(var(--txt-3))" }}>What went wrong?</span>
                    {KB_FEEDBACK_REASONS.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => vote(i, false, r.key)}
                        className="rounded border px-2 py-0.5 hover:brightness-95"
                        style={{ borderColor: "rgb(var(--line))", color: "rgb(var(--txt-2))" }}
                      >
                        {r.label}
                      </button>
                    ))}
                  </>
                ) : (
                  <span style={{ color: "rgb(var(--txt-3))" }}>Thanks — logged.</span>
                )}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <p className="text-sm" style={{ color: "rgb(var(--txt-3))" }}>
            Reading the knowledgebase…
          </p>
        )}
        {error && (
          <p className="text-sm" style={{ color: "rgb(var(--neg))" }}>
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={ask}
        className="flex items-center gap-2 border-t px-3 py-2"
        style={{ borderColor: "rgb(var(--line))" }}
      >
        <input
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What's the pet fee on a lease?"
          maxLength={500}
          className="flex-1 rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-1"
          style={{
            background: "rgb(var(--surface))",
            borderColor: "rgb(var(--line))",
            color: "rgb(var(--txt))",
          }}
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          style={{ background: "rgb(var(--navy))" }}
        >
          Ask
        </button>
      </form>
    </div>
  );
}
