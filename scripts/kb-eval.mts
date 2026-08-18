// The refusal eval — the gate on shipping Haiku.
//
//   npx tsx scripts/kb-eval.mts
//
// Haiku 4.5 was chosen for cost (Kyle, 08/19/26) and extraction-and-cite over
// structured markdown is well within it. The ONE thing smaller models do worse
// is DECLINING, and this corpus concentrates its value in exactly that: two
// documents price a replacement key at $2.50 and $25, the ESA section
// deliberately withholds what documentation to request, and no room rate is
// published anywhere. A model that resolves any of those into one confident
// number has broken the feature while appearing to work.
//
// So the cases below are not a general quality benchmark. Every one is a place
// the right answer is "I will not tell you that" or "both, and it is
// unresolved". If this regresses, the fix is one string — KB_ASK_MODEL in
// lib/kb-ask.ts.
//
// Costs roughly 2 cents to run. Run it before rollout and after any change to
// the system prompt, the model, or the corpus.

// Load .env.local the way every other script here does — tsx does not read it,
// only `next` does, and without this the script reports "no API key" on a
// machine where the key is sitting right there in the file.
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

import { askKb, KB_ASK_MODEL, kbAskConfigured } from "../lib/kb-ask";

type Case = {
  q: string;
  /** What the answer must do. */
  want: string;
  /** Substrings that must ALL appear (case-insensitive). */
  must?: string[];
  /** Substrings that must NOT appear — the confident-wrong answers. */
  mustNot?: string[];
  /** Patterns that must match. Use where a substring is too literal — "8" and
   *  "eight" are the same answer and a plain `must` cannot say so. */
  mustMatch?: RegExp[];
  /** Expected `answered` flag, when the corpus genuinely cannot answer. */
  answered?: boolean;
};

const CASES: Case[] = [
  {
    q: "How much is a replacement room key?",
    want: "Reports BOTH $2.50 and $25 and says it is unresolved. Must not pick one.",
    must: ["2.50", "25"],
  },
  {
    // TIGHTENED 08/19/26. The original banned the phrase "you may request",
    // which fired on the model correctly QUOTING the knowledgebase's own hedge
    // ("documentation may be requested when permitted under company policy").
    // The real failure is NAMING a document a GSA could then demand, so that is
    // what the case tests now — plus answered=false, which all sampled runs
    // produced. This is the legally sensitive case: transient stays are a public
    // accommodation and leases are housing, and the question is out for legal
    // review. The bar is deliberately the strictest in this file.
    q: "What documentation can I ask a guest for about their emotional support animal?",
    want:
      "Repeats the refusal, gives the transient-vs-lease reason, routes to management. " +
      "Must NEVER name a document the desk could demand.",
    answered: false,
    must: ["management"],
    mustNot: [
      "esa letter",
      "doctor's note",
      "physician's letter",
      "certification",
      "registration",
      "proof of",
      "ask the guest for",
    ],
  },
  {
    q: "What is the nightly rate at Davenport?",
    want: "No rate is published anywhere. Points at Cloudbeds.",
    answered: false,
    must: ["cloudbeds"],
  },
  {
    // ASSERTION CORRECTED 08/19/26 after the first run, and the correction is
    // to the test, not to the bar. The original banned the digits "25%"/"35%"
    // outright. Haiku answered: "There is no discount percentage to quote. The
    // published figures vary (the offers page mentions 'up to 25%' and a blog
    // says 20-35%), but none of these are commitments. Quote the current rates
    // in Cloudbeds instead." That is better than what the test demanded — it
    // explains the numbers a GSA may already have seen and disarms them.
    //
    // The real failure mode is stating a percentage AS our discount, not
    // mentioning that published figures exist. The mustNot below encodes that
    // instead. Loosening an assertion because a model failed it is usually how
    // an eval rots; this one was measuring the wrong thing from the start.
    q: "What percentage discount do we give for a weekly stay?",
    want:
      "No percentage to quote — that was the answer, not a gap. Routes to Cloudbeds. " +
      "MAY cite the website's figures so long as it says they are not commitments; " +
      "must never state one as the discount we give.",
    must: ["cloudbeds"],
    mustNot: [
      "we give 25",
      "we offer 25",
      "you save 25",
      "the discount is 25",
      "the weekly discount is 25",
      "a 25% discount applies",
    ],
  },
  {
    q: "What is the security deposit?",
    want: "Forks on stay type: $100/room transient, starts at $250/unit on a lease.",
    must: ["100", "250"],
  },
  {
    // Same correction as case 4: banning the digits caught the model MENTIONING
    // the portfolio range as context, which is useful, rather than the actual
    // failure — ASSIGNING a figure to Kissimmee East. "not on file" is the load
    // -bearing phrase and it is now what the case requires.
    q: "A guest at Kissimmee East damaged the room. What is the damage fee?",
    want:
      "KE has no figure on file — must say so and route to the property. " +
      "MAY give the $700–$1,000 portfolio range as context; must never assign KE a number.",
    must: ["not on file"],
    mustNot: [
      "kissimmee east's damage fee is $",
      "kissimmee east is $",
      "the damage fee at kissimmee east is $",
      "charge the guest $",
    ],
  },
  {
    q: "Does Orlando OBT have a pool?",
    want: "Permanently closed, and the website still advertises it.",
    must: ["closed"],
  },
  {
    q: "Does Lakeland have a pool?",
    want: "Unconfirmed — do not promise one. Only OBT is answered.",
    mustNot: ["yes, lakeland has a pool"],
  },
  {
    q: "What time is check-in?",
    want: "4:00 PM. The FAQ was corrected and no longer says 3:00 PM.",
    must: ["4:00"],
    mustNot: ["3:00 PM is the standard"],
  },
  {
    // Split in two on 08/19/26. The original demanded the FAQ's "seven" in
    // answer to a bare "how many locations". That was unfair — "eight, with JN
    // transitioning" IS the correct answer to that question, and requiring the
    // website discrepancy made the case fail on a good answer.
    //
    // The FAQ discrepancy matters in the GUEST-FACING form of the question, so
    // that is now its own case below. Two questions, two rules, neither
    // straining to cover the other.
    q: "How many Stayable locations are there?",
    want: "Eight, and should mention Jacksonville North is transitioning to Everybody's Home.",
    // "8" and "eight" are the same answer — a literal substring cannot say so,
    // and demanding the spelled form failed three runs on correct answers.
    mustMatch: [/\b(8|eight)\b/i],
    must: ["everybody's home"],
  },
  {
    q: "A guest says your website only lists 7 locations. Are they wrong?",
    want:
      "The guest is right about the direction — the FAQ says 7 because JN is transitioning. " +
      "Must NOT tell staff to correct the guest to eight.",
    must: ["transition"],
    mustNot: ["the guest is wrong", "correct them to eight", "tell them we have eight"],
  },
  {
    q: "Who handles our guest screening?",
    want: "AKIA. The website's Terms still say Autohost and are out of date.",
    must: ["akia"],
  },
  {
    q: "A lease resident is four days late on rent. What do they owe?",
    want: "$25 on day one then $10/day — not a flat $25.",
    must: ["25", "10"],
  },
  {
    q: "What is the card processing fee for a lease resident?",
    want: "3.49% via TurboTenant, not the 3% transient rate.",
    must: ["3.49"],
  },
  {
    q: "What is the wifi password?",
    want: "Not in the knowledgebase at all.",
    answered: false,
  },
  {
    q: "Can I let a guest check in at 20 years old?",
    want: "21 transient, 18 on a signed lease.",
    must: ["21", "18"],
  },
];

if (!kbAskConfigured()) {
  console.error("ANTHROPIC_API_KEY is not set — add it to .env.local. See .env.example.");
  process.exit(1);
}

console.log(`Refusal eval — ${CASES.length} cases against ${KB_ASK_MODEL}\n`);

let failed = 0;
for (const [i, c] of CASES.entries()) {
  const res = await askKb(c.q);
  const hay = res.answer.toLowerCase();
  const problems: string[] = [];

  if (c.answered !== undefined && res.answered !== c.answered) {
    problems.push(`answered=${res.answered}, expected ${c.answered}`);
  }
  for (const m of c.must ?? []) {
    if (!hay.includes(m.toLowerCase())) problems.push(`missing "${m}"`);
  }
  for (const m of c.mustNot ?? []) {
    if (hay.includes(m.toLowerCase())) problems.push(`contains "${m}"`);
  }
  for (const re of c.mustMatch ?? []) {
    if (!re.test(res.answer)) problems.push(`no match for ${re}`);
  }
  if (res.unverified) problems.push("citations did not verify");

  const tag = problems.length ? "FAIL" : "pass";
  if (problems.length) failed++;
  console.log(`${tag}  ${i + 1}. ${c.q}`);
  if (problems.length) {
    console.log(`      want: ${c.want}`);
    console.log(`      got:  ${res.answer.replace(/\s+/g, " ").slice(0, 240)}`);
    console.log(`      why:  ${problems.join("; ")}`);
  }
}

console.log(`\n${CASES.length - failed}/${CASES.length} passed.`);
if (failed) {
  console.error(
    `\n${failed} case(s) failed. These are the corpus's hard cases, not edge cases — ` +
      `a failure here means the model is smoothing over a conflict or answering from ` +
      `general knowledge. Consider raising KB_ASK_MODEL in lib/kb-ask.ts.`,
  );
  process.exit(1);
}
