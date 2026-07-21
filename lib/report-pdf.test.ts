import { describe, it, expect } from "vitest";
import { renderReportPdf } from "./report-pdf";
import { derive, SOURCE_NOTE } from "./revenue-report";
const blk=(i:any)=>({actual:derive(i),lastYear:null});
const report:any = { asOf:"2026-07-19", generatedEastern:"2026-07-20 ET", sourceNote:SOURCE_NOTE,
  actual:[{code:"DP",name:"Stayable Davenport",
    yesterday:blk({transientNights:10,leaseNights:84,otherBlocks:1,ooo:2,inventory:153,transientRev:492.05,leaseRev:2706.13}),
    mtd:blk({transientNights:322,leaseNights:1666,otherBlocks:15,ooo:105,inventory:2893,transientRev:18616.74,leaseRev:54453.95}),
    ytd:blk({transientNights:3229,leaseNights:16011,otherBlocks:215,ooo:7181,inventory:30255,transientRev:177929.48,leaseRev:503025.39})}],
  onTheBooks:[] };
describe("renderReportPdf", () => {
  it("returns a non-empty PDF buffer", () => {
    const buf = renderReportPdf(report);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0,5).toString()).toBe("%PDF-");
  });
});
