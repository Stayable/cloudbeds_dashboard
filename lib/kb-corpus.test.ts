import { join } from "node:path";
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

  // The path-naming wrapper (lib/kb-corpus.ts) is the one piece of production
  // logic beyond the brief's literal code, and the direct implementation of
  // the fail-loud decision: without it, some parse errors (e.g. a document
  // missing its frontmatter block entirely) bubble up with no idea which file
  // failed. Kept in its own __fixtures__/broken/ directory, never read by
  // loadCorpus(KB_FIXTURES_DIR) above, so a deliberately-broken document does
  // not take the rest of the fixture suite down with it.
  it("names the offending file's path when a document fails to parse", () => {
    const brokenDir = join(KB_FIXTURES_DIR, "broken");
    const brokenFile = join(brokenDir, "bad-frontmatter.md");
    expect(() => loadCorpus(brokenDir)).toThrow(brokenFile);
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

  // A spreadsheet paste losing its punctuation is exactly how this corpus is
  // built — the bare-digit half of the phone rule exists for this case.
  it("fails a bare unformatted 10-digit phone number", () => {
    expect(checkCorpus([bad("Call 4075550142 to confirm.")])[0].problem).toMatch(/phone/i);
  });

  // The bare-digit rule is bounded on both sides so it cannot match a 10-digit
  // slice of something longer or differently-shaped. These four are the
  // representative "looks numeric but isn't a phone number" shapes that show
  // up in real SOP content: a dollar figure, a date range, a version string,
  // a room-number range. False-positiving on any of these blocks a build over
  // legitimate content with no clue to the author why.
  it("does not false-positive on a dollar figure", () => {
    expect(checkCorpus([bad("The filing fee comes to $1,234,567.89 total.")])).toEqual([]);
  });

  it("does not false-positive on a date range", () => {
    expect(checkCorpus([bad("Coverage runs 08/07/2026-08/10/2026 for this property.")])).toEqual([]);
  });

  it("does not false-positive on a version string", () => {
    expect(checkCorpus([bad("Running schema version 3.2.1 in production.")])).toEqual([]);
  });

  it("does not false-positive on a room-number range", () => {
    expect(checkCorpus([bad("Rooms 1010-1020 are out of service this week.")])).toEqual([]);
  });

  // NANP forbids an area code or exchange code starting with 0 or 1 — the
  // discriminator the bare-digit rule now requires. These two are not
  // arbitrary: they are the literal shape of a SharePoint `sourcedoc` GUID
  // prefix and a OneDrive `d=w...` share-link suffix, both of which land in
  // sourceUrl values once Task 9's real corpus (authored from OneDrive) is
  // in place.
  it("does not false-positive on a 10-digit run whose area code starts with 1", () => {
    expect(checkCorpus([bad("Confirmation number 1234567890 was issued.")])).toEqual([]);
  });

  it("does not false-positive on a 10-digit run whose area code starts with 0", () => {
    expect(checkCorpus([bad("Invoice #0987654321 due on receipt.")])).toEqual([]);
  });

  // The published company contact points are allowlisted (see kb-check.ts). The
  // property directory is one of the most-searched things in the corpus, and
  // every value below is already on rentstayable.com's public contact page.
  // Both directions are pinned: allowlisted values pass, and a guest's personal
  // address or number sitting in the SAME sentence still fails — the widening
  // must not become a hole.
  it("allows a published property front-desk phone number", () => {
    expect(checkCorpus([bad("Kissimmee West front desk: +1 (855) 305-5357.")])).toEqual([]);
  });

  it("allows a published property phone number written without punctuation", () => {
    expect(checkCorpus([bad("Davenport front desk: 8777590804.")])).toEqual([]);
  });

  it("allows a company mailbox on the rentstayable.com domain", () => {
    expect(checkCorpus([bad("Email jaxwest@rentstayable.com for details.")])).toEqual([]);
  });

  it("still fails a guest email even beside an allowed company mailbox", () => {
    const problems = checkCorpus([
      bad("Forward from jaxwest@rentstayable.com to jane.doe@gmail.com."),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toContain("jane.doe@gmail.com");
  });

  it("still fails an unlisted phone number even beside an allowed one", () => {
    const problems = checkCorpus([bad("Front desk (855) 305-5357, guest cell (407) 555-0142.")]);
    expect(problems).toHaveLength(1);
    expect(problems[0].problem).toContain("(407) 555-0142");
  });

  it("fails a Guest Name column header", () => {
    expect(checkCorpus([bad("| Guest Name | Room |\n| --- | --- |\n| x | 1 |")])[0].problem).toMatch(
      /guest/i,
    );
  });

  it("fails a document with no body content", () => {
    expect(checkCorpus([bad("")])[0].problem).toMatch(/empty/i);
  });

  // The emptiness check is judged on body text, not heading text — a document
  // that is only skeleton headings with no prose under any of them has zero
  // real content, which is what "no body content" is supposed to mean.
  it("fails a document that has headings but no prose under any of them", () => {
    const headingsOnly = parseKbDocument(
      "offender",
      "---\ntitle: T\nsource: S\nsnapshotDate: 2026-08-07\n---\n\n## One\n\n## Two\n",
    );
    expect(checkCorpus([headingsOnly])[0].problem).toMatch(/empty/i);
  });

  // Global matching (minor fix): an author fixing PII one build at a time is a
  // bad afternoon. Every match in the document must be reported, not just the
  // first.
  it("reports every email address, not just the first", () => {
    const problems = checkCorpus([bad("Contact a@example.com and also b@example.com.")]);
    expect(problems).toHaveLength(2);
  });

  // The constraint (CLAUDE.md §5 rule 2) is file-level. A leak sitting in a
  // hand-authored frontmatter scalar is just as real as one in the body.
  it("catches PII sitting in a frontmatter scalar, not just in the body", () => {
    const leaky = parseKbDocument(
      "offender",
      "---\ntitle: T\nsource: jane.doe@example.com\nsnapshotDate: 2026-08-07\n---\n\nClean body text with no PII.",
    );
    expect(checkCorpus([leaky])[0].problem).toMatch(/email/i);
  });

  // sourceUrl is the boundary the review drew: it is a machine-generated link,
  // not authored prose, so it is deliberately NOT scanned. Pin both sides —
  // an email in source: still fails (test above), the identical email in
  // sourceUrl does not.
  const withSourceUrl = (sourceUrl: string) =>
    parseKbDocument(
      "offender",
      `---\ntitle: T\nsource: S\nsourceUrl: ${sourceUrl}\nsnapshotDate: 2026-08-07\n---\n\nClean body text with no PII.`,
    );

  it("does not scan sourceUrl for an email address", () => {
    expect(
      checkCorpus([withSourceUrl("https://contoso.sharepoint.com/sites/x?contact=jane.doe@example.com")]),
    ).toEqual([]);
  });

  it("does not scan sourceUrl for the digit runs real SharePoint/OneDrive links carry", () => {
    const realWorldLinks = [
      "https://contoso.sharepoint.com/sites/x/EabcDEF1234567890ghijk?e=abc123",
      "https://contoso.sharepoint.com/sites/x/doc2.aspx?sourcedoc=%7B1234567890AB-CDEF-1111-2222-333344445555%7D",
      "https://contoso-my.sharepoint.com/personal/x/SOP.docx?d=w0987654321",
    ];
    for (const url of realWorldLinks) {
      expect(checkCorpus([withSourceUrl(url)])).toEqual([]);
    }
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
