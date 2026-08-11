// Corpus validation. CLAUDE.md §5 rule 2: no guest PII on any surface, and the
// /bea §3 exception is scoped to that one table and does NOT generalise here.
//
// This is a HEURISTIC, and it is deliberately specific about what it claims to
// catch, so nobody mistakes a clean run for a guarantee:
//   - an email address (standard local@domain.tld shape)
//   - a phone number written with SOME punctuation between the groups — parens,
//     dots, dashes, or a leading "+1" — e.g. (407) 555-0142, 407.555.0142,
//     407-555-0142, +1 407 555 0142
//   - a BARE unformatted NANP-SHAPED 10-digit run, e.g. 4075550142. This exists
//     because the corpus is built from spreadsheet/Excel pastes, and losing the
//     punctuation on a phone column is exactly what that paste does.
//     "NANP-shaped" is the deliberate narrowing that keeps this useful rather
//     than a landmine: North American numbering forbids an area code or
//     exchange code starting with 0 or 1, so the pattern requires [2-9] in
//     both of those leading positions. That is a real discriminator, not a
//     hack — it is why 4075550142 (area 407, exchange 555) is still caught
//     while 1234567890 and 0987654321 are not. Those two are not edge cases
//     invented for this comment: they are the shape of a SharePoint
//     `sourcedoc` GUID and a OneDrive `d=w...` share-link suffix, both of
//     which showed up for real once sourceUrl entered the corpus (see below).
//     The rule is still bounded on both sides ((?<!\d) / (?!\d), digit
//     adjacency rather than \b — \b treats letters and digits as the same
//     "word" class and would not by itself stop a false match sitting right
//     after a letter) so it cannot match a 10-digit SLICE of something longer.
//     A dollar figure, a date range, a version string, a room-number range,
//     and a 12+ digit ID all pass through untouched — see the false-positive
//     tests in lib/kb-corpus.test.ts.
//
//     What NANP-shaping does NOT buy: a confirmation number or invoice number
//     that happens to fall in the NANP shape (area/exchange digits 2-9) WILL
//     still false-positive — "Invoice #4075550142 due on receipt" is, by
//     inspection, indistinguishable from a phone number, and no regex fixes
//     that. If this fires on a real business identifier, the fix is to reword
//     the source line (e.g. add punctuation, or split the digits) or to widen
//     this rule deliberately with a new test — not to delete the rule quietly,
//     because the next false negative it would have caught is a real one.
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

// --- Published company contact points are not guest PII ----------------------
// The rules below cannot tell a guest's mobile number from the front desk's
// published toll-free line, or a guest's inbox from a property mailbox. Both
// belong in the corpus: "what is the phone number for Kissimmee West" is a
// front-desk question the knowledgebase exists to answer, and every value here
// is already published on rentstayable.com's public contact page.
//
// This is the deliberate widening the module comment asks for — an ALLOWLIST of
// specific published values plus the two company email domains, each paired
// with a test, rather than a quiet loosening of the patterns themselves. The
// rules still fire on anything not on this list, which is where a leaked guest
// number or a personal gmail address would land. A guest email is never
// @rentstayable.com; a guest phone is never one of these eight.
//
// Adding a value here is a content decision, not a formatting fix: it must be a
// company contact point that is already public.

/** Email domains that belong to the company, not to a guest. */
const COMPANY_EMAIL_DOMAINS = ["rentstayable.com", "rise8companies.com"];

/** The eight published property front-desk numbers, digits only (contact page),
 *  plus the emergency services number. */
const PUBLISHED_PHONE_DIGITS = new Set([
  "18446543175", // Jacksonville West (6802)
  "18447552648", // Jacksonville North (812)
  "18777354134", // St. Augustine (2535)
  "18553055357", // Kissimmee West (5399)
  "18333400306", // Kissimmee East (2295)
  "18665594142", // Orlando OBT (8700)
  "18443876651", // Lakeland (4645)
  "18777590804", // Davenport (44199)
]);

function isAllowedContact(match: string): boolean {
  const at = match.indexOf("@");
  if (at >= 0) {
    const domain = match.slice(at + 1).toLowerCase();
    return COMPANY_EMAIL_DOMAINS.includes(domain);
  }
  // Normalise to digits and to a leading country code, so "(844) 654-3175",
  // "+1 844 654 3175" and "8446543175" all resolve to one comparable key.
  const digits = match.replace(/\D/g, "");
  const keyed = digits.length === 10 ? `1${digits}` : digits;
  return PUBLISHED_PHONE_DIGITS.has(keyed);
}

// All patterns carry the `g` flag: matchAll() requires it, and without it a
// document with three leaked emails would only ever report the first — which
// reads as "fixed" after the author cleans up one and re-runs, while two more
// are still sitting in the file.
const RULES: { problem: string; re: RegExp; allowContacts?: boolean }[] = [
  {
    problem: "looks like an email address (guest PII — CLAUDE.md §5 rule 2)",
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    allowContacts: true,
  },
  {
    problem: "looks like a phone number (guest PII — CLAUDE.md §5 rule 2)",
    // Two alternatives: a punctuated 3-3-4 group (with an optional +1/1
    // country prefix) — left as-is, because a separator is a strong signal on
    // its own and narrowing it would start dropping real international
    // numbers — OR a bare NANP-shaped 10-digit run: [2-9]\d{2} (area),
    // [2-9]\d{2} (exchange), \d{4} (subscriber), bounded by (?<!\d)/(?!\d).
    // See the module comment above for exactly what this does and does not
    // catch, and why the NANP shape is required rather than any 10 digits.
    re: /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|(?<!\d)[2-9]\d{2}[2-9]\d{2}\d{4}(?!\d)/g,
    allowContacts: true,
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

    // The PII scan covers more than body text: headings, and the hand-authored
    // frontmatter scalars title/source. A leaked name or email in a `source:`
    // field is just as real a leak as one in prose, and the constraint
    // (CLAUDE.md §5 rule 2) is file-level, not section-level.
    //
    // sourceUrl is DELIBERATELY EXCLUDED, not an oversight. It is a
    // machine-generated link, not authored prose — guest PII does not arrive
    // through a document's own source URL. What DOES arrive there routinely:
    // long opaque digit/hex runs from SharePoint and OneDrive share links
    // (a `sourcedoc` GUID, a `d=w...` suffix), which look exactly like the
    // bare-digit phone shape this file is built to catch. Task 9's real
    // corpus is authored from OneDrive links, so this is not hypothetical.
    // Scanning sourceUrl buys no real PII coverage and guarantees false
    // positives on every such link; excluding it is the fix, not a gap.
    // counties is a controlled list of county names, not free text, so it is
    // not scanned either.
    const scanText = [
      doc.title,
      doc.source,
      ...doc.sections.map((s) => `${s.heading ?? ""}\n${s.body}`),
    ].join("\n");

    for (const rule of RULES) {
      for (const m of scanText.matchAll(rule.re)) {
        if (rule.allowContacts && isAllowedContact(m[0])) continue;
        problems.push({ slug: doc.slug, problem: `${rule.problem}: "${m[0]}"` });
      }
    }
  }
  return problems;
}
