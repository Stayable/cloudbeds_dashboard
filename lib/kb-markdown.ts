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

import { Marked, type Tokens } from "marked";
import { escapeHtml } from "./kb-search";

// A private instance, so this configuration cannot leak into (or be clobbered
// by) any other caller of marked in the process.
const md = new Marked({ gfm: true, breaks: false });

// Installed marked is 18.0.9. In this major, `Renderer.html` is the ONE member
// for raw-HTML tokens — its signature is `html({ text }: Tokens.HTML | Tokens.Tag)`,
// meaning it receives BOTH block-level HTML (Tokens.HTML, e.g. a `<script>` on
// its own line) and inline tags (Tokens.Tag, e.g. `<img ...>` mid-sentence).
// Verified in node_modules/marked/lib/marked.d.ts — there is no separate
// inline-tag member in this version, so one override covers both raw-HTML
// routes. `text` here is the tag's own source text (equal to `raw` for these
// two token kinds); escaping it turns the author's markup into visible text
// instead of letting it reach the page as markup.
md.use({
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(text);
    },
  },
});

/** Render one SECTION body (heading line already stripped by splitSections).
 *  The document page supplies its own <h2 id={anchor}>, so marked never
 *  generates an anchor and can never drift from the ones search links to. */
export function renderMarkdown(source: string): string {
  return md.parse(source, { async: false }) as string;
}
