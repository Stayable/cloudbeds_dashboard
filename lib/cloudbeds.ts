// Server-side Cloudbeds API client. NEVER import this from a client component.
// API keys live in server-only env vars and must never reach the browser
// (CLAUDE.md §5 rule 1). This module is read-only — it never writes to Cloudbeds.
//
// Auth (verified against Cloudbeds docs 2026-06-18):
//   Base URL : https://hotels.cloudbeds.com/api/v1.3
//   Header   : Authorization: Bearer cbat_...   (alt: x-api-key: cbat_...)
//   Scope    : one scoped key per property. Each key resolves its own property,
//              so we do NOT pass propertyID. Env var: CLOUDBEDS_API_KEY_<CODE>.

import { PROPERTIES, type Property } from "@/config/properties";

const BASE_URL = "https://hotels.cloudbeds.com/api/v1.3";

// Cache server-side to stay within rate limits and keep the page fast
// (CLAUDE.md §5 rule 4). 10-minute TTL.
const REVALIDATE_SECONDS = 600;

export type CloudbedsResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; body?: unknown };

/** Read a property's scoped key from env. Davenport keeps a legacy fallback. */
export function readKey(code: string): string | null {
  const direct = process.env[`CLOUDBEDS_API_KEY_${code}`];
  if (direct && direct.trim().length > 0) return direct.trim();
  // Migration cushion: Davenport may still use the original unsuffixed var.
  if (code === "DP") {
    const legacy = process.env.CLOUDBEDS_API_KEY;
    if (legacy && legacy.trim().length > 0) return legacy.trim();
  }
  return null;
}

async function cbGet<T = unknown>(
  apiKey: string,
  path: string,
  params: Record<string, string> = {},
): Promise<CloudbedsResult<T>> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      next: { revalidate: REVALIDATE_SECONDS },
    });
  } catch (e) {
    return { ok: false, status: 0, error: `Network error reaching Cloudbeds: ${String(e)}` };
  }

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* leave as raw text */
  }

  if (!res.ok) {
    return { ok: false, status: res.status, error: `Cloudbeds returned HTTP ${res.status}`, body: parsed };
  }

  // Cloudbeds wraps every response in a { success, data, message } envelope and
  // returns success:false WITH HTTP 200 for logical errors (e.g. property-ID
  // mismatch). Treat success:false as an error, and unwrap the inner `data`.
  if (parsed && typeof parsed === "object" && "success" in parsed) {
    const env = parsed as { success: boolean; data?: unknown; message?: string };
    if (!env.success) {
      return { ok: false, status: res.status, error: env.message ?? "Cloudbeds returned success:false", body: parsed };
    }
    return { ok: true, data: env.data as T };
  }

  return { ok: true, data: parsed as T };
}

/** Property record from getHotels (subset of fields we rely on). */
export type Hotel = {
  propertyID: string;
  organizationID: string;
  propertyName: string;
  propertyTimezone: string;
  propertyCurrency?: { currencyCode: string; currencySymbol: string; currencyPosition: string };
};

/**
 * getDashboard response (verified against the live Davenport response
 * 2026-06-18). Note: `arrivals`/`departures` come back as STRINGS. ADR/RevPAR/
 * revenue are NOT in this endpoint — those need the Data Insights endpoints.
 */
export type DashboardData = {
  property_now: string;
  timezone: string;
  gmt_offset_hours: number;
  roomsOccupied: number;
  percentageOccupied: number;
  arrivals: string;
  departures: string;
  inHouse: number;
  guestsInHouse: number;
  arrivalsConfirmed: number;
  departuresConfirmed: number;
  bookings: number;
  stayovers: number;
  cancellations: number;
  roomsBlocked: number;
  roomBlocks: { blocked_dates: number; out_of_service: number };
  percentageBlocked: number;
  capacity: number;
};

/** Properties this key can access (use to verify a property's real API ID). */
export function getHotels(apiKey: string) {
  return cbGet<Hotel[]>(apiKey, `/getHotels`);
}

/** Current operating snapshot. Key resolves its own property — no propertyID. */
export function getDashboard(apiKey: string) {
  return cbGet<DashboardData>(apiKey, `/getDashboard`);
}

export type PropertyDashboard = {
  property: Property;
  configured: boolean; // a key is set for this property
  result: CloudbedsResult<DashboardData> | null;
};

/** Fetch every configured property's dashboard in parallel. */
export async function getPortfolio(): Promise<PropertyDashboard[]> {
  return Promise.all(
    PROPERTIES.map(async (property): Promise<PropertyDashboard> => {
      const key = readKey(property.code);
      if (!key) return { property, configured: false, result: null };
      return { property, configured: true, result: await getDashboard(key) };
    }),
  );
}

// --- Data Insights (date-ranged occupancy / ADR / RevPAR) -------------------
// Confirmed query shape (see memory data-insights-occupancy). occupancy/adr/
// revpar auto-aggregate; counts/currency are not requested (no aggregation key
// in public docs) — revenue is derived as RevPAR × capacity by the caller.

const DI_BASE = "https://api.cloudbeds.com/datainsights/v1.1";

export type OccupancyRow = {
  date: string; // YYYY-MM-DD
  occupancy: number; // %
  adr: number;
  revpar: number;
};

/** Daily occupancy/ADR/RevPAR for a property over [start, end] (YYYY-MM-DD). */
export async function getInsightsOccupancy(
  apiKey: string,
  apiPropertyId: string,
  start: string,
  end: string,
): Promise<CloudbedsResult<OccupancyRow[]>> {
  const body = {
    property_ids: [Number(apiPropertyId)],
    dataset_id: 7,
    columns: [
      { cdf: { column: "occupancy" } },
      { cdf: { column: "adr" } },
      { cdf: { column: "revpar" } },
    ],
    group_rows: [{ cdf: { column: "stay_date" }, modifier: "day" }],
    filters: {
      and: [
        { cdf: { column: "stay_date" }, operator: "greater_than_or_equal", value: start },
        { cdf: { column: "stay_date" }, operator: "less_than_or_equal", value: end },
      ],
    },
    settings: { totals: false, details: false },
  };

  let res: Response;
  try {
    res = await fetch(`${DI_BASE}/reports/query/data?mode=Run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-PROPERTY-ID": apiPropertyId,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      next: { revalidate: REVALIDATE_SECONDS },
    });
  } catch (e) {
    return { ok: false, status: 0, error: `Network error reaching Data Insights: ${String(e)}` };
  }

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  if (!res.ok) {
    return { ok: false, status: res.status, error: `Data Insights HTTP ${res.status}`, body: parsed };
  }

  const records = (parsed as { records?: Record<string, Record<string, { aggregated?: number }>> })?.records ?? {};
  const agg = (cell?: { aggregated?: number }) =>
    typeof cell?.aggregated === "number" ? cell.aggregated : 0;
  const rows: OccupancyRow[] = Object.keys(records)
    .sort()
    .map((date) => {
      const r = records[date] ?? {};
      return { date, occupancy: agg(r.occupancy), adr: agg(r.adr), revpar: agg(r.revpar) };
    });
  return { ok: true, data: rows };
}

export type PropertyInsights = {
  property: Property;
  configured: boolean;
  result: CloudbedsResult<OccupancyRow[]> | null;
};

/** Date-ranged occupancy for every configured property, in parallel. */
export async function getPortfolioInsights(start: string, end: string): Promise<PropertyInsights[]> {
  return Promise.all(
    PROPERTIES.map(async (property): Promise<PropertyInsights> => {
      const key = readKey(property.code);
      if (!key || !property.apiPropertyId) return { property, configured: false, result: null };
      return {
        property,
        configured: true,
        result: await getInsightsOccupancy(key, property.apiPropertyId, start, end),
      };
    }),
  );
}
