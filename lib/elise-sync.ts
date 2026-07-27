// Orchestrates the nightly EliseAI → Neon sync: pull PII-free aggregates from
// the Snowflake data share, upsert the funnel rollup, replace the pipeline
// snapshot, upsert the enrichment metrics. Server-only. Invoked by
// /api/cron/elise-sync (and mirrored by the standalone scripts/elise-sync.mjs
// used for the initial backfill).
import { fetchEliseAggregates, fetchEliseEnrichment } from "@/lib/snowflake";
import { upsertEliseFunnel, replaceElisePipeline, upsertEliseMetrics } from "@/lib/db";

export type SyncResult = { funnel: number; snapshot: number; metrics: number; skipped: number };

export async function runEliseSync(): Promise<SyncResult> {
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

  return { funnel: funnel.length, snapshot: snapshot.length, metrics, skipped: skipped + enrichSkipped };
}
