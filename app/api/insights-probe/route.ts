import { NextResponse } from "next/server";
import { PILOT_PROPERTY } from "@/config/properties";
import { readKey } from "@/lib/cloudbeds";

// Data Insights probe for the pilot property (Davenport). Discovery for the
// date-ranged occupancy/ADR/RevPAR/revenue features. PIN-gated.
//
//   GET /api/insights-probe            -> list datasets (Occupancy = id 7)
//   GET /api/insights-probe?dataset=7  -> dataset 7 detail (columns / CDFs)
//   GET /api/insights-probe?query=1    -> POST a candidate occupancy query and
//                                         return the request body + raw response
//                                         (iterate body until it returns rows)
//
// Base: https://api.cloudbeds.com/datainsights/v1.1
// Headers: Authorization: Bearer <key>, X-PROPERTY-ID: <apiPropertyId>
export const dynamic = "force-dynamic";

const DI_BASE = "https://api.cloudbeds.com/datainsights/v1.1";

async function call(
  method: "GET" | "POST",
  endpoint: string,
  key: string,
  propertyId: string,
  body?: unknown,
) {
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "X-PROPERTY-ID": propertyId,
        "Accept-Language": "en-US",
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch (e) {
    return { error: `Network error: ${String(e)}` };
  }
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  return { status: res.status, ok: res.ok, body: parsed };
}

export async function GET(req: Request) {
  const property = PILOT_PROPERTY; // Davenport, API propertyID 318197
  const key = readKey(property.code);
  if (!key) return NextResponse.json({ error: `No key for ${property.code}` }, { status: 400 });
  const pid = property.apiPropertyId;
  if (!pid) return NextResponse.json({ error: "No apiPropertyId for pilot" }, { status: 400 });

  const params = new URL(req.url).searchParams;
  const dataset = params.get("dataset");
  const query = params.get("query");

  // --- Candidate occupancy query (POST) ---
  if (query) {
    // `mode` is a URL query-string param (webargs error path was query.mode),
    // not a body field.
    const endpoint = `${DI_BASE}/reports/query/data?mode=Run`;
    // Iter: drop `metric` (measures aggregate via group_rows); filters use an
    // `{and:[...]}` combinator; settings requires `details`.
    const requestBody = {
      property_ids: [Number(pid)],
      dataset_id: 7,
      // Occupancy/adr/revpar auto-aggregate. Count/currency fields need an
      // explicit aggregation — trying cdf.modifier:"sum" (same key group_rows
      // uses for dates) to recover rooms_sold/capacity/room_revenue.
      columns: [
        { cdf: { column: "rooms_sold" }, aggregation: "sum" },
        { cdf: { column: "capacity_count" }, aggregation: "sum" },
        { cdf: { column: "occupancy" } },
        { cdf: { column: "adr" } },
        { cdf: { column: "revpar" } },
        { cdf: { column: "room_revenue" }, aggregation: "sum" },
      ],
      group_rows: [{ cdf: { column: "stay_date" }, modifier: "day" }],
      filters: {
        and: [
          { cdf: { column: "stay_date" }, operator: "greater_than_or_equal", value: "2026-06-10" },
          { cdf: { column: "stay_date" }, operator: "less_than_or_equal", value: "2026-06-16" },
        ],
      },
      settings: { totals: false, details: false },
    };
    const result = await call("POST", endpoint, key, pid, requestBody);
    return NextResponse.json(
      { endpoint, property: property.name, requestBody, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // --- Dataset detail or list (GET) ---
  const endpoint = dataset ? `${DI_BASE}/datasets/${dataset}` : `${DI_BASE}/datasets`;
  const result = await call("GET", endpoint, key, pid);
  return NextResponse.json(
    { endpoint, property: property.name, apiPropertyId: pid, ...result },
    { headers: { "Cache-Control": "no-store" } },
  );
}
