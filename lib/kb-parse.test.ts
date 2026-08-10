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
