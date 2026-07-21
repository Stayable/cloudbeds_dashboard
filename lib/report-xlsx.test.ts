import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { renderReportXlsx } from "./report-xlsx";
import { derive, SOURCE_NOTE } from "./revenue-report";
const blk = (i:any)=>({actual:derive(i),lastYear:null});
const report:any = {
  asOf:"2026-07-19", generatedEastern:"2026-07-20 06:00 ET", sourceNote:SOURCE_NOTE,
  actual:[{code:"DP",name:"Stayable Davenport",
    yesterday:blk({transientNights:10,leaseNights:84,otherBlocks:1,ooo:2,inventory:153,transientRev:492.05,leaseRev:2706.13}),
    mtd:blk({transientNights:322,leaseNights:1666,otherBlocks:15,ooo:105,inventory:2893,transientRev:18616.74,leaseRev:54453.95}),
    ytd:blk({transientNights:3229,leaseNights:16011,otherBlocks:215,ooo:7181,inventory:30255,transientRev:177929.48,leaseRev:503025.39})}],
  onTheBooks:[{code:"DP",name:"Stayable Davenport",days:[
    {date:"2026-07-20",row:derive({transientNights:8,leaseNights:83,otherBlocks:3,ooo:2,inventory:153,transientRev:368.5,leaseRev:2675.56})}]}],
};
describe("renderReportXlsx", () => {
  it("produces a workbook with the three sheets", async () => {
    const buf = await renderReportXlsx(report);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any);
    expect(wb.getWorksheet("ACTUAL")).toBeTruthy();
    expect(wb.getWorksheet("ON-THE-BOOKS")).toBeTruthy();
    expect(wb.getWorksheet("Notes & Sources")).toBeTruthy();
    expect(buf.length).toBeGreaterThan(2000);
  });
});
