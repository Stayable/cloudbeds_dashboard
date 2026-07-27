// One-shot migration: create the `submissions` table (spec §6a).
// Idempotent (CREATE TABLE IF NOT EXISTS). Uses the DIRECT (unpooled) Neon URL.
// Run:  node scripts/db-init.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

// load .env.local (no dep)
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) { console.error("No DATABASE_URL(_UNPOOLED) in .env.local"); process.exit(1); }

const sql = neon(url);

await sql`
  create table if not exists submissions (
    id          bigserial primary key,
    created_at  timestamptz not null default now(),
    source      text not null,
    name        text,
    role        text,
    team        text,
    metrics     jsonb,
    notes       text
  )
`;

const cols = await sql`
  select column_name, data_type
  from information_schema.columns
  where table_name = 'submissions'
  order by ordinal_position
`;
console.log("submissions table ready:");
for (const c of cols) console.log(`  ${c.column_name}  ${c.data_type}`);

// dashboard_pins: per-level login PINs (lib/pins.ts) — the SOLE source of PINs
// (no env fallback). A level with no row cannot log in. Seed with
// scripts/seed-pins.mjs; edited self-service via /api/change-pin.
await sql`
  create table if not exists dashboard_pins (
    level       text primary key,
    pin         text not null,
    updated_at  timestamptz not null default now()
  )
`;
console.log("dashboard_pins table ready.");

// app_settings: small key/value store (lib/db.ts). Backs the Operations
// Dashboard's lockable 1-star reviews date window (key 'ops_reviews_window').
await sql`
  create table if not exists app_settings (
    key         text primary key,
    value       text not null,
    updated_at  timestamptz not null default now()
  )
`;
console.log("app_settings table ready.");

// elise_funnel_daily: PII-free leasing funnel rollup from the EliseAI Snowflake
// data share (RISE8_DATA.DA.PROSPECT_EVENTS_RISE8), refreshed by the nightly
// sync (scripts/elise-sync.mjs / the /api/cron/elise-sync route). One row per
// (building, day, event_type) with a count. `code` is the mapped Stayable
// property code (config/elise.ts); two Elise buildings can share a code (the
// unlaunched dupes fold into LL/DP), so reads GROUP BY code and SUM n.
await sql`
  create table if not exists elise_funnel_daily (
    building_id  bigint not null,
    code         text not null,
    day          date not null,
    event_type   text not null,
    n            integer not null,
    primary key (building_id, day, event_type)
  )
`;
await sql`create index if not exists elise_funnel_daily_day_idx on elise_funnel_daily (day)`;
console.log("elise_funnel_daily table ready.");

// elise_pipeline_snapshot: current prospect-status counts (Inquiry/Applicant/
// Leased/Cancelled) from PROSPECTS_RISE8 — a point-in-time snapshot overwritten
// each sync (not windowed). No PII (status + count only).
await sql`
  create table if not exists elise_pipeline_snapshot (
    building_id      bigint not null,
    code             text not null,
    prospect_status  text not null,
    n                integer not null,
    captured_at      timestamptz not null default now(),
    primary key (building_id, prospect_status)
  )
`;
console.log("elise_pipeline_snapshot table ready.");

// elise_metric_daily: generic PII-free daily aggregate for every ENRICHMENT
// dimension pulled from the Elise share (lead source, channel, AI-booked,
// after-hours, tour type, cancellation reason, voice answered/transfer, handoff
// reason, task type). One table rather than one-per-metric so a new dimension
// needs no migration. `total` is an optional summed measure whose meaning is
// per-metric (voice_answered = call seconds; task_type = resolved count; else 0).
// Keyed on `code` (not building_id) — lib/snowflake.ts merges the duplicate
// unlaunched buildings into their parent code before writing.
await sql`
  create table if not exists elise_metric_daily (
    code       text not null,
    day        date not null,
    metric     text not null,
    dimension  text not null,
    n          integer not null default 0,
    total      numeric not null default 0,
    primary key (code, day, metric, dimension)
  )
`;
await sql`create index if not exists elise_metric_daily_day_idx on elise_metric_daily (day, metric)`;
console.log("elise_metric_daily table ready.");

// report_daily_snapshot: PII-free daily banked figures per property (lib/db.ts
// upsertReportSnapshot/getReportSnapshots), written by a later cron task.
// MTD/YTD occupancy can't be reconstructed from Cloudbeds for past days, so we
// bank each day's exact numbers here and sum stored days (Kyle's decision,
// task-3b-brief.md). One row per (property_code, stay_date); re-runs upsert.
await sql`
  create table if not exists report_daily_snapshot (
    property_code     text not null,
    stay_date         date not null,
    transient_nights  int not null default 0,
    lease_nights      int not null default 0,
    other_blocks      int not null default 0,
    ooo               int not null default 0,
    transient_rev     numeric not null default 0,
    lease_rev         numeric not null default 0,
    inventory         int not null default 0,
    updated_at        timestamptz not null default now(),
    primary key (property_code, stay_date)
  )
`;
console.log("report_daily_snapshot table ready.");
