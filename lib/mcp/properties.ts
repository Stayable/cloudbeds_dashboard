// Turn whatever Rob typed into a property, or an error that tells him why not.
//
// ONE definition of property resolution. The failure mode this prevents is the
// expensive one: "occupancy at Lakeside" silently answering for the whole
// portfolio, or for the wrong property. A confident wrong answer about the
// wrong hotel is worse than an error, because nothing about it looks wrong.

import { PROPERTIES, type Property } from "@/config/properties";
import { McpArgError } from "./types";

const norm = (s: string) => s.trim().toLowerCase();

function validOptions(): string {
  return PROPERTIES.map((p) => `${p.name} (${p.id})`).join(", ");
}

/** Resolve one property by name, short code, or business id. Partial names are
 *  accepted only when they match exactly one property. */
export function resolveProperty(input: string): Property {
  const q = norm(input);
  if (!q) throw new McpArgError(`No property given. Valid properties: ${validOptions()}.`);

  const exact = PROPERTIES.find(
    (p) => norm(p.name) === q || norm(p.code) === q || p.id === q || p.apiPropertyId === q,
  );
  if (exact) return exact;

  const partial = PROPERTIES.filter((p) => norm(p.name).includes(q));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new McpArgError(
      `"${input}" matches more than one property: ${partial.map((p) => p.name).join(", ")}. ` +
        `Ask again with the full name.`,
    );
  }
  throw new McpArgError(`"${input}" is not a Stayable property. Valid properties: ${validOptions()}.`);
}

/** Resolve a list, or the default portfolio when the caller names none.
 *
 *  `active` is typed `boolean | "unconfirmed"` because that third state really
 *  happens. If a property is ever sitting in it, a no-argument portfolio
 *  question would otherwise return fewer than all eight hotels with nothing in
 *  the result saying so — a confident answer over a narrower scope than was
 *  asked, the same failure this module exists to prevent, just moved from name
 *  resolution to the default set. So the default branch returns `excluded`
 *  alongside `properties`: whatever didn't make the active set, named, so the
 *  caller can say so out loud instead of the gap being silent.
 *
 *  When the caller names properties explicitly, they asked for exactly those,
 *  so nothing was dropped on their behalf and `excluded` is always empty.
 *
 *  `source` defaults to the real `PROPERTIES` list; it exists so a test can
 *  point this at a fixture and prove the filter actually does something,
 *  rather than relying on the fact that all 8 real properties currently
 *  happen to be `active: true`. */
export function resolveProperties(
  input?: string[],
  source: Property[] = PROPERTIES,
): { properties: Property[]; excluded: Property[] } {
  if (!input || input.length === 0) {
    return {
      properties: source.filter((p) => p.active === true),
      excluded: source.filter((p) => p.active !== true),
    };
  }
  const seen = new Set<string>();
  const out: Property[] = [];
  for (const name of input) {
    const p = resolveProperty(name);
    if (!seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return { properties: out, excluded: [] };
}

/** The identity fields a tool may return. Deliberately explicit rather than
 *  spreading the Property: a new internal field on Property must not silently
 *  become part of the public tool output.
 *
 *  Final review, Critical 2: `excludeFromAggregate`, `capacityAdjustment` and
 *  `adjustmentNote` were added so a model computing its OWN portfolio figure
 *  (e.g. from get_occupancy's per-property `rows`) can see the exclusion rule
 *  the dashboard applies — without them it was invisible, and the model was as
 *  likely to include Jacksonville North as not. Tools that already compute a
 *  `portfolio` total apply the rule themselves (AGGREGATE_EXCLUDED_CODES in
 *  tools-occupancy.ts); these fields exist for the case where the model
 *  reasons over `rows` directly instead.
 *
 *  `capacityAdjustment` is exposed for DISCLOSURE, not for arithmetic, and the
 *  distinction is load-bearing. The dashboard deliberately does NOT re-base
 *  occupancy onto post-adjustment capacity — see the rule in lib/occupancy.ts
 *  `displayOcc`. Kissimmee East's −20 is an interpretation, not a measurement,
 *  so it belongs in its own labelled line ("% Occupied Adjusted (less 20 rms)")
 *  and never folded into a headline compared against other properties. Doing it
 *  the other way is how KE once read 83.0% on /ops and 73.7% on /report for the
 *  same period, from three separately-maintained copies of the same idea.
 *  A model that applies this field to the ratio would recreate that bug. */
export function propertySummary(p: Property) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    county: p.county,
    active: p.active,
    excludeFromAggregate: p.excludeFromAggregate === true,
    capacityAdjustment: p.capacityAdjustment ?? null,
    adjustmentNote: p.adjustmentNote ?? null,
  };
}
