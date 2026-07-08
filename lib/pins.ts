// PIN store (server-only, Neon). PINs live ONLY in the `dashboard_pins` table —
// Neon is the single source of truth, so users can change their own PIN
// (/api/change-pin) without a redeploy and no env var can shadow the DB value.
// There is NO env-var fallback: if the DB is unreachable or a level has no row,
// that level simply cannot log in (gate stays closed — fail safe, not open).
// Read ONLY at login and in the change-PIN route — never in middleware (the
// cookie is self-verifying).
import { neon } from "@neondatabase/serverless";
import { ALL_LEVELS, type Level } from "@/lib/auth";

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

/** Effective PIN per level, sourced entirely from the Neon `dashboard_pins`
 *  table. DB unreachable / table missing → empty map (no level can log in). */
async function effectivePins(): Promise<Map<Level, string>> {
  const out = new Map<Level, string>();
  try {
    const rows = (await db()`select level, pin from dashboard_pins`) as { level: string; pin: string }[];
    for (const r of rows) if (ALL_LEVELS.includes(r.level as Level) && r.pin) out.set(r.level as Level, r.pin);
  } catch {
    // table missing / DB down → no PINs resolvable; gate stays closed.
  }
  return out;
}

/** The level a submitted PIN unlocks, or null. The home / is gated behind the
 *  `base` PIN (MAIN) — it is no longer public. `base` is checked last so a
 *  more-specific level always wins if PINs were ever set equal. */
export async function findLevelByPin(pin: string): Promise<Level | null> {
  if (!pin) return null;
  const pins = await effectivePins();
  const order: Level[] = ["exec", "crystal", "monica", "bea", "ops", "base"];
  for (const level of order) {
    if (pins.get(level) === pin) return level;
  }
  return null;
}

/** Set (upsert) a level's PIN in the DB. Used by the self-service change-PIN route. */
export async function setPin(level: Level, pin: string): Promise<void> {
  await db()`
    insert into dashboard_pins (level, pin, updated_at)
    values (${level}, ${pin}, now())
    on conflict (level) do update set pin = excluded.pin, updated_at = now()
  `;
}
