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
