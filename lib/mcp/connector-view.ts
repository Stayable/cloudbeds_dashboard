// Presentation helpers for /connectors. Pure, so they are unit-tested rather
// than eyeballed in the browser.

/** "2 hours ago" / "never" / "unknown". `never` is deliberately a word rather
 *  than a dash: it is the signal that a URL was issued and never installed. */
export function relativeAge(iso: string | null, nowMs: number): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "unknown";
  const secs = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
