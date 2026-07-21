# Revenue/Occupancy Report → Teams Automation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recreate Monica's daily Cloudbeds occupancy/revenue report (ACTUAL history + on-the-books forecast, all 8 properties) as a gated `/report` page + downloadable Excel/PDF, and auto-post a summary Adaptive Card to a Teams channel every morning via a Power Automate HTTP-trigger flow.

**Architecture:** A pure builder (`lib/revenue-report.ts`) turns per-property Cloudbeds pulls into a typed `RevenueReport` model (all derived rows computed, tested in isolation). A server fetch layer (`getRevenueReportInputs`) assembles the raw inputs from existing Cloudbeds helpers. Renderers (Excel via `exceljs`, PDF via `jspdf`, HTML via a server component) consume the model. A `CRON_SECRET`-guarded cron route builds the model and POSTs an Adaptive Card to `TEAMS_FLOW_URL`.

**Tech Stack:** Next.js 15 App Router, TypeScript, `exceljs` (already a devDep), `jspdf` + `jspdf-autotable` (already deps), vitest. No headless Chromium. No new runtime services.

## Global Constraints

- **PII-free, always.** No guest names/emails/phones. Lease vs transient is classified by **rate plan** via existing `classifyRatePlan` (= Kyle's `*ML`/`*WL` name convention), never by reading names. (CLAUDE.md §5.2, §6.)
- **Cloudbeds is read-only.** Never write to Cloudbeds. Reuse existing helpers in `lib/cloudbeds.ts`.
- **No `NEXT_PUBLIC_` on any secret.** `TEAMS_FLOW_URL` and `CRON_SECRET` are server-only env vars.
- **Teams body = full Adaptive Card JSON** — top-level `"type":"AdaptiveCard"`, `"$schema"`, `"version":"1.4"`, `"body"`. POST as `Content-Type: application/json; charset=utf-8`. (Verified 2026-07-22; simple `{text}` fails the flow.)
- **Cloudbeds-sourced.** Lease Jan–Aug will differ from Monica's Yardi blend; label the report accordingly. No Yardi, no SharePoint in this plan (deferred).
- **Report definitions (verified against the source PDF):** `Occupied = Transient + Lease + Other blocks`; `Available = Inventory − Occupied − OOO`; `% Occupied = Occupied/Inventory`; `ADR Combined = RoomRevenue/Occupied`; `ADR Transient/Lease = respective revenue / nights`; `RevPAR = RoomRevenue/Inventory`; `Variance = Actual − LastYear`; KE-only `% Occupied Adjusted = Occupied/(Inventory − 20×days)`.
- **Range aggregation is occupied/inventory-WEIGHTED**, not a flat daily average (the live probe showed flat-average YTD drifts).
- **Dev branch:** `claude/nifty-thompson-ts8zny`. Commit per task. No PR unless asked.
- **Tests:** `npm test` (vitest). File naming for any generated export follows `Title_PropertyID_MMDDYY` (portfolio → `Stayable`).

---

### Task 1: Data-availability spike (decides the Task 3 queries)

**Files:**
- Create: `scripts/probe-revenue-split.mjs` (read-only; not committed as production code — a probe like the existing `scripts/probe-*.mjs`)
- Create: `docs/superpowers/notes/2026-07-22-revenue-report-probe-findings.md` (findings + decision)

**Interfaces:**
- Produces: a written decision for Task 3 on three questions — (Q1) which dataset-1 `transaction_type` value(s) equal Monica's "Room Revenue" (excl. taxes/adjustments); (Q2) whether transient-vs-lease **revenue** can be split (candidate: dataset-1 grouped by a rate-plan/reservation dimension, or dataset-3 with a revenue measure); (Q3) the source for range **room-night counts** (rooms_sold, OOO, other-blocks, inventory) given dataset-7 drops them.

- [ ] **Step 1: Write the probe** (Davenport only; key in `.env.local` as `CLOUDBEDS_API_KEY_DP`, apiPropertyId `318197`). It must:
  - Call DI dataset 1 grouped by `transaction_type` for 2026-07-19 and print the type→amount map (identify the room-revenue type; compare its sum to Monica's DP Yesterday Room Revenue $3,198.18).
  - Attempt dataset 1 grouped by `public_rate_plan` (and, if rejected, by `reservation_status`) with a currency measure (`debit_amount`), `details:true`, to see if revenue splits by rate plan. Zip index↔records like `getLeaseMix`.
  - Attempt to obtain range room-night counts: test dataset 3 `room_count` grouped by `public_rate_plan` over a stay-overlap range (checkin_date≤end AND checkout_date≥start) summed per day, and compare the summed transient/lease nights to Monica's DP figures (Yesterday T10/L84).
  - Print every raw HTTP status + first 500 chars on any non-200.

```js
// scripts/probe-revenue-split.mjs  (read-only)
import { readFileSync } from "node:fs";
const env = readFileSync(".env.local","utf8");
const key = env.match(/^CLOUDBEDS_API_KEY_DP=(.*)$/m)[1].trim().replace(/^["']|["']$/g,"");
const PID = "318197";
const DI = "https://api.cloudbeds.com/datainsights/v1.1/reports/query/data?mode=Run";
async function q(body){
  const r = await fetch(DI,{method:"POST",headers:{Authorization:`Bearer ${key}`,"X-PROPERTY-ID":PID,
    "Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(body)});
  const t = await r.text(); return {status:r.status, json:(()=>{try{return JSON.parse(t)}catch{return t}})()};
}
// Q1: revenue by transaction_type for one day
console.log("Q1 dataset1 by transaction_type 2026-07-19:");
console.log(JSON.stringify(await q({property_ids:[318197],dataset_id:1,
  columns:[{cdf:{column:"debit_amount"}},{cdf:{column:"credit_amount"}}],
  group_rows:[{cdf:{column:"transaction_type"}}],
  filters:{and:[{cdf:{column:"transaction_date"},operator:"equals",value:"2026-07-19"}]},
  settings:{totals:false,details:true}}),null,2).slice(0,1200));
// Q2: revenue by rate plan (details:true, zip index<->records)
console.log("\nQ2 dataset1 debit by public_rate_plan 2026-07-19:");
console.log(JSON.stringify(await q({property_ids:[318197],dataset_id:1,
  columns:[{cdf:{column:"debit_amount"}}],group_rows:[{cdf:{column:"public_rate_plan"}}],
  filters:{and:[{cdf:{column:"transaction_date"},operator:"equals",value:"2026-07-19"}]},
  settings:{totals:false,details:true}}),null,2).slice(0,1200));
// Q3: room-nights by rate plan over a range (stay overlap)
console.log("\nQ3 dataset3 room_count by public_rate_plan overlap 2026-07-19..19:");
console.log(JSON.stringify(await q({property_ids:[318197],dataset_id:3,
  columns:[{cdf:{column:"room_count"}}],group_rows:[{cdf:{column:"public_rate_plan"}}],
  filters:{and:[{cdf:{column:"checkin_date"},operator:"less_than_or_equal",value:"2026-07-19"},
    {cdf:{column:"checkout_date"},operator:"greater_than_or_equal",value:"2026-07-19"}]},
  settings:{totals:false,details:true}}),null,2).slice(0,1200));
```

- [ ] **Step 2: Run the probe**

Run: `node scripts/probe-revenue-split.mjs`
Expected: three JSON blocks, each HTTP 200 with data.

- [ ] **Step 3: Record findings + decision**

Write `docs/superpowers/notes/2026-07-22-revenue-report-probe-findings.md` answering Q1/Q2/Q3 with the actual values seen, and state the chosen approach for each row group. Decide the **revenue-split posture**:
  - If Q2 returns a clean per-rate-plan `debit_amount` split → **split path**.
  - Else → **fallback**: total Room Revenue (Q1) + nights-based transient/lease ratio (Q3), with a flag on the report.

- [ ] **Step 4: Commit**

```bash
git add scripts/probe-revenue-split.mjs docs/superpowers/notes/2026-07-22-revenue-report-probe-findings.md
git commit -m "chore(report): data-availability spike for revenue split + range counts"
```

---

### Task 2: Report model + pure builder math

**Files:**
- Create: `lib/revenue-report.ts`
- Test: `lib/revenue-report.test.ts`

**Interfaces:**
- Produces:
  - `type RowInputs = { transientNights:number; leaseNights:number; otherBlocks:number; ooo:number; inventory:number; transientRev:number; leaseRev:number }`
  - `type DerivedRow = RowInputs & { occupied:number; available:number; pOcc:number; pOoo:number; pAvail:number; roomRev:number; adrCombined:number; adrTransient:number; adrLease:number; revpar:number; occAdjLess20:number|null }`
  - `function derive(input: RowInputs, opts?: { keDays?: number }): DerivedRow` — computes all derived fields; `occAdjLess20` non-null only when `keDays` is provided.
  - `function variance(a: number|null, b: number|null): number|null` — `a−b`, or `null` if either is null.
  - `type PeriodBlock = { actual: DerivedRow; lastYear: DerivedRow | null }`
  - `type PropertyActual = { code:string; name:string; yesterday:PeriodBlock; mtd:PeriodBlock; ytd:PeriodBlock }`
  - `type OnTheBooksDay = { date:string; row:DerivedRow }`
  - `type PropertyOnTheBooks = { code:string; name:string; days:OnTheBooksDay[] }`
  - `type RevenueReport = { asOf:string; generatedEastern:string; actual:PropertyActual[]; onTheBooks:PropertyOnTheBooks[]; sourceNote:string }`
- Consumes: nothing (pure).

- [ ] **Step 1: Write failing tests** (fixtures are Monica's DP numbers used purely as arithmetic oracles for the math — NOT as the report's data source)

```ts
import { describe, it, expect } from "vitest";
import { derive, variance } from "./revenue-report";

describe("derive", () => {
  it("computes Davenport Yesterday rows", () => {
    const d = derive({ transientNights:10, leaseNights:84, otherBlocks:1, ooo:2,
      inventory:153, transientRev:492.05, leaseRev:2706.13 });
    expect(d.occupied).toBe(95);
    expect(d.available).toBe(56);
    expect(d.roomRev).toBeCloseTo(3198.18, 2);
    expect(d.pOcc).toBeCloseTo(95/153, 5);
    expect(d.adrCombined).toBeCloseTo(3198.18/95, 2);
    expect(d.adrTransient).toBeCloseTo(492.05/10, 2);
    expect(d.revpar).toBeCloseTo(3198.18/153, 2);
    expect(d.occAdjLess20).toBeNull();
  });
  it("KE adjusted occupancy uses inventory minus 20×days", () => {
    const d = derive({ transientNights:16, leaseNights:103, otherBlocks:0, ooo:30,
      inventory:167, transientRev:771.14, leaseRev:3223.40 }, { keDays:1 });
    expect(d.occAdjLess20).toBeCloseTo(119/147, 4); // ≈ 0.8095
  });
  it("guards divide-by-zero (no prior-year inventory)", () => {
    const d = derive({ transientNights:0, leaseNights:0, otherBlocks:0, ooo:0,
      inventory:0, transientRev:0, leaseRev:0 });
    expect(d.pOcc).toBe(0); expect(d.adrCombined).toBe(0);
  });
  it("variance returns null when a side is null", () => {
    expect(variance(10, 4)).toBe(6);
    expect(variance(10, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- revenue-report`
Expected: FAIL ("derive is not a function").

- [ ] **Step 3: Implement `derive` + `variance`**

```ts
// lib/revenue-report.ts
export type RowInputs = {
  transientNights: number; leaseNights: number; otherBlocks: number; ooo: number;
  inventory: number; transientRev: number; leaseRev: number;
};
export type DerivedRow = RowInputs & {
  occupied: number; available: number; pOcc: number; pOoo: number; pAvail: number;
  roomRev: number; adrCombined: number; adrTransient: number; adrLease: number;
  revpar: number; occAdjLess20: number | null;
};
const div = (n: number, d: number) => (d ? n / d : 0);
export function derive(i: RowInputs, opts?: { keDays?: number }): DerivedRow {
  const occupied = i.transientNights + i.leaseNights + i.otherBlocks;
  const available = i.inventory - occupied - i.ooo;
  const roomRev = i.transientRev + i.leaseRev;
  const occAdjLess20 =
    opts?.keDays != null ? div(occupied, i.inventory - 20 * opts.keDays) : null;
  return {
    ...i, occupied, available, roomRev,
    pOcc: div(occupied, i.inventory), pOoo: div(i.ooo, i.inventory),
    pAvail: div(available, i.inventory),
    adrCombined: div(roomRev, occupied), adrTransient: div(i.transientRev, i.transientNights),
    adrLease: div(i.leaseRev, i.leaseNights), revpar: div(roomRev, i.inventory),
    occAdjLess20,
  };
}
export function variance(a: number | null, b: number | null): number | null {
  return a == null || b == null ? null : a - b;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- revenue-report`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the report container types** (append to `lib/revenue-report.ts`)

```ts
export type PeriodBlock = { actual: DerivedRow; lastYear: DerivedRow | null };
export type PropertyActual = {
  code: string; name: string; yesterday: PeriodBlock; mtd: PeriodBlock; ytd: PeriodBlock;
};
export type OnTheBooksDay = { date: string; row: DerivedRow };
export type PropertyOnTheBooks = { code: string; name: string; days: OnTheBooksDay[] };
export type RevenueReport = {
  asOf: string; generatedEastern: string;
  actual: PropertyActual[]; onTheBooks: PropertyOnTheBooks[]; sourceNote: string;
};
export const SOURCE_NOTE =
  "Cloudbeds-sourced. Transient nights/revenue and OOO from Cloudbeds; lease classified by rate plan. " +
  "Differs from Monica's Yardi-blended lease figures for Jan–Aug. Room Revenue excludes taxes and adjustments.";
```

- [ ] **Step 6: Commit**

```bash
git add lib/revenue-report.ts lib/revenue-report.test.ts
git commit -m "feat(report): pure revenue-report builder (derive/variance + model types)"
```

---

### Task 3: Cloudbeds fetch layer — `getRevenueReportInputs`

**Files:**
- Modify: `lib/cloudbeds.ts` (add exported `getRevenueReportInputs`, near the other portfolio getters)
- Test: `lib/revenue-report-inputs.test.ts` (range-math only; network calls are integration-verified in Task 12, not unit-mocked)

**Interfaces:**
- Consumes: `derive` types from Task 2; existing `getInsightsOccupancy`, `getFinanceAggregates`/`getPortfolioFinance`, `getLeaseMix`, `getRoomBlocks`/`getPortfolioOoo`, `PROPERTIES`, `readKey`, date helpers (`shiftYmd`, `monthStart`, `dayCount`, `easternToday`), and the **Task 1 decision** for revenue/nights queries.
- Produces:
  - `type ReportRanges = { asOf:string; yesterday:[string,string]; mtd:[string,string]; ytd:[string,string]; lyYesterday:[string,string]; lyMtd:[string,string]; lyYtd:[string,string]; onTheBooks:string[] }`
  - `function reportRanges(asOf: string): ReportRanges` — pure; `asOf` = the "Yesterday" date; on-the-books = the 7 days starting `asOf+1`.
  - `async function getRevenueReportInputs(asOf: string): Promise<{ actual: PropertyActual[]; onTheBooks: PropertyOnTheBooks[] }>` — per property, builds `RowInputs` for each range/day using the confirmed queries, then wraps each in `derive` (KE passes `keDays`).

- [ ] **Step 1: Write failing test for `reportRanges`**

```ts
import { describe, it, expect } from "vitest";
import { reportRanges } from "./cloudbeds";
describe("reportRanges", () => {
  it("derives the six actual ranges + 7 on-the-books days from asOf", () => {
    const r = reportRanges("2026-07-19");
    expect(r.yesterday).toEqual(["2026-07-19","2026-07-19"]);
    expect(r.mtd).toEqual(["2026-07-01","2026-07-19"]);
    expect(r.ytd).toEqual(["2026-01-01","2026-07-19"]);
    expect(r.lyYesterday).toEqual(["2025-07-19","2025-07-19"]);
    expect(r.lyMtd).toEqual(["2025-07-01","2025-07-19"]);
    expect(r.lyYtd).toEqual(["2025-01-01","2025-07-19"]);
    expect(r.onTheBooks[0]).toBe("2026-07-20");
    expect(r.onTheBooks).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- cloudbeds`
Expected: FAIL ("reportRanges is not a function").

- [ ] **Step 3: Implement `reportRanges`** (pure; put near the DI helpers in `lib/cloudbeds.ts`)

```ts
export type ReportRanges = {
  asOf: string;
  yesterday: [string, string]; mtd: [string, string]; ytd: [string, string];
  lyYesterday: [string, string]; lyMtd: [string, string]; lyYtd: [string, string];
  onTheBooks: string[];
};
export function reportRanges(asOf: string): ReportRanges {
  const yStart = `${asOf.slice(0, 4)}-01-01`;
  const ly = (d: string) => `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;
  return {
    asOf,
    yesterday: [asOf, asOf],
    mtd: [monthStart(asOf), asOf],
    ytd: [yStart, asOf],
    lyYesterday: [ly(asOf), ly(asOf)],
    lyMtd: [ly(monthStart(asOf)), ly(asOf)],
    lyYtd: [ly(yStart), ly(asOf)],
    onTheBooks: Array.from({ length: 7 }, (_, i) => shiftYmd(asOf, i + 1)),
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- cloudbeds`
Expected: PASS.

- [ ] **Step 5: Implement `getRevenueReportInputs`** using the Task-1-confirmed queries. Per property with a configured key: for each of the six ranges fetch `RowInputs` (transient/lease nights + revenue via the Task-1 path; `ooo`/`otherBlocks` from `getRoomBlocks` summed over the range; `inventory` = capacity×days; occupancy cross-checked against dataset 7); build `PeriodBlock`s via `derive` (KE passes `keDays = dayCount(range)`). For on-the-books, fetch the same per forward day. Return `{ actual, onTheBooks }`. Use `Promise.all` across properties (mirrors `getPortfolioFinance`). Skip unconfigured properties (no key) and mark them absent rather than throwing.

> Implementer note: the exact column/measure names for nights+revenue come from the Task 1 findings doc. If the split path was rejected in Task 1, populate `transientRev`/`leaseRev` from the fallback (total Room Revenue split by the nights ratio) and set a module-level `revenueSplitEstimated = true` that Task 4–6 surface as a footnote.

- [ ] **Step 6: Commit**

```bash
git add lib/cloudbeds.ts lib/revenue-report-inputs.test.ts
git commit -m "feat(report): getRevenueReportInputs — assemble per-property inputs from Cloudbeds"
```

---

### Task 4: Excel renderer

**Files:**
- Create: `lib/report-xlsx.ts`
- Test: `lib/report-xlsx.test.ts`

**Interfaces:**
- Consumes: `RevenueReport` (Task 2).
- Produces: `async function renderReportXlsx(report: RevenueReport): Promise<Buffer>` — an `exceljs` workbook with sheets `ACTUAL`, `ON-THE-BOOKS`, `Notes & Sources`; dark headers, per-property blocks, `Occupied=Transient+Lease+Other`, the KE adjusted row, currency/%/int formats, and conditional formatting on `% Available` cells (red ≤0.15, orange ≤0.20, purple font ≥0.40). Banner row states Cloudbeds-sourced.

- [ ] **Step 1: Write failing test**

```ts
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
  onTheBooks:[{code:"DP",name:"Stayable Davenport",days:[]}],
};
describe("renderReportXlsx", () => {
  it("produces a workbook with the three sheets and the Occupied total", async () => {
    const buf = await renderReportXlsx(report);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any);
    expect(wb.getWorksheet("ACTUAL")).toBeTruthy();
    expect(wb.getWorksheet("ON-THE-BOOKS")).toBeTruthy();
    expect(wb.getWorksheet("Notes & Sources")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure** — Run: `npm test -- report-xlsx` → FAIL.

- [ ] **Step 3: Implement `renderReportXlsx`** with `exceljs`, mirroring the block layout (property title bar → block headers → date row → the 18 rows, KE gets the adjusted row). Reuse the palette/formats from the prototype in the design (`docs/superpowers/specs/2026-07-21-…`): navy headers, `$#,##0.00` / `0.0%` / `#,##0` formats, `worksheet.addConditionalFormatting` on the `% Available` cells. Return `await wb.xlsx.writeBuffer()` as `Buffer`.

- [ ] **Step 4: Run to verify pass** — Run: `npm test -- report-xlsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/report-xlsx.ts lib/report-xlsx.test.ts
git commit -m "feat(report): Excel renderer (exceljs, Monica layout + availability highlighting)"
```

---

### Task 5: PDF renderer

**Files:**
- Create: `lib/report-pdf.ts`
- Test: `lib/report-pdf.test.ts`

**Interfaces:**
- Consumes: `RevenueReport`.
- Produces: `function renderReportPdf(report: RevenueReport): Buffer` — landscape PDF via `jspdf` + `jspdf-autotable`: a table per property (ACTUAL blocks), an on-the-books table per property, and a notes/legend footer. Availability cells shaded via autotable `didParseCell`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { renderReportPdf } from "./report-pdf";
import { derive, SOURCE_NOTE } from "./revenue-report";
const report:any = { asOf:"2026-07-19", generatedEastern:"x", sourceNote:SOURCE_NOTE,
  actual:[{code:"DP",name:"Stayable Davenport",
    yesterday:{actual:derive({transientNights:10,leaseNights:84,otherBlocks:1,ooo:2,inventory:153,transientRev:492.05,leaseRev:2706.13}),lastYear:null},
    mtd:{actual:derive({transientNights:322,leaseNights:1666,otherBlocks:15,ooo:105,inventory:2893,transientRev:18616.74,leaseRev:54453.95}),lastYear:null},
    ytd:{actual:derive({transientNights:3229,leaseNights:16011,otherBlocks:215,ooo:7181,inventory:30255,transientRev:177929.48,leaseRev:503025.39}),lastYear:null}}],
  onTheBooks:[] };
describe("renderReportPdf", () => {
  it("returns a non-empty PDF buffer", () => {
    const buf = renderReportPdf(report);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.subarray(0,5).toString()).toBe("%PDF-");
  });
});
```

- [ ] **Step 2: Run to verify failure** — Run: `npm test -- report-pdf` → FAIL.

- [ ] **Step 3: Implement `renderReportPdf`** with `jspdf` (`new jsPDF({ orientation:"landscape" })`) + `autoTable`, one table per property, `didParseCell` to shade `% Available` cells (red ≤0.15, orange ≤0.20, purple text ≥0.40). Return `Buffer.from(doc.output("arraybuffer"))`.

- [ ] **Step 4: Run to verify pass** — Run: `npm test -- report-pdf` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/report-pdf.ts lib/report-pdf.test.ts
git commit -m "feat(report): PDF renderer (jspdf + autotable)"
```

---

### Task 6: `/report` gated HTML page

**Files:**
- Create: `app/report/page.tsx`
- Create: `components/RevenueReportView.tsx`

**Interfaces:**
- Consumes: `getRevenueReportInputs` (Task 3), `SOURCE_NOTE`, `reportRanges`, date helpers.
- Produces: a server component that computes `asOf = shiftYmd(easternToday(), -1)`, builds the `RevenueReport`, and renders it as HTML tables (ACTUAL + on-the-books, per property, availability highlighting) via `RevenueReportView`. Gated automatically by middleware at the `base` level (path `/report` → `requiredLevel` returns `base`; no route change needed). Includes download links to `/report/latest.xlsx` and `/report/latest.pdf`.

- [ ] **Step 1: Implement the page** (server component; `export const dynamic = "force-dynamic"`). Build the report, pass to `RevenueReportView`. Show `generatedEastern`, `SOURCE_NOTE`, and the two download buttons.

- [ ] **Step 2: Implement `RevenueReportView`** — presentational tables mirroring the Excel/PDF layout; Tailwind classes consistent with existing sections (dark header row, right-aligned numerics, red/orange/purple availability cells).

- [ ] **Step 3: Verify it builds** — Run: `npm run build` → the `/report` route compiles with no type errors.

- [ ] **Step 4: Commit**

```bash
git add app/report/page.tsx components/RevenueReportView.tsx
git commit -m "feat(report): gated /report HTML page"
```

---

### Task 7: Download routes (`/report/latest.xlsx`, `/report/latest.pdf`)

**Files:**
- Create: `app/report/latest.xlsx/route.ts`
- Create: `app/report/latest.pdf/route.ts`

**Interfaces:**
- Consumes: `getRevenueReportInputs`, `renderReportXlsx` (Task 4), `renderReportPdf` (Task 5), `SOURCE_NOTE`, date helpers.
- Produces: GET handlers returning the file with the correct `Content-Type` and `Content-Disposition: attachment; filename="OccupancyRevenueReport_Stayable_<MMDDYY>.<ext>"`. `export const runtime = "nodejs"`. Gated by middleware (under `/report`, base level).

- [ ] **Step 1: Implement the xlsx route**

```ts
import { NextResponse } from "next/server";
import { easternToday, shiftYmd } from "@/lib/dates";
import { getRevenueReportInputs } from "@/lib/cloudbeds";
import { renderReportXlsx } from "@/lib/report-xlsx";
import { SOURCE_NOTE } from "@/lib/revenue-report";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const asOf = shiftYmd(easternToday(), -1);
  const { actual, onTheBooks } = await getRevenueReportInputs(asOf);
  const buf = await renderReportXlsx({ asOf, generatedEastern: `${easternToday()} ET`, actual, onTheBooks, sourceNote: SOURCE_NOTE });
  const mmddyy = `${asOf.slice(5,7)}${asOf.slice(8,10)}${asOf.slice(2,4)}`;
  return new NextResponse(buf, { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="OccupancyRevenueReport_Stayable_${mmddyy}.xlsx"` } });
}
```

- [ ] **Step 2: Implement the pdf route** — identical shape, `renderReportPdf`, `Content-Type: application/pdf`, `.pdf` filename.

- [ ] **Step 3: Verify build** — Run: `npm run build` → both routes compile.

- [ ] **Step 4: Commit**

```bash
git add "app/report/latest.xlsx/route.ts" "app/report/latest.pdf/route.ts"
git commit -m "feat(report): xlsx/pdf download routes"
```

---

### Task 8: Adaptive Card builder

**Files:**
- Create: `lib/report-card.ts`
- Test: `lib/report-card.test.ts`

**Interfaces:**
- Consumes: `RevenueReport`, and a `baseUrl: string` for the buttons.
- Produces: `function buildReportCard(report: RevenueReport, baseUrl: string): object` — a valid Adaptive Card v1.4 object: title + as-of, a portfolio summary (occupied-weighted Occ% + RevPAR for Yesterday & MTD), a per-property `FactSet`/`ColumnSet` (Occ% + RevPAR), and `Action.OpenUrl` buttons → `${baseUrl}/report`, `${baseUrl}/report/latest.xlsx`, `${baseUrl}/report/latest.pdf`. All strings ASCII-safe.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildReportCard } from "./report-card";
import { derive, SOURCE_NOTE } from "./revenue-report";
const rpt:any = { asOf:"2026-07-19", generatedEastern:"2026-07-20 ET", sourceNote:SOURCE_NOTE,
  actual:[{code:"DP",name:"Stayable Davenport",
    yesterday:{actual:derive({transientNights:10,leaseNights:84,otherBlocks:1,ooo:2,inventory:153,transientRev:492.05,leaseRev:2706.13}),lastYear:null},
    mtd:{actual:derive({transientNights:322,leaseNights:1666,otherBlocks:15,ooo:105,inventory:2893,transientRev:18616.74,leaseRev:54453.95}),lastYear:null},
    ytd:{actual:derive({transientNights:3229,leaseNights:16011,otherBlocks:215,ooo:7181,inventory:30255,transientRev:177929.48,leaseRev:503025.39}),lastYear:null}}],
  onTheBooks:[] };
describe("buildReportCard", () => {
  it("is a valid Adaptive Card with OpenUrl buttons", () => {
    const c:any = buildReportCard(rpt, "https://dashboard.rentstayable.com");
    expect(c.type).toBe("AdaptiveCard");
    expect(c.version).toBe("1.4");
    expect(Array.isArray(c.body)).toBe(true);
    const urls = (c.actions ?? []).map((a:any)=>a.url);
    expect(urls).toContain("https://dashboard.rentstayable.com/report/latest.xlsx");
  });
});
```

- [ ] **Step 2: Run to verify failure** — Run: `npm test -- report-card` → FAIL.

- [ ] **Step 3: Implement `buildReportCard`** returning the v1.4 object (title, as-of `TextBlock`, portfolio `FactSet`, per-property `ColumnSet`, `actions` = three `Action.OpenUrl`). Occupied-weighted portfolio Occ% = Σoccupied/Σinventory across `excludeFromAggregate=false` properties.

- [ ] **Step 4: Run to verify pass** — Run: `npm test -- report-card` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/report-card.ts lib/report-card.test.ts
git commit -m "feat(report): Adaptive Card builder for Teams"
```

---

### Task 9: Teams poster

**Files:**
- Create: `lib/teams.ts`
- Test: `lib/teams.test.ts`

**Interfaces:**
- Produces: `async function postAdaptiveCard(card: object): Promise<{ ok: boolean; status: number }>` — reads `process.env.TEAMS_FLOW_URL`; POSTs `JSON.stringify(card)` with `Content-Type: application/json; charset=utf-8`; returns `{ ok: res.status===202 || res.ok, status }`. If `TEAMS_FLOW_URL` unset, returns `{ ok:false, status:0 }` (no throw). Never logs the URL.

- [ ] **Step 1: Write failing test** (mock `fetch`)

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { postAdaptiveCard } from "./teams";
afterEach(() => vi.restoreAllMocks());
describe("postAdaptiveCard", () => {
  it("POSTs utf-8 JSON and treats 202 as ok", async () => {
    process.env.TEAMS_FLOW_URL = "https://flow.example/x";
    const f = vi.spyOn(global, "fetch").mockResolvedValue(new Response(null,{status:202}));
    const r = await postAdaptiveCard({ type:"AdaptiveCard" });
    expect(r).toEqual({ ok:true, status:202 });
    expect(f.mock.calls[0][1]?.headers).toMatchObject({ "Content-Type":"application/json; charset=utf-8" });
  });
  it("returns {ok:false,status:0} when unset", async () => {
    delete process.env.TEAMS_FLOW_URL;
    expect(await postAdaptiveCard({})).toEqual({ ok:false, status:0 });
  });
});
```

- [ ] **Step 2: Run to verify failure** — Run: `npm test -- teams` → FAIL.

- [ ] **Step 3: Implement `postAdaptiveCard`**

```ts
// lib/teams.ts
export async function postAdaptiveCard(card: object): Promise<{ ok: boolean; status: number }> {
  const url = process.env.TEAMS_FLOW_URL;
  if (!url) return { ok: false, status: 0 };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(card),
  });
  return { ok: res.status === 202 || res.ok, status: res.status };
}
```

- [ ] **Step 4: Run to verify pass** — Run: `npm test -- teams` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/teams.ts lib/teams.test.ts
git commit -m "feat(report): Teams Adaptive Card poster (Power Automate HTTP trigger)"
```

---

### Task 10: Cron route

**Files:**
- Create: `app/api/cron/revenue-report/route.ts`

**Interfaces:**
- Consumes: `getRevenueReportInputs`, `buildReportCard`, `postAdaptiveCard`, `SOURCE_NOTE`, date helpers.
- Produces: `GET` handler — `CRON_SECRET`-guarded exactly like `app/api/cron/elise-sync/route.ts` (Bearer check when the env var is set); builds `asOf = shiftYmd(easternToday(),-1)`, assembles the report, posts the card, returns `{ ok, status, asOf, properties }`. `runtime="nodejs"`, `dynamic="force-dynamic"`, `maxDuration=300`.

- [ ] **Step 1: Implement the route**

```ts
import { NextResponse } from "next/server";
import { easternToday, shiftYmd } from "@/lib/dates";
import { getRevenueReportInputs } from "@/lib/cloudbeds";
import { buildReportCard } from "@/lib/report-card";
import { postAdaptiveCard } from "@/lib/teams";
import { SOURCE_NOTE } from "@/lib/revenue-report";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const asOf = shiftYmd(easternToday(), -1);
  const base = process.env.PUBLIC_BASE_URL || "https://dashboard.rentstayable.com";
  const { actual, onTheBooks } = await getRevenueReportInputs(asOf);
  const report = { asOf, generatedEastern: `${easternToday()} ET`, actual, onTheBooks, sourceNote: SOURCE_NOTE };
  const card = buildReportCard(report, base);
  const posted = await postAdaptiveCard(card);
  return NextResponse.json({ ok: posted.ok, status: posted.status, asOf, properties: actual.length });
}
```

- [ ] **Step 2: Verify build + auth** — Run: `npm run build`; then `npm run dev` and `curl -s localhost:3000/api/cron/revenue-report` with a wrong bearer → 401 (when `CRON_SECRET` set locally).

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/revenue-report/route.ts
git commit -m "feat(report): daily cron route builds report + posts Teams card"
```

---

### Task 11: Cron schedule + env docs

**Files:**
- Modify: `vercel.json`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: a second cron entry; documented `TEAMS_FLOW_URL` (+ optional `PUBLIC_BASE_URL`).

- [ ] **Step 1: Add the cron entry** to `vercel.json` (keep the existing `elise-sync`):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/cron/elise-sync", "schedule": "0 12 * * *" },
    { "path": "/api/cron/revenue-report", "schedule": "0 10 * * *" }
  ]
}
```

- [ ] **Step 2: Document env** — append to `.env.example`:

```
# Teams delivery for the daily revenue report (Power Automate HTTP-trigger flow).
# Secret (contains a sig= token). Server-only. Body must be an Adaptive Card.
TEAMS_FLOW_URL=
# Optional: absolute base URL used for the card's buttons (defaults to the prod domain).
PUBLIC_BASE_URL=
```

- [ ] **Step 3: Commit**

```bash
git add vercel.json .env.example
git commit -m "chore(report): daily cron schedule (10:00 UTC) + env docs"
```

---

### Task 12: Deploy + end-to-end verification

**Files:** none (ops).

- [ ] **Step 1:** Set `TEAMS_FLOW_URL` (the real Power Automate URL) in Vercel → Project → Settings → Environment Variables (Production), Sensitive.
- [ ] **Step 2:** Push the branch; confirm the Vercel build is green.
- [ ] **Step 3:** Open `https://dashboard.rentstayable.com/report` (enter the MAIN pin) → verify all 8 properties render, both tables, availability highlighting; download the Excel and PDF.
- [ ] **Step 4:** Vercel → Project → Settings → Cron Jobs → **Run** `revenue-report` → expect `{ ok:true, status:202, properties:8 }` and a card in the Teams **Test Channel**.
- [ ] **Step 5:** Compare the card + `/report` numbers against Monica's latest report for 2–3 properties; note residual gaps (expect YTD lease divergence from the Yardi caveat). Record the comparison in the findings note from Task 1.
- [ ] **Step 6:** Update `TODO.md` Pickup marker + add/refresh memory `teams-report-delivery` with the shipped state.

---

## Notes for the implementer
- **Task 1 gates Task 3.** Do not write the nights/revenue queries until the probe findings are recorded; the split-vs-fallback branch is real.
- The **prototype Excel generator** written during design (data transcribed from Monica's PDF, in session scratchpad) is a layout reference for Task 4 only — Task 4's data comes exclusively from `getRevenueReportInputs`.
- The Teams card body **must** be a full Adaptive Card (v1.4) — confirmed 2026-07-22; simple `{text}` fails the flow.
- Card "Download" buttons link to gated routes; a viewer opening them from Teams will hit the MAIN-pin login first (intended).

---

## PLAN REVISION — 2026-07-22 (daily-snapshot architecture; Kyle's decision)

**Why:** Task 3's live validation proved MTD/YTD occupancy COUNTS + OOO totals
cannot be reconstructed from Cloudbeds for past days — DI dataset-3
`reservation_status`/rate-plan reflect *current* state, `getRoomBlocks` range OOO
doesn't reconcile, and no historical capacity is exposed. Revenue IS historically
exact (dataset-1 `service_date`). Kyle's decision: **bank daily snapshots** (like
Monica's own spreadsheet). Supersedes spec §9 "snapshots deferred".

**New Task 3b — snapshot persistence (`lib/db.ts` + Neon table).** Add table
`report_daily_snapshot(property_code text, stay_date date, transient_nights int,
lease_nights int, other_blocks int, ooo int, transient_rev numeric, lease_rev
numeric, inventory int, updated_at timestamptz, PRIMARY KEY(property_code,
stay_date))` (created in the existing db-init path). PII-free aggregates only
(CLAUDE.md §5.6). Functions: `upsertReportSnapshot(code, stayDate, inputs)` and
`getReportSnapshots(code|null, start, end)` returning rows to sum. Unit-test the
sum/aggregation helper `sumSnapshotRows(rows) → RowInputs`.

**Task 3 change:** `getRevenueReportInputs(asOf)` now sources:
- **Yesterday** block: the live single-day fetch (already built — exact).
- **MTD / YTD / LY** blocks: `sumSnapshotRows(getReportSnapshots(code, rangeStart,
  rangeEnd))` — NOT the live per-day loop. LY blocks are `null` until a year of
  snapshots exists. Keep the single-day `buildRowInputs` helper (reused by the
  cron writer). Add `trackingSince` (earliest snapshot date) to the report so the
  UI/renderers can label MTD/YTD "partial since <date>".
- **On-the-books**: unchanged (live forward 7 days).

**Task 10 (cron) change:** each run, FIRST fetch the exact single-day figures for
`asOf` for every property and `upsertReportSnapshot`, THEN build the report
(Yesterday live, MTD/YTD from snapshots incl. the day just written) and post the
card. Idempotent (upsert on PK).

**Model change (Task 2 already merged):** add optional `trackingSince?: string`
to `RevenueReport`; fold a "MTD/YTD accumulate from <trackingSince>" line into
`sourceNote` at build time. Renderers (Tasks 4–7) render the note; no other
renderer change.

**Optional follow-up (not now):** one-time historical REVENUE-only backfill of the
snapshot table (dataset-1 `service_date` is exact); counts cannot be backfilled.
