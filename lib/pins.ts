// PIN store (server-only, Neon). PINs live in the `dashboard_pins` table so they
// can be changed without a redeploy; each level falls back to its env var
// (ENV_PIN_FOR) when no DB row exists, for migration. Read ONLY at login and in
// the change-PIN route — never in middleware (the cookie is self-verifying).
import { neon } from "@neondatabase/serverless";
import { ALL_LEVELS, ENV_PIN_FOR, type Level } from "@/lib/auth";

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return neon(url);
}

/** Effective PIN per level: DB row if present, else the env-var fallback. */
async function effectivePins(): Promise<Map<Level, string>> {
  const out = new Map<Level, string>();
  // env fallbacks first
  for (const level of ALL_LEVELS) {
    const envPin = process.env[ENV_PIN_FOR[level]];
    if (envPin) out.set(level, envPin);
  }
  // DB overrides
  try {
    const rows = (await db()`select level, pin from dashboard_pins`) as { level: string; pin: string }[];
    for (const r of rows) if (ALL_LEVELS.includes(r.level as Level) && r.pin) out.set(r.level as Level, r.pin);
  } catch {
    // table missing / DB down → env fallbacks only
  }
  return out;
}

/** The level a submitted PIN unlocks, or null. Exec wins, then user levels, then
 *  base — so a shared base PIN never shadows a more-specific one. */
export async function findLevelByPin(pin: string): Promise<Level | null> {
  if (!pin) return null;
  const pins = await effectivePins();
  const order: Level[] = ["exec", "crystal", "monica", "bea", "base"];
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
