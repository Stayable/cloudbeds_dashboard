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
