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
 *  repo has no content/kb/ until the real documents land.
 *
 *  FAIL LOUD ON A BAD DOCUMENT, DELIBERATELY — this is a decision, not the
 *  default falling out of .map(). The corpus is authored in-repo, git-reviewed,
 *  and gated by checkCorpus (lib/kb-corpus.test.ts) in CI, so a malformed
 *  document should never reach production. If one somehow does, a dashboard
 *  that silently serves 11 of 12 documents is worse than one that refuses to
 *  start: nobody notices the missing twelfth, and the gap sits there until
 *  someone happens to look for exactly that page. Refusing to start gets it
 *  fixed the same day. What a hard failure owes in return is a message good
 *  enough to act on — so the catch below re-throws with the actual file path,
 *  not a bare parse error floating free of its source. */
export function loadCorpus(dir: string = KB_DIR): KbDocument[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => {
      const path = join(dir, e.name);
      try {
        return parseKbDocument(e.name.replace(/\.md$/, ""), readFileSync(path, "utf8"));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`loadCorpus: failed to parse ${path}: ${message}`);
      }
    })
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
