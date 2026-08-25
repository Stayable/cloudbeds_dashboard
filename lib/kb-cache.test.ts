import { describe, expect, it } from "vitest";
import {
  KB_DAILY_CAP_DEFAULT,
  canServeCached,
  kbDailyCap,
  questionCacheKey,
  type CachedKbRow,
} from "./kb-cache";

describe("questionCacheKey", () => {
  it("lowercases so case does not split the cache", () => {
    expect(questionCacheKey("What Is The Pet Fee")).toBe(questionCacheKey("what is the pet fee"));
  });

  it("ignores punctuation, so an apostrophe and a question mark do not split the cache", () => {
    expect(questionCacheKey("What's the pet fee?")).toBe(questionCacheKey("whats the pet fee"));
  });

  it("collapses runs of whitespace", () => {
    expect(questionCacheKey("pet   fee\n\tnow")).toBe("pet fee now");
  });

  it("keeps digits — a number is part of the question", () => {
    expect(questionCacheKey("is the key $25?")).toBe("is the key 25");
  });

  // The guard against over-normalising. Sorting or stopword-stripping the words
  // would make these two collide, and they are not the same question.
  it("preserves word order", () => {
    expect(questionCacheKey("can a guest bring a dog")).not.toBe(
      questionCacheKey("can a dog bring a guest"),
    );
  });

  it("is null for a question with nothing to key on", () => {
    expect(questionCacheKey("")).toBeNull();
    expect(questionCacheKey("   ")).toBeNull();
    expect(questionCacheKey("?!...")).toBeNull();
  });
});

const row = (over: Partial<CachedKbRow> = {}): CachedKbRow => ({
  id: 7,
  answer: "Pet fee is $15 per day.",
  answered: true,
  unverified: false,
  citations: "pet-policy#pet-fee",
  corpusFingerprint: "abc123",
  helpful: null,
  ...over,
});

describe("canServeCached", () => {
  it("serves a verified answer when the corpus has not changed", () => {
    expect(canServeCached(row(), "abc123")).toBe(true);
  });

  // The whole reason a fingerprint exists. A cached answer that outlives an edit
  // to the fee schedule would quote a number we have since corrected — worse
  // than paying for a fresh call.
  it("refuses an answer written against a different corpus", () => {
    expect(canServeCached(row(), "def456")).toBe(false);
  });

  // A grounded "the knowledgebase does not say" is a real, correct, and
  // expensive-to-recompute answer. Caching it stops us paying repeatedly for
  // questions the corpus cannot answer.
  it("serves a verified refusal", () => {
    expect(canServeCached(row({ answered: false, citations: "" }), "abc123")).toBe(true);
  });

  it("refuses an answer whose citations the verifier rejected", () => {
    expect(canServeCached(row({ unverified: true }), "abc123")).toBe(false);
  });

  it("refuses an answer a reader marked unhelpful", () => {
    expect(canServeCached(row({ helpful: false }), "abc123")).toBe(false);
  });

  it("serves an answer a reader marked helpful", () => {
    expect(canServeCached(row({ helpful: true }), "abc123")).toBe(true);
  });
});

describe("kbDailyCap", () => {
  it("defaults when unset", () => {
    expect(kbDailyCap(undefined)).toBe(KB_DAILY_CAP_DEFAULT);
  });

  it("reads a positive integer", () => {
    expect(kbDailyCap("20")).toBe(20);
  });

  // Falling back rather than honouring these is deliberate: a cap of 0 or -1
  // would silently brick the widget, and a typo should not be able to do that.
  it("falls back on values that would disable the widget or make no sense", () => {
    expect(kbDailyCap("0")).toBe(KB_DAILY_CAP_DEFAULT);
    expect(kbDailyCap("-5")).toBe(KB_DAILY_CAP_DEFAULT);
    expect(kbDailyCap("lots")).toBe(KB_DAILY_CAP_DEFAULT);
    expect(kbDailyCap("")).toBe(KB_DAILY_CAP_DEFAULT);
    expect(kbDailyCap("12.5")).toBe(KB_DAILY_CAP_DEFAULT);
  });
});
