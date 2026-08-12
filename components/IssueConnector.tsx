"use client";

import { useState } from "react";
import { MCP_USERS } from "@/config/mcp-users";

const INPUT =
  "w-full rounded-[7px] border border-lineStrong bg-surface px-3 py-2 text-[13px] text-txt outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20";

/** Issue a connector URL. The returned URL is shown ONCE — only its hash is
 *  stored, so it cannot be retrieved again. */
export default function IssueConnector() {
  const [choice, setChoice] = useState("");
  const [otherEmail, setOtherEmail] = useState("");
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  const email = choice === "other" ? otherEmail.trim() : choice;
  const canSubmit = email.length > 0 && status !== "saving";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setErrorMsg("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch("/api/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, label }),
        signal: controller.signal,
      });
      const b = await res.json().catch(() => ({}));
      if (res.ok && b?.url) {
        setUrl(b.url);
        setStatus("done");
      } else {
        setErrorMsg(b?.error || "Could not issue a URL.");
        setStatus("error");
      }
    } catch {
      setErrorMsg("Could not reach the server. Try again.");
      setStatus("error");
    } finally {
      clearTimeout(timeout);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (status === "done") {
    return (
      <section className="rounded-[10px] border border-pos/40 bg-posbg p-5 sm:p-6">
        <p className="text-lg font-semibold text-pos">URL issued for {email}</p>
        <p className="mt-1 text-sm text-pos">
          This is the only time it is shown. Only its hash is stored — if it is lost, revoke it and
          issue a new one.
        </p>
        <code className="mt-3 block break-all rounded-[7px] border border-lineStrong bg-surface p-3 text-[12.5px] text-txt">
          {url}
        </code>
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={copy}
            className="rounded-[7px] bg-accent px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            {copied ? "Copied" : "Copy URL"}
          </button>
          <button
            onClick={() => {
              setStatus("idle");
              setUrl("");
              setCopied(false);
              setChoice("");
              setOtherEmail("");
              setLabel("");
            }}
            className="text-sm font-medium text-txt2 hover:text-txt"
          >
            Issue another
          </button>
        </div>
        <p className="mt-3 text-xs text-txt2">
          Send it directly to the person. This URL <span className="font-semibold">is</span> the
          credential — anyone holding it has full read access, so do not paste it into a group chat.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[10px] border border-line bg-surface p-5 shadow-card sm:p-6">
      <p className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">Issue</p>
      <h2 className="mt-1 text-lg font-semibold text-txt">New connector URL</h2>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">
              Tied to *
            </span>
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              required
              className={"mt-1 " + INPUT}
            >
              <option value="">Select…</option>
              {MCP_USERS.map((u) => (
                <option key={u.email} value={u.email}>
                  {u.name} — {u.email}
                </option>
              ))}
              <option value="other">Other…</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">
              Label (optional)
            </span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Claude Desktop — laptop"
              className={"mt-1 " + INPUT}
            />
          </label>
        </div>

        {choice === "other" && (
          <label className="block">
            <span className="text-[10.5px] font-semibold uppercase tracking-[.08em] text-txt3">
              Email address
            </span>
            <input
              value={otherEmail}
              onChange={(e) => setOtherEmail(e.target.value)}
              placeholder="name@rentstayable.com"
              className={"mt-1 " + INPUT}
            />
          </label>
        )}

        {status === "error" && <p className="text-sm text-neg">{errorMsg}</p>}

        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-[7px] bg-accent px-5 py-3 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {status === "saving" ? "Issuing…" : "Issue URL"}
        </button>
      </form>
    </section>
  );
}
