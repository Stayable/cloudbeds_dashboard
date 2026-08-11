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

  it("wraps a table in its own horizontal scroller", () => {
    const html = renderMarkdown("| A | B |\n| --- | --- |\n| 1 | 2 |\n");
    expect(html).toContain('<div class="kb-table-scroll">');
    expect(html.indexOf('kb-table-scroll')).toBeLessThan(html.indexOf("<table"));
  });
});

// A `javascript:` (or any other dangerous-scheme) href is a SECOND route to
// executable markup, separate from the raw-HTML route covered above: it is
// ordinary markdown link/autolink/image syntax resolving to a dangerous
// attribute value, so HTML-escaping the token text (the defence above) gives
// this route no protection at all. marked's own URL handling is only
// encodeURI(), with no scheme allow/deny-list of its own.
describe("renderMarkdown — link/image href safety", () => {
  it("strips the anchor from a javascript: link but keeps the link text", () => {
    const html = renderMarkdown("[click me](javascript:alert(1))\n");
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("<a");
    expect(html).toContain("click me");
  });

  it("strips the anchor from a bare javascript: autolink", () => {
    const html = renderMarkdown("<javascript:alert(1)>\n");
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("<a");
  });

  it("catches a mixed-case JaVaScRiPt: scheme", () => {
    const html = renderMarkdown("[x](JaVaScRiPt:alert(1))\n");
    expect(html).not.toContain('href="');
    expect(html).not.toContain("<a");
  });

  it("catches a javascript: scheme hidden behind leading whitespace", () => {
    const html = renderMarkdown("[x](\t\tjavascript:alert(1))\n");
    expect(html).not.toContain('href="');
    expect(html).not.toContain("<a");
  });

  it("rejects a data: URL image", () => {
    const html = renderMarkdown("![x](data:text/html,<script>alert(1)</script>)\n");
    expect(html).not.toContain('src="data:');
    expect(html).not.toContain("<img");
  });

  it("still renders an ordinary https: link as a working anchor", () => {
    const html = renderMarkdown("[the form](https://example.invalid/f)\n");
    expect(html).toContain('href="https://example.invalid/f"');
    expect(html).toContain("<a");
  });

  // Relative links and same-page anchors are how the corpus actually
  // cross-links documents (splitSections-produced anchors, per-doc slugs) —
  // these are exactly what an over-eager allowlist would break.
  it("still renders a relative link as a working anchor", () => {
    const html = renderMarkdown("[other doc](/kb/some-doc)\n");
    expect(html).toContain('href="/kb/some-doc"');
    expect(html).toContain("<a");
  });

  it("still renders a same-page anchor link as a working anchor", () => {
    const html = renderMarkdown("[jump](#notice-period)\n");
    expect(html).toContain('href="#notice-period"');
    expect(html).toContain("<a");
  });

  it("still renders a mailto: link as a working anchor", () => {
    const html = renderMarkdown("[email us](mailto:ops@example.invalid)\n");
    expect(html).toContain('href="mailto:ops@example.invalid"');
    expect(html).toContain("<a");
  });

  it("still renders an ordinary https: image as an <img>", () => {
    const html = renderMarkdown("![a photo](https://example.invalid/p.png)\n");
    expect(html).toContain("<img");
    expect(html).toContain('src="https://example.invalid/p.png"');
  });
});

// DOCUMENTED BOUNDARY, not a defect to fix (Kyle/review, 08/10/26): marked's
// default `text` renderer sets an `escaped` flag on some inline runs and skips
// our html() override for them, so a `<` inside an inline raw-HTML span is not
// uniformly escaped by this module's own logic. This is inert only because
// marked's inline-tag grammar and a browser's HTML5 tag-open-state grammar
// happen to draw the "is this actually a tag" line in the same place — a
// bare `<` followed by a digit/space/`&` is not a tag to either parser. That
// is a coincidence between two independently-specified grammars, not a
// guarantee this module provides. Do not read "renderMarkdown output is safe
// by construction" into this test — it pins current behaviour so a future
// change here is a deliberate decision, not an accidental regression.
it("renders a nested comparison inside an inline HTML span unescaped (documented, not fixed)", () => {
  const html = renderMarkdown("a <script>1 < 2 && x</script> b");
  expect(html).toContain("1 < 2 &&");
});
