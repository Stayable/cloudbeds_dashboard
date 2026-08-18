// Knowledgebase over MCP — the second, cheaper, more capable tier.
//
// WHY THIS EXISTS ALONGSIDE THE DASHBOARD WIDGET. The widget runs Haiku on our
// API credits and answers quick lookups. These tools hand the corpus to whatever
// model the caller is already paying for (Claude Desktop / claude.ai), so the
// heavy reasoning tier costs us nothing — and unlike the widget, it composes
// with the live tools: "which rooms are OOO at Lakeland, and what do we charge
// if I have to move a guest out of one" joins get_ooo_rooms to the KB in one
// turn.
//
// THE GROUNDING GUARANTEE DOES NOT CARRY OVER, AND THAT IS THE THING TO KNOW.
// /api/kb/ask verifies every citation server-side and discards an answer that
// cannot be grounded. Here we do not control the model, so no such check is
// possible — a caller's Claude could smooth over a conflict the corpus
// deliberately leaves open.
//
// The mitigation is already in the content, and it is why the authoring
// discipline was worth the effort: the conflicts are stated in the prose the
// model reads. "Unresolved — do not pick one at the desk" travels with the text.
// A corpus of bare facts would not be safe to expose this way; this one is. The
// tool descriptions below reinforce it, because a description is the one piece
// of instruction we DO still control.

import { z } from "zod";
import { getCorpus, getDocument, searchKb } from "../kb-corpus";
import { McpArgError, type Freshness, type McpToolDef } from "./types";

/** The section body behind a search hit.
 *
 *  `SearchResult.snippetHtml` is deliberately NOT used here: it is a truncated
 *  fragment with `<mark>` tags around the query terms, built for the /kb search
 *  page. Handing that to a model gives it markup to trip over and a body cut off
 *  mid-sentence — and a truncated fee table is exactly how a caller ends up
 *  quoting half a policy. Look the real section up instead. */
function sectionBody(slug: string, anchor: string): string {
  const doc = getDocument(slug);
  return doc?.sections.find((s) => s.anchor === anchor)?.body ?? "";
}

/** Oldest snapshot in the corpus. Deliberately the OLDEST, not the newest: a
 *  freshness line that quotes the most recently touched document would claim
 *  the whole knowledgebase is as current as its best-maintained page. */
function corpusFreshness(): Freshness {
  const docs = getCorpus();
  const dates = docs.map((d) => d.snapshotDate).sort();
  return {
    source: "config",
    asOf: dates[0] ?? null,
    note:
      `Knowledgebase of ${docs.length} documents, authored from the public website, internal policy documents, and answers from Bea. ` +
      `Oldest snapshot ${dates[0] ?? "unknown"}, newest ${dates[dates.length - 1] ?? "unknown"}. ` +
      `Where two sources disagree the documents SAY SO and leave it unresolved — report both figures, never pick one.`,
  };
}

const MAX_RESULTS = 12;

export const KB_TOOLS: McpToolDef[] = [
  {
    name: "list_kb_documents",
    title: "List knowledgebase documents",
    description:
      "Every document in the Stayable staff knowledgebase, with its title, slug and snapshot date. Call this first if you are unsure which document covers a topic, then fetch the one you need with get_kb_document.",
    inputSchema: z.object({}),
    handler: async () => ({
      data: {
        documents: getCorpus().map((d) => ({
          slug: d.slug,
          title: d.title,
          snapshotDate: d.snapshotDate,
          source: d.source,
          sections: d.sections.filter((s) => s.heading).map((s) => s.heading),
        })),
      },
      freshness: corpusFreshness(),
    }),
  },
  {
    name: "search_kb",
    title: "Search the knowledgebase",
    description:
      "Search the Stayable staff knowledgebase for guest-facing policy: check-in and check-out, deposits, pet fees, house rules, WiFi, mail, evictions-adjacent rules, property contact details, and the lease-vs-transient differences. Returns matching SECTIONS with the document they came from. Answer only from what comes back — if the search returns nothing relevant, say the knowledgebase does not cover it rather than filling the gap from general knowledge about hotels. Where a returned section says two sources disagree, report both figures and say it is unresolved.",
    inputSchema: z.object({
      query: z.string().min(1).describe("What to look for, in plain words."),
      limit: z.number().int().min(1).max(MAX_RESULTS).default(6).describe("Max sections to return."),
    }),
    handler: async (args: { query: string; limit?: number }) => {
      const q = args.query.trim();
      if (!q) throw new McpArgError("query must not be empty");
      const limit = args.limit ?? 6;
      const hits = searchKb(q).slice(0, limit);
      return {
        data: {
          query: q,
          resultCount: hits.length,
          // An empty result is a real answer, and saying so beats a bare [].
          note:
            hits.length === 0
              ? "No section matched. The knowledgebase does not cover this — say so rather than answering from general knowledge."
              : undefined,
          results: hits.map((h) => ({
            slug: h.slug,
            documentTitle: h.title,
            heading: h.heading,
            anchor: h.anchor,
            snapshotDate: h.snapshotDate,
            body: sectionBody(h.slug, h.anchor),
          })),
        },
        freshness: corpusFreshness(),
      };
    },
  },
  {
    name: "get_kb_document",
    title: "Read one knowledgebase document",
    description:
      "The full text of one knowledgebase document by slug (get slugs from list_kb_documents or search_kb). Use this when a search hit is clearly the right document but you need the surrounding context — for example the whole fee schedule rather than one row. Quote the document; do not paraphrase a figure into a different one.",
    inputSchema: z.object({
      slug: z.string().min(1).describe("Document slug, e.g. \"fee-schedule\"."),
    }),
    handler: async (args: { slug: string }) => {
      const doc = getDocument(args.slug);
      if (!doc) {
        const known = getCorpus().map((d) => d.slug).join(", ");
        throw new McpArgError(`No knowledgebase document "${args.slug}". Known slugs: ${known}`);
      }
      return {
        data: {
          slug: doc.slug,
          title: doc.title,
          source: doc.source,
          sourceUrl: doc.sourceUrl,
          snapshotDate: doc.snapshotDate,
          sections: doc.sections.map((s) => ({
            heading: s.heading,
            anchor: s.anchor,
            body: s.body,
          })),
        },
        freshness: {
          ...corpusFreshness(),
          asOf: doc.snapshotDate,
          note: `"${doc.title}" as captured on ${doc.snapshotDate}. Source: ${doc.source}.`,
        },
      };
    },
  },
];
