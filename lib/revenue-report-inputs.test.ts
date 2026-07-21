import { describe, it, expect } from "vitest";
import { reportRanges } from "./cloudbeds";
import { classifyForReport } from "./revenue-report";

describe("reportRanges", () => {
  it("derives six actual ranges + 7 on-the-books days from asOf", () => {
    const r = reportRanges("2026-07-19");
    expect(r.yesterday).toEqual(["2026-07-19", "2026-07-19"]);
    expect(r.mtd).toEqual(["2026-07-01", "2026-07-19"]);
    expect(r.ytd).toEqual(["2026-01-01", "2026-07-19"]);
    expect(r.lyYesterday).toEqual(["2025-07-19", "2025-07-19"]);
    expect(r.lyMtd).toEqual(["2025-07-01", "2025-07-19"]);
    expect(r.lyYtd).toEqual(["2025-01-01", "2025-07-19"]);
    expect(r.onTheBooks[0]).toBe("2026-07-20");
    expect(r.onTheBooks).toHaveLength(7);
  });

  it("handles a January asOf date (mtd/ytd collapse to the same start)", () => {
    const r = reportRanges("2026-01-15");
    expect(r.mtd).toEqual(["2026-01-01", "2026-01-15"]);
    expect(r.ytd).toEqual(["2026-01-01", "2026-01-15"]);
    expect(r.lyMtd).toEqual(["2025-01-01", "2025-01-15"]);
    expect(r.onTheBooks).toEqual([
      "2026-01-16",
      "2026-01-17",
      "2026-01-18",
      "2026-01-19",
      "2026-01-20",
      "2026-01-21",
      "2026-01-22",
    ]);
  });
});

describe("classifyForReport", () => {
  it("classifies genuine lease plans as lease", () => {
    expect(classifyForReport("Monthly Lease")).toBe("lease");
    expect(classifyForReport("Weekly Lease")).toBe("lease");
    expect(classifyForReport("Discounted Long Term Rate")).toBe("lease");
  });

  it("classifies weekly-RATE promos and everything else as transient", () => {
    expect(classifyForReport("Discounted Weekly Rate")).toBe("transient");
    expect(classifyForReport("Employee Weekly Rate")).toBe("transient");
    expect(classifyForReport("Base Rate")).toBe("transient");
    expect(classifyForReport("Book Direct and Save")).toBe("transient");
  });

  it("gives lease precedence on comma-joined multi-plan strings", () => {
    expect(classifyForReport("Discounted Weekly Rate, Discounted Long Term Rate")).toBe("lease");
  });

  it("is case-insensitive and handles empty/nullish input", () => {
    expect(classifyForReport("MONTHLY LEASE")).toBe("lease");
    expect(classifyForReport("")).toBe("transient");
  });
});
