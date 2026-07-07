// Orchestrates the nightly EliseAI → Neon sync: pull PII-free aggregates from
// the Snowflake data share, upsert the funnel rollup, replace the pipeline
// snapshot. Server-only. Invoked by /api/cron/elise-sync (and mirrored by the
// standalone scripts/elise-sync.mjs used for the initial backfill).
import { fetchEliseAggregates } from "@/lib/snowflake";
import { upsertEliseFunnel, replaceElisePipeline } from "@/lib/db";

export type SyncResult = { funnel: number; snapshot: number; skipped: number };

export async function runEliseSync(): Promise<SyncResult> {
  const { funnel, snapshot, skipped } = await fetchEliseAggregates();
  await upsertEliseFunnel(funnel);
  await replaceElisePipeline(snapshot);
  return { funnel: funnel.length, snapshot: snapshot.length, skipped };
}
