// Server-only EliseAI Snowflake data-share client. NEVER import from a client
// component — credentials live in server-only env vars (CLAUDE.md §5 rule 1).
//
// This module is READ-ONLY and AGGREGATE-ONLY: every query is a GROUP BY that
// selects counts/dates/ids only. No name/email/phone/transcript column is ever
// selected, so guest PII never leaves Snowflake (CLAUDE.md §5 rule 2, and the
// PII posture in memory `elise-data-share`).
//
// Used by the nightly sync (lib/elise-sync.ts → /api/cron/elise-sync). The
// public dashboard reads the resulting rollups from Neon, never Snowflake.
import snowflake from "snowflake-sdk";
import buildingMap from "@/config/elise-buildings.json";

const BUILDING_TO_CODE = buildingMap as Record<string, string>;

export type FunnelRow = { buildingId: number; code: string; day: string; eventType: string; n: number };
export type SnapshotRow = { buildingId: number; code: string; status: string; n: number };

function makeConnection() {
  const required = ["SNOWFLAKE_ACCOUNT", "SNOWFLAKE_USER", "SNOWFLAKE_PASSWORD", "SNOWFLAKE_WAREHOUSE"];
  for (const k of required) if (!process.env[k]) throw new Error(`${k} is not set`);
  snowflake.configure({ logLevel: "ERROR" });
  return snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT!,
    username: process.env.SNOWFLAKE_USER!,
    password: process.env.SNOWFLAKE_PASSWORD!,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE!,
    database: process.env.SNOWFLAKE_DATABASE ?? "RISE8_DATA",
    schema: process.env.SNOWFLAKE_SCHEMA ?? "DA",
    role: process.env.SNOWFLAKE_ROLE ?? "SYSADMIN",
  });
}

/** Snowflake DATE arrives as JS Date (UTC midnight) or string → YYYY-MM-DD. */
function ymd(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

/** Fetch both aggregate result sets on one connection. Skips buildings not in
 *  our map (returns the skip count for logging). */
export async function fetchEliseAggregates(): Promise<{
  funnel: FunnelRow[];
  snapshot: SnapshotRow[];
  skipped: number;
}> {
  const conn = makeConnection();
  const q = <T = Record<string, unknown>>(sqlText: string) =>
    new Promise<T[]>((resolve, reject) =>
      conn.execute({ sqlText, complete: (err, _s, rows) => (err ? reject(err) : resolve((rows ?? []) as T[])) }),
    );

  await new Promise<void>((resolve, reject) => conn.connect((e) => (e ? reject(e) : resolve())));
  try {
    const funnelRaw = await q(`
      SELECT BUILDING_ID, EVENT_DATETIME::DATE AS DAY, EVENT_TYPE, COUNT(*) AS N
      FROM RISE8_DATA.DA.PROSPECT_EVENTS_RISE8
      WHERE BUILDING_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL AND EVENT_TYPE IS NOT NULL
      GROUP BY BUILDING_ID, EVENT_DATETIME::DATE, EVENT_TYPE`);

    const snapRaw = await q(`
      SELECT ELISE_PROPERTY_ID AS BUILDING_ID, PROSPECT_STATUS, COUNT(*) AS N
      FROM RISE8_DATA.DA.PROSPECTS_RISE8
      WHERE ELISE_PROPERTY_ID IS NOT NULL AND PROSPECT_STATUS IS NOT NULL
      GROUP BY ELISE_PROPERTY_ID, PROSPECT_STATUS`);

    let skipped = 0;
    const funnel: FunnelRow[] = [];
    for (const r of funnelRaw) {
      const code = BUILDING_TO_CODE[String(r.BUILDING_ID)];
      if (!code) { skipped++; continue; }
      funnel.push({ buildingId: Number(r.BUILDING_ID), code, day: ymd(r.DAY), eventType: String(r.EVENT_TYPE), n: Number(r.N) });
    }
    const snapshot: SnapshotRow[] = [];
    for (const r of snapRaw) {
      const code = BUILDING_TO_CODE[String(r.BUILDING_ID)];
      if (!code) { skipped++; continue; }
      snapshot.push({ buildingId: Number(r.BUILDING_ID), code, status: String(r.PROSPECT_STATUS), n: Number(r.N) });
    }
    return { funnel, snapshot, skipped };
  } finally {
    conn.destroy(() => {});
  }
}
