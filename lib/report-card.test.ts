import { describe, it, expect } from "vitest";
import { buildReportCard } from "./report-card";
import { derive, SOURCE_NOTE } from "./revenue-report";
const blk=(i:any)=>({actual:derive(i),lastYear:null});
const rpt:any = { asOf:"2026-07-19", generatedEastern:"2026-07-20 ET", sourceNote:SOURCE_NOTE, trackingSince:"2026-07-19",
  actual:[{code:"DP",name:"Stayable Davenport",
    yesterday:blk({transientNights:10,leaseNights:84,otherBlocks:1,ooo:2,inventory:153,transientRev:492.05,leaseRev:2706.13}),
    mtd:blk({transientNights:322,leaseNights:1666,otherBlocks:15,ooo:105,inventory:2893,transientRev:18616.74,leaseRev:54453.95}),
    ytd:blk({transientNights:3229,leaseNights:16011,otherBlocks:215,ooo:7181,inventory:30255,transientRev:177929.48,leaseRev:503025.39})}],
  onTheBooks:[] };
describe("buildReportCard", () => {
  it("is a valid Adaptive Card v1.4 with OpenUrl buttons", () => {
    const c:any = buildReportCard(rpt, "https://dashboard.rentstayable.com");
    expect(c.type).toBe("AdaptiveCard");
    expect(c.version).toBe("1.4");
    expect(Array.isArray(c.body)).toBe(true);
    const urls = (c.actions ?? []).map((a:any)=>a.url);
    expect(urls).toContain("https://dashboard.rentstayable.com/report/latest.xlsx");
    expect(urls).toContain("https://dashboard.rentstayable.com/report");
    // JSON-serializable + ASCII-safe
    const s = JSON.stringify(c);
    expect(s).not.toMatch(/[^\x00-\x7F]/);
  });

  it("carries no per-property breakdown and no source/methodology footer", () => {
    // Kyle 07/29/26: both made the message too crowded. The per-property detail
    // lives in the attached PDF; the methodology on its methodology pages.
    const c:any = buildReportCard(rpt, "https://dashboard.rentstayable.com");
    const texts = c.body.map((b:any)=>b.text ?? "").join("\n");
    expect(texts).not.toContain("By property");
    expect(texts).not.toContain("Stayable Davenport");
    expect(texts).not.toContain("Methodology confirmed by Monica Oco");
    expect(texts).not.toContain(SOURCE_NOTE);
    const factTitles = c.body.flatMap((b:any)=>b.facts?.map((f:any)=>f.title) ?? []);
    expect(factTitles).not.toContain("Davenport");
  });

  it("drops the PDF button only when the PDF ships as a real attachment", () => {
    // Keyed off URLs, not titles: the label carries the report date and moves.
    const plain:any = buildReportCard(rpt, "https://x.test");
    expect(plain.actions.map((a:any)=>a.url)).toContain("https://x.test/report/latest.pdf");
    // Until the flow attaches the file, that button IS the attachment, so it leads.
    expect(plain.actions[0].url).toBe("https://x.test/report/latest.pdf");
    expect(plain.actions[0].title).toContain("(PDF)");

    const attached:any = buildReportCard(rpt, "https://x.test", { pdfAttached: true });
    const urls = attached.actions.map((a:any)=>a.url);
    expect(urls).not.toContain("https://x.test/report/latest.pdf");
    // The .xlsx is deliberately NOT attached, so its link must survive.
    expect(urls).toContain("https://x.test/report/latest.xlsx");
    expect(urls).toContain("https://x.test/report");
  });

  it("routes both file buttons through the token link when given one", () => {
    // The pin-gated /report/latest.* paths are a login wall for anyone in the
    // Revenue chat without the MAIN pin, so a card carrying a token must not
    // emit them at all — including the Excel button, which survives attachment.
    const c:any = buildReportCard(rpt, "https://x.test", { fileToken: "123.abc" });
    const urls: string[] = c.actions.map((a:any)=>a.url);
    expect(urls).toContain("https://x.test/api/report-file?fmt=pdf&t=123.abc");
    expect(urls).toContain("https://x.test/api/report-file?fmt=xlsx&t=123.abc");
    expect(urls.some((u)=>u.includes("/report/latest."))).toBe(false);
    // The dashboard link stays gated on purpose — a file token is not a pin.
    expect(urls).toContain("https://x.test/report");

    const attached:any = buildReportCard(rpt, "https://x.test", { fileToken: "123.abc", pdfAttached: true });
    const aUrls: string[] = attached.actions.map((a:any)=>a.url);
    expect(aUrls.some((u)=>u.includes("/report/latest."))).toBe(false);
    expect(aUrls).toContain("https://x.test/api/report-file?fmt=xlsx&t=123.abc");
  });

  it("shows Portfolio Occupancy (MTD) when MTD counts are complete", () => {
    const c:any = buildReportCard(rpt, "https://dashboard.rentstayable.com");
    const factSet = c.body.find((b:any)=>b.type==="FactSet" && b.facts.some((f:any)=>f.title.startsWith("Portfolio Occupancy")));
    const titles = factSet.facts.map((f:any)=>f.title);
    expect(titles).toContain("Portfolio Occupancy (MTD)");
    expect(titles).toContain("Room Revenue (MTD)");
  });

  it("omits the garbage Portfolio Occupancy (MTD) fact when MTD counts are partial, but keeps Room Revenue (MTD)", () => {
    const partialRpt:any = {
      ...rpt,
      actual: [{ ...rpt.actual[0], mtd: { ...rpt.actual[0].mtd, countsPartial: true } }],
    };
    const c:any = buildReportCard(partialRpt, "https://dashboard.rentstayable.com");
    const factSet = c.body.find((b:any)=>b.type==="FactSet" && b.facts.some((f:any)=>f.title.includes("Occupancy") || f.title.includes("Revenue")));
    const titles = factSet.facts.map((f:any)=>f.title);
    expect(titles).not.toContain("Portfolio Occupancy (MTD)");
    expect(titles).toContain("Portfolio Occupancy (Yesterday)");
    expect(titles).toContain("Room Revenue (MTD)");
  });
});
