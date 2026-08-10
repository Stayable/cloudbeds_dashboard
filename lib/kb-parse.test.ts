import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  slugifyHeading,
  splitSections,
  parseKbDocument,
  daysSince,
  snapshotAge,
  STALE_AFTER_DAYS,
} from "./kb-parse";

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

  it("throws when a fenced code block is unclosed", () => {
    expect(() =>
      splitSections("## A\n\nBody A\n\n```\nunclosed fence\n\n## B (should this be swallowed?)\n\nMore text\n")
    ).toThrow(/unclosed|fenced|block/i);
  });

  it("properly parses a document with a closed fenced block followed by more headings", () => {
    const secs = splitSections("## Real\n\n```bash\ncode block\n```\n\n## After\n\nMore text.\n");
    expect(secs).toHaveLength(2);
    expect(secs.map((s) => s.anchor)).toEqual(["real", "after"]);
  });

  it("gives three duplicate headings unique anchors", () => {
    const secs = splitSections("## Process\n\nA\n\n## Process\n\nB\n\n## Process\n\nC\n");
    expect(secs.map((s) => s.anchor)).toEqual(["process", "process-2", "process-3"]);
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

  it("names the file when an unclosed fenced block is encountered", () => {
    const badFence = `---\ntitle: X\nsource: Y\nsnapshotDate: 2026-08-07\n---\n\n## A\n\nBody\n\n\`\`\`\nunclosed\n\n## B\n`;
    expect(() => parseKbDocument("my-doc", badFence)).toThrow(/my-doc/);
  });

  it("rejects a calendar-invalid snapshotDate like February 30, naming the slug", () => {
    const badDate = `---\ntitle: X\nsource: Y\nsnapshotDate: 2026-02-30\n---\n\nBody.\n`;
    expect(() => parseKbDocument("bad-calendar", badDate)).toThrow(/bad-calendar.*calendar.*date/i);
  });

  it("accepts a valid leap day like 2028-02-29", () => {
    const leapDay = `---\ntitle: X\nsource: Y\nsnapshotDate: 2028-02-29\n---\n\nBody.\n`;
    const doc = parseKbDocument("leap", leapDay);
    expect(doc.snapshotDate).toBe("2028-02-29");
  });
});

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

  it("returns 0 for a calendar-impossible date like 2026-13-45", () => {
    expect(daysSince("2026-13-45", "2026-08-19")).toBe(0);
  });

  it("returns 0 for February 30, which does not exist", () => {
    expect(daysSince("2026-02-30", "2026-08-19")).toBe(0);
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

  it("does NOT render a plausible-looking but calendar-impossible stamp like 13/45/26", () => {
    const result = snapshotAge("2026-13-45", "2026-08-19");
    expect(result.text).not.toContain("13/45/26");
    // Explicitly check that the raw invalid input appears instead
    expect(result.text).toContain("2026-13-45");
  });

  it("does not understate age for February 30 by rolling to March 2", () => {
    const result = snapshotAge("2026-02-30", "2026-08-19");
    // February 30 is invalid; daysSince returns 0 so age reads "today",
    // not the March 2 calculation.
    expect(result.text).toContain("today");
  });
});
