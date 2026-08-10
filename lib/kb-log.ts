// The /kb query log, isolated behind one function so it can be deleted without
// touching search (spec §8).
//
// What is stored: the normalised query string and how many sections came back.
// What is NOT stored: who searched, their PIN level, their session, their IP, or
// anything from the documents. The value is the MISSES — a query that returns 0
// is a document we do not have yet, and there is no way to reconstruct that
// after the fact.

import { insertKbQuery } from "./db";

/** Longer than any real search; a longer string is a paste or a probe. */
export const KB_QUERY_MAX = 200;

export function normaliseQuery(q: string): string | null {
  const t = q.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.slice(0, KB_QUERY_MAX);
}

/** Fire-and-forget. NEVER throws: a logging failure must not be able to break
 *  the search page, which is the whole point of the page working when other
 *  things do not. */
export async function logKbQuery(query: string, resultCount: number): Promise<void> {
  const normalised = normaliseQuery(query);
  if (!normalised) return;
  try {
    await insertKbQuery(normalised, resultCount);
  } catch (e) {
    console.error("[kb] could not log query:", e);
  }
}
