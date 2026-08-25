// Ask-the-KB: a grounded answer over the knowledgebase corpus, or an honest
// redirect to the documents.
//
// THE WHOLE CORPUS GOES IN THE PROMPT. There is no retrieval step, and that is
// a measured decision rather than laziness: the corpus is ~68 KB / ~18K tokens,
// which fits with room to spare. Selecting sections would add a ranker that can
// miss — "right answer to the wrong question" — for no benefit. Prompt caching
// makes the full corpus cheaper per query than retrieval would be.
//
// WHY THE VERIFIER EXISTS, AND WHY IT IS NOT A PROMPT INSTRUCTION.
// This corpus is unusual: its value is concentrated in what it REFUSES to
// settle. Two source documents price a replacement key at $2.50 and at $25;
// the ESA section deliberately will not say what documentation to request; no
// room rate is published anywhere. A model that smooths any of those into one
// confident number has destroyed the reason the knowledgebase exists.
//
// "Please cite your sources" is a request. `verifyCitations` is a check: every
// cited anchor must resolve to a real section of a real document, and an answer
// whose citations do not resolve is DISCARDED and replaced with document links.
// A model cannot talk its way past that, which is the point.

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { getCorpus } from "./kb-corpus";
import type { KbDocument } from "./kb-parse";

/** Kyle's call 08/19/26. Extraction-and-cite over structured markdown is well
 *  within Haiku; heavy reasoning is routed to claude.ai via the MCP tools
 *  instead. Gated on the refusal eval in `scripts/kb-eval.mts` — if that
 *  regresses, this one string is the fix. */
export const KB_ASK_MODEL = "claude-haiku-4-5";

/** Answers are short by construction. A KB answer that runs long is usually a
 *  model padding around a fact it does not have. */
export const KB_ASK_MAX_TOKENS = 1024;

/** Longer than any real question; beyond this it is a paste or a probe. */
export const KB_QUESTION_MAX = 500;

export type KbCitation = { slug: string; anchor: string };

export type KbAnswer = {
  /** False when the corpus does not answer it. `answer` then explains what is
   *  missing rather than guessing, and `citations` may be empty. */
  answered: boolean;
  answer: string;
  citations: KbCitation[];
  /** Set when the verifier rejected the model's own citations. Surfaced so the
   *  UI can show links instead, and so the failure is countable rather than
   *  invisible. */
  unverified?: boolean;
};

/** The corpus, rendered for the prompt. Stable byte-for-byte between requests
 *  so it can be cached — the question is deliberately NOT in here. */
export function renderCorpus(docs: KbDocument[]): string {
  return docs
    .map((doc) => {
      const head = [
        `<document slug="${doc.slug}" snapshot="${doc.snapshotDate}">`,
        `# ${doc.title}`,
        `Source: ${doc.source}`,
      ].join("\n");
      const body = doc.sections
        .map((s) =>
          s.heading
            ? `<section anchor="${s.anchor}">\n## ${s.heading}\n${s.body}\n</section>`
            : `<section anchor="${s.anchor}">\n${s.body}\n</section>`,
        )
        .join("\n\n");
      return `${head}\n\n${body}\n</document>`;
    })
    .join("\n\n---\n\n");
}

export const KB_SYSTEM_INSTRUCTIONS = `You answer questions for Stayable staff from the knowledgebase below, and from nothing else.

Stayable is an extended-stay hotel brand with eight Florida properties, operated by RISE8 Companies. Your readers are front-desk staff (GSAs) and property managers, usually mid-conversation with a guest. Answer in one or two sentences where that is enough. No preamble.

THE RULES THAT MATTER, IN ORDER:

1. Answer ONLY from the documents below. You have general knowledge about hotels; it is not admissible here. If the corpus does not contain the answer, say so and set answered=false. An unanswered question is a correct outcome, not a failure.

2. NEVER RESOLVE A CONFLICT THE DOCUMENTS LEAVE OPEN. Where two sources disagree and the corpus says so, report BOTH figures and say it is unresolved. Do not average them, do not pick the more likely one, do not quietly prefer the newer one. Staff are trusted to handle "we do not agree with ourselves on this yet"; they are not served by a confident wrong number.

3. Where a document explicitly declines to answer — for example what documentation may be requested for a service animal — repeat the refusal and the reason. Do not supply the answer it withheld.

4. TRANSIENT AND LEASE ARE DIFFERENT PRODUCTS. Deposit, pet fee, minimum age, housekeeping, card processing and late fees all differ. If the question does not say which applies, give both or ask which. This holds ESPECIALLY when the answer for one side is a flat no — "no, a transient guest must be 21" without adding "but 18 is enough on a signed lease" sends away someone we could have housed. State the other side even when the first answer closes the question.

5. Cite every claim. Each citation is the document slug plus the anchor of the section you used. Cite only sections you actually read a fact from.

6. Where a document flags that the public website is wrong or out of date, say so — staff get quoted the website by guests and need to know which way the correction runs.

Set answered=false when the corpus does not cover the question, and use the answer field to say what is missing and who would know.`;

/** The tool the model must call. Structured output is what makes the verifier
 *  possible — a prose answer with citations woven into the text could not be
 *  machine-checked. */
export const KB_ANSWER_TOOL: Anthropic.Tool = {
  name: "kb_answer",
  description: "Return the grounded answer and the sections it came from.",
  input_schema: {
    type: "object",
    properties: {
      answered: {
        type: "boolean",
        description:
          "true only when the knowledgebase actually contains the answer. false when it does not — that is a correct outcome.",
      },
      answer: {
        type: "string",
        description:
          "The answer for a staff member mid-conversation. One or two sentences where that suffices. When answered=false, say what is missing and who would know.",
      },
      citations: {
        type: "array",
        description:
          "Sections a fact was actually read from. Empty is acceptable when answered=false.",
        items: {
          type: "object",
          properties: {
            slug: { type: "string", description: "The document slug." },
            anchor: { type: "string", description: "The section anchor within that document." },
          },
          required: ["slug", "anchor"],
          additionalProperties: false,
        },
      },
    },
    required: ["answered", "answer", "citations"],
    additionalProperties: false,
  },
};

/** Every (slug, anchor) pair that exists. Built from the corpus, so it cannot
 *  drift from what the model was shown. */
export function validAnchors(docs: KbDocument[]): Set<string> {
  const set = new Set<string>();
  for (const doc of docs) {
    for (const section of doc.sections) set.add(`${doc.slug}#${section.anchor}`);
  }
  return set;
}

/** Keep only citations that resolve to a real section. Returns the survivors
 *  and whether anything was dropped.
 *
 *  Dropping rather than failing the whole answer is deliberate: a model that
 *  cites four real sections and invents a fifth has still done the work. What
 *  must never survive is an answer resting on NO real citation — `askKb`
 *  handles that case by refusing to claim it was answered. */
export function verifyCitations(
  citations: KbCitation[],
  anchors: Set<string>,
): { kept: KbCitation[]; dropped: KbCitation[] } {
  const kept: KbCitation[] = [];
  const dropped: KbCitation[] = [];
  const seen = new Set<string>();
  for (const c of citations) {
    const key = `${c.slug}#${c.anchor}`;
    if (!anchors.has(key)) {
      dropped.push(c);
      continue;
    }
    if (seen.has(key)) continue; // same section cited twice adds nothing
    seen.add(key);
    kept.push(c);
  }
  return { kept, dropped };
}

export function normaliseQuestion(q: string): string | null {
  const t = q.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.slice(0, KB_QUESTION_MAX);
}

/** Pull the tool call out of the response. Returns null when the model answered
 *  in prose instead of calling the tool — which is itself a refusal to trust. */
export function extractAnswer(message: Anthropic.Message): KbAnswer | null {
  for (const block of message.content) {
    if (block.type !== "tool_use" || block.name !== KB_ANSWER_TOOL.name) continue;
    const input = block.input as Partial<KbAnswer> | undefined;
    if (!input || typeof input.answer !== "string" || typeof input.answered !== "boolean") {
      return null;
    }
    const citations = Array.isArray(input.citations) ? input.citations : [];
    return {
      answered: input.answered,
      answer: input.answer,
      citations: citations.filter(
        (c): c is KbCitation =>
          !!c && typeof c.slug === "string" && typeof c.anchor === "string",
      ),
    };
  }
  return null;
}

/** Apply the verifier to a raw model answer. Separated from the network call so
 *  the rule can be tested without a client. */
export function groundAnswer(raw: KbAnswer | null, docs: KbDocument[]): KbAnswer {
  if (!raw) {
    return {
      answered: false,
      answer:
        "I could not produce a grounded answer. Search the knowledgebase directly rather than relying on this.",
      citations: [],
      unverified: true,
    };
  }

  const { kept, dropped } = verifyCitations(raw.citations, validAnchors(docs));

  // Claimed an answer but nothing it cited is real. This is the exact failure
  // the feature exists to prevent, so it is converted into a redirect rather
  // than shown with a caveat — a caveat still puts the wrong number on screen.
  if (raw.answered && kept.length === 0) {
    return {
      answered: false,
      answer:
        "I could not verify that answer against the knowledgebase, so I am not going to give it. Open the documents below instead.",
      citations: [],
      unverified: true,
    };
  }

  return {
    answered: raw.answered,
    answer: raw.answer,
    citations: kept,
    ...(dropped.length > 0 ? { unverified: true } : {}),
  };
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export function kbAskConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** The launch switch, DEFAULT OFF (Kyle, 08/19/26 — "hide the widget now, I will
 *  launch it later").
 *
 *  Same shape as the DDF seed gates: an explicit "1" turns it on and anything
 *  else leaves it off, so a missing or fat-fingered value fails CLOSED rather
 *  than quietly launching a feature to forty staff.
 *
 *  ONE definition, read by BOTH the mount and the /api/kb/ask route. Hiding the
 *  button while leaving the endpoint live would not be "off" — the route would
 *  still answer, still call the model, and still bill, to anyone who knew the
 *  path. The UI and the endpoint go dark together or the switch is a lie.
 *
 *  Deliberately NOT gated: the MCP knowledgebase tools. They cost us nothing
 *  (the caller's own model does the work), they sit behind per-person tokens
 *  rather than the shared MAIN pin, and they are not the thing being launched.
 *  Say so if you want those dark too — it is a one-line change. */
export function kbChatEnabled(): boolean {
  return process.env.KB_CHAT_ENABLED === "1";
}

/** The exact system text `askKb` sends: instructions plus the rendered corpus.
 *
 *  Extracted so it has ONE definition. `corpusFingerprint` hashes this string to
 *  decide whether a cached answer is still valid, and a second copy of the same
 *  concatenation would let the prompt drift away from the hash that is supposed
 *  to describe it — green tests, stale answers served in production. */
export function buildSystemPrompt(docs: KbDocument[]): string {
  return `${KB_SYSTEM_INSTRUCTIONS}\n\n<knowledgebase>\n${renderCorpus(docs)}\n</knowledgebase>`;
}

/** Short content hash. 64 bits is ample — this distinguishes a handful of corpus
 *  revisions, it is not a security boundary. */
export function hashPrompt(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

/** Identifies everything the model was shown. Any edit to a document OR to the
 *  instructions changes it, which retires every cached answer written under the
 *  old version. See lib/kb-cache.ts for why that matters. */
export function corpusFingerprint(docs: KbDocument[]): string {
  return hashPrompt(buildSystemPrompt(docs));
}

/** Ask the knowledgebase. Throws only on transport failure; a model that cannot
 *  answer returns answered=false, which is a normal outcome. */
export async function askKb(question: string): Promise<KbAnswer> {
  const docs = getCorpus();
  const message = await anthropic().messages.create({
    model: KB_ASK_MODEL,
    max_tokens: KB_ASK_MAX_TOKENS,
    system: [
      {
        type: "text",
        text: buildSystemPrompt(docs),
        // 1-HOUR TTL, NOT THE 5-MINUTE DEFAULT, and this is a cost decision
        // rather than a tuning knob. Staff use is bursty — a question at 09:10
        // and the next at 09:40. On the default TTL almost every query would
        // pay a full cache WRITE for ~18K tokens, which dominates the bill. The
        // 1h write costs 2x and survives the gaps.
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ],
    // The question sits AFTER the cached prefix. Anything before it that
    // changed per-request would invalidate the corpus cache on every call.
    messages: [{ role: "user", content: question }],
    tools: [KB_ANSWER_TOOL],
    tool_choice: { type: "tool", name: KB_ANSWER_TOOL.name },
  });

  return groundAnswer(extractAnswer(message), docs);
}
