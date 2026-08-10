// Which of the three /kb states to render. Pure, so the states are tested
// without a browser.
//
//   browse   no query — list the whole corpus so someone who does not know the
//            right word can still find the document
//   results  matches, ranked
//   empty    a real query that matched nothing. Says so, repeats what was
//            searched, and shows the corpus list. It NEVER pads with weak fuzzy
//            matches: a confident bad match is worse than an honest miss — the
//            same rule /ops follows for empty funnel stages.

import type { OutlineDoc, SearchResult } from "./kb-search";

export type KbView = {
  mode: "browse" | "results" | "empty";
  query: string;
  results: SearchResult[];
  outline: OutlineDoc[];
};

export function kbView(query: string, results: SearchResult[], docs: OutlineDoc[]): KbView {
  const q = query.trim();
  if (!q) return { mode: "browse", query: "", results: [], outline: docs };
  if (results.length) return { mode: "results", query: q, results, outline: docs };
  return { mode: "empty", query: q, results: [], outline: docs };
}
