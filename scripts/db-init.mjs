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

// mcp_tokens: one row per issued MCP connector URL (spec 2026-08-12).
// Only the SHA-256 hash is stored — a lost URL is re-minted, never recovered.
// Revoked rows are KEPT so "who had access in August" stays answerable.
await sql`
  create table if not exists mcp_tokens (
    id            bigserial   primary key,
    email         text,
    label         text,
    token_hash    text        not null unique,
    created_at    timestamptz not null default now(),
    last_used_at  timestamptz,
    revoked_at    timestamptz
  )
`;
await sql`create index if not exists mcp_tokens_hash_idx on mcp_tokens (token_hash)`;
// token_preview: first and last few characters of the token, so a URL someone is
// holding can be matched to a row on /connectors by eye. Added after the table
// shipped, hence ADD COLUMN rather than a column in the CREATE above. Nullable —
// rows minted before this existed have no preview and never will, because the
// token itself was never stored. See tokenPreview() in lib/mcp/tokens.ts for why
// storing a 12-character fragment of a 256-bit token is safe.
await sql`alter table mcp_tokens add column if not exists token_preview text`;
console.log("mcp_tokens table ready.");

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
// data share (RISE8_DATA.DA.EVENTS_LEASING_RISE8 for the seven funnel stages,
// plus prospect_canceled from PROSPECT_EVENTS_RISE8), refreshed by the nightly
// sync (scripts/elise-sync.mts / the /api/cron/elise-sync route). One row per
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
// updated_at added 08/07/26. Without it, rows written by two different query
// definitions are INDISTINGUISHABLE — which is exactly how the 08/07 source swap
// left three event types (tour_booked / tour_attended / application_approved)
// holding a mix of old UTC-bucketed and new local-bucketed rows that could not be
// separated after the fact. Every sync now stamps it, so stale rows are
// identifiable and purgeable (scripts/purge-elise-funnel.mts).
await sql`alter table elise_funnel_daily add column if not exists updated_at timestamptz not null default now()`;
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

// elise_sync_status: one row per sync ATTEMPT, success or failure. Added
// 08/08/26 because the dashboard could see that leasing data was stale but had
// no way to say WHY — the cron 500'd and recorded nothing, so a reader could not
// distinguish "nothing happened in the funnel" from "the sync has been failing
// for two days". The failure text is what lets the banner state the real reason
// instead of a hardcoded guess that outlives its truth.
// Failures are kept, not overwritten by the next attempt, so a recurring
// credential problem is visible as a run of failures rather than a single blip.
await sql`
  create table if not exists elise_sync_status (
    id            bigserial primary key,
    attempted_at  timestamptz not null default now(),
    ok            boolean not null,
    error         text,
    funnel_rows   integer,
    metric_rows   integer
  )
`;
await sql`create index if not exists elise_sync_status_at_idx on elise_sync_status (attempted_at desc)`;
console.log("elise_sync_status table ready.");

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

// Added 07/28/26 (Monica-parity remediation). Additive + idempotent so an
// existing store upgrades in place; every column has a default that reproduces
// the old behaviour for rows banked before it existed.
//   comp_nights      room-nights whose room-rate transactions net to $0
//                    (employee/complimentary). Already inside other_blocks;
//                    stored separately for the drill-down.
//   blocks_by_type   Cloudbeds roomBlockType -> room-nights, so "Other blocks"
//                    is explainable (Orlando showed 11 MTD vs Monica's 0).
//   ooo_source       'cloudbeds' | 'override' — an OOO figure that came from a
//                    config sellableOverrides entry is badged, never blended.
//   is_final /       a day stops being restated once its month is closed.
//   finalized_at
//   flash_room_rev   the FIRST captured total room revenue, never overwritten,
//                    so the restatement delta is visible. Monica's figures are
//                    the settled ledger; our 06:00 ET capture is a flash, and
//                    re-querying moved a single Davenport day by +48% one way
//                    and -1.7% the other.
//   first_captured_at / restated_at   audit trail for the two writes.
for (const [column, ddl] of [
  ["comp_nights", "int not null default 0"],
  ["blocks_by_type", "jsonb not null default '{}'::jsonb"],
  ["ooo_source", "text not null default 'cloudbeds'"],
  ["is_final", "boolean not null default false"],
  ["finalized_at", "timestamptz"],
  ["flash_room_rev", "numeric"],
  ["first_captured_at", "timestamptz"],
  ["restated_at", "timestamptz"],
  // Added 07/30/26. Cloudbeds room blocks ERODE for past dates: changing a block
  // drops it from the days already gone, and a past block cannot be re-added
  // (confirmed by Kyle 07/29/26). So a day's OOO can only ever decrease on
  // re-query, and `ooo` is now kept as the MAXIMUM observed on or after the stay
  // date rather than whatever the latest read said. These two columns record
  // which observation each figure came from, so the improvement is measurable
  // the same way flash_room_rev makes the revenue restatement measurable:
  //   ooo_eod    what the 23:00 ET end-of-day pass saw (its own day)
  //   ooo_flash  what the 06:00 ET next-morning flash saw
  // `ooo` = greatest(the two, plus any config override).
  ["ooo_eod", "int"],
  ["ooo_flash", "int"],
  ["ooo_observed_at", "timestamptz"],
]) {
  await sql.query(`alter table report_daily_snapshot add column if not exists ${column} ${ddl}`);
}
// The restatement pass scans "recent, not yet final" rows every night.
await sql`
  create index if not exists report_daily_snapshot_restate_idx
    on report_daily_snapshot (is_final, stay_date)
`;
console.log("report_daily_snapshot table ready (with restatement columns).");

// known_rate_plan: the plan names we have already ruled on. Lease vs transient is
// detected purely from the rate-plan string, so a NEW plan name silently banks as
// transient forever (and the snapshot freezes it). The rate-plans audit records
// what it sees here and reports anything unseen, turning a silent
// misclassification into a one-line alert. `acknowledged_class` is the ruling
// (Monica's, 07/27/26 for the current 57 plans); null = not yet ruled on.
await sql`
  create table if not exists known_rate_plan (
    plan               text primary key,
    first_seen         timestamptz not null default now(),
    last_seen          timestamptz not null default now(),
    acknowledged_class text
  )
`;
console.log("known_rate_plan table ready.");

// kb_queries: what people search the knowledgebase for, and how many sections
// came back. Result count ONLY — no user identity, no cookie, no level, no
// document contents (spec §8; CLAUDE.md §5 rule 2 unchanged).
//
// In v1 deliberately, against the minimal-scope instinct: what people search for
// and FAIL to find is the single best signal for which document to add next, and
// it cannot be reconstructed later. Deferring it would not save the work, it
// would destroy the data. Kyle kept it at spec review, 08/10/26.
await sql`
  create table if not exists kb_queries (
    id           bigserial primary key,
    query        text not null,
    result_count int  not null,
    created_at   timestamptz not null default now()
  )
`;
// "What found nothing, recently" is the query this table exists to answer.
await sql`
  create index if not exists kb_queries_misses_idx
    on kb_queries (created_at desc) where result_count = 0
`;
console.log("kb_queries table ready.");
