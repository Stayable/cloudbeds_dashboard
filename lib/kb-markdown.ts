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

// A "javascript:" (or any other dangerous-scheme) href is a SECOND route to
// executable markup, distinct from the raw-HTML route the html() override
// below guards. It arrives as an ordinary link/autolink/image `href` — normal
// markdown syntax, not raw markup — so HTML-escaping never sees it, and
// marked's own URL handling is just `encodeURI(...)` with no scheme check at
// all. An ALLOWLIST is used rather than a "javascript:"/"data:" denylist
// because it fails closed: a dangerous scheme nobody has enumerated yet is
// rejected by default instead of slipping through unrecognised.
//
// Entity decoding was deliberately NOT added here, and that was verified, not
// assumed: a direct check of the markdown `[x](&#106;avascript:alert(1))`
// shows marked passes the RAW, undecoded entity string to the renderer (the
// href the renderer sees is literally "&#106;avascript:alert(1)", not
// "javascript:alert(1)") — so the premise "marked already decodes it" is
// false for this version. It is still safe without decoding, for a different
// reason: the check below is an allowlist, so an entity-obfuscated scheme
// doesn't need to be *recognised* as dangerous, it only needs to fail to
// *match* an allowed prefix — and the undecoded string does not start with
// "http", "https", "mailto", "tel", or a relative-path marker, so it is
// rejected the same as any other unrecognised scheme.
function isSafeHref(href: string): boolean {
  // Browsers strip leading/trailing C0-control-or-space from a URL before
  // reading its scheme, so a leading tab in front of "javascript:" must not
  // be allowed to dodge this check the way a plain startsWith would. Trim by
  // character code rather than a regex escape, to sidestep any ambiguity
  // between an escape sequence and a literal control character landing in
  // the source file.
  let start = 0;
  let end = href.length;
  while (start < end && href.charCodeAt(start) <= 0x20) start++;
  while (end > start && href.charCodeAt(end - 1) <= 0x20) end--;
  const trimmed = href.slice(start, end).toLowerCase();

  if (/^(https?:|mailto:|tel:)/.test(trimmed)) return true;
  if (/^[/#?.]/.test(trimmed)) return true; // relative path, anchor, query, or "./"
  return false;
}

// Installed marked is 18.0.9. In this major, `Renderer.html` is the ONE member
// for raw-HTML tokens — its signature is `html({ text }: Tokens.HTML | Tokens.Tag)`,
// meaning it receives BOTH block-level HTML (Tokens.HTML, e.g. a `<script>` on
// its own line) and inline tags (Tokens.Tag, e.g. `<img ...>` mid-sentence).
// Verified in node_modules/marked/lib/marked.d.ts — there is no separate
// inline-tag member in this version, so one override covers both raw-HTML
// routes. `text` here is the tag's own source text (equal to `raw` for these
// two token kinds); escaping it turns the author's markup into visible text
// instead of letting it reach the page as markup.
//
// `link`/`image` returning `false` is marked's own extension convention for
// "render this the normal way" (verified empirically — it defers to the
// built-in renderer for that exact token, not a no-op). So the safe branch
// below costs nothing beyond the check: only a rejected href takes the
// custom path, and it keeps the author's words on the page as escaped text
// rather than silently dropping them along with the dangerous anchor/image.
md.use({
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(text);
    },
    link(token: Tokens.Link) {
      return isSafeHref(token.href) ? false : escapeHtml(token.text);
    },
    image(token: Tokens.Image) {
      return isSafeHref(token.href) ? false : escapeHtml(token.text);
    },
  },
});

/** Render one SECTION body (heading line already stripped by splitSections).
 *  The document page supplies its own <h2 id={anchor}>, so marked never
 *  generates an anchor and can never drift from the ones search links to. */
export function renderMarkdown(source: string): string {
  return md.parse(source, { async: false }) as string;
}
