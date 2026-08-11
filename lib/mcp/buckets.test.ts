import { describe, it, expect } from "vitest";
import { bucketRange } from "./buckets";
import { McpArgError } from "./types";

describe("bucketRange — daily", () => {
  it("returns one bucket per day, inclusive of both ends", () => {
    const b = bucketRange("2026-08-01", "2026-08-03", "daily");
    expect(b.map((x) => x.key)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    expect(b.every((x) => x.from === x.to && !x.partial)).toBe(true);
  });

  it("handles a single day", () => {
    expect(bucketRange("2026-08-01", "2026-08-01", "daily")).toHaveLength(1);
  });
});

describe("bucketRange — weekly", () => {
  // Weeks start Monday. 2026-08-03 is a Monday.
  it("splits on Monday boundaries", () => {
    const b = bucketRange("2026-08-03", "2026-08-16", "weekly");
    expect(b).toHaveLength(2);
    expect(b[0]).toMatchObject({ from: "2026-08-03", to: "2026-08-09", partial: false });
    expect(b[1]).toMatchObject({ from: "2026-08-10", to: "2026-08-16", partial: false });
  });

  // A partial week labelled as a whole one is how a short week gets read as a
  // bad week. The dates must be the real ones, and it must say it is partial.
  it("clips the first and last bucket to the range and marks them partial", () => {
    const b = bucketRange("2026-08-05", "2026-08-12", "weekly");
    expect(b[0]).toMatchObject({ from: "2026-08-05", to: "2026-08-09", partial: true });
    expect(b[1]).toMatchObject({ from: "2026-08-10", to: "2026-08-12", partial: true });
  });
});

describe("bucketRange — monthly", () => {
  it("splits on calendar months", () => {
    const b = bucketRange("2026-07-01", "2026-09-30", "monthly");
    expect(b.map((x) => x.key)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(b.every((x) => !x.partial)).toBe(true);
  });

  it("marks a clipped month partial with its real dates", () => {
    const b = bucketRange("2026-07-15", "2026-08-10", "monthly");
    expect(b[0]).toMatchObject({ from: "2026-07-15", to: "2026-07-31", partial: true });
    expect(b[1]).toMatchObject({ from: "2026-08-01", to: "2026-08-10", partial: true });
  });

  it("handles a February in a leap year", () => {
    const b = bucketRange("2028-02-01", "2028-02-29", "monthly");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ from: "2028-02-01", to: "2028-02-29", partial: false });
  });
});

describe("bucketRange — bad input", () => {
  it("rejects an inverted range instead of returning nothing", () => {
    expect(() => bucketRange("2026-08-10", "2026-08-01", "daily")).toThrow(McpArgError);
  });

  it("rejects a malformed date", () => {
    expect(() => bucketRange("last tuesday", "2026-08-01", "daily")).toThrow(McpArgError);
  });

  // An unbounded range would pull the whole store into one reply.
  it("rejects a range longer than two years", () => {
    expect(() => bucketRange("2020-01-01", "2026-08-01", "daily")).toThrow(McpArgError);
  });
});
