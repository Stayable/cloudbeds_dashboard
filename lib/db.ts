// Server-only Neon Postgres client (CLAUDE.md §6 reversal — sanctioned for
// persisting /test submissions and exec feedback). Never import from a client
// component. One table `submissions` (see scripts/db-init.mjs).
import { neon } from "@neondatabase/serverless";
import type { RowInputs } from "./revenue-report";

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

export type SubmissionInput = {
  name: string;
  role: string;
  team: string;
  metrics: string[];
  notes?: string;
};

/** Insert a team requirements submission from /test (source='team-intake'). */
export async function insertSubmission(input: SubmissionInput): Promise<void> {
  const sql = db();
  const source = "team-intake";
  await sql`
    insert into submissions (source, name, role, team, metrics, notes)
    values (${source}, ${input.name}, ${input.role}, ${input.team},
            ${JSON.stringify(input.metrics)}::jsonb, ${input.notes ?? null})
  `;
}

/** Insert Rob's exec feedback (source='exec-feedback', name='Rob'). */
export async function insertFeedback(notes: string): Promise<void> {
  const sql = db();
  const source = "exec-feedback";
  const name = "Rob";
  await sql`
    insert into submissions (source, name, notes)
    values (${source}, ${name}, ${notes})
  `;
}

/** Insert a note from the /crystal dashboard (source='crystal-note', name='Crystal'). */
export async function insertCrystalNote(notes: string): Promise<void> {
  const sql = db();
  const source = "crystal-note";
  const name = "Crystal";
  await sql`
    insert into submissions (source, name, notes)
    values (${source}, ${name}, ${notes})
  `;
}

// --- App settings (small server-only key/value store) -----------------------
// Backs the Operations Dashboard's lockable 1-star reviews date window
// (key 'ops_reviews_window' = JSON {from,to}). See scripts/db-init.mjs.

/** Read a setting's raw string value, or null if unset / on any error. */
export async function getSetting(key: string): Promise<string | null> {
  try {
    const sql = db();
    const rows = (await sql`select value from app_settings where key = ${key}`) as { value: string }[];
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

/** Upsert a setting's value. */
export async function setSetting(key: string, value: string): Promise<void> {
  const sql = db();
  await sql`
    insert into app_settings (key, value, updated_at)
    values (${key}, ${value}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
}

// --- EliseAI leasing funnel (PII-free rollups from the Snowflake data share) --
// Written by the nightly sync (lib/elise-sync.ts); read by /ops §2. See
// scripts/db-init.mjs for the elise_funnel_daily / elise_pipeline_snapshot DDL.

export type EliseFunnelRow = { code: string; day: string; eventType: string; n: number };
export type ElisePipelineRow = { code: string; status: string; n: number };

/** Funnel-daily rows whose Eastern event date falls in [from, to] (inclusive).
 *  `day` is returned as a YYYY-MM-DD string (cast in SQL to avoid tz drift). */
export async function getEliseFunnel(from: string, to: string): Promise<EliseFunnelRow[]> {
  try {
    const sql = db();
    const rows = (await sql`
      select code, to_char(day, 'YYYY-MM-DD') as day, event_type, n
      from elise_funnel_daily
      where day >= ${from} and day <= ${to}
    `) as { code: string; day: string; event_type: string; n: number }[];
    return rows.map((r) => ({ code: r.code, day: r.day, eventType: r.event_type, n: Number(r.n) }));
  } catch {
    return [];
  }
}

/** Current prospect-status snapshot (Inquiry/Applicant/Leased/Cancelled). */
export async function getElisePipeline(): Promise<ElisePipelineRow[]> {
  try {
    const sql = db();
    const rows = (await sql`
      select code, prospect_status, n from elise_pipeline_snapshot
    `) as { code: string; prospect_status: string; n: number }[];
    return rows.map((r) => ({ code: r.code, status: r.prospect_status, n: Number(r.n) }));
  } catch {
    return [];
  }
}

/** True when the funnel table has any rows (i.e. a sync has run). */
export async function eliseFunnelConfigured(): Promise<boolean> {
  try {
    const sql = db();
    const rows = (await sql`select 1 from elise_funnel_daily limit 1`) as unknown[];
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** Upsert funnel rows (nightly sync). Chunked positional insert. */
export async function upsertEliseFunnel(
  rows: { buildingId: number; code: string; day: string; eventType: string; n: number }[],
): Promise<void> {
  if (!rows.length) return;
  const sql = db();
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r, j) => {
      const b = j * 5;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`);
      params.push(r.buildingId, r.code, r.day, r.eventType, r.n);
    });
    await sql.query(
      `insert into elise_funnel_daily (building_id, code, day, event_type, n)
       values ${values.join(",")}
       on conflict (building_id, day, event_type)
       do update set n = excluded.n, code = excluded.code`,
      params,
    );
  }
}

/** Replace the whole pipeline snapshot (delete + insert) in one sync. */
export async function replaceElisePipeline(
  rows: { buildingId: number; code: string; status: string; n: number }[],
): Promise<void> {
  const sql = db();
  await sql.query("delete from elise_pipeline_snapshot");
  if (!rows.length) return;
  const values: string[] = [];
  const params: unknown[] = [];
  rows.forEach((r, j) => {
    const b = j * 4;
    values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4})`);
    params.push(r.buildingId, r.code, r.status, r.n);
  });
  await sql.query(
    `insert into elise_pipeline_snapshot (building_id, code, prospect_status, n)
     values ${values.join(",")}`,
    params,
  );
}

// --- Report daily snapshot (banked figures for MTD/YTD rollups) -------------
// PII-free per-day aggregates per property (CLAUDE.md §5.6). Written by a
// later cron task; read by the revenue report's MTD/YTD rollups via
// sumSnapshotRows (lib/revenue-report.ts). See scripts/db-init.mjs for DDL.

export type ReportSnapshotRow = RowInputs & { propertyCode: string; stayDate: string };

/** Upsert one day's snapshot for a property. Idempotent — safe to re-run. */
export async function upsertReportSnapshot(
  propertyCode: string,
  stayDate: string,
  inputs: RowInputs,
): Promise<void> {
  const sql = db();
  await sql`
    insert into report_daily_snapshot (
      property_code, stay_date, transient_nights, lease_nights, other_blocks,
      ooo, transient_rev, lease_rev, inventory
    )
    values (
      ${propertyCode}, ${stayDate}, ${inputs.transientNights}, ${inputs.leaseNights},
      ${inputs.otherBlocks}, ${inputs.ooo}, ${inputs.transientRev}, ${inputs.leaseRev},
      ${inputs.inventory}
    )
    on conflict (property_code, stay_date) do update set
      transient_nights = excluded.transient_nights,
      lease_nights = excluded.lease_nights,
      other_blocks = excluded.other_blocks,
      ooo = excluded.ooo,
      transient_rev = excluded.transient_rev,
      lease_rev = excluded.lease_rev,
      inventory = excluded.inventory,
      updated_at = now()
  `;
}

/** Snapshot rows in [start, end] (inclusive), optionally filtered to one
 *  property. Ordered by property_code, stay_date. */
export async function getReportSnapshots(
  propertyCode: string | null,
  start: string,
  end: string,
): Promise<ReportSnapshotRow[]> {
  const sql = db();
  const rows = (await sql`
    select
      property_code, to_char(stay_date, 'YYYY-MM-DD') as stay_date,
      transient_nights, lease_nights, other_blocks, ooo,
      transient_rev, lease_rev, inventory
    from report_daily_snapshot
    where stay_date >= ${start} and stay_date <= ${end}
      and (${propertyCode}::text is null or property_code = ${propertyCode})
    order by property_code, stay_date
  `) as {
    property_code: string; stay_date: string;
    transient_nights: number; lease_nights: number; other_blocks: number; ooo: number;
    transient_rev: string; lease_rev: string; inventory: number;
  }[];
  return rows.map((r) => ({
    propertyCode: r.property_code,
    stayDate: r.stay_date,
    transientNights: Number(r.transient_nights),
    leaseNights: Number(r.lease_nights),
    otherBlocks: Number(r.other_blocks),
    ooo: Number(r.ooo),
    transientRev: Number(r.transient_rev),
    leaseRev: Number(r.lease_rev),
    inventory: Number(r.inventory),
  }));
}

/** Earliest banked stay_date for a property (or across all if null), as
 *  YYYY-MM-DD. Null if no snapshots exist yet. Backs the report's
 *  "tracking since" note. */
export async function getEarliestSnapshotDate(propertyCode: string | null): Promise<string | null> {
  const sql = db();
  const rows = (await sql`
    select to_char(min(stay_date), 'YYYY-MM-DD') as min_date
    from report_daily_snapshot
    where ${propertyCode}::text is null or property_code = ${propertyCode}
  `) as { min_date: string | null }[];
  return rows[0]?.min_date ?? null;
}
