import { describe, it, expect } from "vitest";
import { buildDdfRows, ddfSheetName, DDF_HEADERS, SEED_RESERVATION_STATUS, type DdfSourceRow } from "@/lib/ddf-sheet";
import { PROPERTIES } from "@/config/properties";

const prop = (code: string) => PROPERTIES.find((p) => p.code === code)!;

describe("ddfSheetName", () => {
  it("matches the workbook's existing MM.DD convention", () => {
    expect(ddfSheetName("2026-08-15")).toBe("08.15");
    expect(ddfSheetName("2026-02-01")).toBe("02.01");
  });
});

describe("buildDdfRows", () => {
  const sources: DdfSourceRow[] = [
    {
      property: prop("JW"),
      reservations: [
        { rooms: ["109"], arrival: "2026-08-01", guest: "A Name" },
        { rooms: ["404", "406"], arrival: "2026-07-28", guest: "B Name" },
      ],
    },
    { property: prop("KW"), reservations: [] },
    { property: prop("KE"), reservations: null },
  ];

  it("has exactly the workbook's seven columns", () => {
    expect(DDF_HEADERS).toHaveLength(7);
    for (const row of buildDdfRows("2026-08-15", sources)) expect(row).toHaveLength(7);
  });

  it("writes one row per RESERVATION with rooms comma-joined", () => {
    // The workbook's column is "Room(s)" and a refund is decided per
    // reservation, so a two-room stay is one row — the opposite of the walk
    // list, which is one row per door.
    const rows = buildDdfRows("2026-08-15", sources);
    expect(rows[0]).toEqual(["JW", "", "2026-08-01", "2026-08-15", "109", SEED_RESERVATION_STATUS, ""]);
    expect(rows[1][4]).toBe("404, 406");
  });

  it("seeds status as Due Out, never Checked Out", () => {
    // Seeding "Checked Out" would assert a departure that has not happened —
    // and the team overwrites this column as people actually leave.
    const rows = buildDdfRows("2026-08-15", sources);
    expect(rows.map((r) => r[5])).not.toContain("Checked Out");
    expect(rows[0][5]).toBe(SEED_RESERVATION_STATUS);
  });

  it("uses the workbook's own no-due-outs marker", () => {
    expect(buildDdfRows("2026-08-15", sources)[2][0]).toBe("KW - No due outs");
  });

  it("distinguishes a failed read from a genuine zero", () => {
    const rows = buildDdfRows("2026-08-15", sources);
    const failed = rows.find((r) => r[5] === "READ FAILED")!;
    expect(failed[0]).toBe("KE");
    expect(failed[6]).toMatch(/verify manually/);
    // and it is NOT the same row shape as KW's real zero
    expect(rows.some((r) => r[0] === "KE - No due outs")).toBe(false);
  });

  it("leaves the Name column blank by default", () => {
    // CLAUDE.md §5 rule 2 — no code outside /bea §3 emits a guest name unless
    // explicitly switched on.
    for (const row of buildDdfRows("2026-08-15", sources)) expect(row[1]).toBe("");
  });

  it("fills the Name column only when explicitly asked", () => {
    const rows = buildDdfRows("2026-08-15", sources, { includeGuestNames: true });
    expect(rows[0][1]).toBe("A Name");
    expect(rows[1][1]).toBe("B Name");
    // rows that never had a guest stay blank rather than reading "undefined"
    expect(rows[2][1]).toBe("");
  });

  it("stamps the departure date on every real row", () => {
    const rows = buildDdfRows("2026-08-15", sources).filter((r) => r[5] === SEED_RESERVATION_STATUS);
    expect(rows.every((r) => r[3] === "2026-08-15")).toBe(true);
  });
});
