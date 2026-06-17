import { NextResponse } from "next/server";
import { PILOT_PROPERTY } from "@/config/properties";
import { readKey } from "@/lib/cloudbeds";

// Probe the Data Insights API for the pilot property (Davenport). Discovery step
// for the daily/weekly/monthly occupancy toggle. Confirmed: access OK, Occupancy
// dataset = id 7 (id 4 is the unsupported legacy one). Gated by PIN middleware.
//
//   GET /api/insights-probe            -> lists datasets
//   GET /api/insights-probe?dataset=7  -> dataset 7 detail (columns / CDFs)
//
// Base: https://api.cloudbeds.com/datainsights/v1.1
// Headers: Authorization: Bearer <key>, X-PROPERTY-ID: <apiPropertyId>
export const dynamic = "force-dynamic";

const DI_BASE = "https://api.cloudbeds.com/datainsights/v1.1";

export async function GET(req: Request) {
  const property = PILOT_PROPERTY; // Davenport, API propertyID 318197
  const key = readKey(property.code);
  if (!key) {
    return NextResponse.json({ error: `No key for ${property.code}` }, { status: 400 });
  }
  if (!property.apiPropertyId) {
    return NextResponse.json({ error: "No apiPropertyId for pilot" }, { status: 400 });
  }

  const dataset = new URL(req.url).searchParams.get("dataset");
  const endpoint = dataset ? `${DI_BASE}/datasets/${dataset}` : `${DI_BASE}/datasets`;
  let result: Record<string, unknown>;
  try {
    const res = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${key}`,
        "X-PROPERTY-ID": property.apiPropertyId,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep raw text */
    }
    result = { status: res.status, ok: res.ok, body };
  } catch (e) {
    result = { error: `Network error: ${String(e)}` };
  }

  return NextResponse.json(
    {
      endpoint,
      property: property.name,
      apiPropertyId: property.apiPropertyId,
      ...result,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
