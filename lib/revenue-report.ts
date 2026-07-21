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
  "Differs from Monica's Yardi-blended lease figures for Jan-Aug. Room Revenue excludes taxes and adjustments.";
