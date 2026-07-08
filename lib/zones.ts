// Pure room → zone assignment. No I/O — unit-tested (lib/__tests__/zones.test.ts).
// Zone definitions live in config/zones.ts (transcribed from ROOM-ZONING.md).

export type Parity = "odd" | "even";
/** Inclusive [lo, hi]; optional parity restricts to odd/even room numbers. */
export type Range = { lo: number; hi: number; parity?: Parity };
export type Zone = { name: string; ranges: Range[] };

/** A room as surfaced to the zone view: inventory identity + status overlays. */
export type ZonedRoom = { name: string; type: string; ooo: boolean; occupied: boolean; reason?: string };
/** Rooms grouped under one zone, plus its occupied / out-of-service counts. */
export type ZoneGroup = { zone: string; rooms: ZonedRoom[]; occupiedCount: number; oooCount: number };

/** Leading integer of a room code ("133" → 133, "1103" → 1103); null if none. */
export function parseRoomNumber(name: string): number | null {
  const m = name.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/** Does a room number fall inside a range (honoring an optional parity filter)? */
export function inRange(num: number, r: Range): boolean {
  if (num < r.lo || num > r.hi) return false;
  if (r.parity === "odd" && num % 2 === 0) return false;
  if (r.parity === "even" && num % 2 !== 0) return false;
  return true;
}

/** The zone name a room belongs to, or null if it matches no range ("Other"). */
export function zoneForRoom(name: string, zones: Zone[]): string | null {
  const num = parseRoomNumber(name);
  if (num === null) return null;
  for (const z of zones) if (z.ranges.some((r) => inRange(num, r))) return z.name;
  return null;
}

/** Numeric-aware room-code sort ("2" before "10", "133" before "201"). */
function byRoom(a: ZonedRoom, b: ZonedRoom): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true });
}

/** Group a property's rooms into its configured zones. Zones always appear in
 *  config order (even if empty); unmatched rooms collect in a trailing "Other"
 *  bucket (only when non-empty). Rooms are sorted numerically within each zone. */
export function buildZoneGroups(rooms: ZonedRoom[], zones: Zone[]): ZoneGroup[] {
  const buckets = new Map<string, ZonedRoom[]>();
  for (const z of zones) buckets.set(z.name, []);
  const other: ZonedRoom[] = [];

  for (const room of rooms) {
    const zn = zoneForRoom(room.name, zones);
    if (zn) buckets.get(zn)!.push(room);
    else other.push(room);
  }

  const toGroup = (zone: string, list: ZonedRoom[]): ZoneGroup => {
    const rs = [...list].sort(byRoom);
    return {
      zone,
      rooms: rs,
      occupiedCount: rs.filter((r) => r.occupied && !r.ooo).length,
      oooCount: rs.filter((r) => r.ooo).length,
    };
  };
  const groups: ZoneGroup[] = zones.map((z) => toGroup(z.name, buckets.get(z.name)!));
  if (other.length) groups.push(toGroup("Other", other));
  return groups;
}
