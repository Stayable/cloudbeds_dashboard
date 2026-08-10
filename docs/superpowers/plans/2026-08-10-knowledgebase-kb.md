# Knowledgebase (`/kb`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a PIN-gated `/kb` where the Stayable team searches company documents and SOPs and gets back the specific *section* that answers them, with a citation, a snapshot date, and a link to the full document.

**Architecture:** Markdown files in `content/kb/*.md` are parsed at module load into an in-memory index — no database on the read path, no embeddings, no LLM. A plain `GET` form posts to `/kb?q=…`, the server ranks sections and renders results. `/kb/<slug>` renders one document with `marked`. One Neon table (`kb_queries`) records the query text and result count so we learn what people fail to find.

**Tech Stack:** Next.js 15 App Router (server components), TypeScript, Tailwind (design tokens only), vitest, `marked` (new dependency), `@neondatabase/serverless` (already present).

**Source spec:** `docs/superpowers/specs/2026-08-07-knowledgebase-design.md` — approved by Kyle 08/10/26. Read it before starting; this plan implements it and does not restate its reasoning.

## Global Constraints

- **Branch:** `claude/nifty-thompson-ts8zny`. Never push to another branch. Do not open a PR.
- **No guest PII in `content/kb/**`.** CLAUDE.md §5 rule 2. The `/bea` §3 exception is scoped to that one table and does not generalise here. Enforced as a **test failure**, not a warning (Task 5).
- **Credentials are server-side only.** No `NEXT_PUBLIC_` prefix on anything.
- **Never pad results with weak matches.** A section that matches zero query terms is excluded. A confident bad match is worse than an honest miss.
- **Snapshot dates are load-bearing.** Every result row and document page shows the snapshot date and its age. Nothing is implied to be live.
- **Staleness must never understate age.** Round toward "older than you think" — see the `daysBetween` bug recorded in TODO.md session 9j.
- **One definition per meaning.** Section anchors are generated in exactly one place (`splitSections` in `lib/kb-parse.ts`) and consumed everywhere else. Do not re-derive an anchor in the renderer or in a page.
- **Escape before highlighting**, never after. Highlighting is the classic injection hole.
- **Test command:** `npm test` (vitest, `lib/**/*.test.ts` + `app/**/*.test.ts` + `config/**/*.test.ts`). Typecheck: `npx tsc --noEmit`.
- **Design tokens only.** Colours come from the Tailwind token names (`surface`, `surface2`, `line`, `txt`, `txt2`, `txt3`, `accent`, `warn`, `warnbg`). No literal hex in components.
- **Commit after every task.** Message style matches the repo: `feat(kb): …`, `fix(kb): …`, lowercase subject, and end with the `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` trailer.

---

## File Structure

| File | Responsibility | Depends on |
|---|---|---|
| `lib/kb-parse.ts` | frontmatter + heading chunking + corpus loading + snapshot-age formatting | `node:fs`, `node:path` |
| `lib/kb-parse.test.ts` | parsing, chunking, anchors, snapshot age | — |
| `lib/kb-search.ts` | tokenise, rank, snippet, corpus outline, `escapeHtml` | `kb-parse` types |
| `lib/kb-search.test.ts` | tokenising, ranking order, snippet escaping | — |
| `lib/kb-markdown.ts` | markdown → HTML (wraps `marked`, raw HTML neutralised) | `marked`, `kb-search` (`escapeHtml`) |
| `lib/kb-markdown.test.ts` | tables, lists, links, raw-HTML escaping | — |
| `lib/kb-corpus.test.ts` | the real corpus parses and is PII-clean | `kb-parse`, `scripts/kb-check` logic |
| `lib/kb-check.ts` | pure corpus validation rules (shared by test + script) | `kb-parse` |
| `lib/kb-log.ts` | fire-and-forget query logging boundary | `lib/db` |
| `lib/db.ts` (modify) | `insertKbQuery` — the SQL, alongside every other table | `@neondatabase/serverless` |
| `scripts/db-init.mjs` (modify) | `kb_queries` DDL | — |
| `scripts/kb-check.mts` | CLI wrapper over `lib/kb-check.ts` | `kb-check` |
| `app/kb/page.tsx` | search box, results, empty + no-result states | `kb-parse`, `kb-search`, `kb-log` |
| `app/kb/[slug]/page.tsx` | document view | `kb-parse`, `kb-markdown` |
| `lib/auth.ts` (modify) | add `/kb` to `SHARED_PAGES` | — |
| `app/globals.css` (modify) | `.kb-prose` styles for rendered markdown | — |
| `next.config.mjs` (modify) | `outputFileTracingIncludes` for `content/kb/**` | — |
| `content/kb/__fixtures__/*.md` | test corpus, excluded from the live index | — |
| `content/kb/*.md` | the real corpus (Task 9) | — |

**Why `lib/kb-check.ts` exists** and the spec only named `scripts/kb-check.mts`: the spec requires the validator to run **in the test suite** against the real corpus. A `.mts` script under `scripts/` is not picked up by `vitest.config.ts` (which globs `lib/`, `app/`, `config/`). So the rules live in `lib/kb-check.ts` where the suite can reach them, and the script is a thin CLI over the same function. One definition, two callers.

**Why `content/kb/__fixtures__/` is naturally excluded:** `loadCorpus` reads only `*.md` entries directly inside `content/kb/`. A subdirectory is not a `.md` file, so fixtures never enter the live index without any filter logic.

---

### Task 1: Frontmatter parsing and section chunking

**Files:**
- Create: `lib/kb-parse.ts`
- Test: `lib/kb-parse.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type KbSection = { heading: string | null; anchor: string; level: number; body: string }`
  - `type KbDocument = { slug: string; title: string; source: string; sourceUrl: string | null; snapshotDate: string; counties: string[]; sections: KbSection[] }`
  - `function parseFrontmatter(raw: string): { data: Record<string, string | string[]>; body: string }`
  - `function slugifyHeading(heading: string): string`
  - `function splitSections(body: string): KbSection[]`
  - `function parseKbDocument(slug: string, raw: string): KbDocument`

- [ ] **Step 1: Write the failing test**

Create `lib/kb-parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseFrontmatter, slugifyHeading, splitSections, parseKbDocument } from "./kb-parse";

const DOC = `---
title: Eviction filing process
source: SharePoint — Operations/SOPs/Evictions.xlsx
sourceUrl: https://example.invalid/evictions.xlsx
snapshotDate: 2026-08-07
counties: [Osceola, Duval]
---

Intro paragraph before any heading.

## Notice period

Serve a three-day notice.

## Filing

File in county court.

## Filing

Second section with a duplicate heading.
`;

describe("parseFrontmatter", () => {
  it("splits the block from the body and parses scalars and lists", () => {
    const { data, body } = parseFrontmatter(DOC);
    expect(data.title).toBe("Eviction filing process");
    expect(data.counties).toEqual(["Osceola", "Duval"]);
    expect(body.startsWith("\nIntro paragraph")).toBe(true);
  });

  it("throws when the frontmatter block is missing", () => {
    expect(() => parseFrontmatter("# Just a heading\n")).toThrow(/frontmatter/i);
  });
});

describe("slugifyHeading", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyHeading("Notice period")).toBe("notice-period");
    expect(slugifyHeading("Rent & fees (2026)")).toBe("rent-fees-2026");
  });

  it("never returns an empty anchor", () => {
    expect(slugifyHeading("###")).toBe("section");
  });
});

describe("splitSections", () => {
  it("keeps the preamble as a section anchored at top", () => {
    const secs = splitSections("Some preamble.\n\n## First\n\nBody.\n");
    expect(secs[0]).toMatchObject({ heading: null, anchor: "top", level: 0 });
    expect(secs[0].body).toBe("Some preamble.");
    expect(secs[1]).toMatchObject({ heading: "First", anchor: "first", level: 2 });
  });

  it("gives duplicate headings unique anchors", () => {
    const secs = splitSections("## Filing\n\nA\n\n## Filing\n\nB\n");
    expect(secs.map((s) => s.anchor)).toEqual(["filing", "filing-2"]);
  });

  it("does NOT treat a # line inside a fenced code block as a heading", () => {
    const secs = splitSections("## Real\n\n```bash\n# not a heading\n```\n");
    expect(secs).toHaveLength(1);
    expect(secs[0].heading).toBe("Real");
    expect(secs[0].body).toContain("# not a heading");
  });

  it("returns no sections for an empty body", () => {
    expect(splitSections("")).toEqual([]);
  });

  it("handles a heading-less document as one preamble section", () => {
    const secs = splitSections("Just prose, no headings at all.\n");
    expect(secs).toHaveLength(1);
    expect(secs[0].heading).toBeNull();
  });
});

describe("parseKbDocument", () => {
  it("builds a document with metadata and sections", () => {
    const doc = parseKbDocument("evictions", DOC);
    expect(doc.slug).toBe("evictions");
    expect(doc.title).toBe("Eviction filing process");
    expect(doc.snapshotDate).toBe("2026-08-07");
    expect(doc.counties).toEqual(["Osceola", "Duval"]);
    expect(doc.sourceUrl).toBe("https://example.invalid/evictions.xlsx");
    expect(doc.sections.map((s) => s.anchor)).toEqual(["top", "notice-period", "filing", "filing-2"]);
  });

  it("names the file and the key when a required field is missing", () => {
    const bad = `---\ntitle: X\nsource: Y\n---\n\nBody.\n`;
    expect(() => parseKbDocument("bad-doc", bad)).toThrow(/bad-doc.*snapshotDate/);
  });

  it("rejects a snapshotDate that is not YYYY-MM-DD", () => {
    const bad = `---\ntitle: X\nsource: Y\nsnapshotDate: 08/07/26\n---\n\nBody.\n`;
    expect(() => parseKbDocument("bad-date", bad)).toThrow(/YYYY-MM-DD/);
  });

  it("defaults optional fields rather than throwing", () => {
    const min = `---\ntitle: X\nsource: Y\nsnapshotDate: 2026-08-07\n---\n\nBody.\n`;
    const doc = parseKbDocument("min", min);
    expect(doc.counties).toEqual([]);
    expect(doc.sourceUrl).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/kb-parse.test.ts`
Expected: FAIL — `Failed to resolve import "./kb-parse"`.

- [ ] **Step 3: Write the implementation**

Create `lib/kb-parse.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/kb-parse.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add lib/kb-parse.ts lib/kb-parse.test.ts
git commit -m "feat(kb): parse corpus frontmatter and chunk documents on headings"
```

---

### Task 2: Snapshot age (staleness), erring old

**Files:**
- Modify: `lib/kb-parse.ts` (append)
- Modify: `lib/kb-parse.test.ts` (append)

**Interfaces:**
- Consumes: nothing from Task 1 beyond living in the same module.
- Produces:
  - `const STALE_AFTER_DAYS = 90`
  - `type SnapshotAge = { text: string; days: number; stale: boolean }`
  - `function daysSince(ymd: string, todayYmd: string): number`
  - `function snapshotAge(ymd: string, todayYmd: string): SnapshotAge`

- [ ] **Step 1: Write the failing test**

Append to `lib/kb-parse.test.ts`:

```ts
import { daysSince, snapshotAge, STALE_AFTER_DAYS } from "./kb-parse";

describe("daysSince", () => {
  it("counts whole calendar days between two YYYY-MM-DD dates", () => {
    expect(daysSince("2026-08-07", "2026-08-19")).toBe(12);
    expect(daysSince("2026-08-19", "2026-08-19")).toBe(0);
  });

  // A snapshot dated in the future is a data error, not a negative age.
  it("never returns a negative age", () => {
    expect(daysSince("2026-08-20", "2026-08-19")).toBe(0);
  });

  it("returns 0 for an unparseable date rather than NaN", () => {
    expect(daysSince("not a date", "2026-08-19")).toBe(0);
  });
});

describe("snapshotAge", () => {
  it("renders the RISE8 MM/DD/YY stamp with the age in days", () => {
    expect(snapshotAge("2026-08-07", "2026-08-19").text).toBe("as of 08/07/26 (12 days ago)");
  });

  it("says today and yesterday in words", () => {
    expect(snapshotAge("2026-08-19", "2026-08-19").text).toBe("as of 08/19/26 (today)");
    expect(snapshotAge("2026-08-18", "2026-08-19").text).toBe("as of 08/18/26 (yesterday)");
  });

  it("flags stale only past the threshold, and the threshold day itself is not stale", () => {
    const at = new Date(Date.UTC(2026, 7, 19));
    const onThreshold = new Date(at.getTime() - STALE_AFTER_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const overThreshold = new Date(at.getTime() - (STALE_AFTER_DAYS + 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(snapshotAge(onThreshold, "2026-08-19").stale).toBe(false);
    expect(snapshotAge(overThreshold, "2026-08-19").stale).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/kb-parse.test.ts`
Expected: FAIL — `daysSince is not a function` (or an import error).

- [ ] **Step 3: Write the implementation**

Append to `lib/kb-parse.ts`:

```ts
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
  const a = Date.parse(`${ymd}T00:00:00Z`);
  const b = Date.parse(`${todayYmd}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** "as of 08/07/26 (12 days ago)" — RISE8 MM/DD/YY, plus a stale flag. */
export function snapshotAge(ymd: string, todayYmd: string): SnapshotAge {
  const days = daysSince(ymd, todayYmd);
  const [y, m, d] = ymd.split("-");
  const stamp = y && m && d ? `${m}/${d}/${y.slice(2)}` : ymd;
  const age = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  return { text: `as of ${stamp} (${age})`, days, stale: days > STALE_AFTER_DAYS };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/kb-parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/kb-parse.ts lib/kb-parse.test.ts
git commit -m "feat(kb): snapshot age that errs old rather than young"
```

---

### Task 3: Search — tokenise, rank, snippet

**Files:**
- Create: `lib/kb-search.ts`
- Test: `lib/kb-search.test.ts`

**Interfaces:**
- Consumes: `KbDocument`, `KbSection` types from `lib/kb-parse.ts` (types only — no runtime import of the loader, so this module stays pure and touches no filesystem).
- Produces:
  - `function escapeHtml(s: string): string`
  - `function tokenize(s: string): string[]`
  - `type SearchResult = { slug: string; title: string; heading: string | null; anchor: string; snapshotDate: string; snippetHtml: string; score: number }`
  - `function rankSections(query: string, docs: KbDocument[]): SearchResult[]`
  - `function snippet(body: string, terms: string[], width?: number): string`
  - `type OutlineDoc = { slug: string; title: string; source: string; snapshotDate: string; headings: { heading: string; anchor: string }[] }`
  - `function outline(docs: KbDocument[]): OutlineDoc[]`

Note: the public `searchKb(query)` / `corpusOutline()` wrappers that read the real corpus land in Task 5, once the loader exists. `rankSections` and `outline` take documents explicitly so they can be tested with no filesystem.

- [ ] **Step 1: Write the failing test**

Create `lib/kb-search.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { escapeHtml, tokenize, rankSections, snippet, outline } from "./kb-search";
import { parseKbDocument } from "./kb-parse";
import type { KbDocument } from "./kb-parse";

function doc(slug: string, title: string, body: string): KbDocument {
  return parseKbDocument(
    slug,
    `---\ntitle: ${title}\nsource: test\nsnapshotDate: 2026-08-07\n---\n\n${body}`,
  );
}

describe("tokenize", () => {
  it("lowercases, strips punctuation, and folds naive plurals", () => {
    expect(tokenize("Evictions, in OSCEOLA county!")).toEqual(["eviction", "in", "osceola", "county"]);
  });

  it("does not butcher short words or double-s endings", () => {
    expect(tokenize("is as class")).toEqual(["is", "as", "class"]);
  });

  it("folds -ies to -y", () => {
    expect(tokenize("policies")).toEqual(["policy"]);
  });

  it("returns nothing for punctuation-only input", () => {
    expect(tokenize("   ??? ")).toEqual([]);
  });
});

describe("escapeHtml", () => {
  it("escapes the four dangerous characters", () => {
    expect(escapeHtml('<script>"x" & y</script>')).toBe(
      "&lt;script&gt;&quot;x&quot; &amp; y&lt;/script&gt;",
    );
  });
});

describe("rankSections", () => {
  it("returns nothing for an empty query", () => {
    expect(rankSections("", [doc("a", "A", "## H\n\neviction\n")])).toEqual([]);
  });

  it("excludes sections that match no query term — never pads with weak matches", () => {
    const d = doc("a", "A", "## Notice period\n\nServe a notice.\n\n## Parking\n\nCars go here.\n");
    const hits = rankSections("notice", [d]);
    expect(hits).toHaveLength(1);
    expect(hits[0].heading).toBe("Notice period");
  });

  it("ranks an exact phrase in a HEADING above the same phrase in body text", () => {
    const d = doc(
      "a",
      "A",
      "## Eviction process\n\nUnrelated words here.\n\n## Other\n\nThe eviction process is described at length here.\n",
    );
    const hits = rankSections("eviction process", [d]);
    expect(hits[0].heading).toBe("Eviction process");
  });

  it("ranks term COVERAGE above term frequency", () => {
    const d = doc(
      "a",
      "A",
      "## Both\n\nalpha beta\n\n## Repeats\n\nalpha alpha alpha alpha alpha alpha alpha alpha\n",
    );
    const hits = rankSections("alpha beta", [d]);
    expect(hits[0].heading).toBe("Both");
  });

  it("does not let a long section win on volume alone", () => {
    const padding = "filler ".repeat(400);
    const d = doc("a", "A", `## Short\n\nalpha\n\n## Long\n\n${padding} alpha alpha\n`);
    const hits = rankSections("alpha", [d]);
    expect(hits[0].heading).toBe("Short");
  });

  it("carries the citation fields a result row needs", () => {
    const hits = rankSections("notice", [doc("evictions", "Evictions", "## Notice\n\nnotice text\n")]);
    expect(hits[0]).toMatchObject({
      slug: "evictions",
      title: "Evictions",
      heading: "Notice",
      anchor: "notice",
      snapshotDate: "2026-08-07",
    });
  });

  it("is stable across documents — equal scores keep corpus order", () => {
    const a = doc("a", "A doc", "## X\n\nalpha\n");
    const b = doc("b", "B doc", "## X\n\nalpha\n");
    expect(rankSections("alpha", [a, b]).map((r) => r.slug)).toEqual(["a", "b"]);
  });
});

describe("snippet", () => {
  it("windows on the first matching term and marks it", () => {
    const body = `${"lead ".repeat(60)}eviction happens here${" tail".repeat(60)}`;
    const out = snippet(body, ["eviction"]);
    expect(out).toContain("<mark>eviction</mark>");
    expect(out.length).toBeLessThan(body.length);
  });

  it("escapes document HTML before highlighting", () => {
    const out = snippet('<script>alert(1)</script> eviction notice', ["eviction"]);
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("<mark>eviction</mark>");
  });

  it("cannot be made to emit markup via the QUERY", () => {
    const out = snippet("plain body text about evictions", tokenize("<img src=x onerror=1>"));
    expect(out).not.toContain("<img");
  });

  // &amp; contains the literal substring "amp" — highlighting AFTER escaping
  // would put a <mark> inside an entity and corrupt it.
  it("does not highlight inside an HTML entity", () => {
    const out = snippet("Rent & fees amp policy", ["amp"]);
    expect(out).toContain("&amp;");
    expect(out).not.toContain("&<mark>amp</mark>;");
  });

  it("falls back to the start of the body when no term is present", () => {
    expect(snippet("nothing relevant", ["zzz"])).toBe("nothing relevant");
  });
});

describe("outline", () => {
  it("lists every document with its headings", () => {
    const d = doc("a", "A", "Preamble.\n\n## One\n\nx\n\n## Two\n\ny\n");
    expect(outline([d])).toEqual([
      {
        slug: "a",
        title: "A",
        source: "test",
        snapshotDate: "2026-08-07",
        headings: [
          { heading: "One", anchor: "one" },
          { heading: "Two", anchor: "two" },
        ],
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/kb-search.test.ts`
Expected: FAIL — `Failed to resolve import "./kb-search"`.

- [ ] **Step 3: Write the implementation**

Create `lib/kb-search.ts`:

```ts
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
        (headingText.toLowerCase().includes(phrase) ? W_HEADING_PHRASE : 0) +
        (section.body.toLowerCase().includes(phrase) ? W_BODY_PHRASE : 0) +
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

  const pattern = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/kb-search.test.ts`
Expected: PASS.

If the "long section" case fails, the frequency term is not saturating hard enough for that fixture — **do not raise `W_TERM`**, which would break the coverage guarantee. Increase the length divisor (`words.length / 100` → `/ 50`) and re-run both that test and the coverage test.

- [ ] **Step 5: Commit**

```bash
git add lib/kb-search.ts lib/kb-search.test.ts
git commit -m "feat(kb): rank sections by phrase, coverage, then frequency"
```

---

### Task 4: Markdown rendering with `marked`

**Files:**
- Modify: `package.json` (add `marked`)
- Create: `lib/kb-markdown.ts`
- Test: `lib/kb-markdown.test.ts`

**Interfaces:**
- Consumes: `escapeHtml` from `lib/kb-search.ts`.
- Produces: `function renderMarkdown(md: string): string`

**Note on headings:** `renderMarkdown` is called **per section, with the heading line already stripped** (`KbSection.body`). The document page emits its own `<h2 id={section.anchor}>`. That is deliberate — anchors have exactly one producer (`splitSections`), so `marked`'s own heading ids are never involved and can never drift from the links search emits.

- [ ] **Step 1: Install the dependency**

Run: `npm install marked`

Then confirm the installed major version, because the renderer API differs across majors:

Run: `node -p "require('./node_modules/marked/package.json').version"`

- [ ] **Step 2: Write the failing test**

Create `lib/kb-markdown.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./kb-markdown";

describe("renderMarkdown", () => {
  // Excel-derived content means tables are the whole reason this exists.
  it("renders a GFM table", () => {
    const html = renderMarkdown("| County | Days |\n| --- | --- |\n| Osceola | 3 |\n");
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("Osceola");
  });

  it("renders nested lists", () => {
    const html = renderMarkdown("- one\n  - nested\n- two\n");
    expect(html).toContain("<ul>");
    expect(html.match(/<ul>/g) ?? []).toHaveLength(2);
  });

  it("renders links and inline emphasis", () => {
    const html = renderMarkdown("See [the form](https://example.invalid/f) and **note** this.\n");
    expect(html).toContain('href="https://example.invalid/f"');
    expect(html).toContain("<strong>note</strong>");
  });

  // marked does NOT sanitise — it dropped its sanitiser years ago and GFM
  // permits raw HTML. The corpus is authored by us and git-reviewed, but that is
  // a process guarantee; this is the technical one.
  it("renders block-level raw HTML as visible text, not as markup", () => {
    const html = renderMarkdown("<script>alert(1)</script>\n");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders INLINE raw HTML as visible text too", () => {
    const html = renderMarkdown("Text with <img src=x onerror=alert(1)> inline.\n");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("leaves a code fence as escaped code, not double-escaped", () => {
    const html = renderMarkdown("```\na < b && c\n```\n");
    expect(html).toContain("<code");
    expect(html).toContain("a &lt; b &amp;&amp; c");
    expect(html).not.toContain("&amp;lt;");
  });

  it("returns an empty string for empty input", () => {
    expect(renderMarkdown("").trim()).toBe("");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run lib/kb-markdown.test.ts`
Expected: FAIL — `Failed to resolve import "./kb-markdown"`.

- [ ] **Step 4: Write the implementation**

Create `lib/kb-markdown.ts`:

```ts
// Markdown → HTML for the knowledgebase document page.
//
// DECISION (Kyle, 08/10/26): use `marked` rather than the ~100-line renderer the
// spec originally proposed. Hand-rolled markdown parsers are a known source of
// small bugs, and Excel-derived content makes table correctness load-bearing —
// exactly where a hand-rolled parser fails quietly. Spec §7.
//
// marked does NOT sanitise. GFM permits raw HTML, so a `<script>` in a document
// would otherwise pass straight through. Our corpus is authored in-repo and
// git-reviewed, but that is a process guarantee and process guarantees fail, so
// raw HTML is neutralised below and the behaviour is pinned by a test.

import { Marked } from "marked";
import { escapeHtml } from "./kb-search";

// A private instance, so this configuration cannot leak into (or be clobbered
// by) any other caller of marked in the process.
const md = new Marked({ gfm: true, breaks: false });

md.use({
  renderer: {
    // Handles BOTH block-level html tokens and inline tag tokens: render the
    // author's raw source as visible text instead of as markup.
    html(token: { raw: string }) {
      return escapeHtml(token.raw);
    },
  },
});

/** Render one SECTION body (heading line already stripped by splitSections).
 *  The document page supplies its own <h2 id={anchor}>, so marked never
 *  generates an anchor and can never drift from the ones search links to. */
export function renderMarkdown(source: string): string {
  return md.parse(source, { async: false }) as string;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/kb-markdown.test.ts`
Expected: PASS.

**If the raw-HTML tests fail**, the installed `marked` routes inline tags through a different renderer key. Open `node_modules/marked/lib/marked.d.ts`, find the `Renderer` interface, and look for the member that receives `Tokens.HTML` / `Tokens.Tag`. Add that member alongside `html` with the same body. Do not change the tests — they state the required behaviour, and the behaviour is not negotiable.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/kb-markdown.ts lib/kb-markdown.test.ts
git commit -m "feat(kb): render markdown with marked, raw HTML neutralised"
```

---

### Task 5: Corpus loading, fixtures, and the PII validator

**Files:**
- Create: `lib/kb-corpus.ts`
- Create: `lib/kb-check.ts`
- Create: `lib/kb-corpus.test.ts`
- Create: `content/kb/__fixtures__/table-heavy.md`
- Create: `content/kb/__fixtures__/no-headings.md`
- Create: `content/kb/__fixtures__/duplicate-headings.md`
- Create: `scripts/kb-check.mts`
- Modify: `next.config.mjs`

**Interfaces:**
- Consumes: `parseKbDocument`, `KbDocument` (Task 1); `rankSections`, `outline`, `SearchResult`, `OutlineDoc` (Task 3).
- Produces:
  - `const KB_DIR: string`, `const KB_FIXTURES_DIR: string`
  - `function loadCorpus(dir?: string): KbDocument[]`
  - `function getCorpus(): KbDocument[]` (memoised)
  - `function getDocument(slug: string): KbDocument | null`
  - `function searchKb(query: string): SearchResult[]`
  - `function corpusOutline(): OutlineDoc[]`
  - `type KbProblem = { slug: string; problem: string }`
  - `function checkCorpus(docs: KbDocument[]): KbProblem[]`

- [ ] **Step 1: Write the fixtures**

Create `content/kb/__fixtures__/table-heavy.md`:

```markdown
---
title: Fixture — county filing matrix
source: fixture (not real content)
snapshotDate: 2026-08-07
counties: [Osceola, Duval, Polk]
---

Exercises the Excel-derived shape: a wide table with inline emphasis.

## Filing windows by county

| County  | Notice days | Court            | Filing fee |
| ------- | ----------- | ---------------- | ---------- |
| Osceola | 3           | Osceola County   | $185       |
| Duval   | 3           | Duval County     | $185       |
| Polk    | 3           | Polk County      | $185       |

## Escalation

Escalate to the **regional manager** after 10 days with no response.
```

Create `content/kb/__fixtures__/no-headings.md`:

```markdown
---
title: Fixture — a document with no headings at all
source: fixture (not real content)
snapshotDate: 2026-05-01
---

This document is one unbroken block of prose with no markdown headings. It
exists so the parser, the search index and the document page are all proven
against a document whose only section is the preamble. The word bufflehead
appears here exactly once so a test can search for something unique.
```

Create `content/kb/__fixtures__/duplicate-headings.md`:

```markdown
---
title: Fixture — repeated headings
source: fixture (not real content)
snapshotDate: 2026-08-01
---

## Process

First process section.

## Process

Second process section, which must get its own anchor.

## Process

Third process section.
```

- [ ] **Step 2: Write the failing test**

Create `lib/kb-corpus.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { loadCorpus, getCorpus, getDocument, KB_FIXTURES_DIR } from "./kb-corpus";
import { checkCorpus } from "./kb-check";
import { rankSections } from "./kb-search";
import { parseKbDocument } from "./kb-parse";

const fixtures = loadCorpus(KB_FIXTURES_DIR);

describe("loadCorpus", () => {
  it("loads every fixture and derives the slug from the filename", () => {
    expect(fixtures.map((d) => d.slug).sort()).toEqual([
      "duplicate-headings",
      "no-headings",
      "table-heavy",
    ]);
  });

  it("gives repeated headings distinct anchors", () => {
    const dup = fixtures.find((d) => d.slug === "duplicate-headings");
    expect(dup?.sections.map((s) => s.anchor)).toEqual(["process", "process-2", "process-3"]);
  });

  it("returns an empty corpus for a directory that does not exist", () => {
    expect(loadCorpus("content/kb/__does_not_exist__")).toEqual([]);
  });
});

describe("the live corpus", () => {
  // The whole point of the fixtures directory: it must never be searchable.
  it("does NOT include the fixtures", () => {
    expect(getCorpus().some((d) => d.slug.startsWith("no-headings"))).toBe(false);
  });

  it("parses without throwing, whatever is in it", () => {
    expect(() => getCorpus()).not.toThrow();
  });

  it("returns null for an unknown slug", () => {
    expect(getDocument("definitely-not-a-document")).toBeNull();
  });

  // Runs against the REAL content, so bad content fails CI rather than only
  // synthetic fixtures (spec §12).
  it("contains no guest PII and no malformed frontmatter", () => {
    expect(checkCorpus(getCorpus())).toEqual([]);
  });
});

describe("checkCorpus", () => {
  const bad = (body: string) =>
    parseKbDocument("offender", `---\ntitle: T\nsource: S\nsnapshotDate: 2026-08-07\n---\n\n${body}`);

  it("fails an email address", () => {
    expect(checkCorpus([bad("Contact jane.doe@example.com about it.")])[0].problem).toMatch(/email/i);
  });

  it("fails a phone number", () => {
    expect(checkCorpus([bad("Call (407) 555-0142 to confirm.")])[0].problem).toMatch(/phone/i);
  });

  it("fails a Guest Name column header", () => {
    expect(checkCorpus([bad("| Guest Name | Room |\n| --- | --- |\n| x | 1 |")])[0].problem).toMatch(
      /guest/i,
    );
  });

  it("fails a document with no body content", () => {
    expect(checkCorpus([bad("")])[0].problem).toMatch(/empty/i);
  });

  it("passes clean operational content", () => {
    expect(checkCorpus([bad("Serve the three-day notice, then file in county court.")])).toEqual([]);
  });
});

describe("search over the fixtures", () => {
  it("finds a unique word in a heading-less document", () => {
    const hits = rankSections("bufflehead", fixtures);
    expect(hits).toHaveLength(1);
    expect(hits[0].slug).toBe("no-headings");
    expect(hits[0].heading).toBeNull();
  });

  it("returns the honest empty result for a nonsense query", () => {
    expect(rankSections("zzzzqqqq", fixtures)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run lib/kb-corpus.test.ts`
Expected: FAIL — `Failed to resolve import "./kb-corpus"`.

- [ ] **Step 4: Write the corpus loader**

Create `lib/kb-corpus.ts`:

```ts
// Loads content/kb/*.md into memory once per server instance and exposes the
// two functions the pages call. This is the ONLY module in the KB that touches
// the filesystem, and the only place `searchKb` binds to the real corpus — so
// swapping the in-process index for Postgres FTS later (spec §3) changes this
// file and no callers.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseKbDocument, type KbDocument } from "./kb-parse";
import { outline, rankSections, type OutlineDoc, type SearchResult } from "./kb-search";

export const KB_DIR = join(process.cwd(), "content", "kb");

/** Test data. Lives under content/kb/ so it sits with the corpus, and is
 *  excluded from the live index for free: loadCorpus reads only *.md entries
 *  directly inside a directory, and this is a subdirectory. */
export const KB_FIXTURES_DIR = join(KB_DIR, "__fixtures__");

/** Parse every *.md in `dir`. Sorted by title so the corpus outline reads
 *  alphabetically. A missing directory is an empty corpus, not a crash — the
 *  repo has no content/kb/ until the real documents land. */
export function loadCorpus(dir: string = KB_DIR): KbDocument[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => parseKbDocument(e.name.replace(/\.md$/, ""), readFileSync(join(dir, e.name), "utf8")))
    .sort((a, b) => a.title.localeCompare(b.title));
}

let cached: KbDocument[] | null = null;

/** The live corpus, parsed once. */
export function getCorpus(): KbDocument[] {
  if (cached === null) cached = loadCorpus();
  return cached;
}

export function getDocument(slug: string): KbDocument | null {
  return getCorpus().find((d) => d.slug === slug) ?? null;
}

/** THE search interface (spec §3). Everything else calls this. */
export function searchKb(query: string): SearchResult[] {
  return rankSections(query, getCorpus());
}

export function corpusOutline(): OutlineDoc[] {
  return outline(getCorpus());
}
```

- [ ] **Step 5: Write the validator**

Create `lib/kb-check.ts`:

```ts
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
```

- [ ] **Step 6: Write the CLI wrapper**

Create `scripts/kb-check.mts`:

```ts
// CLI over lib/kb-check.ts, for checking the corpus without running the suite:
//   npx tsx scripts/kb-check.mts
// The same rules run inside lib/kb-corpus.test.ts, which is what actually gates
// CI. This exists for the authoring loop.
import { getCorpus } from "../lib/kb-corpus";
import { checkCorpus } from "../lib/kb-check";

const docs = getCorpus();
const problems = checkCorpus(docs);

console.log(`Checked ${docs.length} document(s) in content/kb/.`);
for (const p of problems) console.error(`  FAIL  ${p.slug}: ${p.problem}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s). Fix the corpus — this is not a warning.`);
  process.exit(1);
}
console.log("Corpus is clean.");
```

- [ ] **Step 7: Make the corpus survive deployment**

`fs.readFileSync` against a runtime-computed path is **not** traced by Next's bundler, so `content/kb/` would be absent from the Vercel deployment and the page would render an empty corpus in production while working perfectly on localhost. Pin it explicitly.

Modify `next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Cloudbeds credentials are read server-side only — never exposed to the client.
  // snowflake-sdk is a Node driver (native-ish deps); keep it out of the bundle
  // so the /api/cron/elise-sync route can require it at runtime.
  serverExternalPackages: ["snowflake-sdk"],
  // The KB corpus is read from disk at runtime (lib/kb-corpus.ts). Next traces
  // static imports, not readFileSync of a computed path, so without this the
  // markdown is simply missing from the deployment and /kb renders an empty
  // corpus in production while working locally. Fixtures are excluded — they are
  // test data and must never ship.
  outputFileTracingIncludes: {
    "/kb": ["./content/kb/*.md"],
    "/kb/[slug]": ["./content/kb/*.md"],
  },
};

export default nextConfig;
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run lib/kb-corpus.test.ts`
Expected: PASS. The "live corpus" block passes trivially against an empty corpus at this point — that is correct; Task 9 fills it and the same tests then guard real content.

Run: `npx tsx scripts/kb-check.mts`
Expected: `Checked 0 document(s) in content/kb/.` then `Corpus is clean.`

- [ ] **Step 9: Commit**

```bash
git add lib/kb-corpus.ts lib/kb-check.ts lib/kb-corpus.test.ts content/kb/__fixtures__ scripts/kb-check.mts next.config.mjs
git commit -m "feat(kb): load the corpus from disk, with fixtures and a PII validator"
```

---

### Task 6: Query logging

**Files:**
- Modify: `scripts/db-init.mjs` (append)
- Modify: `lib/db.ts` (append)
- Create: `lib/kb-log.ts`
- Test: `lib/kb-log.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `lib/db.ts`: `function insertKbQuery(query: string, resultCount: number): Promise<void>`
  - `lib/kb-log.ts`: `const KB_QUERY_MAX = 200`; `function normaliseQuery(q: string): string | null`; `function logKbQuery(query: string, resultCount: number): Promise<void>`

**Why two files:** the SQL lives in `lib/db.ts` with every other table in this repo, which is the established pattern. `lib/kb-log.ts` is the never-throws boundary the page calls, and is where the "delete this and logging is gone" seam sits (spec §8).

- [ ] **Step 1: Add the table DDL**

Append to `scripts/db-init.mjs`:

```js
// kb_queries: what people search the knowledgebase for, and how many sections
// came back. Result count ONLY — no user identity, no cookie, no level, no
// document contents (spec §8; CLAUDE.md §5 rule 2 unchanged).
//
// In v1 deliberately, against the minimal-scope instinct: what people search for
// and FAIL to find is the single best signal for which document to add next, and
// it cannot be reconstructed later. Deferring it would not save the work, it
// would destroy the data. Kyle kept it at spec review, 08/10/26.
await sql`
  create table if not exists kb_queries (
    id           bigserial primary key,
    query        text not null,
    result_count int  not null,
    created_at   timestamptz not null default now()
  )
`;
// "What found nothing, recently" is the query this table exists to answer.
await sql`
  create index if not exists kb_queries_misses_idx
    on kb_queries (created_at desc) where result_count = 0
`;
console.log("kb_queries table ready.");
```

- [ ] **Step 2: Write the failing test**

Create `lib/kb-log.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const insertKbQuery = vi.fn();
vi.mock("./db", () => ({ insertKbQuery: (...a: unknown[]) => insertKbQuery(...a) }));

import { logKbQuery, normaliseQuery, KB_QUERY_MAX } from "./kb-log";

beforeEach(() => insertKbQuery.mockReset());

describe("normaliseQuery", () => {
  it("collapses whitespace and trims", () => {
    expect(normaliseQuery("  eviction   process  ")).toBe("eviction process");
  });

  it("returns null for an empty or whitespace-only query", () => {
    expect(normaliseQuery("")).toBeNull();
    expect(normaliseQuery("   ")).toBeNull();
  });

  it("truncates an absurdly long query rather than storing it whole", () => {
    expect(normaliseQuery("x".repeat(5_000))).toHaveLength(KB_QUERY_MAX);
  });
});

describe("logKbQuery", () => {
  it("records the query and its result count", async () => {
    await logKbQuery(" eviction ", 3);
    expect(insertKbQuery).toHaveBeenCalledWith("eviction", 3);
  });

  it("does not record an empty query", async () => {
    await logKbQuery("   ", 0);
    expect(insertKbQuery).not.toHaveBeenCalled();
  });

  // A logging failure must never take the search page down with it.
  it("swallows a database error", async () => {
    insertKbQuery.mockRejectedValueOnce(new Error("DATABASE_URL is not set"));
    await expect(logKbQuery("eviction", 1)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run lib/kb-log.test.ts`
Expected: FAIL — `Failed to resolve import "./kb-log"`.

- [ ] **Step 4: Write the implementation**

Append to `lib/db.ts`:

```ts
// --- Knowledgebase query log (spec §8) --------------------------------------
// Query text + result count ONLY. No user identity, no level, no cookie, no
// document contents — CLAUDE.md §5 rule 2 is unchanged by this table.

/** Record one /kb search. Called only via lib/kb-log.ts, which owns the
 *  never-throws behaviour. */
export async function insertKbQuery(query: string, resultCount: number): Promise<void> {
  const sql = db();
  await sql`
    insert into kb_queries (query, result_count)
    values (${query}, ${resultCount})
  `;
}
```

Create `lib/kb-log.ts`:

```ts
// The /kb query log, isolated behind one function so it can be deleted without
// touching search (spec §8).
//
// What is stored: the normalised query string and how many sections came back.
// What is NOT stored: who searched, their PIN level, their session, their IP, or
// anything from the documents. The value is the MISSES — a query that returns 0
// is a document we do not have yet, and there is no way to reconstruct that
// after the fact.

import { insertKbQuery } from "./db";

/** Longer than any real search; a longer string is a paste or a probe. */
export const KB_QUERY_MAX = 200;

export function normaliseQuery(q: string): string | null {
  const t = q.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.slice(0, KB_QUERY_MAX);
}

/** Fire-and-forget. NEVER throws: a logging failure must not be able to break
 *  the search page, which is the whole point of the page working when other
 *  things do not. */
export async function logKbQuery(query: string, resultCount: number): Promise<void> {
  const normalised = normaliseQuery(query);
  if (!normalised) return;
  try {
    await insertKbQuery(normalised, resultCount);
  } catch (e) {
    console.error("[kb] could not log query:", e);
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/kb-log.test.ts`
Expected: PASS.

- [ ] **Step 6: Create the table**

Run: `node scripts/db-init.mjs`
Expected: output ending `kb_queries table ready.`

If `DATABASE_URL` is not set locally, skip this step and note it — Task 10 verifies the table on the deployment.

- [ ] **Step 7: Commit**

```bash
git add scripts/db-init.mjs lib/db.ts lib/kb-log.ts lib/kb-log.test.ts
git commit -m "feat(kb): log queries and result counts, no identity, never throws"
```

---

### Task 7: The search page

**Files:**
- Create: `app/kb/page.tsx`
- Modify: `lib/auth.ts:75-79` (`SHARED_PAGES`)
- Modify: `app/globals.css` (append `.kb-prose`)
- Test: `lib/kb-view.test.ts`
- Create: `lib/kb-view.ts`

**Interfaces:**
- Consumes: `searchKb`, `corpusOutline` (Task 5); `snapshotAge` (Task 2); `logKbQuery` (Task 6).
- Produces:
  - `lib/kb-view.ts`: `type KbView = { mode: "browse" | "results" | "empty"; query: string; results: SearchResult[]; outline: OutlineDoc[] }`; `function kbView(query: string, results: SearchResult[], docs: OutlineDoc[]): KbView`

**Why `lib/kb-view.ts`:** the three page states (browse / results / honest miss) are the part of the page worth testing, and a server component is not directly testable under vitest's node environment. The decision is a pure function; the page renders it.

- [ ] **Step 1: Write the failing test**

Create `lib/kb-view.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { kbView } from "./kb-view";
import type { SearchResult, OutlineDoc } from "./kb-search";

const docs: OutlineDoc[] = [
  { slug: "a", title: "A", source: "s", snapshotDate: "2026-08-07", headings: [] },
];
const hit: SearchResult = {
  slug: "a", title: "A", heading: "H", anchor: "h",
  snapshotDate: "2026-08-07", snippetHtml: "x", score: 1,
};

describe("kbView", () => {
  it("browses the whole corpus for an empty query", () => {
    const v = kbView("", [], docs);
    expect(v.mode).toBe("browse");
    expect(v.outline).toEqual(docs);
  });

  it("browses for a whitespace-only query too", () => {
    expect(kbView("   ", [], docs).mode).toBe("browse");
  });

  it("shows results when there are any", () => {
    const v = kbView("h", [hit], docs);
    expect(v.mode).toBe("results");
    expect(v.results).toEqual([hit]);
  });

  // The honest miss: say so, repeat the query, and show the corpus. Never pad.
  it("returns the empty state WITH the corpus for a query that found nothing", () => {
    const v = kbView("zzzz", [], docs);
    expect(v.mode).toBe("empty");
    expect(v.query).toBe("zzzz");
    expect(v.results).toEqual([]);
    expect(v.outline).toEqual(docs);
  });

  it("trims the echoed query", () => {
    expect(kbView("  zzzz  ", [], docs).query).toBe("zzzz");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/kb-view.test.ts`
Expected: FAIL — `Failed to resolve import "./kb-view"`.

- [ ] **Step 3: Write the view model**

Create `lib/kb-view.ts`:

```ts
// Which of the three /kb states to render. Pure, so the states are tested
// without a browser.
//
//   browse   no query — list the whole corpus so someone who does not know the
//            right word can still find the document
//   results  matches, ranked
//   empty    a real query that matched nothing. Says so, repeats what was
//            searched, and shows the corpus list. It NEVER pads with weak fuzzy
//            matches: a confident bad match is worse than an honest miss — the
//            same rule /ops follows for empty funnel stages.

import type { OutlineDoc, SearchResult } from "./kb-search";

export type KbView = {
  mode: "browse" | "results" | "empty";
  query: string;
  results: SearchResult[];
  outline: OutlineDoc[];
};

export function kbView(query: string, results: SearchResult[], docs: OutlineDoc[]): KbView {
  const q = query.trim();
  if (!q) return { mode: "browse", query: "", results: [], outline: docs };
  if (results.length) return { mode: "results", query: q, results, outline: docs };
  return { mode: "empty", query: q, results: [], outline: docs };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/kb-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `/kb` to the nav**

Modify `lib/auth.ts`, in `SHARED_PAGES`:

```ts
export const SHARED_PAGES: PageLink[] = [
  { href: "/", label: "Home" },
  { href: "/ops", label: "Operations" },
  { href: "/report", label: "Revenue Report" },
  { href: "/kb", label: "Knowledgebase" },
];
```

No other auth change is needed. `canAccess` already falls through to "any authenticated, non-restricted level" for unrecognised routes (`lib/auth.ts:60-69`), so `/kb` is gated at the MAIN pin automatically, `exec` sees it, and the fully-isolated `elise` level cannot reach it.

- [ ] **Step 6: Add the prose styles**

Append to `app/globals.css`:

```css
/* ---------------------------------------------------------------------------
   .kb-prose — the ONLY place rendered knowledgebase markdown is styled.
   Tailwind's preflight strips list markers, table borders and heading sizes, so
   HTML that marked emits needs these back. Design tokens only; no literal
   colours (see the token block above).
   --------------------------------------------------------------------------- */
.kb-prose {
  @apply text-[14px] leading-[1.65] text-txt2;
}
.kb-prose > * + * {
  @apply mt-3.5;
}
.kb-prose h3 {
  @apply mt-6 text-[14.5px] font-semibold tracking-[-.01em] text-txt;
}
.kb-prose h4,
.kb-prose h5,
.kb-prose h6 {
  @apply mt-5 text-[13.5px] font-semibold text-txt;
}
.kb-prose strong {
  @apply font-semibold text-txt;
}
.kb-prose a {
  @apply text-accent underline underline-offset-2;
}
.kb-prose ul {
  @apply list-disc space-y-1.5 pl-5;
}
.kb-prose ol {
  @apply list-decimal space-y-1.5 pl-5;
}
.kb-prose li > ul,
.kb-prose li > ol {
  @apply mt-1.5;
}
.kb-prose blockquote {
  @apply border-l-[3px] border-line pl-4 text-txt3;
}
.kb-prose code {
  @apply rounded bg-surface3 px-1 py-0.5 text-[12.5px];
}
.kb-prose pre {
  @apply overflow-x-auto rounded-[8px] border border-line bg-surface2 p-3.5 text-[12.5px];
}
.kb-prose pre code {
  @apply bg-transparent p-0;
}
.kb-prose hr {
  @apply border-t border-line;
}
/* Excel-derived content is mostly tables — this is the load-bearing part.
   The wrapper scrolls so a wide table never scrolls the page body sideways. */
.kb-prose .kb-table-scroll {
  @apply -mx-1 overflow-x-auto px-1;
}
.kb-prose table {
  @apply w-full border-collapse text-[13px];
}
.kb-prose thead th {
  @apply whitespace-nowrap border-b border-line bg-surface2 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[.06em] text-txt3;
}
.kb-prose tbody td {
  @apply border-b border-line px-3 py-2 align-top;
}
.kb-prose tbody tr:last-child td {
  @apply border-b-0;
}
/* Search-result highlighting. */
mark {
  @apply rounded-[3px] bg-gold/35 px-0.5 text-txt;
}
/* Anchored sections must clear the sticky top chrome when linked to. */
.kb-anchor {
  scroll-margin-top: 104px;
}
```

- [ ] **Step 7: Write the search page**

Create `app/kb/page.tsx`:

```tsx
import Link from "next/link";
import { Card, CardHead, Notice, PageHead } from "@/components/ui";
import { corpusOutline, searchKb } from "@/lib/kb-corpus";
import { snapshotAge } from "@/lib/kb-parse";
import { kbView } from "@/lib/kb-view";
import { logKbQuery } from "@/lib/kb-log";
import { easternToday } from "@/lib/dates";
import type { OutlineDoc } from "@/lib/kb-search";

// Company documents and SOPs, searchable. Search only — there is no LLM here
// (spec §1). A search box keeps working when a model, a key or a provider does
// not, which is most of why it ships.
//
// Gated at the MAIN pin with no access-control code of its own: canAccess falls
// through to "any authenticated, non-restricted level" for unrecognised routes,
// so exec sees it and the isolated elise level cannot reach it.
export const dynamic = "force-dynamic";

export const metadata = { title: "Stayable — Knowledgebase" };

function Snapshot({ date, today }: { date: string; today: string }) {
  const age = snapshotAge(date, today);
  return (
    <span className={age.stale ? "text-warn" : "text-txt3"} title="When this copy was taken">
      {age.text}
    </span>
  );
}

function CorpusList({ docs, today }: { docs: OutlineDoc[]; today: string }) {
  if (!docs.length) {
    return <Notice tone="warn">The knowledgebase has no documents in it yet.</Notice>;
  }
  return (
    <ul className="divide-y divide-line">
      {docs.map((d) => (
        <li key={d.slug} className="px-5 py-3.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Link href={`/kb/${d.slug}`} className="text-[14px] font-semibold text-txt hover:text-accent">
              {d.title}
            </Link>
            <span className="text-[11.5px]">
              <Snapshot date={d.snapshotDate} today={today} />
            </span>
          </div>
          {d.headings.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1">
              {d.headings.map((h) => (
                <Link
                  key={h.anchor}
                  href={`/kb/${d.slug}#${h.anchor}`}
                  className="rounded border border-line px-1.5 py-0.5 text-[11.5px] text-txt3 hover:border-accent hover:text-accent"
                >
                  {h.heading}
                </Link>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function KbPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.q) ? (params.q[0] ?? "") : (params.q ?? "");
  const today = easternToday();

  const results = raw.trim() ? searchKb(raw) : [];
  const view = kbView(raw, results, corpusOutline());

  // Query logging (spec §8): text + count only, no identity. Awaited rather than
  // floated so the write is not cut off when the response finishes; it can never
  // throw (lib/kb-log.ts).
  if (view.mode !== "browse") await logKbQuery(view.query, view.results.length);

  return (
    <main className="mx-auto max-w-[1100px] space-y-4 px-4 py-5 sm:px-6">
      <PageHead
        eyebrow="Stayable · RISE8"
        title="Knowledgebase"
        sub="Company documents and SOPs. Search returns the section that answers you, with its source and snapshot date."
      />

      <Card>
        <form action="/kb" method="get" className="flex flex-wrap gap-2 p-4">
          <input
            type="search"
            name="q"
            defaultValue={view.query}
            autoFocus
            placeholder="e.g. eviction process in Osceola"
            aria-label="Search the knowledgebase"
            className="h-10 min-w-0 flex-1 rounded-md border border-lineStrong bg-surface px-3 text-[14px] text-txt placeholder:text-txt3 focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Search
          </button>
          {view.query && (
            <Link
              href="/kb"
              className="inline-flex h-10 items-center rounded-md border border-lineStrong px-3 text-[13px] font-semibold text-txt2 hover:border-accent hover:text-accent"
            >
              Clear
            </Link>
          )}
        </form>
      </Card>

      {view.mode === "results" && (
        <Card>
          <CardHead
            title={`${view.results.length} ${view.results.length === 1 ? "section" : "sections"} for “${view.query}”`}
            hint="Ranked by exact phrase in a heading, then in the text, then by how many of your words appear."
          />
          <ul className="divide-y divide-line">
            {view.results.map((r) => (
              <li key={`${r.slug}#${r.anchor}`} className="px-5 py-4">
                <Link
                  href={`/kb/${r.slug}#${r.anchor}`}
                  className="text-[14px] font-semibold text-txt hover:text-accent"
                >
                  {r.title}
                  {r.heading && <span className="text-txt3"> → </span>}
                  {r.heading}
                </Link>
                <div className="mt-1 text-[11.5px]">
                  <Snapshot date={r.snapshotDate} today={today} />
                </div>
                <p
                  className="mt-2 text-[13px] leading-[1.6] text-txt2"
                  // snippetHtml is escaped then highlighted in lib/kb-search.ts —
                  // the only markup it can contain is <mark>.
                  dangerouslySetInnerHTML={{ __html: r.snippetHtml }}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {view.mode === "empty" && (
        <Notice tone="warn">
          Nothing in the knowledgebase matches <strong>“{view.query}”</strong>. Everything we have is
          listed below — nothing is being hidden, and no weak matches are being shown in place of a
          real one.
        </Notice>
      )}

      <Card>
        <CardHead
          title="Everything in the knowledgebase"
          hint={
            view.mode === "results"
              ? "Browse the full corpus."
              : "Every document, with its sections. Snapshot dates are when the copy was taken — the originals may have moved on since."
          }
        />
        <CorpusList docs={view.outline} today={today} />
      </Card>
    </main>
  );
}
```

- [ ] **Step 8: Typecheck and run the whole suite**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npm test`
Expected: all tests pass, including the pre-existing 325.

- [ ] **Step 9: Verify the page in the running app**

Run: `npm run dev`, then open `http://localhost:3000/kb` (log in with the MAIN pin first).
Expected: the search box renders; with an empty corpus the list card shows "The knowledgebase has no documents in it yet."; a search echoes the query and shows the honest miss.

- [ ] **Step 10: Commit**

```bash
git add app/kb/page.tsx lib/kb-view.ts lib/kb-view.test.ts lib/auth.ts app/globals.css
git commit -m "feat(kb): search page with browse, results, and an honest no-result state"
```

---

### Task 8: The document page

**Files:**
- Create: `app/kb/[slug]/page.tsx`

**Interfaces:**
- Consumes: `getCorpus`, `getDocument` (Task 5); `renderMarkdown` (Task 4); `snapshotAge` (Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the page**

Create `app/kb/[slug]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHead, PageHead } from "@/components/ui";
import { getCorpus, getDocument } from "@/lib/kb-corpus";
import { renderMarkdown } from "@/lib/kb-markdown";
import { snapshotAge } from "@/lib/kb-parse";
import { easternToday } from "@/lib/dates";

// One knowledgebase document. Sections are rendered individually so the <h2>
// carries the anchor produced by splitSections — the SAME anchor search links
// to. marked never generates an id here, so the two cannot drift apart.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDocument(slug);
  return { title: doc ? `${doc.title} — Stayable Knowledgebase` : "Not found — Stayable Knowledgebase" };
}

export default async function KbDocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDocument(slug);
  if (!doc) notFound();

  const today = easternToday();
  const age = snapshotAge(doc.snapshotDate, today);
  const headings = doc.sections.filter((s) => s.heading !== null);
  const others = getCorpus().filter((d) => d.slug !== doc.slug);

  return (
    <main className="mx-auto max-w-[1100px] space-y-4 px-4 py-5 sm:px-6">
      <PageHead
        eyebrow="Knowledgebase"
        title={doc.title}
        sub={
          <>
            {doc.source}
            {doc.counties.length > 0 && ` · ${doc.counties.join(", ")}`}
          </>
        }
      >
        <Link href="/kb" className="inline-flex h-8 items-center rounded-md border border-chromeLine bg-white/[.06] px-3 text-xs font-semibold text-chromeText transition-colors hover:bg-white/[.14]">
          ← Search
        </Link>
      </PageHead>

      <div
        className={
          "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border px-4 py-2.5 text-[12.5px] " +
          (age.stale ? "border-warn/30 bg-warnbg text-warn" : "border-line bg-surface2 text-txt3")
        }
      >
        <span className="font-semibold">{age.text}</span>
        <span>
          This is a copy taken on that date. The original may have changed since — it is not synced.
        </span>
        {doc.sourceUrl && (
          <a
            href={doc.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto font-semibold text-accent underline underline-offset-2"
          >
            Open the original ↗
          </a>
        )}
      </div>

      {headings.length > 1 && (
        <Card>
          <CardHead title="Sections" />
          <div className="flex flex-wrap gap-2 px-5 py-3.5">
            {headings.map((s) => (
              <a
                key={s.anchor}
                href={`#${s.anchor}`}
                className="rounded border border-line px-2 py-1 text-[12px] text-txt2 hover:border-accent hover:text-accent"
              >
                {s.heading}
              </a>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="px-5 py-5 sm:px-6">
          {doc.sections.map((s) => (
            <section key={s.anchor} id={s.anchor} className="kb-anchor mb-7 last:mb-0">
              {s.heading && (
                <h2 className="mb-2.5 text-[15px] font-semibold tracking-[-.01em] text-txt">
                  {s.heading}
                </h2>
              )}
              <div
                className="kb-prose"
                // Rendered by lib/kb-markdown.ts, which neutralises raw HTML.
                dangerouslySetInnerHTML={{ __html: renderMarkdown(s.body) }}
              />
            </section>
          ))}
        </div>
      </Card>

      {others.length > 0 && (
        <Card>
          <CardHead title="Other documents" />
          <ul className="divide-y divide-line">
            {others.map((d) => (
              <li key={d.slug} className="px-5 py-2.5">
                <Link href={`/kb/${d.slug}`} className="text-[13.5px] text-txt2 hover:text-accent">
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Wrap tables so a wide one scrolls itself**

`marked` emits a bare `<table>`. The `.kb-prose .kb-table-scroll` rule added in Task 7 needs that wrapper to exist. Add it in `lib/kb-markdown.ts`, in the same `md.use({ renderer: … })` call as `html`:

```ts
    table(token: { header: unknown[]; rows: unknown[][] }) {
      // `this.parser` is marked's own renderer context — call through to the
      // default implementation, then wrap it. A wide Excel-derived table must
      // scroll inside its own box, never scroll the page body sideways.
      const html = defaultTable.call(this as never, token as never);
      return `<div class="kb-table-scroll">${html}</div>`;
    },
```

with, above the `md.use(...)` call:

```ts
import { Marked, Renderer } from "marked";

const defaultTable = Renderer.prototype.table;
```

Add the matching test to `lib/kb-markdown.test.ts`:

```ts
  it("wraps a table in its own horizontal scroller", () => {
    const html = renderMarkdown("| A | B |\n| --- | --- |\n| 1 | 2 |\n");
    expect(html).toContain('<div class="kb-table-scroll">');
    expect(html.indexOf('kb-table-scroll')).toBeLessThan(html.indexOf("<table"));
  });
```

Run: `npx vitest run lib/kb-markdown.test.ts`
Expected: PASS.

If calling through to `Renderer.prototype.table` does not work in the installed version, replace the wrapper with the simpler equivalent: leave the renderer alone and instead apply the scroll styling directly to `.kb-prose table` by giving it `@apply block max-w-full overflow-x-auto` — then delete this step's renderer override and its test. Note which route you took in the commit message.

- [ ] **Step 3: Typecheck and run the whole suite**

Run: `npx tsc --noEmit && npm test`
Expected: exit 0, all tests pass.

- [ ] **Step 4: Verify against the fixtures**

To see a real document before the corpus exists, temporarily copy one fixture into the live corpus:

```bash
cp content/kb/__fixtures__/table-heavy.md content/kb/tmp-preview.md
```

Run `npm run dev`, open `http://localhost:3000/kb`, search `filing`, follow the result link and confirm: the table renders with borders and a header strip, the anchor scrolls to the right section, and the snapshot line shows. Then:

```bash
rm content/kb/tmp-preview.md
```

Confirm it is gone before committing — `git status` must show no `content/kb/tmp-preview.md`.

- [ ] **Step 5: Verify the 404**

Open `http://localhost:3000/kb/definitely-not-a-document`.
Expected: the Next 404 page, not a crash.

- [ ] **Step 6: Commit**

```bash
git add app/kb/[slug]/page.tsx lib/kb-markdown.ts lib/kb-markdown.test.ts
git commit -m "feat(kb): document view with section anchors and scrollable tables"
```

---

### Task 9: Author the real corpus

**Files:**
- Create: `content/kb/<slug>.md` — one per source document

**Blocked on Kyle** supplying the three sources (a website, the live SharePoint Excel, and possibly one more). Everything before this task is unblocked; **this task is what ship criterion 2 gates on — an empty KB is worse than no KB.**

- [ ] **Step 1: Collect the sources**

Get from Kyle, for each document: the file or URL, and a one-line statement of what it is authoritative for. Record where each came from — it becomes the `source:` field, and a reader who cannot tell where a procedure came from cannot trust it.

- [ ] **Step 2: Author one markdown file per source document**

Filename is the slug: lowercase, hyphenated, describing the document (`eviction-filing-process.md`). This is a framework/content file, not a generated report, so the `Title_PropertyID_MMDDYY` convention does not apply (CLAUDE.md §7 exception).

Every file starts with:

```markdown
---
title: Eviction filing process
source: SharePoint — Operations/SOPs/Evictions.xlsx
sourceUrl: https://…
snapshotDate: 2026-08-10
counties: [Osceola, Duval]
---
```

Rules while authoring:

- **`snapshotDate` is the date the copy was taken**, not the date the original was written. It is what the page shows and what the staleness flag reads.
- **Split on real headings.** A section is the unit a result cites, so a heading should be the thing someone would search for ("Notice period", not "Section 2").
- **Excel sheets become GFM tables.** Keep the column headers as written; they are what people search for.
- **No guest PII.** No names, emails, phone numbers, reservation numbers, or "Guest Name" columns. The validator catches the obvious cases and will not catch a name in prose — that one is on you at authoring time.
- **Nothing that needs narrower distribution.** Every MAIN-pin holder sees the whole corpus; there are no per-document permissions (spec §9, confirmed by Kyle 08/10/26).

- [ ] **Step 3: Validate the corpus**

Run: `npx tsx scripts/kb-check.mts`
Expected: `Checked N document(s)` then `Corpus is clean.` Fix any reported problem in the content — do not weaken a rule to make it pass.

- [ ] **Step 4: Run the suite against the real content**

Run: `npm test`
Expected: PASS, including `lib/kb-corpus.test.ts`'s "contains no guest PII and no malformed frontmatter" against the real corpus.

- [ ] **Step 5: Search it like a user**

Run `npm run dev`, open `/kb`, and check two things by hand:

1. A term you know is in the source returns the **right section** as the first result.
2. A nonsense search returns the honest no-result state with the corpus listed — and no weak match.

- [ ] **Step 6: Commit**

```bash
git add content/kb
git commit -m "content(kb): author the initial knowledgebase corpus"
```

---

### Task 10: Ship

**Files:** none — verification only.

- [ ] **Step 1: Full local verification**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npm test`
Expected: every test passes. Record the count (it was 325 before this work).

Run: `npm run build`
Expected: a clean production build, with `/kb` and `/kb/[slug]` listed in the route output.

- [ ] **Step 2: Push**

```bash
git push -u origin claude/nifty-thompson-ts8zny
```

Do **not** open a pull request.

- [ ] **Step 3: Confirm the production table exists**

If `node scripts/db-init.mjs` was skipped in Task 6, run it now against the production `DATABASE_URL`, or confirm `kb_queries` exists. A missing table does not break the page — `logKbQuery` swallows the error — which means it will fail **silently**, so check it rather than assuming.

- [ ] **Step 4: Verify on the deployment (spec §13)**

Against the production URL, confirm each of these and record the actual result:

1. `/kb` **307s to `/login`** when unauthenticated. This is the ship-blocking check.
   `curl -sS -o /dev/null -w "%{http_code}\n" https://<prod>/kb`
2. With the MAIN pin, `/kb` loads and lists the corpus.
3. **The corpus is not empty in production.** This is the specific thing `outputFileTracingIncludes` exists to prevent — if the list card says "no documents in it yet" on the deployment but works locally, the tracing config did not take effect.
4. `/kb/<slug>` renders, and its **tables render as tables**.
5. An unknown slug 404s.
6. A search for a term you know is in the corpus returns the right section; a nonsense search returns the honest no-result state.

- [ ] **Step 5: Update TODO.md**

Add a session entry recording: what shipped, the deployment id, the test count, the live smoke results from Step 4, and anything that came out differently from this plan — particularly the `marked` renderer-key question in Task 4 Step 5 and the table-wrapper fallback in Task 8 Step 2, since both were flagged as version-dependent.

- [ ] **Step 6: Commit**

```bash
git add TODO.md
git commit -m "docs: record the /kb knowledgebase release"
git push
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 search only, no LLM | whole plan — no AI dependency is added |
| §2 sources, fixtures, launch gates on real content | 5 (fixtures), 9 (real corpus) |
| §3 markdown in repo, no DB, section chunking, one `searchKb()` | 1, 5 |
| §4 routing, no auth changes but `SHARED_PAGES` | 7 step 5; verified in 10 step 4.1 |
| §5 GET form, ranking order, snippets, empty + no-result states | 3, 7 |
| §6 snapshot dates and staleness threshold | 2, 7, 8 |
| §7 `marked`, raw HTML off, tables | 4, 8 |
| §8 query logging, result count only, isolated, never throws | 6 |
| §9 out of scope | nothing built for them |
| §10 no guest PII, enforced as a test failure | 5 |
| §11 modules | file structure table (two deliberate additions, both explained) |
| §12 testing | 1, 2, 3, 4, 5, 6, 7 |
| §13 ship criteria | 10 |

**Additions beyond the spec's module list, each with a reason stated in place:** `lib/kb-corpus.ts` (the spec folded loading into `kb-parse`; splitting it keeps `kb-search` pure and gives the Postgres-FTS swap a single seam), `lib/kb-check.ts` (the spec's `scripts/kb-check.mts` is outside vitest's glob, and §12 requires the validator to run in the suite), `lib/kb-view.ts` (makes the three page states testable without a browser).

**Two version-dependent steps are flagged rather than assumed**, both in `marked`: the renderer key for inline raw HTML (Task 4 Step 5) and calling through to the default table renderer (Task 8 Step 2). Each has a stated fallback and a test that fails loudly if the assumption is wrong.

**One accepted imprecision, recorded rather than hidden:** phrase matching in `rankSections` compares against raw lowercased text, so it does not see plural folding — searching "evictions process" will not get the heading-phrase bonus on a heading reading "eviction process". Coverage scoring still ranks it well. Fixing it properly means positional token indexing, which is more machinery than this corpus justifies.
