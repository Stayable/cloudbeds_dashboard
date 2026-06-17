import { NextResponse } from "next/server";
import { PROPERTIES } from "@/config/properties";
import { getHotels, readKey } from "@/lib/cloudbeds";

// Temporary mapping aid: for each configured property key, returns the real
// Cloudbeds API propertyID via getHotels. No guest data — property metadata
// only. Remove (or gate behind the PIN) once all apiPropertyId values are
// recorded in config/properties.ts.
export const dynamic = "force-dynamic";

export async function GET() {
  const properties = await Promise.all(
    PROPERTIES.map(async (p) => {
      const key = readKey(p.code);
      if (!key) {
        return { code: p.code, name: p.name, businessId: p.id, configured: false };
      }
      const res = await getHotels(key);
      if (!res.ok) {
        return {
          code: p.code,
          name: p.name,
          businessId: p.id,
          configured: true,
          error: res.error,
          status: res.status,
        };
      }
      const hotels = (res.data ?? []).map((h) => ({
        propertyID: h.propertyID,
        organizationID: h.organizationID,
        propertyName: h.propertyName,
      }));
      return { code: p.code, name: p.name, businessId: p.id, configured: true, hotels };
    }),
  );

  return NextResponse.json(
    { generatedAt: new Date().toISOString(), properties },
    { headers: { "Cache-Control": "no-store" } },
  );
}
