// Corpus validation. CLAUDE.md §5 rule 2: no guest PII on any surface, and the
// /bea §3 exception is scoped to that one table and does NOT generalise here.
//
// This is a HEURISTIC, and it is deliberately specific about what it claims to
// catch, so nobody mistakes a clean run for a guarantee:
//   - an email address (standard local@domain.tld shape)
//   - a phone number written with SOME punctuation between the groups — parens,
//     dots, dashes, or a leading "+1" — e.g. (407) 555-0142, 407.555.0142,
//     407-555-0142, +1 407 555 0142
//   - a BARE unformatted 10-digit run, e.g. 4075550142. This exists because the
//     corpus is built from spreadsheet/Excel pastes, and losing the punctuation
//     on a phone column is exactly what that paste does. It is bounded on both
//     sides (no adjacent digit) so it does NOT fire inside a longer digit run —
//     a 12-digit ID, a comma-grouped dollar figure, a version string, a
//     room-number range all pass through untouched. See lib/kb-check.test.ts
//     (or the false-positive tests alongside the phone tests) for the exact
//     cases checked.
//   - a "Guest Name" / "Guest Phone" / "Guest Email" column header
//
// It explicitly does NOT catch: an unpunctuated number that still runs longer
// than 10 digits (an international number with a country code and no
// separators, e.g. 442079460958), a spelled-out number, or — the one that
// matters most — a guest's name buried in ordinary prose. The rule is enforced
// by this check AND by review at authoring time; neither alone is sufficient.
// Run as a TEST FAILURE, not a warning — a warning in a build log is a rule
// nobody enforces.

import type { KbDocument } from "./kb-parse";

export type KbProblem = { slug: string; problem: string };

// All patterns carry the `g` flag: matchAll() requires it, and without it a
// document with three leaked emails would only ever report the first — which
// reads as "fixed" after the author cleans up one and re-runs, while two more
// are still sitting in the file.
const RULES: { problem: string; re: RegExp }[] = [
  {
    problem: "looks like an email address (guest PII — CLAUDE.md §5 rule 2)",
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    problem: "looks like a phone number (guest PII — CLAUDE.md §5 rule 2)",
    // Two alternatives: a punctuated 3-3-4 group (with an optional +1/1
    // country prefix), OR a bare 10-digit run guarded on both sides by
    // (?<!\d) / (?!\d) so it cannot match a 10-digit SLICE of something longer
    // — a 12-digit reservation ID, a $1,234,567,890 figure written without
    // commas, etc. The lookaround checks digits specifically, not \b: \b
    // treats letters and digits as the same "word" class, so it would not by
    // itself stop a false match sitting right after a letter.
    re: /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|(?<!\d)\d{10}(?!\d)/g,
  },
  {
    problem: 'has a guest-identifying column header ("guest name" / "guest phone" / "guest email")',
    re: /\bguest\s+(name|phone|email|e-mail)\b/gi,
  },
];

/** Every problem in the corpus, empty when it is clean. */
export function checkCorpus(docs: KbDocument[]): KbProblem[] {
  const problems: KbProblem[] = [];
  for (const doc of docs) {
    // Emptiness is judged on SECTION BODY TEXT ONLY, excluding heading text.
    // A document that is nothing but headings with no prose underneath has
    // exactly zero body content — the message already says "no body content
    // after the frontmatter", and counting heading text as content would let
    // that skeleton pass silently, which is the opposite of what the message
    // claims.
    const bodyOnly = doc.sections.map((s) => s.body).join("\n");
    if (!bodyOnly.trim()) {
      problems.push({ slug: doc.slug, problem: "is empty — no body content after the frontmatter" });
    }

    // The PII scan covers more than body text: headings, and the frontmatter
    // SCALARS an author fills in by hand (title, source, sourceUrl). A leaked
    // name or email in a `source:` field is just as real a leak as one in
    // prose, and the constraint (CLAUDE.md §5 rule 2) is file-level, not
    // section-level. counties is a controlled list of county names, not
    // free text, so it is not scanned.
    const scanText = [
      doc.title,
      doc.source,
      doc.sourceUrl ?? "",
      ...doc.sections.map((s) => `${s.heading ?? ""}\n${s.body}`),
    ].join("\n");

    for (const rule of RULES) {
      for (const m of scanText.matchAll(rule.re)) {
        problems.push({ slug: doc.slug, problem: `${rule.problem}: "${m[0]}"` });
      }
    }
  }
  return problems;
}
