// src/lib/stay.ts
// THE single home for reading a registration's accommodation ("stay") data.
//
// Two namespaces can carry stay fields inside registrations.selections:
//   • selections.import813 — the IMMUTABLE bulk-import snapshot (never mutated)
//   • selections.stay      — live values written by public self-edits (status page v2)
// Every reader (public status page, dashboard registration detail, rosters/exports)
// must prefer stay ?? import813 PER FIELD via resolveStay below — never read the
// namespaces directly. room_assign (同房 R-codes) is centrally planned: it lives only
// in import813 and is never publicly editable.
//
// Pure module — safe for client components and server routes alike.

export type StayInfo = {
  needs_accommodation: boolean | null;
  room_type: string | null;
  room_assign: string | null; // READ-ONLY everywhere (import813 only)
  check_in: string | null;    // 'YYYY-MM-DD'
  check_out: string | null;   // 'YYYY-MM-DD'
};

// Room-type vocabulary observed in the 813 import; the public editor offers these.
export const STAY_ROOM_TYPES = ['Twin', 'King', 'EB', 'Dorm 4', 'Dorm 8'] as const;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const boolOrNull = (v: unknown): boolean | null => (v === true ? true : v === false ? false : null);

// stay[field] ?? import813[field], field by field. Always returns the object — an
// all-null result simply means no stay data exists yet (the editor seeds from it).
export function resolveStay(selections: unknown): StayInfo {
  const s = (selections ?? {}) as Record<string, unknown>;
  const imp = (s.import813 ?? {}) as Record<string, unknown>;
  const stay = (s.stay && typeof s.stay === 'object' ? s.stay : {}) as Record<string, unknown>;
  const pick = <T,>(key: string, coerce: (v: unknown) => T): T =>
    key in stay ? coerce(stay[key]) : coerce(imp[key]);
  return {
    needs_accommodation: pick('needs_accommodation', boolOrNull),
    room_type: pick('room_type', str),
    room_assign: str(imp.room_assign), // never from stay — centrally planned
    check_in: pick('check_in', str),
    check_out: pick('check_out', str),
  };
}

// Whole nights between two 'YYYY-MM-DD' dates (check_out − check_in); null when
// either date is missing or the order is invalid.
export function stayNights(checkIn: string | null, checkOut: string | null): number | null {
  if (!checkIn || !checkOut) return null;
  const n = (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400000;
  return Number.isInteger(n) && n > 0 ? n : null;
}
