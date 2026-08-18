// The reasons a "no" can mean, in ONE place, imported by both the API route
// and the client widget.
//
// WHY ITS OWN MODULE rather than living in lib/kb-ask.ts: kb-ask imports
// kb-corpus, which reads the corpus off disk with node:fs. A "use client"
// component that imports kb-ask therefore drags node:fs into the browser
// bundle and the build fails with UnhandledSchemeError. Splitting the shared
// constant out is the fix; duplicating the list in the component would also
// have made the build pass, and would have been the wrong answer — two copies
// of one meaning is how the UI ends up offering a reason the server silently
// discards.
//
// TWO reasons, not three. The obvious third — "right answer to the wrong
// question" — describes a RETRIEVAL failure, and there is no retrieval step:
// the whole corpus goes into the prompt, so no ranker can miss. Offering a
// verdict that cannot occur teaches readers the buttons are decorative.
//
// These are not a training signal. They are (a) a replayable eval set and
// (b) a content-gap list — "not-covered" on a question the knowledgebase
// SHOULD answer names the next document to write.

export const KB_FEEDBACK_REASONS = [
  { key: "wrong", label: "Wrong answer" },
  { key: "not-covered", label: "Not in the KB" },
] as const;

export type KbFeedbackReason = (typeof KB_FEEDBACK_REASONS)[number]["key"];

export function isKbFeedbackReason(v: unknown): v is KbFeedbackReason {
  return typeof v === "string" && KB_FEEDBACK_REASONS.some((r) => r.key === v);
}
