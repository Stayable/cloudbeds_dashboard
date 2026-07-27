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

/** One generic daily aggregate: (property, day, metric, dimension) → count and
 *  an optional summed measure. Deliberately generic so new Elise dimensions can
 *  be surfaced without another table + migration each time. */
export type MetricRow = {
  code: string;
  day: string;
  metric: string;
  dimension: string;
  n: number;
  total: number;
};

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

// --- Enrichment aggregates --------------------------------------------------
//
// Scope was set by a live probe of all 30 shared views on 2026-07-27
// (scripts/snowflake-rowcounts.mjs + scripts/probe-elise-dimensions.mjs). Only
// 15 views hold any rows; RENEWALS, DEMAND_NOTICES, WORK_ORDERS, TURNS,
// INSPECTIONS, PAYMENT_PLANS, RESIDENT_SURVEYS et al are EMPTY for this org, so
// the Renewals / Evictions / Maintenance sections cannot be built from Elise.
// RESIDENTS holds only Future/Cancelled/Applicant (no current residents), so it
// yields no meaningful movement metrics either. What follows is what the share
// actually supports. Re-run the probes if Elise enables more views.
//
// Every query is a GROUP BY over counts/durations. No name, email, phone,
// transcript or recording column is selected — PII stays in Snowflake.

/** Marketing source arrives as a JSON-ish array literal (`["Zillow Group"]`)
 *  or the placeholder `-`. Flatten to a bare label for display. */
const CLEAN_SOURCE = `NULLIF(TRIM(REPLACE(REPLACE(REPLACE(MARKETING_SOURCE, '[', ''), ']', ''), '"', '')), '-')`;
const CLEAN_HANDOFF = `TRIM(REPLACE(REPLACE(REPLACE(HANDOFF_REASONS::string, '[', ''), ']', ''), '"', ''))`;

/** Daily PII-free enrichment aggregates across the populated Elise views.
 *  Returns one flat MetricRow list; unmapped buildings are dropped (counted in
 *  `skipped`). Runs on a single connection. */
export async function fetchEliseEnrichment(): Promise<{ rows: MetricRow[]; skipped: number }> {
  const conn = makeConnection();
  const q = <T = Record<string, unknown>>(sqlText: string) =>
    new Promise<T[]>((resolve, reject) =>
      conn.execute({ sqlText, complete: (err, _s, rows) => (err ? reject(err) : resolve((rows ?? []) as T[])) }),
    );
  await new Promise<void>((resolve, reject) => conn.connect((e) => (e ? reject(e) : resolve())));

  // Each entry yields rows shaped (BUILDING_ID, DAY, DIM, N, TOTAL) for `metric`.
  const QUERIES: { metric: string; sql: string }[] = [
    {
      // Lead source per day. Tracks where demand originates.
      metric: "lead_source",
      sql: `SELECT BUILDING_ID, EVENT_DATETIME::DATE AS DAY,
                   COALESCE(${CLEAN_SOURCE}, 'Unknown') AS DIM, COUNT(*) AS N, 0 AS TOTAL
            FROM RISE8_DATA.DA.PROSPECT_EVENTS_RISE8
            WHERE BUILDING_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL
              AND EVENT_TYPE = 'prospect'
            GROUP BY 1, 2, 3`,
    },
    {
      // Contact channel mix (Voice / Email / SMS / Webchat).
      metric: "channel",
      sql: `SELECT BUILDING_ID, EVENT_DATETIME::DATE AS DAY,
                   COALESCE(CHANNEL, 'Unknown') AS DIM, COUNT(*) AS N, 0 AS TOTAL
            FROM RISE8_DATA.DA.PROSPECT_EVENTS_RISE8
            WHERE BUILDING_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL
            GROUP BY 1, 2, 3`,
    },
    {
      // AI-booked share. IS_AI_BOOKED is only populated on tour events, so the
      // denominator must be these rows alone — never all prospect events.
      metric: "ai_booked",
      sql: `SELECT BUILDING_ID, EVENT_DATETIME::DATE AS DAY,
                   IFF(IS_AI_BOOKED, 'ai', 'human') AS DIM, COUNT(*) AS N, 0 AS TOTAL
            FROM RISE8_DATA.DA.PROSPECT_EVENTS_RISE8
            WHERE BUILDING_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL
              AND IS_AI_BOOKED IS NOT NULL
            GROUP BY 1, 2, 3`,
    },
    {
      metric: "after_hours",
      sql: `SELECT BUILDING_ID, EVENT_DATETIME::DATE AS DAY,
                   IFF(IS_AFTER_HOURS, 'after_hours', 'business_hours') AS DIM, COUNT(*) AS N, 0 AS TOTAL
            FROM RISE8_DATA.DA.PROSPECT_EVENTS_RISE8
            WHERE BUILDING_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL
              AND IS_AFTER_HOURS IS NOT NULL
            GROUP BY 1, 2, 3`,
    },
    {
      metric: "tour_type",
      sql: `SELECT BUILDING_ID, EVENT_DATETIME::DATE AS DAY,
                   TOUR_TYPE_STANDARDIZED AS DIM, COUNT(*) AS N, 0 AS TOTAL
            FROM RISE8_DATA.DA.PROSPECT_EVENTS_RISE8
            WHERE BUILDING_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL
              AND TOUR_TYPE_STANDARDIZED IS NOT NULL
            GROUP BY 1, 2, 3`,
    },
    {
      // Why prospects cancel — the "cancellation reasons" ask. MUST be scoped to
      // prospect_canceled events: the reason is stamped on every later event row
      // for the same prospect, so an unscoped count runs ~3x the funnel's
      // Cancelled figure and the two sections visibly disagree.
      metric: "cancel_reason",
      sql: `SELECT BUILDING_ID, EVENT_DATETIME::DATE AS DAY,
                   CANCELLATION_REASON AS DIM, COUNT(*) AS N, 0 AS TOTAL
            FROM RISE8_DATA.DA.PROSPECT_EVENTS_RISE8
            WHERE BUILDING_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL
              AND CANCELLATION_REASON IS NOT NULL
              AND EVENT_TYPE = 'prospect_canceled'
            GROUP BY 1, 2, 3`,
    },
    {
      // Voice-AI: who answered, and total talk time (seconds) for an avg.
      metric: "voice_answered",
      sql: `SELECT ELISE_PROPERTY_ID AS BUILDING_ID, EVENT_DATETIME::DATE AS DAY,
                   COALESCE(ANSWERED_TYPE, 'unanswered') AS DIM, COUNT(*) AS N,
                   COALESCE(SUM(CALL_DURATION_SEC), 0) AS TOTAL
            FROM RISE8_DATA.DA.VOICE_CALLS_RISE8
            WHERE ELISE_PROPERTY_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL
            GROUP BY 1, 2, 3`,
    },
    {
      metric: "voice_after_hours",
      sql: `SELECT ELISE_PROPERTY_ID AS BUILDING_ID, EVENT_DATETIME::DATE AS DAY,
                   IFF(AFTER_HOURS, 'after_hours', 'business_hours') AS DIM, COUNT(*) AS N, 0 AS TOTAL
            FROM RISE8_DATA.DA.VOICE_CALLS_RISE8
            WHERE ELISE_PROPERTY_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL
              AND AFTER_HOURS IS NOT NULL
            GROUP BY 1, 2, 3`,
    },
    {
      // Escalation: which calls the AI handed to a human, and why.
      metric: "voice_transfer",
      sql: `SELECT ELISE_PROPERTY_ID AS BUILDING_ID, EVENT_DATETIME::DATE AS DAY,
                   TRANSFER_REASON AS DIM, COUNT(*) AS N, 0 AS TOTAL
            FROM RISE8_DATA.DA.VOICE_CALLS_RISE8
            WHERE ELISE_PROPERTY_ID IS NOT NULL AND EVENT_DATETIME IS NOT NULL
              AND TRANSFER_REASON IS NOT NULL
            GROUP BY 1, 2, 3`,
    },
    {
      metric: "handoff_reason",
      sql: `SELECT ELISE_PROPERTY_ID AS BUILDING_ID, CREATED_AT::DATE AS DAY,
                   COALESCE(NULLIF(${CLEAN_HANDOFF}, ''), 'unspecified') AS DIM, COUNT(*) AS N, 0 AS TOTAL
            FROM RISE8_DATA.DA.HANDOFFS_RISE8
            WHERE ELISE_PROPERTY_ID IS NOT NULL AND CREATED_AT IS NOT NULL
            GROUP BY 1, 2, 3`,
    },
    {
      metric: "task_type",
      sql: `SELECT ELISE_PROPERTY_ID AS BUILDING_ID, TRIGGER_TIME::DATE AS DAY,
                   TASK_TYPE AS DIM, COUNT(*) AS N,
                   COUNT_IF(RESOLVED) AS TOTAL
            FROM RISE8_DATA.DA.TASKS_RISE8
            WHERE ELISE_PROPERTY_ID IS NOT NULL AND TRIGGER_TIME IS NOT NULL
              AND TASK_TYPE IS NOT NULL
            GROUP BY 1, 2, 3`,
    },
  ];

  try {
    // Two Elise buildings can map to the same Stayable code (the unlaunched
    // LL/DP dupes), and the Neon key is (code, day, metric, dimension) — so
    // merge here rather than letting the second row silently overwrite the first.
    const merged = new Map<string, MetricRow>();
    let skipped = 0;
    for (const { metric, sql } of QUERIES) {
      const raw = await q(sql);
      for (const r of raw) {
        const code = BUILDING_TO_CODE[String(r.BUILDING_ID)];
        if (!code) {
          skipped++;
          continue;
        }
        const day = ymd(r.DAY);
        const dimension = String(r.DIM ?? "Unknown").slice(0, 120);
        const key = `${code}|${day}|${metric}|${dimension}`;
        const prev = merged.get(key);
        if (prev) {
          prev.n += Number(r.N ?? 0);
          prev.total += Number(r.TOTAL ?? 0);
        } else {
          merged.set(key, { code, day, metric, dimension, n: Number(r.N ?? 0), total: Number(r.TOTAL ?? 0) });
        }
      }
    }
    return { rows: [...merged.values()], skipped };
  } finally {
    conn.destroy(() => {});
  }
}
