// Server-only Neon Postgres client (CLAUDE.md §6 reversal — sanctioned for
// persisting /test submissions and exec feedback). Never import from a client
// component. One table `submissions` (see scripts/db-init.mjs).
import { neon } from "@neondatabase/serverless";
import { shiftYmd } from "./dates";
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

/** What the last sync attempt did, plus when data last actually landed.
 *
 *  `lastSuccessAt` is deliberately separate from `lastAttemptAt`: a reader needs
 *  BOTH to understand the situation — "we tried 20 minutes ago and it failed, and
 *  the newest data we hold is from two days ago" is a different message from
 *  "nothing has run at all". Null fields mean the table has no such row yet,
 *  which is itself the honest answer for a store that has never synced. */
export type EliseSyncStatus = {
  lastAttemptAt: string | null;
  lastAttemptOk: boolean | null;
  lastError: string | null;
  lastSuccessAt: string | null;
  /** Consecutive failures ending at the most recent attempt. 0 when the last
   *  attempt succeeded — so a single blip reads differently from a dead
   *  credential failing every night. */
  consecutiveFailures: number;
};

/** Record one sync ATTEMPT, success or failure. Called by both the cron route and
 *  the manual script, so a hand-run recovery clears the dashboard banner exactly
 *  as an automatic run would. Never throws: a status write must not be able to
 *  fail a sync that otherwise worked. */
export async function recordEliseSyncAttempt(a: {
  ok: boolean;
  error?: string | null;
  funnelRows?: number | null;
  metricRows?: number | null;
}): Promise<void> {
  try {
    const sql = db();
    await sql`
      insert into elise_sync_status (ok, error, funnel_rows, metric_rows)
      values (${a.ok}, ${a.error ?? null}, ${a.funnelRows ?? null}, ${a.metricRows ?? null})
    `;
  } catch (e) {
    console.error("[elise] could not record sync status:", e);
  }
}

/** timestamptz → ISO 8601 UTC string.
 *
 *  Neon hands a `timestamptz` back as a **JS Date**, and `String(date)` gives
 *  "Sun Aug 09 2026 00:50:00 GMT+0800" — so slicing it for display produces
 *  "Sun Aug 09 2026  UTC" and leaks the server's local zone. Exactly the trap
 *  already documented for Snowflake DATEs in lib/snowflake.ts (`ymd`); this is
 *  the same bug in a different table, so it gets the same explicit conversion
 *  rather than a String() and a slice. */
function toIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Read the sync status for the dashboard banner. Returns all-null rather than
 *  throwing if the table is missing, so a store that predates this feature
 *  renders as "never synced" instead of erroring the whole page. */
export async function getEliseSyncStatus(): Promise<EliseSyncStatus> {
  const empty: EliseSyncStatus = {
    lastAttemptAt: null, lastAttemptOk: null, lastError: null,
    lastSuccessAt: null, consecutiveFailures: 0,
  };
  try {
    const sql = db();
    const recent = (await sql`
      select attempted_at, ok, error from elise_sync_status
       order by attempted_at desc limit 50
    `) as { attempted_at: unknown; ok: boolean; error: string | null }[];
    if (!recent.length) return empty;

    const success = (await sql`
      select max(attempted_at) as at from elise_sync_status where ok = true
    `) as { at: unknown }[];

    let consecutiveFailures = 0;
    for (const r of recent) {
      if (r.ok) break;
      consecutiveFailures++;
    }
    return {
      lastAttemptAt: toIso(recent[0].attempted_at),
      lastAttemptOk: recent[0].ok,
      lastError: recent[0].error,
      lastSuccessAt: toIso(success[0]?.at),
      consecutiveFailures,
    };
  } catch {
    return empty;
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
      // now() is inlined as the 6th column rather than bound, so the parameter
      // numbering stays 5-per-row.
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},now())`);
      params.push(r.buildingId, r.code, r.day, r.eventType, r.n);
    });
    await sql.query(
      // updated_at is stamped on every write so rows from an older query
      // definition can be told apart from current ones — see the note in
      // scripts/db-init.mjs for the incident that made this necessary.
      `insert into elise_funnel_daily (building_id, code, day, event_type, n, updated_at)
       values ${values.join(",")}
       on conflict (building_id, day, event_type)
       do update set n = excluded.n, code = excluded.code, updated_at = now()`,
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

// --- Report freshness + per-property daily series ---------------------------
// Both read report_daily_snapshot (the source of truth for MTD/YTD). Freshness
// answers "did the daily cron actually run?" without making the reader infer it
// from a stale-looking number; the series drives the per-property sparklines.

export type SnapshotFreshness = {
  /** Most recent write to any snapshot row (ISO). Null when the table is empty. */
  lastBankedAt: string | null;
  /** Latest stay_date that carries REAL occupancy counts (not a revenue-only
   *  stub or a future inventory row) — i.e. the last day actually captured. */
  latestCapturedDate: string | null;
  /** Properties with a real capture on `latestCapturedDate`. */
  propertiesOnLatest: number;
};

export async function getSnapshotFreshness(): Promise<SnapshotFreshness> {
  try {
    const sql = db();
    const [row] = (await sql`
      with captured as (
        select stay_date, property_code
        from report_daily_snapshot
        where transient_nights + lease_nights > 0
      ), latest as (
        select max(stay_date) as d from captured
      )
      select
        (select max(updated_at) from report_daily_snapshot)::text as last_banked_at,
        (select to_char(d, 'YYYY-MM-DD') from latest) as latest_captured,
        (select count(*) from captured where stay_date = (select d from latest))::int as props
    `) as { last_banked_at: string | null; latest_captured: string | null; props: number }[];
    return {
      lastBankedAt: row?.last_banked_at ?? null,
      latestCapturedDate: row?.latest_captured ?? null,
      propertiesOnLatest: Number(row?.props ?? 0),
    };
  } catch {
    return { lastBankedAt: null, latestCapturedDate: null, propertiesOnLatest: 0 };
  }
}

export type DailyOccPoint = { code: string; day: string; pOcc: number };

/** Per-property daily occupancy over [from, to] for the sparklines. Only days
 *  with a real capture are returned, so a gap renders as a gap rather than as
 *  a misleading dip to zero. */
export async function getDailyOccSeries(from: string, to: string): Promise<DailyOccPoint[]> {
  try {
    const sql = db();
    const rows = (await sql`
      select property_code, to_char(stay_date, 'YYYY-MM-DD') as day,
             (transient_nights + lease_nights + other_blocks)::float8 / nullif(inventory, 0) as p_occ
      from report_daily_snapshot
      where stay_date >= ${from} and stay_date <= ${to}
        and transient_nights + lease_nights > 0
        and inventory > 0
      order by stay_date
    `) as { property_code: string; day: string; p_occ: number | null }[];
    return rows
      .filter((r) => r.p_occ != null)
      .map((r) => ({ code: r.property_code, day: r.day, pOcc: Number(r.p_occ) }));
  } catch {
    return [];
  }
}

/** One property's occupancy + rate rollup over a date range, derived entirely
 *  from banked snapshots. */
export type OccupancyRollup = {
  code: string;
  /** Σ occupied (transient + lease + other blocks) — the same definition
   *  `/report` and Monica both use. */
  occupied: number;
  /** Σ inventory room-days, honouring in-service windows and per-day capacity
   *  changes (a property out of service contributes 0, not today's capacity). */
  inventory: number;
  transientNights: number;
  leaseNights: number;
  roomRev: number;
  ooo: number;
  /** Days with a real capture, oldest first. A cron gap is a gap.
   *
   *  `occupied`/`inventory`/`roomRev`/`ooo` here are ADDITIVE (MCP task 5,
   *  08/11/26): the per-day RAW counts, not just the derived `pOcc`
   *  percentage. A caller that needs to roll these days up into weeks or
   *  months (lib/mcp/tools-occupancy.ts) must sum the real per-day counts
   *  within its bucket — reconstructing them from the period's average
   *  inventory is only exact when inventory is constant across the whole
   *  range, which it is not in general (in-service windows, capacity
   *  changes, renovations). The SELECT below already reads all four columns
   *  per day before folding them into the period totals, so stashing them
   *  here costs nothing extra. Optional so every OccupancyRollup fixture
   *  already in the repo (lib/occupancy.test.ts et al.), which predates this
   *  and only sets `pOcc`, keeps type-checking unchanged. */
  days: { day: string; pOcc: number; occupied?: number; inventory?: number; roomRev?: number; ooo?: number }[];
};

/** Per-property occupancy/ADR/RevPAR inputs over [from, to], from the snapshot
 *  store rather than Data Insights.
 *
 *  WHY NOT DATA INSIGHTS (Kyle's decision, 08/03/26): DI returns Cloudbeds'
 *  OWN derivation — rooms sold over a capacity figure that is demonstrably
 *  wrong (168 at KE against a real 167, 134 at JW against 133), and its
 *  numerator excludes the "other blocks" that both `/report` and Monica count
 *  as occupied. Measured over 2026-07-05..08-02 that put every property
 *  between 0.6pp and 4.2pp away from the same property's figure on `/report`.
 *  The rule now is: Cloudbeds is the source for primitives, we own every
 *  derivation, and nothing consumes Cloudbeds' pre-computed percentages.
 *
 *  Ratio of sums, NOT mean of daily ratios — a 30%-occupied day at a 153-room
 *  property must not weigh the same as one at a 127-room property. This also
 *  matches how `/report` rolls MTD/YTD, which is the point. */
export async function getOccupancyRollup(from: string, to: string): Promise<OccupancyRollup[]> {
  try {
    const sql = db();
    const rows = (await sql`
      select property_code,
             to_char(stay_date, 'YYYY-MM-DD') as day,
             (transient_nights + lease_nights + other_blocks)::float8 as occupied,
             transient_nights::float8 as transient_nights,
             lease_nights::float8 as lease_nights,
             ooo::float8 as ooo,
             inventory::float8 as inventory,
             (transient_rev + lease_rev)::float8 as room_rev
      from report_daily_snapshot
      where stay_date >= ${from} and stay_date <= ${to}
        and transient_nights + lease_nights > 0
        and inventory > 0
      order by stay_date
    `) as Record<string, any>[];

    const byCode = new Map<string, OccupancyRollup>();
    for (const r of rows) {
      const code = r.property_code as string;
      let e = byCode.get(code);
      if (!e) {
        e = { code, occupied: 0, inventory: 0, transientNights: 0, leaseNights: 0, roomRev: 0, ooo: 0, days: [] };
        byCode.set(code, e);
      }
      const occupied = Number(r.occupied), inventory = Number(r.inventory);
      const roomRev = Number(r.room_rev), ooo = Number(r.ooo);
      e.occupied += occupied;
      e.inventory += inventory;
      e.transientNights += Number(r.transient_nights);
      e.leaseNights += Number(r.lease_nights);
      e.roomRev += roomRev;
      e.ooo += ooo;
      // occupied/inventory/roomRev/ooo are the per-day raw counts (see the
      // type's comment) — a rollup consumer sums these directly instead of
      // reconstructing them from the period average.
      e.days.push({ day: r.day as string, pOcc: occupied / inventory, occupied, inventory, roomRev, ooo });
    }
    return [...byCode.values()];
  } catch {
    return [];
  }
}

// --- EliseAI enrichment metrics (generic daily aggregate) -------------------
// One table for every extra Elise dimension (lead source, channel, AI-booked,
// after-hours, tour type, cancellation reason, voice answered/transfer,
// handoff reason, task type) so adding a dimension needs no migration. Written
// by the nightly sync from `fetchEliseEnrichment`. PII-free: counts, durations
// and category labels only.

export type EliseMetricRow = { code: string; day: string; metric: string; dimension: string; n: number; total: number };

/** Enrichment rows for [from, to] (inclusive), optionally one metric only. */
export async function getEliseMetrics(from: string, to: string, metric?: string): Promise<EliseMetricRow[]> {
  try {
    const sql = db();
    const rows = (await sql`
      select code, to_char(day, 'YYYY-MM-DD') as day, metric, dimension, n, total
      from elise_metric_daily
      where day >= ${from} and day <= ${to}
        and (${metric ?? null}::text is null or metric = ${metric ?? null})
    `) as { code: string; day: string; metric: string; dimension: string; n: number; total: number }[];
    return rows.map((r) => ({ ...r, n: Number(r.n), total: Number(r.total) }));
  } catch {
    return [];
  }
}

/** Upsert enrichment rows (nightly sync). Chunked positional insert. */
export async function upsertEliseMetrics(rows: EliseMetricRow[]): Promise<void> {
  if (!rows.length) return;
  const sql = db();
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r, j) => {
      const b = j * 6;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`);
      params.push(r.code, r.day, r.metric, r.dimension, r.n, r.total);
    });
    await sql.query(
      `insert into elise_metric_daily (code, day, metric, dimension, n, total)
       values ${values.join(",")}
       on conflict (code, day, metric, dimension)
       do update set n = excluded.n, total = excluded.total`,
      params,
    );
  }
}

// --- Report daily snapshot (banked figures for MTD/YTD rollups) -------------
// PII-free per-day aggregates per property (CLAUDE.md §5.6). Written by a
// later cron task; read by the revenue report's MTD/YTD rollups via
// sumSnapshotRows (lib/revenue-report.ts). See scripts/db-init.mjs for DDL.

export type ReportSnapshotRow = RowInputs & {
  propertyCode: string;
  stayDate: string;
  /** True once the day's month is closed — the restatement pass skips it. */
  isFinal?: boolean;
  /** Total room revenue as FIRST captured (the 06:00 ET flash), never
   *  overwritten. Null for rows banked before 07/28/26. */
  flashRoomRev?: number | null;
};

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

// --- Room-block observations (07/30/26) --------------------------------------
// Cloudbeds room blocks ERODE for past dates: changing a block drops it from the
// days already gone, and a past block cannot be re-added (confirmed by Kyle
// 07/29/26). So a stay date's OOO can only ever DECREASE on re-query, there is no
// as-of view, and the EARLIEST reading is the truest one.
//
// Two things follow. Blocks must never be restated downward (already true — see
// restateSnapshot), and our 06:00 ET next-morning flash is too late: anything
// tidied up during the day itself is already gone. Proven on 2026-07-28, where
// the banked Lakeland figure was 3 while both Monica's report and a live
// re-query read 6. That is the whole systematic gap against her report (every
// delta negative, ours always lower: LL -11, JW -10, SA -11, KE -81 MTD).
//
// So `ooo` is now the MAXIMUM observed on or after the stay date, fed by an
// end-of-day pass during the day itself plus the morning flash.

export type BlockObservation = {
  /** OOO room-nights for the day: Cloudbeds `out_of_service` blocks, or the
   *  config sellable-override where that is larger. */
  ooo: number;
  blocksByType: Record<string, number>;
  oooSource: "cloudbeds" | "override";
  /** Which pass saw it. `eod` = the 23:00 ET run on the stay date itself;
   *  `flash` = the 06:00 ET run the next morning. */
  pass: "eod" | "flash";
};

/**
 * Record a block observation for a stay date, keeping the HIGHEST OOO seen.
 *
 * Never lowers a stored figure — erosion is one-way, so a smaller later reading
 * is a loss of information, not a correction. `blocks_by_type` and `ooo_source`
 * move only when the new observation actually raises `ooo`, so the composition
 * always describes the figure being shown.
 *
 * Creates the row if the day has no snapshot yet (the end-of-day pass runs
 * before the morning flash). Such a row carries zero nights and zero revenue
 * until the flash fills them — which is why `bankDailySnapshot`'s "still empty"
 * test looks at NIGHTS only and no longer at `ooo`.
 *
 * ONLY call this with a real reading. A failed/rate-limited block fetch must be
 * skipped, never passed in as 0: a `greatest()` makes a zero harmless, but it
 * would still stamp `ooo_eod`/`ooo_flash` misleadingly.
 */
export async function observeBlocks(
  propertyCode: string,
  stayDate: string,
  obs: BlockObservation,
): Promise<void> {
  const sql = db();
  const eod = obs.pass === "eod" ? obs.ooo : null;
  const flash = obs.pass === "flash" ? obs.ooo : null;
  await sql`
    insert into report_daily_snapshot (
      property_code, stay_date, ooo, blocks_by_type, ooo_source,
      ooo_eod, ooo_flash, ooo_observed_at
    )
    values (
      ${propertyCode}, ${stayDate}, ${obs.ooo},
      ${JSON.stringify(obs.blocksByType)}, ${obs.oooSource},
      ${eod}, ${flash}, now()
    )
    on conflict (property_code, stay_date) do update set
      ooo = greatest(report_daily_snapshot.ooo, excluded.ooo),
      blocks_by_type = case
        when excluded.ooo > report_daily_snapshot.ooo then excluded.blocks_by_type
        else report_daily_snapshot.blocks_by_type
      end,
      ooo_source = case
        when excluded.ooo > report_daily_snapshot.ooo then excluded.ooo_source
        else report_daily_snapshot.ooo_source
      end,
      ooo_eod = coalesce(${eod}, report_daily_snapshot.ooo_eod),
      ooo_flash = coalesce(${flash}, report_daily_snapshot.ooo_flash),
      ooo_observed_at = now(),
      updated_at = now()
    where report_daily_snapshot.is_final = false
  `;
}

/** CAPTURE-ONCE daily bank (the store is our source of truth going forward, so
 *  a captured day must FREEZE — never drift from a later CB re-query). Inserts a
 *  fresh row; on conflict it fills ONLY a still-empty (all-count-zero) row and
 *  otherwise leaves an already-banked real day untouched. A failed/zero capture
 *  stays open for re-capture until it lands real counts, then freezes. Used by
 *  the daily cron; the historical backfills use their own upserts. */
export async function bankDailySnapshot(
  propertyCode: string,
  stayDate: string,
  inputs: RowInputs,
): Promise<void> {
  const sql = db();
  const roomRev = inputs.transientRev + inputs.leaseRev;
  await sql`
    insert into report_daily_snapshot (
      property_code, stay_date, transient_nights, lease_nights, other_blocks,
      ooo, transient_rev, lease_rev, inventory,
      comp_nights, blocks_by_type, ooo_source, flash_room_rev, first_captured_at
    )
    values (
      ${propertyCode}, ${stayDate}, ${inputs.transientNights}, ${inputs.leaseNights},
      ${inputs.otherBlocks}, ${inputs.ooo}, ${inputs.transientRev}, ${inputs.leaseRev},
      ${inputs.inventory},
      ${inputs.compNights ?? 0}, ${JSON.stringify(inputs.blocksByType ?? {})},
      ${inputs.oooSource ?? "cloudbeds"}, ${roomRev}, now()
    )
    on conflict (property_code, stay_date) do update set
      transient_nights = excluded.transient_nights,
      lease_nights = excluded.lease_nights,
      other_blocks = excluded.other_blocks,
      -- Blocks erode (see observeBlocks): the end-of-day pass on the stay date
      -- itself sees more than this next-morning read can, so never lower it.
      ooo = greatest(report_daily_snapshot.ooo, excluded.ooo),
      ooo_flash = excluded.ooo,
      transient_rev = excluded.transient_rev,
      lease_rev = excluded.lease_rev,
      inventory = excluded.inventory,
      comp_nights = excluded.comp_nights,
      blocks_by_type = case
        when excluded.ooo > report_daily_snapshot.ooo then excluded.blocks_by_type
        else report_daily_snapshot.blocks_by_type
      end,
      ooo_source = case
        when excluded.ooo > report_daily_snapshot.ooo then excluded.ooo_source
        else report_daily_snapshot.ooo_source
      end,
      -- The flash is the FIRST capture only. A revenue-only backfill stub may
      -- already exist with no flash recorded, so fill it; never overwrite one.
      flash_room_rev = coalesce(report_daily_snapshot.flash_room_rev, excluded.flash_room_rev),
      first_captured_at = coalesce(report_daily_snapshot.first_captured_at, now()),
      updated_at = now()
    -- "Still empty" = no real occupancy capture yet, judged on NIGHTS ONLY.
    -- It used to require ooo = 0 and other_blocks = 0 too, which would now block
    -- every day the end-of-day block pass had already touched (that pass runs
    -- BEFORE this one and legitimately pre-populates ooo), leaving the day with
    -- no nights or revenue forever.
    where report_daily_snapshot.transient_nights = 0
      and report_daily_snapshot.lease_nights = 0
  `;
}

// --- Restatement (07/28/26) --------------------------------------------------
// Kyle's decision after the Monica-parity analysis. This DELIBERATELY relaxes
// the earlier capture-once rule, and the reason it is now safe is specific:
// capture-once existed because dataset-3 night counts were re-derived from
// CURRENT reservation status and so drifted when re-queried. Nights now come
// from dataset-1 room-rate transactions keyed on `service_date`
// (getPaidNightsByPlanDay), which reproduce a past day faithfully — so a
// re-query is a correction, not drift.
//
// The ledger genuinely keeps moving: re-querying Davenport 7/25 raised transient
// revenue 48% (our frozen $468.90 vs the settled $693.93, which is exactly
// Monica's figure), while 7/24 moved DOWN 1.7%. Monica's own footnote says past
// dates keep changing. So: keep the 06:00 flash, restate nightly over a trailing
// window, and freeze permanently once the month is closed.

/** Re-derive one day for one property. Updates revenue, nights and inventory,
 *  and only while the row is not yet final. Returns true if a row was actually
 *  updated (false = already finalized, or no such row).
 *
 *  ROOM BLOCKS ARE NOT RESTATED once a day has a real occupancy capture, and that
 *  exception is the opposite of the rule for everything else here. Revenue and
 *  room-nights key off `service_date`, so re-querying them recovers late postings
 *  — a correction. Room blocks have no as-of query at all: `/getRoomBlocks`
 *  returns the block records as they exist NOW, and an expired block that someone
 *  has since tidied up simply vanishes. Observed live on the first full
 *  restatement run (07/28/26): Lakeland's 07/26 out-of-order dropped 6 -> 4 and
 *  Jacksonville West's 6 -> 5, both moving AWAY from the figures Monica published
 *  and that our own 06:00 capture had matched exactly. The rooms were out of order
 *  that day; only the record changed. So the first capture wins.
 *
 *  `other_blocks` is split for this: its BLOCK component is frozen while its comp
 *  component (room-nights whose room rate nets to $0) still restates, because
 *  that half comes from the revenue query and does settle. */
export async function restateSnapshot(
  propertyCode: string,
  stayDate: string,
  inputs: RowInputs,
): Promise<boolean> {
  const sql = db();
  const rows = (await sql`
    update report_daily_snapshot set
      transient_nights = ${inputs.transientNights},
      lease_nights = ${inputs.leaseNights},
      transient_rev = ${inputs.transientRev},
      lease_rev = ${inputs.leaseRev},
      inventory = ${inputs.inventory},
      comp_nights = ${inputs.compNights ?? 0},
      -- Freeze the block half, restate the comp half. Column references on the
      -- right-hand side of SET are the row's OLD values.
      other_blocks = case
        when transient_nights + lease_nights > 0
          then greatest(other_blocks - comp_nights, 0) + ${inputs.compNights ?? 0}
        else ${inputs.otherBlocks}
      end,
      -- Frozen once the day has real nights, and even before that only ever
      -- raised: blocks erode, so a smaller re-read is lost information rather
      -- than a correction (see observeBlocks).
      ooo = case
        when transient_nights + lease_nights > 0 then ooo
        else greatest(ooo, ${inputs.ooo})
      end,
      blocks_by_type = case
        when transient_nights + lease_nights > 0 then blocks_by_type
        else ${JSON.stringify(inputs.blocksByType ?? {})}
      end,
      ooo_source = case
        when transient_nights + lease_nights > 0 then ooo_source
        else ${inputs.oooSource ?? "cloudbeds"}
      end,
      flash_room_rev = coalesce(flash_room_rev, ${inputs.transientRev + inputs.leaseRev}),
      restated_at = now(),
      updated_at = now()
    where property_code = ${propertyCode}
      and stay_date = ${stayDate}
      and is_final = false
    returning 1 as ok
  `) as { ok: number }[];
  return rows.length > 0;
}

/** Freeze every day in months that closed more than `graceDays` ago. Idempotent.
 *  Returns how many rows were newly finalized. */
export async function finalizeClosedMonths(today: string, graceDays = 5): Promise<number> {
  const sql = db();
  const rows = (await sql`
    update report_daily_snapshot set is_final = true, finalized_at = now()
    where is_final = false
      and stay_date < date_trunc('month', (${today}::date - ${graceDays}::int))
    returning 1 as ok
  `) as { ok: number }[];
  return rows.length;
}

/** Latest stay_date that is finalized (portfolio-wide), or null if none is. */
export async function getFinalThrough(): Promise<string | null> {
  try {
    const sql = db();
    const rows = (await sql`
      select to_char(max(stay_date), 'YYYY-MM-DD') as d
      from report_daily_snapshot where is_final = true
    `) as { d: string | null }[];
    return rows[0]?.d ?? null;
  } catch {
    return null;
  }
}

export type RestatementRow = {
  propertyCode: string;
  stayDate: string;
  flashRoomRev: number;
  currentRoomRev: number;
  delta: number;
};

/** Days in [from, to] whose room revenue has moved since the flash capture, so
 *  the report can show how much a "final" number differs from what was first
 *  published. Largest absolute move first. */
export async function getRestatements(from: string, to: string, minDelta = 0.01): Promise<RestatementRow[]> {
  try {
    const sql = db();
    const rows = (await sql`
      select property_code, to_char(stay_date, 'YYYY-MM-DD') as stay_date,
             flash_room_rev::float8 as flash,
             (transient_rev + lease_rev)::float8 as current
      from report_daily_snapshot
      where stay_date >= ${from} and stay_date <= ${to}
        and flash_room_rev is not null
        and abs((transient_rev + lease_rev) - flash_room_rev) >= ${minDelta}
      order by abs((transient_rev + lease_rev) - flash_room_rev) desc
    `) as { property_code: string; stay_date: string; flash: number; current: number }[];
    return rows.map((r) => ({
      propertyCode: r.property_code,
      stayDate: r.stay_date,
      flashRoomRev: Number(r.flash),
      currentRoomRev: Number(r.current),
      delta: Number(r.current) - Number(r.flash),
    }));
  } catch {
    return [];
  }
}

/** Gap detector: for each `codes` property × each day in [start, end], report
 *  the (property, date) pairs that lack a REAL occupancy capture — i.e. no row,
 *  OR only a revenue-only row with all counts = 0 (which happens if the daily
 *  cron missed the day but a revenue backfill left a stub). Since our store is
 *  the source of truth, that's silent occupancy loss. Intended for the FORWARD
 *  era (recent window) where every active property has real occupancy daily;
 *  historical pre-acquisition zero days (JN Apr'25–Mar'26, DP pre-Jun'25) would
 *  read as gaps, so keep the window recent. */
export async function findSnapshotGaps(
  start: string,
  end: string,
  codes: string[],
): Promise<{ propertyCode: string; stayDate: string }[]> {
  const sql = db();
  const rows = (await sql`
    with days as (
      select generate_series(${start}::date, ${end}::date, interval '1 day')::date as d
    ),
    props as (select unnest(${codes}::text[]) as code)
    select props.code as property_code, to_char(days.d, 'YYYY-MM-DD') as stay_date
    from days cross join props
    left join report_daily_snapshot s
      on s.property_code = props.code and s.stay_date = days.d
      and (s.transient_nights + s.lease_nights + s.other_blocks + s.ooo) > 0
    where s.property_code is null
    order by props.code, days.d
  `) as { property_code: string; stay_date: string }[];
  return rows.map((r) => ({ propertyCode: r.property_code, stayDate: r.stay_date }));
}

export type AvailabilityAlert = {
  propertyCode: string;
  firstDay: string;
  lastDay: string;
  days: number;
  avgAvailablePct: number;
};

/** Properties showing implausibly high availability for a sustained run of days
 *  — the signature of an inventory/OOO problem rather than of a quiet week.
 *
 *  WHY: Jacksonville North read 89 of 127 rooms available (70%) for months
 *  because only 20 of its ~107 unsellable renovation rooms were blocked in
 *  Cloudbeds. Nothing flagged it; it took a manual reconciliation against
 *  Monica's report to notice. A property that genuinely cannot sell rooms shows
 *  up here on day one.
 *
 *  Returns one entry per maximal run of >= `minDays` consecutive banked days
 *  where availability >= `thresholdPct` of inventory. Days with no banked row,
 *  or with no inventory, break a run rather than extending it. */
export async function findAvailabilityAnomalies(
  start: string,
  end: string,
  thresholdPct = 0.25,
  minDays = 7,
): Promise<AvailabilityAlert[]> {
  const sql = db();
  const rows = (await sql`
    select property_code, to_char(stay_date, 'YYYY-MM-DD') as stay_date,
           ((inventory - (transient_nights + lease_nights + other_blocks) - ooo)::float8
             / nullif(inventory, 0)) as avail_pct
    from report_daily_snapshot
    where stay_date >= ${start} and stay_date <= ${end} and inventory > 0
    order by property_code, stay_date
  `) as { property_code: string; stay_date: string; avail_pct: number | null }[];
  return groupAvailabilityRuns(
    rows.map((r) => ({ code: r.property_code, day: r.stay_date, availPct: r.avail_pct })),
    thresholdPct,
    minDays,
  );
}

/** Pure run-detection behind `findAvailabilityAnomalies`: collapse day rows
 *  (ordered by code then day) into maximal runs of >= `minDays` CONSECUTIVE days
 *  at or above `thresholdPct` availability. A missing day, a null percentage or a
 *  day below the threshold breaks a run rather than extending it — a gap must not
 *  be silently bridged into a longer alert than the data supports. Split out so
 *  the boundary conditions are unit-tested without a database. */
export function groupAvailabilityRuns(
  rows: { code: string; day: string; availPct: number | null }[],
  thresholdPct = 0.25,
  minDays = 7,
): AvailabilityAlert[] {
  const out: AvailabilityAlert[] = [];
  let run: { code: string; days: string[]; pcts: number[] } | null = null;

  const flush = () => {
    if (run && run.days.length >= minDays) {
      out.push({
        propertyCode: run.code,
        firstDay: run.days[0],
        lastDay: run.days[run.days.length - 1],
        days: run.days.length,
        avgAvailablePct: run.pcts.reduce((a, b) => a + b, 0) / run.pcts.length,
      });
    }
    run = null;
  };

  for (const r of rows) {
    const pct = r.availPct;
    const current = run;
    const contiguous =
      current != null && current.code === r.code && shiftYmd(current.days[current.days.length - 1], 1) === r.day;
    if (pct != null && pct >= thresholdPct) {
      if (contiguous && current) {
        current.days.push(r.day);
        current.pcts.push(pct);
      } else {
        flush();
        run = { code: r.code, days: [r.day], pcts: [pct] };
      }
    } else {
      flush();
    }
  }
  flush();
  return out;
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
      transient_rev, lease_rev, inventory,
      comp_nights, blocks_by_type, ooo_source, is_final, flash_room_rev
    from report_daily_snapshot
    where stay_date >= ${start} and stay_date <= ${end}
      and (${propertyCode}::text is null or property_code = ${propertyCode})
    order by property_code, stay_date
  `) as {
    property_code: string; stay_date: string;
    transient_nights: number; lease_nights: number; other_blocks: number; ooo: number;
    transient_rev: string; lease_rev: string; inventory: number;
    comp_nights: number; blocks_by_type: Record<string, number> | null;
    ooo_source: string | null; is_final: boolean | null; flash_room_rev: string | null;
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
    compNights: Number(r.comp_nights ?? 0),
    blocksByType: r.blocks_by_type ?? {},
    oooSource: r.ooo_source === "override" ? "override" : "cloudbeds",
    isFinal: r.is_final === true,
    flashRoomRev: r.flash_room_rev == null ? null : Number(r.flash_room_rev),
  }));
}

/** Earliest banked stay_date for a property (or across all if null), as
 *  YYYY-MM-DD. Null if no snapshots exist yet. Backs the report's
 *  "tracking since" note.
 *
 *  Same fix as getEarliestCountsDate below, same reason (final review,
 *  Important 4): this was the first of two queries in this file missing a
 *  try/catch, and `getRevenueReportInputs` calls it unconditionally — a dead
 *  Neon connection took buildRevenueReport down with it instead of degrading. */
export async function getEarliestSnapshotDate(propertyCode: string | null): Promise<string | null> {
  try {
    const sql = db();
    const rows = (await sql`
      select to_char(min(stay_date), 'YYYY-MM-DD') as min_date
      from report_daily_snapshot
      where ${propertyCode}::text is null or property_code = ${propertyCode}
    `) as { min_date: string | null }[];
    return rows[0]?.min_date ?? null;
  } catch {
    return null;
  }
}

// --- Rate-plan drift alerting (07/28/26) ------------------------------------
// Lease vs transient comes entirely from the rate-plan string, so a plan name
// nobody has ruled on banks as transient and the snapshot freezes it. Recording
// the plans we have seen turns that silent failure into an alert the first time
// a new name appears.

/** Register the plans seen in an audit run and return the ones that are NEW
 *  (never recorded before this call). Idempotent; safe to run every night. */
export async function recordAndDiffRatePlans(plans: string[]): Promise<string[]> {
  if (plans.length === 0) return [];
  const sql = db();
  const known = (await sql`select plan from known_rate_plan`) as { plan: string }[];
  const seen = new Set(known.map((k) => k.plan));
  const fresh = [...new Set(plans)].filter((p) => !seen.has(p));

  const values: string[] = [];
  const params: unknown[] = [];
  [...new Set(plans)].forEach((p, i) => {
    values.push(`($${i + 1})`);
    params.push(p);
  });
  await sql.query(
    `insert into known_rate_plan (plan) values ${values.join(",")}
     on conflict (plan) do update set last_seen = now()`,
    params,
  );
  return fresh;
}

// --- Historical revenue-only backfill (Kyle's decision — see
// .superpowers/sdd/briefs/revenue-backfill-brief.md) -------------------------
// Revenue (dataset-1 service_date) IS historically exact and can be
// reconstructed for past days; occupancy COUNTS cannot (dataset-3 status/rate-
// plan fields are current-state only — see the drift note on
// getNightsByPlanDay in lib/cloudbeds.ts) and must keep accumulating forward
// via the daily cron's upsertReportSnapshot. upsertRevenueSnapshot therefore
// touches ONLY transient_rev/lease_rev/inventory on conflict — the count
// columns (transient_nights/lease_nights/other_blocks/ooo) are never clobbered
// so a real count-snapshot banked by the cron always survives a backfill re-run.

/** Upsert ONLY the revenue + inventory columns for one day/property. INSERTs a
 *  fresh row with the count columns defaulted to 0 if none exists yet; on
 *  conflict, updates transient_rev/lease_rev/inventory ONLY — never the count
 *  columns, so a real cron-banked count snapshot is preserved. Idempotent. */
export async function upsertRevenueSnapshot(
  propertyCode: string,
  stayDate: string,
  transientRev: number,
  leaseRev: number,
  inventory: number,
): Promise<void> {
  const sql = db();
  await sql`
    insert into report_daily_snapshot (
      property_code, stay_date, transient_rev, lease_rev, inventory
    )
    values (
      ${propertyCode}, ${stayDate}, ${transientRev}, ${leaseRev}, ${inventory}
    )
    on conflict (property_code, stay_date) do update set
      transient_rev = excluded.transient_rev,
      lease_rev = excluded.lease_rev,
      inventory = excluded.inventory,
      updated_at = now()
  `;
}

/** Earliest stay_date with a real (non-zero) count snapshot — i.e. banked by
 *  the daily cron, not just the revenue backfill — for a property (or across
 *  all if null). Null if no counts have been banked yet. Backs the report's
 *  "counts accumulate since" caveat.
 *
 *  Found while adding the MCP manifest's output-PII sweep (final review,
 *  Important 4): this was the one query in this file with no try/catch, so a
 *  dead Neon connection didn't degrade `buildRevenueReport` the way every
 *  sibling query here degrades — it threw straight out of
 *  `getEarliestCountsDate(null)` (buildRevenueReport's unconditional,
 *  portfolio-wide call), taking /report, get_daily_report and get_report_file
 *  down with it instead of returning a report with an honest "no counts
 *  banked yet" caveat. Matches every other function in this file. */
export async function getEarliestCountsDate(propertyCode: string | null): Promise<string | null> {
  try {
    const sql = db();
    const rows = (await sql`
      select to_char(min(stay_date), 'YYYY-MM-DD') as min_date
      from report_daily_snapshot
      where (${propertyCode}::text is null or property_code = ${propertyCode})
        and (transient_nights + lease_nights + other_blocks + ooo) > 0
    `) as { min_date: string | null }[];
    return rows[0]?.min_date ?? null;
  } catch {
    return null;
  }
}

// --- Knowledgebase query log (spec §8) --------------------------------------
// Query text + result count ONLY. No user identity, no level, no cookie, no
// document contents — CLAUDE.md §5 rule 2 is unchanged by this table.

/** Record one /kb search. Called only via lib/kb-log.ts, which owns the
 *  never-throws behaviour. */
export async function insertKbQuery(query: string, resultCount: number): Promise<void> {
  const sql = db();
  await sql`
    insert into kb_queries (query, result_count)
    values (${query}, ${resultCount})
  `;
}
