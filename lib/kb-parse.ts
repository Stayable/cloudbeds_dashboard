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
  return sections;
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
    throw new Error(`${slug}: snapshotDate must be YYYY-MM-DD, got "${snapshotDate}"`);
  }
  return {
    slug,
    title: need("title"),
    source: need("source"),
    sourceUrl: typeof data.sourceUrl === "string" && data.sourceUrl ? data.sourceUrl : null,
    snapshotDate,
    counties: Array.isArray(data.counties) ? data.counties : [],
    sections: splitSections(body),
  };
}
