// Server-side Smartsheet API client. NEVER import this from a client component.
// The API token lives in a server-only env var and must never reach the browser
// (CLAUDE.md §5 rule 1). This module is READ-ONLY — it never writes to Smartsheet.
//
// Auth: Smartsheet REST API v2.0.
//   Base URL : https://api.smartsheet.com/2.0
//   Header   : Authorization: Bearer <SMARTSHEET_API_TOKEN>
//   Token    : a raw API access token generated in Smartsheet → Personal
//              Settings → API Access. (The claude.ai MCP connector used during
//              development is interactive OAuth and is NOT usable from the
//              deployed server — this token is the server-to-server analog.)
//
// We only ever read the pre-aggregated "Evictions Metrics" sheet, which holds
// counts only (no tenant names / case detail), so no guest PII is exposed
// (CLAUDE.md §5 rule 2). The case-level sheets (Closed / Master Database) DO
// contain PII and are intentionally NOT read here.

import {
  buildEvictionsViews,
  computeDaysToFile,
  type ClosedCaseDates,
  type EvictionsView,
} from "@/lib/evictions";
import { isOneStar, type ReviewRow } from "@/lib/reviews";
import { easternDateOf } from "@/lib/dates";

const BASE_URL = "https://api.smartsheet.com/2.0";

// Cache server-side to stay fast and within rate limits (CLAUDE.md §5 rule 4).
const REVALIDATE_SECONDS = 600; // 10 min

export type SmartsheetResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; body?: unknown };

/** Read the Smartsheet API token from env (server-only). */
export function readSmartsheetToken(): string | null {
  const t = process.env.SMARTSHEET_API_TOKEN;
  return t && t.trim().length > 0 ? t.trim() : null;
}

// Raw shape of GET /sheets/{id} (subset we rely on). Each cell carries the
// columnId (not index); we resolve titles via the columns array.
export type RawColumn = { id: number; index: number; title: string };
export type RawCell = { columnId: number; value?: unknown; displayValue?: string };
export type RawRow = { id: number; cells: RawCell[] };
export type RawSheet = { id: number; name: string; columns: RawColumn[]; rows: RawRow[] };

async function ssGet<T = unknown>(token: string, path: string): Promise<SmartsheetResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      next: { revalidate: REVALIDATE_SECONDS },
    });
  } catch (e) {
    return { ok: false, status: 0, error: `Network error reaching Smartsheet: ${String(e)}` };
  }

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* leave as raw text */
  }

  if (!res.ok) {
    // Smartsheet error bodies look like { errorCode, message, refId }.
    const msg =
      parsed && typeof parsed === "object" && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : `Smartsheet returned HTTP ${res.status}`;
    return { ok: false, status: res.status, error: msg, body: parsed };
  }

  return { ok: true, data: parsed as T };
}

/** Fetch one sheet (columns + rows) by numeric ID. */
export function getSheet(token: string, sheetId: number | string): Promise<SmartsheetResult<RawSheet>> {
  return ssGet<RawSheet>(token, `/sheets/${sheetId}`);
}

// --- Evictions (pre-aggregated "Evictions Metrics" sheet) -------------------

// The pre-aggregated metrics sheet. Overridable via env, defaults to the
// confirmed Dashboard-basis sheet. (Upstream Closed + Master Database sheets
// feed THIS one inside Smartsheet — we read the rollup, not the case sheets.)
export const EVICTIONS_SHEET_ID =
  process.env.SMARTSHEET_EVICTIONS_SHEET_ID?.trim() || "4398121124581252";

// The Closed case sheet — source for the app-computed days-to-file (notice →
// complaint) metric. We fetch ONLY the property + two date columns (no PII).
export const EVICTIONS_CLOSED_SHEET_ID =
  process.env.SMARTSHEET_CLOSED_SHEET_ID?.trim() || "1160578736646020";

// Column IDs on the Closed sheet (verified 2026-06-26). Restricting the GET to
// these keeps tenant names/contact columns out of the server response entirely.
const CLOSED_COL = {
  property: 4912247484508036,
  noticePosted: 7737623000704900,
  complaintFiledPrimary: 4359923280177028, // "Complaint Filed (1D afterNotice Exp)"
  complaintFiledAlt: 4967669099614084, // legacy "Complaint Filed"
} as const;

/** Days-to-file (notice → complaint) per property, computed from the Closed
 *  sheet. Reads only Property + the two date columns. Returns an empty map on
 *  any error so the rest of the evictions view still renders. */
async function getDaysToFile(token: string): Promise<Map<string, number | null>> {
  const columnIds = [
    CLOSED_COL.property,
    CLOSED_COL.noticePosted,
    CLOSED_COL.complaintFiledPrimary,
    CLOSED_COL.complaintFiledAlt,
  ].join(",");
  const res = await ssGet<RawSheet>(
    token,
    `/sheets/${EVICTIONS_CLOSED_SHEET_ID}?columnIds=${columnIds}`,
  );
  if (!res.ok) return new Map();

  const rows = rowsByTitle(res.data);
  const cases: ClosedCaseDates[] = rows.map((r) => ({
    property: r["Property"] ?? "",
    noticePosted: r["Notice Posted"] ?? "",
    complaintFiled:
      r["Complaint Filed (1D afterNotice Exp)"] || r["Complaint Filed"] || "",
  }));
  return computeDaysToFile(cases);
}

export type EvictionsPayload = {
  configured: boolean; // a Smartsheet token is set
  error: string | null; // fetch/parse error, if any
  sheetName: string | null;
  views: EvictionsView[];
};

/** Evictions selector views (All + per property). Degrades gracefully when no
 *  token is set or the fetch fails — the section renders an explanatory state
 *  rather than crashing the page. */
export async function getEvictions(): Promise<EvictionsPayload> {
  const token = readSmartsheetToken();
  if (!token) return { configured: false, error: null, sheetName: null, views: [] };

  const [res, daysToFile] = await Promise.all([
    getSheet(token, EVICTIONS_SHEET_ID),
    getDaysToFile(token),
  ]);
  if (!res.ok) return { configured: true, error: res.error, sheetName: null, views: [] };

  const sheet = res.data;
  const columnTitles = sheet.columns.map((c) => c.title);
  const views = buildEvictionsViews(rowsByTitle(sheet), columnTitles, daysToFile);
  return { configured: true, error: null, sheetName: sheet.name, views };
}

// --- 1-Star Reviews ("Review & Feedback Tracking" sheet) --------------------
// Operations Dashboard §5. We read ONLY: Review/Feedback, Source, Property,
// Rating, Manager Response, and the system Created date — column-restricted so
// the Reviewer Name column (PII) never reaches the server. Rating is stored as
// text "1.0"; we keep only the 1-star rows. Date windowing/grouping is done by
// the pure builder in lib/reviews.ts.

export const REVIEWS_SHEET_ID =
  process.env.SMARTSHEET_REVIEWS_SHEET_ID?.trim() || "4932316188436356";

// Column IDs verified 2026-06-30 via get_columns on the reviews sheet.
const REVIEWS_COL = {
  review: 911501009676164, // "Review/Feedback" (col 1)
  source: 7602923490305924, // "Source" (col 3)
  property: 2037400916518788, // "Property" (col 4)
  rating: 3163300823361412, // "Rating" (col 5)
  managerResponse: 6541000543889284, // "Manager Response" (col 9)
  created: 3188875541669764, // system "Created" date
} as const;

export type ReviewsPayload = {
  configured: boolean; // a Smartsheet token is set
  error: string | null; // fetch/parse error, if any
  reviews: ReviewRow[]; // ALL 1-star rows (date filtering happens in the view)
};

/** Fetch every 1-star review (rating == 1), column-restricted to the safe set,
 *  with Created normalized to its Eastern date. Degrades gracefully (empty list)
 *  when no token is set or the fetch fails. */
export async function getOneStarReviews(): Promise<ReviewsPayload> {
  const token = readSmartsheetToken();
  if (!token) return { configured: false, error: null, reviews: [] };

  const columnIds = Object.values(REVIEWS_COL).join(",");
  // GET sheet with no pagination params returns all rows (column-restricted).
  const res = await ssGet<RawSheet>(token, `/sheets/${REVIEWS_SHEET_ID}?columnIds=${columnIds}`);
  if (!res.ok) return { configured: true, error: res.error, reviews: [] };

  const reviews: ReviewRow[] = [];
  for (const r of res.data.rows ?? []) {
    const cellOf = (id: number) => r.cells.find((c) => c.columnId === id);
    const text = (id: number): string => {
      const cell = cellOf(id);
      if (!cell) return "";
      return String(cell.displayValue ?? (cell.value == null ? "" : cell.value)).trim();
    };

    const ratingCell = cellOf(REVIEWS_COL.rating);
    if (!isOneStar(ratingCell?.value ?? ratingCell?.displayValue)) continue;

    const createdRaw = String(cellOf(REVIEWS_COL.created)?.value ?? "");
    reviews.push({
      property: text(REVIEWS_COL.property) || "—",
      source: text(REVIEWS_COL.source),
      review: text(REVIEWS_COL.review),
      managerResponse: text(REVIEWS_COL.managerResponse),
      created: createdRaw ? easternDateOf(createdRaw) : "",
    });
  }
  return { configured: true, error: null, reviews };
}

/**
 * Flatten a raw sheet into label-keyed rows: each row becomes a
 * `{ [columnTitle]: displayValue }` map, so callers address cells by the
 * human-readable column titles rather than opaque column IDs.
 */
export function rowsByTitle(sheet: RawSheet): Record<string, string>[] {
  const titleById = new Map<number, string>();
  for (const c of sheet.columns) titleById.set(c.id, c.title);

  return sheet.rows.map((row) => {
    const out: Record<string, string> = {};
    for (const cell of row.cells) {
      const title = titleById.get(cell.columnId);
      if (!title) continue;
      const v = cell.displayValue ?? (cell.value == null ? "" : String(cell.value));
      out[title] = v;
    }
    return out;
  });
}
