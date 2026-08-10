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
