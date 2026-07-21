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
});
