// Corpus validation. CLAUDE.md §5 rule 2: no guest PII on any surface, and the
// /bea §3 exception is scoped to that one table and does NOT generalise here.
//
// This is a HEURISTIC and the spec says so plainly: it catches an email address,
// a phone number and a "Guest Name" column header. It does NOT catch a guest's
// name buried in prose. The rule is enforced by this check AND by review at
// authoring time; neither alone is sufficient. Run as a TEST FAILURE, not a
// warning — a warning in a build log is a rule nobody enforces.

import type { KbDocument } from "./kb-parse";

export type KbProblem = { slug: string; problem: string };

const RULES: { problem: string; re: RegExp }[] = [
  {
    problem: "looks like an email address (guest PII — CLAUDE.md §5 rule 2)",
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  },
  {
    problem: "looks like a phone number (guest PII — CLAUDE.md §5 rule 2)",
    re: /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/,
  },
  {
    problem: 'has a guest-identifying column header ("guest name" / "guest phone" / "guest email")',
    re: /\bguest\s+(name|phone|email|e-mail)\b/i,
  },
];

/** Every problem in the corpus, empty when it is clean. */
export function checkCorpus(docs: KbDocument[]): KbProblem[] {
  const problems: KbProblem[] = [];
  for (const doc of docs) {
    const text = doc.sections.map((s) => `${s.heading ?? ""}\n${s.body}`).join("\n");
    if (!text.trim()) {
      problems.push({ slug: doc.slug, problem: "is empty — no body content after the frontmatter" });
    }
    for (const rule of RULES) {
      const m = rule.re.exec(text);
      if (m) problems.push({ slug: doc.slug, problem: `${rule.problem}: "${m[0]}"` });
    }
  }
  return problems;
}
