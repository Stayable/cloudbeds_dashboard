// Lease vs Transient classification, derived ONLY from rate-plan strings.
// No guest PII, no Guest scope (CLAUDE.md §5.2). Keyword lists are named
// constants so they can be corrected against real rate-plan inventory without
// touching call sites. See memory `lease-vs-transient` for the verified plans.

export type LeaseClass = "lease-monthly" | "lease-weekly" | "transient";

// Monthly is checked first (precedence). Verified plans + safe synonyms.
export const MONTHLY_KEYWORDS = ["monthly lease", "long term", "discounted long term"];
export const WEEKLY_KEYWORDS = [
  "weekly lease",
  "weekly rate",
  "discounted weekly",
  "employee weekly",
];

/**
 * Classify a (possibly comma-joined multi-plan) rate-plan string.
 * Any lease keyword present => lease; monthly takes precedence over weekly;
 * otherwise transient. Case-insensitive.
 */
export function classifyRatePlan(ratePlan: string | null | undefined): LeaseClass {
  const s = (ratePlan ?? "").toLowerCase();
  if (MONTHLY_KEYWORDS.some((k) => s.includes(k))) return "lease-monthly";
  if (WEEKLY_KEYWORDS.some((k) => s.includes(k))) return "lease-weekly";
  return "transient";
}
