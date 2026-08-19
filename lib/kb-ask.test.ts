import { afterEach, describe, expect, it } from "vitest";
import { getCorpus } from "./kb-corpus";
import {
  KB_ANSWER_TOOL,
  KB_QUESTION_MAX,
  extractAnswer,
  groundAnswer,
  kbChatEnabled,
  normaliseQuestion,
  renderCorpus,
  validAnchors,
  verifyCitations,
  type KbAnswer,
} from "./kb-ask";
import type { KbDocument } from "./kb-parse";

const docs: KbDocument[] = [
  {
    slug: "pet-policy",
    title: "Pet policy",
    source: "test",
    sourceUrl: null,
    snapshotDate: "2026-08-18",
    counties: ["Polk"],
    sections: [
      { heading: null, anchor: "top", level: 0, body: "Pets are allowed." },
      { heading: "Pet fee", anchor: "pet-fee", level: 2, body: "$15 per day." },
    ],
  },
  {
    slug: "fee-schedule",
    title: "Fee schedule",
    source: "test",
    sourceUrl: null,
    snapshotDate: "2026-08-18",
    counties: ["Polk"],
    sections: [{ heading: "Fees", anchor: "fees", level: 2, body: "Lost key $2.50." }],
  },
];

const anchors = validAnchors(docs);

describe("validAnchors", () => {
  it("keys every section as slug#anchor", () => {
    expect(anchors).toEqual(
      new Set(["pet-policy#top", "pet-policy#pet-fee", "fee-schedule#fees"]),
    );
  });

  it("covers the real corpus, so a citation to any live section resolves", () => {
    const real = validAnchors(getCorpus());
    expect(real.size).toBeGreaterThan(50);
    expect([...real].every((k) => k.includes("#"))).toBe(true);
  });
});

describe("verifyCitations", () => {
  it("keeps citations that resolve", () => {
    const { kept, dropped } = verifyCitations([{ slug: "pet-policy", anchor: "pet-fee" }], anchors);
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  it("drops an invented anchor in a real document", () => {
    const { kept, dropped } = verifyCitations(
      [{ slug: "pet-policy", anchor: "cat-surcharge" }],
      anchors,
    );
    expect(kept).toHaveLength(0);
    expect(dropped).toEqual([{ slug: "pet-policy", anchor: "cat-surcharge" }]);
  });

  it("drops an invented document entirely", () => {
    const { dropped } = verifyCitations([{ slug: "parking-policy", anchor: "top" }], anchors);
    expect(dropped).toHaveLength(1);
  });

  // A real anchor on the WRONG document is the subtle one: both halves exist,
  // the pair does not. Checking slug and anchor separately would pass this.
  it("rejects a real anchor borrowed from another document", () => {
    const { kept, dropped } = verifyCitations([{ slug: "fee-schedule", anchor: "pet-fee" }], anchors);
    expect(kept).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });

  it("de-duplicates the same section cited twice", () => {
    const { kept } = verifyCitations(
      [
        { slug: "pet-policy", anchor: "pet-fee" },
        { slug: "pet-policy", anchor: "pet-fee" },
      ],
      anchors,
    );
    expect(kept).toHaveLength(1);
  });
});

describe("groundAnswer", () => {
  const good: KbAnswer = {
    answered: true,
    answer: "$15 per day for a transient stay.",
    citations: [{ slug: "pet-policy", anchor: "pet-fee" }],
  };

  it("passes a fully grounded answer through unchanged", () => {
    const out = groundAnswer(good, docs);
    expect(out.answered).toBe(true);
    expect(out.answer).toBe(good.answer);
    expect(out.unverified).toBeUndefined();
  });

  // The failure this whole module exists for: a confident answer resting on
  // nothing real. It must not reach the screen even with a caveat attached.
  it("REFUSES an answered=true whose every citation is invented", () => {
    const out = groundAnswer(
      { answered: true, answer: "The pet fee is $40 a night.", citations: [{ slug: "pet-policy", anchor: "made-up" }] },
      docs,
    );
    expect(out.answered).toBe(false);
    expect(out.unverified).toBe(true);
    expect(out.answer).not.toContain("$40");
    expect(out.citations).toHaveLength(0);
  });

  it("refuses an answered=true carrying no citations at all", () => {
    const out = groundAnswer({ answered: true, answer: "Check-in is 4 PM.", citations: [] }, docs);
    expect(out.answered).toBe(false);
    expect(out.answer).not.toContain("4 PM");
  });

  it("keeps a partly-grounded answer but flags it", () => {
    const out = groundAnswer(
      {
        answered: true,
        answer: "$15 per day.",
        citations: [
          { slug: "pet-policy", anchor: "pet-fee" },
          { slug: "pet-policy", anchor: "invented" },
        ],
      },
      docs,
    );
    expect(out.answered).toBe(true);
    expect(out.citations).toHaveLength(1);
    expect(out.unverified).toBe(true);
  });

  // answered=false is a correct outcome, not an error path — it must survive
  // with no citations and without being rewritten.
  it("leaves an honest 'not in the corpus' answer alone", () => {
    const out = groundAnswer(
      { answered: false, answer: "No room rate is published; quote Cloudbeds.", citations: [] },
      docs,
    );
    expect(out.answered).toBe(false);
    expect(out.answer).toContain("Cloudbeds");
    expect(out.unverified).toBeUndefined();
  });

  it("redirects when the model never called the tool", () => {
    const out = groundAnswer(null, docs);
    expect(out.answered).toBe(false);
    expect(out.unverified).toBe(true);
  });
});

describe("extractAnswer", () => {
  const msg = (content: unknown[]) => ({ content }) as never;

  it("reads the tool call", () => {
    const out = extractAnswer(
      msg([
        { type: "tool_use", name: "kb_answer", input: { answered: true, answer: "Yes.", citations: [] } },
      ]),
    );
    expect(out?.answer).toBe("Yes.");
  });

  it("returns null when the model wrote prose instead of calling the tool", () => {
    expect(extractAnswer(msg([{ type: "text", text: "The pet fee is $15." }]))).toBeNull();
  });

  it("returns null on a malformed tool input rather than coercing it", () => {
    expect(
      extractAnswer(msg([{ type: "tool_use", name: "kb_answer", input: { answer: 42 } }])),
    ).toBeNull();
  });

  it("ignores a tool call by another name", () => {
    expect(
      extractAnswer(msg([{ type: "tool_use", name: "something_else", input: { answered: true, answer: "x", citations: [] } }])),
    ).toBeNull();
  });

  it("drops malformed citation entries but keeps the answer", () => {
    const out = extractAnswer(
      msg([
        {
          type: "tool_use",
          name: "kb_answer",
          input: {
            answered: true,
            answer: "Yes.",
            citations: [{ slug: "pet-policy", anchor: "pet-fee" }, { slug: 7 }, null],
          },
        },
      ]),
    );
    expect(out?.citations).toEqual([{ slug: "pet-policy", anchor: "pet-fee" }]);
  });
});

describe("normaliseQuestion", () => {
  it("collapses whitespace", () => {
    expect(normaliseQuestion("  what   is\nthe pet fee ")).toBe("what is the pet fee");
  });

  it("rejects an empty question", () => {
    expect(normaliseQuestion("   ")).toBeNull();
  });

  it("truncates a paste rather than sending it", () => {
    expect(normaliseQuestion("x".repeat(900))).toHaveLength(KB_QUESTION_MAX);
  });
});

describe("renderCorpus", () => {
  it("emits every section anchor the verifier will accept", () => {
    const rendered = renderCorpus(docs);
    for (const key of anchors) {
      expect(rendered).toContain(`anchor="${key.split("#")[1]}"`);
    }
  });

  it("labels each document with its slug and snapshot date", () => {
    const rendered = renderCorpus(docs);
    expect(rendered).toContain('slug="pet-policy"');
    expect(rendered).toContain('snapshot="2026-08-18"');
  });

  // Cache correctness: the rendered prefix must be byte-stable for the same
  // input, or every request pays a cache write for ~18K tokens.
  it("is byte-identical across calls", () => {
    expect(renderCorpus(docs)).toBe(renderCorpus(docs));
    expect(renderCorpus(getCorpus())).toBe(renderCorpus(getCorpus()));
  });

  it("stays within the size the caching cost model assumes", () => {
    // ~18K tokens at ~4 chars/token. If the corpus doubles, revisit whether the
    // whole-corpus-in-prompt decision still holds.
    expect(renderCorpus(getCorpus()).length).toBeLessThan(160_000);
  });
});

describe("KB_ANSWER_TOOL", () => {
  it("forbids extra properties so the model cannot smuggle an uncited field", () => {
    const schema = KB_ANSWER_TOOL.input_schema as Record<string, unknown>;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["answered", "answer", "citations"]);
  });
});

describe("kbChatEnabled — the launch switch", () => {
  const original = process.env.KB_CHAT_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.KB_CHAT_ENABLED;
    else process.env.KB_CHAT_ENABLED = original;
  });

  // The default is the one that matters: shipping this file without touching
  // any environment must leave the widget hidden.
  it("is OFF when the variable is absent", () => {
    delete process.env.KB_CHAT_ENABLED;
    expect(kbChatEnabled()).toBe(false);
  });

  it("is ON only for exactly \"1\"", () => {
    process.env.KB_CHAT_ENABLED = "1";
    expect(kbChatEnabled()).toBe(true);
  });

  // Fails CLOSED. A fat-fingered value must not launch a feature to 40 staff,
  // which is why this is an equality check and not a truthiness check.
  it.each(["0", "true", "yes", "on", "", " 1", "1 ", "TRUE"])(
    "stays off for %o",
    (v) => {
      process.env.KB_CHAT_ENABLED = v;
      expect(kbChatEnabled()).toBe(false);
    },
  );
});
