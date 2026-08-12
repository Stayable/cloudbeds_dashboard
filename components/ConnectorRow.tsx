"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Revoke button for one token. Two-step: the first click asks, the second
 *  does it — the URL dies immediately and nobody is warned. */
export default function ConnectorRow({ id, email }: { id: number; email: string | null }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  async function revoke() {
    setStatus("saving");
    try {
      const res = await fetch(`/api/connectors/${id}/revoke`, { method: "POST" });
      if (res.ok) {
        router.refresh();
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  if (status === "error") return <span className="text-[12.5px] text-neg">Failed — reload</span>;

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="rounded-[7px] border border-lineStrong px-3 py-1.5 text-[12.5px] font-semibold text-txt2 transition-colors hover:border-neg hover:text-neg"
      >
        Revoke
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <button
        onClick={revoke}
        disabled={status === "saving"}
        className="rounded-[7px] bg-neg px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50"
      >
        {status === "saving" ? "Revoking…" : `Kill ${email ?? "this URL"}`}
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="text-[12.5px] font-medium text-txt2 hover:text-txt"
      >
        Cancel
      </button>
    </span>
  );
}
