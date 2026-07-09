// src/lib/finance.ts
// Server-side helpers for the 财务 (Phase D) routes:
//   • financeScope / enforceScope — the CENTRE-SCOPE WALL. RLS covers logged-in reads, but the
//     Phase D routes run as service-role (bypassing RLS), so this server-side check is the REAL
//     wall: an own_center 财政 is forced to their own centre and 400s on any other centre_id.
//   • nextReceiptNo — mint the next per-centre receipt number (sequential book, zero-padded).
//   • month helpers — '2026-09' ↔ first-of-month date, and range validity.

import type { SupabaseClient } from '@supabase/supabase-js';

export type FinanceScope = { centreId: string | null; locked: boolean };

// Roles that are platform-wide finance regardless of the per-volunteer scope column.
const ALL_CENTRE_ROLES = new Set(['admin', 'erp_admin', 'finance_director']);

// Resolve the caller's finance centre scope from volunteers.scope + centre_id (service-role read).
// own_center (and not an all-centre role) → locked to that centre; else unlocked (all centres).
export async function financeScope(db: SupabaseClient, volunteerId: string): Promise<FinanceScope> {
  const { data } = await db.from('volunteers').select('scope, centre_id, role').eq('id', volunteerId).maybeSingle();
  const scope = (data?.scope as string | undefined) ?? 'own_center';
  const role = (data?.role as string | undefined) ?? 'volunteer';
  const allCentres = scope === 'all_centers' || ALL_CENTRE_ROLES.has(role);
  if (allCentres) return { centreId: null, locked: false };
  return { centreId: (data?.centre_id as string | null) ?? null, locked: true };
}

// Force the effective centre for a request. When locked, the request's centre MUST be the
// caller's own centre (or omitted → filled in). Unlocked callers keep whatever they asked for
// (possibly null = all centres, for read routes that allow it).
export function enforceScope(
  scope: FinanceScope,
  requested: string | null
): { ok: true; centreId: string | null } | { ok: false; error: string } {
  if (scope.locked) {
    if (!scope.centreId) return { ok: false, error: '账号未绑定中心，无法访问财务数据' };
    if (requested && requested !== scope.centreId) return { ok: false, error: '无权访问该中心的财务数据' };
    return { ok: true, centreId: scope.centreId };
  }
  return { ok: true, centreId: requested };
}

// Mint the next receipt number for a centre's book: max numeric part + 1, zero-padded to the
// width of the current highest number. Empty book → '0000001' (width 7). The book can hold
// hand-edited legacy numbers, so we scan the digits of each and track the widest current max.
export async function nextReceiptNo(db: SupabaseClient, centreId: string): Promise<string> {
  // NO void filter — a receipt number is consumed forever (voided or not), and the unique
  // constraint is over ALL rows. Suggesting a voided number would clash, so scan every row.
  const { data } = await db.from('fee_payments').select('receipt_no').eq('centre_id', centreId);
  const rows = data ?? [];
  if (rows.length === 0) return '0000001';
  let maxNum = 0;
  let width = 7;
  for (const r of rows as { receipt_no: string }[]) {
    const m = String(r.receipt_no).match(/(\d+)/);
    if (!m) continue;
    const num = parseInt(m[1], 10);
    if (num >= maxNum) {
      maxNum = num;
      width = Math.max(m[1].length, 4);
    }
  }
  return String(maxNum + 1).padStart(width, '0');
}

// '2026-09' → '2026-09-01' (first-of-month date string), or null if malformed.
export function monthInputToDate(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}$/.test(v)) return null;
  const mo = Number(v.slice(5, 7));
  if (mo < 1 || mo > 12) return null;
  return `${v}-01`;
}

// '2026-09-01' → '2026-09' for the UI's <input type="month">.
export function dateToMonthInput(d: string): string {
  return d.slice(0, 7);
}

// A first-of-month range is valid when to >= from (both already 'YYYY-MM-01').
export function monthRangeValid(from: string, to: string): boolean {
  return to >= from;
}

export const FEE_CHANNELS = ['cash', 'bank_transfer', 'to_hq'] as const;
export const EXPENSE_CATEGORIES = ['rent', 'utilities', 'maintenance', 'activity', 'misc'] as const;
