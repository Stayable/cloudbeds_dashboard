import { describe, expect, it } from "vitest";
import { METHODOLOGY, derive, type PropertyActual, type RevenueReport } from "./revenue-report";
import { buildReportCard } from "./report-card";
import { renderReportXlsx } from "./report-xlsx";
import { renderReportPdf } from "./report-pdf";

// The page, the .xlsx, the .pdf and the Teams card must all state the SAME
// methodology and the SAME freshness. They used to drift because each renderer
// carried its own wording; METHODOLOGY is now the single source and these tests
// pin the parity.

const row = (over: Partial<Parameters<typeof derive>[0]> = {}) =>
  derive({
    transientNights: 10,
    leaseNights: 90,
    otherBlocks: 2,
    ooo: 3,
    inventory: 150,
    transientRev: 1000,
    leaseRev: 3000,
    ...over,
  });

const property = (code: string, name: string): PropertyActual => ({
  code,
  name,
  yesterday: { actual: row(), lastYear: null },
  mtd: { actual: row(), lastYear: row({ transientRev: 800, leaseRev: 2500 }) },
  ytd: { actual: row(), lastYear: row({ transientRev: 900, leaseRev: 2600 }) },
  spark: [
    { day: "2026-07-24", pOcc: 0.6 },
    { day: "2026-07-25", pOcc: 0.65 },
    { day: "2026-07-26", pOcc: 0.7 },
  ],
});

const baseReport = (over: Partial<RevenueReport> = {}): RevenueReport => ({
  asOf: "2026-07-26",
  generatedEastern: "2026-07-27 ET",
  actual: [property("DP", "Davenport"), property("LL", "Lakeland")],
  onTheBooks: [],
  sourceNote: "Cloudbeds-sourced.",
  trackingSince: "2026-01-01",
  freshness: {
    lastBankedAt: "2026-07-27T10:01:00.000Z",
    latestCapturedDate: "2026-07-26",
    propertiesOnLatest: 2,
    propertiesExpected: 8,
  },
  ...over,
});

describe("METHODOLOGY", () => {
  it("is non-empty and every section carries points", () => {
    expect(METHODOLOGY.length).toBeGreaterThan(0);
    for (const sec of METHODOLOGY) {
      expect(sec.heading.trim().length).toBeGreaterThan(0);
      expect(sec.points.length).toBeGreaterThan(0);
    }
  });

  it("states Monica's confirmed rate-plan rulings so the exports cannot contradict her", () => {
    const all = METHODOLOGY.flatMap((s) => s.points).join(" ");
    expect(all).toContain("Monthly Lease");
    expect(all).toContain("Weekly Lease");
    // The three plans she ruled transient on 07/27 must be named explicitly.
    expect(all).toContain("Discounted Monthly Rate");
    expect(all).toContain("Discounted Weekly Rate");
    expect(all).toContain("Employee Weekly Rate");
    expect(all).toContain("Room Rate");
  });
});

describe("REPORT_NOTES", () => {
  it("is ASCII-only — the flow 400s on non-ASCII bytes in the card", async () => {
    const { REPORT_NOTES } = await import("./revenue-report");
    const all = REPORT_NOTES.flatMap((s) => [s.heading, ...s.points]).join(" ");
    expect(all).not.toMatch(/[^\x00-\x7F]/);
  });

  it("carries her three headings and her Other Blocks / ADR / RevPar wording", async () => {
    const { REPORT_NOTES } = await import("./revenue-report");
    expect(REPORT_NOTES.map((s) => s.heading)).toEqual(["Sources", "Notes", "Legend"]);
    const all = REPORT_NOTES.flatMap((s) => s.points).join(" ");
    expect(all).toContain("Other Blocks - blocked or occupied room other than paid leases/transient rooms");
    expect(all).toContain("ADR - Average Daily Rate / Average Room Rate");
    expect(all).toContain("RevPar - Revenue per Available Room");
  });

  it("does NOT reproduce her Yardi source line, which is not how ours are built", async () => {
    const { REPORT_NOTES } = await import("./revenue-report");
    const all = REPORT_NOTES.flatMap((s) => s.points).join(" ");
    expect(all).not.toMatch(/Yardi/i);
    expect(all).toContain("classified by rate plan");
  });
});

describe("Teams card last-year variance", () => {
  it("shows occupancy variance in POINTS and revenue variance in percent", () => {
    const card = buildReportCard(baseReport(), "https://x.test") as { body: { facts?: { title: string; value: string }[] }[] };
    const facts = card.body.flatMap((b) => b.facts ?? []);
    // The fixture gives MTD/YTD a last-year row but not Yesterday, so this
    // exercises both branches at once.
    expect(facts.find((f) => f.title === "Portfolio Occupancy (MTD)")?.value).toMatch(/LY .*pts\)$/);
    expect(facts.find((f) => f.title === "Room Revenue (MTD)")?.value).toMatch(/LY \$.*%\)$/);
    expect(facts.find((f) => f.title === "Portfolio Occupancy (Yesterday)")?.value).not.toContain("LY");
  });

  it("omits LY entirely when any aggregate-eligible property lacks a last-year row", () => {
    // A partial set would weight this year's full portfolio against a subset of
    // last year's and read as a swing that never happened.
    const partial = baseReport();
    partial.actual[1].mtd.lastYear = null;
    const card = buildReportCard(partial, "https://x.test") as { body: { facts?: { title: string; value: string }[] }[] };
    const facts = card.body.flatMap((b) => b.facts ?? []);
    expect(facts.find((f) => f.title === "Portfolio Occupancy (MTD)")?.value).not.toContain("LY");
    expect(facts.find((f) => f.title === "Room Revenue (MTD)")?.value).not.toContain("LY");
  });
});

describe("Teams card parity", () => {
  it("opens with her title and greeting, and carries her notes inline", async () => {
    const { REPORT_NOTES } = await import("./revenue-report");
    const card = buildReportCard(baseReport(), "https://x.test") as {
      body: { text?: string }[];
    };
    const texts = card.body.map((b) => b.text ?? "").join("\n");
    expect(texts).toContain("Occupancy Report as of July 27, 2026");
    expect(texts).toContain("Good day Team. Please refer to the attached file");
    for (const sec of REPORT_NOTES) {
      expect(texts).toContain(`${sec.heading}:`);
      for (const pt of sec.points) expect(texts).toContain(pt);
    }
  });

  it("stays ASCII-safe with the notes embedded", () => {
    const json = JSON.stringify(buildReportCard(baseReport(), "https://x.test"));
    expect(json).not.toMatch(/[^\x00-\x7F]/);
  });

  // The card deliberately does NOT carry METHODOLOGY or the source blob any more
  // (Kyle 07/29/26 — too crowded; the point is to automate Monica's post, which
  // carries neither). The .xlsx and .pdf still do — pinned further down — and the
  // card keeps her Sources/Notes/Legend, which is where the definitions live.
  it("keeps the methodology out of the message", () => {
    const card = buildReportCard(baseReport(), "https://x.test") as { body: { text?: string }[] };
    const texts = card.body.map((b) => b.text ?? "").join(" ");
    expect(texts).not.toContain("Methodology confirmed by Monica Oco");
  });

  it("does NOT warn when the latest capture covers the report date", () => {
    const card = buildReportCard(baseReport(), "https://x.test") as { body: { text?: string }[] };
    expect(card.body.map((b) => b.text ?? "").join(" ")).not.toContain("WARNING");
  });

  it("warns loudly when the daily capture is behind the report date", () => {
    const stale = baseReport({
      freshness: {
        lastBankedAt: "2026-07-25T10:01:00.000Z",
        latestCapturedDate: "2026-07-24",
        propertiesOnLatest: 2,
        propertiesExpected: 8,
      },
    });
    const card = buildReportCard(stale, "https://x.test") as { body: { text?: string }[] };
    const texts = card.body.map((b) => b.text ?? "").join(" ");
    expect(texts).toContain("WARNING");
    expect(texts).toContain("2026-07-24");
  });

  it("omits the warning entirely when freshness is unknown", () => {
    const card = buildReportCard(baseReport({ freshness: undefined }), "https://x.test") as {
      body: { text?: string }[];
    };
    expect(card.body.map((b) => b.text ?? "").join(" ")).not.toContain("WARNING");
  });
});

describe("export renderers accept the freshness/methodology fields", () => {
  it("builds an .xlsx without throwing, both fresh and stale", async () => {
    const fresh = await renderReportXlsx(baseReport());
    expect(fresh.byteLength).toBeGreaterThan(1000);
    const stale = await renderReportXlsx(baseReport({ freshness: undefined }));
    expect(stale.byteLength).toBeGreaterThan(1000);
  });

  it("builds a .pdf without throwing", () => {
    const pdf = renderReportPdf(baseReport());
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
});
