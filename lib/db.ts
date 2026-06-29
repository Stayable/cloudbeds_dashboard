// Server-only Neon Postgres client (CLAUDE.md §6 reversal — sanctioned for
// persisting /test submissions and exec feedback). Never import from a client
// component. One table `submissions` (see scripts/db-init.mjs).
import { neon } from "@neondatabase/serverless";

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
