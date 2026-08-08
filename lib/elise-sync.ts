// Orchestrates the nightly EliseAI → Neon sync: pull PII-free aggregates from
// the Snowflake data share, upsert the funnel rollup, replace the pipeline
// snapshot, upsert the enrichment metrics. Server-only. Invoked by
// /api/cron/elise-sync (and mirrored by the standalone scripts/elise-sync.mjs
// used for the initial backfill).
import { fetchEliseAggregates, fetchEliseEnrichment } from "@/lib/snowflake";
import {
  upsertEliseFunnel,
  replaceElisePipeline,
  upsertEliseMetrics,
  recordEliseSyncAttempt,
} from "@/lib/db";

export type SyncResult = { funnel: number; snapshot: number; metrics: number; skipped: number };

/** Every attempt is recorded here — inside the one function both the cron route
 *  and scripts/elise-sync.mts call — rather than at each call site. Two call
 *  sites recording separately is the shape that has burned this repo before (see
 *  the .mts/.mjs duplicate that silently re-synced the old vocabulary), and it
 *  would mean a hand-run recovery did not clear the dashboard banner while the
 *  cron did. On failure the attempt is recorded and the error is RETHROWN, so the
 *  route still answers 500 and Vercel still marks the cron run failed. */
export async function runEliseSync(): Promise<SyncResult> {
  try {
    const { funnel, snapshot, skipped } = await fetchEliseAggregates();
    await upsertEliseFunnel(funnel);
    await replaceElisePipeline(snapshot);

    // Enrichment is additive: if it fails, the funnel/pipeline sync above still
    // counts as a success rather than the whole nightly job erroring out.
    let metrics = 0;
    let enrichSkipped = 0;
    try {
      const enrichment = await fetchEliseEnrichment();
      await upsertEliseMetrics(enrichment.rows);
      metrics = enrichment.rows.length;
      enrichSkipped = enrichment.skipped;
    } catch (e) {
      console.error("[elise-sync] enrichment failed (funnel/pipeline still synced):", e);
    }

    const result = {
      funnel: funnel.length,
      snapshot: snapshot.length,
      metrics,
      skipped: skipped + enrichSkipped,
    };
    await recordEliseSyncAttempt({ ok: true, funnelRows: result.funnel, metricRows: result.metrics });
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await recordEliseSyncAttempt({ ok: false, error: message });
    throw e;
  }
}
