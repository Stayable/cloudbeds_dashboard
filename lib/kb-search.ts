// Full-text search over the knowledgebase corpus. Pure: types only from
// kb-parse, no filesystem, no database, no model. Everything here is
// deterministic and unit-tested, because "why did this rank first" has to be
// answerable (spec §5).
//
// searchKb() and corpusOutline() — the versions that read the real corpus —
// live in lib/kb-corpus.ts. This module never loads anything.

import type { KbDocument } from "./kb-parse";

/** Escape text for interpolation into HTML. Lives here rather than in
 *  kb-markdown so this module stays dependency-free; kb-markdown imports it. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Naive plural folding. NOT a stemmer: a real one is a dependency, and at a
 *  corpus of roughly a dozen documents the extra recall does not pay for it
 *  (spec §5). "evictions" → "eviction" covers the actual miss we care about. */
function fold(w: string): string {
  if (w.length > 3 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith("sses")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(fold);
}

/** Escape a string for literal use inside a RegExp. Shared by containsPhrase
 *  and snippet so the escaping rule has exactly one definition. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-phrase test: true only if `phrase` appears in `haystack` with no
 *  alphanumeric character immediately before or after the match (or string
 *  edge, which trivially satisfies the lookaround). A bare `.includes` would
 *  award the top-tier phrase bonus for query "art" inside the heading "Chart
 *  data" — "art" is a real substring of "Chart" but not a real word there —
 *  which promotes a coincidence above a genuine whole-word/phrase match. */
function containsPhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false;
  const re = new RegExp(`(?<![a-z0-9])${escapeRegExp(phrase.toLowerCase())}(?![a-z0-9])`);
  return re.test(haystack.toLowerCase());
}

export type SearchResult = {
  slug: string;
  title: string;
  heading: string | null;
  anchor: string;
  snapshotDate: string;
  /** Escaped, with <mark> around query terms. Safe to render as HTML. */
  snippetHtml: string;
  score: number;
};

// Ranking weights (spec §5), descending. The gaps are wide enough that a lower
// signal can never overtake a higher one:
//   phrase-in-heading  >  phrase-in-body  >  term coverage  >  term frequency
// Coverage contributes 100 per matched term; frequency contributes strictly
// less than 1. So 4-of-4 terms always beats 3-of-4, whatever the counts.
const W_HEADING_PHRASE = 10_000;
const W_BODY_PHRASE = 1_000;
const W_TERM = 100;

export function rankSections(query: string, docs: KbDocument[]): SearchResult[] {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  const phrase = query.trim().toLowerCase();

  const scored: { result: SearchResult; order: number }[] = [];

  docs.forEach((doc, di) => {
    doc.sections.forEach((section, si) => {
      const headingText = section.heading ?? "";
      const words = tokenize(`${headingText}\n${section.body}`);
      const counts = new Map<string, number>();
      for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);

      const matched = terms.filter((t) => (counts.get(t) ?? 0) > 0);
      if (!matched.length) return; // never pad with weak matches

      const tf = matched.reduce((n, t) => n + (counts.get(t) ?? 0), 0);
      // Saturating and length-normalised, so it stays in [0, 1) and a long
      // section cannot win on volume: the denominator grows with section length.
      const frequency = tf / (tf + 2 + words.length / 100);

      const score =
        (containsPhrase(headingText, phrase) ? W_HEADING_PHRASE : 0) +
        (containsPhrase(section.body, phrase) ? W_BODY_PHRASE : 0) +
        W_TERM * matched.length +
        frequency;

      scored.push({
        order: di * 1_000 + si,
        result: {
          slug: doc.slug,
          title: doc.title,
          heading: section.heading,
          anchor: section.anchor,
          snapshotDate: doc.snapshotDate,
          snippetHtml: snippet(section.body || headingText, matched),
          score,
        },
      });
    });
  });

  return scored
    .sort((a, b) => b.result.score - a.result.score || a.order - b.order)
    .map((s) => s.result);
}

/** A window of `body` centred on the first matching term, escaped, with query
 *  terms wrapped in <mark>.
 *
 *  ESCAPE FIRST, THEN WRAP — and specifically, escape each plain-text run and
 *  emit the <mark> tags between the runs. Highlighting a string that has already
 *  been escaped by searching it for the raw term is the classic bug: the term
 *  "amp" matches inside "&amp;" and corrupts the entity. */
export function snippet(body: string, terms: string[], width = 220): string {
  const flat = body.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();

  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = at < 0 ? 0 : Math.max(0, at - Math.floor(width / 3));
  const end = Math.min(flat.length, start + width);
  const raw = flat.slice(start, end);
  const prefix = start > 0 ? "… " : "";
  const suffix = end < flat.length ? " …" : "";

  if (!terms.length) return prefix + escapeHtml(raw) + suffix;

  const pattern = terms.map(escapeRegExp).join("|");
  const re = new RegExp(pattern, "gi");
  const parts: string[] = [];
  let cursor = 0;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    if (m[0].length === 0) break; // defensive: a zero-width match would spin
    parts.push(escapeHtml(raw.slice(cursor, m.index)), "<mark>", escapeHtml(m[0]), "</mark>");
    cursor = m.index + m[0].length;
  }
  parts.push(escapeHtml(raw.slice(cursor)));
  return prefix + parts.join("") + suffix;
}

export type OutlineDoc = {
  slug: string;
  title: string;
  source: string;
  snapshotDate: string;
  headings: { heading: string; anchor: string }[];
};

/** The whole corpus, document by document with its headings. Shown for an empty
 *  query AND for a no-result query (spec §5): someone who does not know the
 *  right word can browse, and everyone learns what the KB contains. */
export function outline(docs: KbDocument[]): OutlineDoc[] {
  return docs.map((d) => ({
    slug: d.slug,
    title: d.title,
    source: d.source,
    snapshotDate: d.snapshotDate,
    headings: d.sections
      .filter((s) => s.heading !== null)
      .map((s) => ({ heading: s.heading as string, anchor: s.anchor })),
  }));
}
