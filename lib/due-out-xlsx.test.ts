import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { dueOutFileName, walkRows, renderDueOutXlsx } from "@/lib/due-out-xlsx";
import type { DueOutProperty } from "@/lib/due-outs";
import { PROPERTIES } from "@/config/properties";

const prop = (code: string) => PROPERTIES.find((p) => p.code === code)!;

const rows: DueOutProperty[] = [
  { property: prop("DP"), rooms: ["219", "245"], reservations: 2 },
  { property: prop("LL"), rooms: [], reservations: 0 },
  { property: prop("JW"), rooms: ["109", "412"], reservations: 1 },
];

describe("dueOutFileName", () => {
  it("stamps the STAY date MMDDYY per CLAUDE.md §7", () => {
    expect(dueOutFileName("2026-08-15")).toBe("DueOutWalkList_Stayable_081526.xlsx");
  });

  it("keeps leading zeros in single-digit months and days", () => {
    expect(dueOutFileName("2027-01-05")).toBe("DueOutWalkList_Stayable_010527.xlsx");
  });
});

describe("walkRows", () => {
  it("emits one row per ROOM, not per reservation", () => {
    // JW above is 2 rooms on 1 reservation. Per-reservation rows would send a
    // PA to walk one door where two are vacating.
    expect(walkRows(rows)).toEqual([
      { name: "Davenport", id: "44199", room: "219" },
      { name: "Davenport", id: "44199", room: "245" },
      { name: "Jacksonville West", id: "6802", room: "109" },
      { name: "Jacksonville West", id: "6802", room: "412" },
    ]);
  });

  it("skips unread properties rather than inventing rows for them", () => {
    const withFailure: DueOutProperty[] = [{ property: prop("KE"), rooms: null, reservations: null }];
    expect(walkRows(withFailure)).toEqual([]);
  });
});

async function read(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  // `as any` matches lib/report-xlsx.test.ts — exceljs's bundled Buffer type
  // predates the ArrayBufferLike generic in this @types/node.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buf as any);
  const ws = wb.getWorksheet("Walk List")!;
  const text: string[] = [];
  ws.eachRow((row) => row.eachCell((c) => text.push(String(c.value ?? ""))));
  return { ws, text: text.join(" | ") };
}

describe("renderDueOutXlsx", () => {
  it("titles the sheet with the stay date, not the generation date", async () => {
    const { text } = await read(await renderDueOutXlsx("2026-08-15", rows, "2026-08-14 14:13"));
    expect(text).toContain("Saturday, August 15, 2026");
    expect(text).toContain("generated 2026-08-14 14:13 Eastern");
  });

  it("writes one body row per room with its property ID", async () => {
    const { text } = await read(await renderDueOutXlsx("2026-08-15", rows, "x"));
    expect(text).toContain("44199");
    expect(text).toContain("6802");
    expect(text).toContain("4 rooms across 3 properties");
  });

  it("gives an unread property its own UNAVAILABLE row", async () => {
    const withFailure: DueOutProperty[] = [...rows, { property: prop("KE"), rooms: null, reservations: null }];
    const { text } = await read(await renderDueOutXlsx("2026-08-15", withFailure, "x"));
    expect(text).toContain("UNAVAILABLE");
    expect(text).toContain("UNKNOWN, not zero");
    // and the caveat is on the face of the document, not only in the row
    expect(text).toContain("could not be read");
  });

  it("omits the warning entirely when every property was read", async () => {
    const { text } = await read(await renderDueOutXlsx("2026-08-15", rows, "x"));
    expect(text).not.toContain("UNAVAILABLE");
    expect(text).not.toContain("could not be read");
  });

  it("says so plainly when nothing is due out", async () => {
    const empty: DueOutProperty[] = [{ property: prop("DP"), rooms: [], reservations: 0 }];
    const { text } = await read(await renderDueOutXlsx("2026-08-15", empty, "x"));
    expect(text).toContain("No rooms are scheduled to check out");
  });

  it("carries no guest name, balance or currency anywhere in the workbook", async () => {
    // CLAUDE.md §5 rule 2 — this file gets shared by link, which is a weaker
    // gate than the PIN, so it must carry the least sensitive data.
    const { text } = await read(await renderDueOutXlsx("2026-08-15", rows, "x"));
    expect(text).not.toMatch(/\$|balance|owes/i);
  });

  it("freezes the header and filters the body", async () => {
    const { ws } = await read(await renderDueOutXlsx("2026-08-15", rows, "x"));
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 5 });
    expect(ws.autoFilter).toBeTruthy();
  });
});
