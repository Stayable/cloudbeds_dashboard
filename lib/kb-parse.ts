// Knowledgebase corpus: markdown files in content/kb/*.md parsed into documents
// and heading-delimited sections. No database on the read path (spec §3) — the
// index is built in-process at module load and memoised for the lifetime of the
// server instance.
//
// ANCHORS ARE DEFINED HERE AND NOWHERE ELSE. `splitSections` is the single
// producer of section anchors; the search results, the document page and any
// future consumer read `section.anchor` rather than re-slugifying a heading.
// Two definitions of one meaning is how you get green tests and wrong links.

export type KbSection = {
  /** null for the preamble that precedes the first heading. */
  heading: string | null;
  /** Unique within the document. "top" for the preamble. */
  anchor: string;
  /** Markdown heading level 1-6; 0 for the preamble. */
  level: number;
  /** Markdown source of this section, heading line excluded, trimmed. */
  body: string;
};

export type KbDocument = {
  slug: string;
  title: string;
  source: string;
  sourceUrl: string | null;
  /** YYYY-MM-DD — when this copy was taken. See spec §6. */
  snapshotDate: string;
  counties: string[];
  sections: KbSection[];
};

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Strip surrounding quotes from a frontmatter scalar. Deliberately does NOT
 *  strip trailing "# comments" — a `#` is legal inside a URL fragment, and
 *  losing half a sourceUrl silently is worse than not supporting comments. */
function unquote(s: string): string {
  const t = s.trim();
  const quoted =
    (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"));
  return quoted && t.length >= 2 ? t.slice(1, -1) : t;
}

/** Minimal YAML subset: `key: scalar` and `key: [a, b]`. That is the whole
 *  frontmatter vocabulary the corpus uses (spec §3), so a YAML dependency would
 *  buy nothing. Anything else throws rather than being silently ignored. */
export function parseFrontmatter(raw: string): {
  data: Record<string, string | string[]>;
  body: string;
} {
  const m = FRONTMATTER.exec(raw);
  if (!m) throw new Error('missing frontmatter block ("---" … "---") at the top of the file');
  const data: Record<string, string | string[]> = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const i = line.indexOf(":");
    if (i < 0) throw new Error(`frontmatter line is not "key: value": ${line}`);
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    data[key] =
      value.startsWith("[") && value.endsWith("]")
        ? value
            .slice(1, -1)
            .split(",")
            .map(unquote)
            .filter(Boolean)
        : unquote(value);
  }
  return { data, body: raw.slice(m[0].length) };
}

export function slugifyHeading(heading: string): string {
  const base = heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "section";
}

/** Split markdown into heading-delimited sections. Fenced code blocks are
 *  tracked so a `# comment` inside a shell example is not read as a heading. */
export function splitSections(body: string): KbSection[] {
  const sections: KbSection[] = [];
  const used = new Map<string, number>([["top", 1]]); // reserve the preamble anchor
  let fence: string | null = null;
  let current: KbSection = { heading: null, anchor: "top", level: 0, body: "" };
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join("\n").trim();
    if (current.heading !== null || text) sections.push({ ...current, body: text });
    buf = [];
  };

  for (const line of body.split(/\r?\n/)) {
    const fenceMatch = /^\s{0,3}(```|~~~)/.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1];
      else if (fenceMatch[1] === fence) fence = null;
      buf.push(line);
      continue;
    }
    const headingMatch = fence === null ? /^(#{1,6})\s+(.*)$/.exec(line) : null;
    if (headingMatch) {
      flush();
      const heading = headingMatch[2].trim().replace(/\s+#+\s*$/, "");
      const base = slugifyHeading(heading);
      const n = (used.get(base) ?? 0) + 1;
      used.set(base, n);
      current = {
        heading,
        anchor: n === 1 ? base : `${base}-${n}`,
        level: headingMatch[1].length,
        body: "",
      };
    } else {
      buf.push(line);
    }
  }
  flush();
  // Detect unclosed fenced code blocks, which silently swallow remaining headings.
  // This is data loss in a knowledge base — a missing closing fence means real
  // sections stop appearing in search/anchors with no signal. Fail loud and early.
  if (fence !== null) {
    throw new Error(
      `unclosed fenced code block: a ${fence} was opened but never closed. ` +
        `Every heading after the opening fence is lost (swallowed into the preceding section body). ` +
        `Close the fence with a matching ${fence} line.`
    );
  }
  return sections;
}

/** Check if a date string is a valid YYYY-MM-DD calendar date.
 *
 *  Shape-only regex allows February 30, which Date.parse silently rolls to
 *  March 2, understating age — the one direction this module must never fail in.
 *  Round-trip parse-to-string to catch calendar impossibilities. */
function isValidYmd(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const ms = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(ms)) return false;
  const parsed = new Date(ms).toISOString().slice(0, 10);
  return parsed === ymd;
}

export function parseKbDocument(slug: string, raw: string): KbDocument {
  const { data, body } = parseFrontmatter(raw);
  const need = (key: string): string => {
    const v = data[key];
    if (typeof v !== "string" || !v) {
      throw new Error(`${slug}: frontmatter is missing required key "${key}"`);
    }
    return v;
  };
  const snapshotDate = need("snapshotDate");
  if (!isValidYmd(snapshotDate)) {
    throw new Error(
      `${slug}: snapshotDate must be a valid YYYY-MM-DD calendar date, got "${snapshotDate}"`
    );
  }
  let sections: KbSection[];
  try {
    sections = splitSections(body);
  } catch (e) {
    // Re-throw body parsing errors with the slug for context, so the corpus
    // author knows which file failed. Slug prefixing is centralized here.
    if (e instanceof Error) {
      throw new Error(`${slug}: ${e.message}`);
    }
    throw e;
  }
  return {
    slug,
    title: need("title"),
    source: need("source"),
    sourceUrl: typeof data.sourceUrl === "string" && data.sourceUrl ? data.sourceUrl : null,
    snapshotDate,
    counties: Array.isArray(data.counties) ? data.counties : [],
    sections,
  };
}

// --- Snapshot staleness (spec §6) -------------------------------------------
// Every result row and document page states its snapshot date and age. The
// corpus is a copy of a LIVE SharePoint file, so a copy is stale the moment
// someone edits the original; the page says so rather than implying currency.

/** Days after which a snapshot is visually flagged. One constant, one meaning. */
export const STALE_AFTER_DAYS = 90;

export type SnapshotAge = { text: string; days: number; stale: boolean };

/** Whole calendar days between two YYYY-MM-DD dates, floor 0.
 *
 *  UTC midnight-to-midnight on purpose. Both inputs are date-only strings, so
 *  there is no time component to floor away — which is the failure mode that bit
 *  the Elise staleness counter (TODO.md session 9j): it floored elapsed HOURS and
 *  so read a 47-hour-old figure as "1 day ago". For a staleness warning,
 *  understating age is the dangerous direction. */
export function daysSince(ymd: string, todayYmd: string): number {
  if (!isValidYmd(ymd) || !isValidYmd(todayYmd)) return 0;
  const a = Date.parse(`${ymd}T00:00:00Z`);
  const b = Date.parse(`${todayYmd}T00:00:00Z`);
  // Both are now guaranteed valid; the parse should not fail.
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** "as of 08/07/26 (12 days ago)" — RISE8 MM/DD/YY, plus a stale flag. */
export function snapshotAge(ymd: string, todayYmd: string): SnapshotAge {
  const days = daysSince(ymd, todayYmd);
  // Only format the date as MM/DD/YY if it is a valid calendar date. Otherwise
  // fall back to the raw ymd — obviously broken is better than plausibly wrong.
  let stamp: string;
  if (isValidYmd(ymd)) {
    const [y, m, d] = ymd.split("-");
    stamp = `${m}/${d}/${y.slice(2)}`;
  } else {
    stamp = ymd;
  }
  const age = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  return { text: `as of ${stamp} (${age})`, days, stale: days > STALE_AFTER_DAYS };
}
