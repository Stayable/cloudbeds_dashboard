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

/** Resolve a list, or every ACTIVE property when the caller names none.
 *  Defaulting to active-only keeps a portfolio question from being dragged down
 *  by a property that is not trading. */
export function resolveProperties(input?: string[]): Property[] {
  if (!input || input.length === 0) return PROPERTIES.filter((p) => p.active === true);
  const seen = new Set<string>();
  const out: Property[] = [];
  for (const name of input) {
    const p = resolveProperty(name);
    if (!seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

/** The identity fields a tool may return. Deliberately explicit rather than
 *  spreading the Property: a new internal field on Property must not silently
 *  become part of the public tool output. */
export function propertySummary(p: Property) {
  return { id: p.id, code: p.code, name: p.name, county: p.county, active: p.active };
}
