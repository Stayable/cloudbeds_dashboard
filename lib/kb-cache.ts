// The answer cache and the daily cap — the two cost controls on the KB chatbot.
//
// WHAT THIS IS NOT. The Anthropic prompt cache (lib/kb-ask.ts, 1h ephemeral) is
// a PREFIX cache: it stores the corpus we send, never the question or the
// answer, so a "hit" there only means somebody asked something in the last hour.
// It expires, it does not accumulate, and asking the same question tomorrow pays
// full price. This module is the thing people assume that one already is — a
// real question -> answer cache, which makes a repeated question free forever
// rather than cheap for an hour.
//
// WHY A FINGERPRINT GATES IT. A stored answer is only true of the corpus it was
// written against. Serve a cached "damage fee is $700" after the fee schedule
// changes and the widget is confidently wrong — strictly worse than paying
// $0.05 for a fresh call. So every row carries the fingerprint of the exact
// prompt that produced it, and any edit anywhere in the corpus or the
// instructions retires every answer at once. Coarse, and correct; the corpus
// changes about monthly.

/** A previously recorded answer, as far as the cache decision cares. */
export type CachedKbRow = {
  id: number;
  answer: string;
  answered: boolean;
  unverified: boolean;
  citations: string;
  corpusFingerprint: string;
  /** A reader's verdict, null when nobody has left one. */
  helpful: boolean | null;
};

/** Well above real staff use — this is runaway protection, not rationing. At 20
 *  questions a day the ceiling is about $31/month; this caps the bill near $45
 *  in the worst case while leaving normal use untouched. Override with
 *  KB_DAILY_CAP. */
export const KB_DAILY_CAP_DEFAULT = 150;

/** The lookup key for the answer cache.
 *
 *  DELIBERATELY NOT `normaliseQuestion`. That one produces the text we send to
 *  the model and store for the eval set, so it must stay faithful to what the
 *  reader typed. This is a lookup key and nothing else, so it can be lossy.
 *
 *  Case and punctuation go, because "What's the pet fee?" and "whats the pet
 *  fee" are the same question and splitting them would leave the cache barely
 *  hitting. Word ORDER stays: sorting or dropping stopwords would collide
 *  "can a guest bring a dog" with "can a dog bring a guest", and a cache that
 *  answers the wrong question is worse than no cache. */
export function questionCacheKey(question: string): string | null {
  const key = question
    .toLowerCase()
    // Apostrophes are DELETED, not spaced — "what's" has to collapse to "whats",
    // and spacing it gives "what s", a different key from the one a reader
    // typing without the apostrophe would produce. Curly quote included; phones
    // insert it automatically.
    .replace(/['‘’`]/g, "")
    // Everything else that is not a letter or a digit becomes a separator, so
    // "fee?next" does not weld into one token.
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return key || null;
}

/** Whether a recorded answer can be served again instead of calling the model.
 *
 *  Three ways to be disqualified, and each is a real signal rather than a
 *  precaution: the corpus moved underneath it, our own verifier rejected its
 *  citations, or a reader told us it was wrong. A grounded refusal ("the
 *  knowledgebase does not say") IS servable — it is a correct answer that cost
 *  real money to produce, and re-buying it every time is waste. */
export function canServeCached(row: CachedKbRow, corpusFingerprint: string): boolean {
  if (row.corpusFingerprint !== corpusFingerprint) return false;
  if (row.unverified) return false;
  if (row.helpful === false) return false;
  return true;
}

/** Answers per day across the whole portfolio, from KB_DAILY_CAP.
 *
 *  Portfolio-wide because per-person is not possible: the PIN cookie is a signed
 *  level, not a person, so there is no identity to count against. Real per-user
 *  limits wait on Managed Authorization (M365).
 *
 *  Anything that is not a positive integer falls back to the default rather than
 *  being honoured — a stray "0" or a typo must not be able to silently take the
 *  widget offline for everyone. */
export function kbDailyCap(raw: string | undefined = process.env.KB_DAILY_CAP): number {
  if (!raw || !/^\d+$/.test(raw)) return KB_DAILY_CAP_DEFAULT;
  const n = Number(raw);
  return n > 0 ? n : KB_DAILY_CAP_DEFAULT;
}
