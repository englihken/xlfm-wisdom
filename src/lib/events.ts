// src/lib/events.ts
// Shared server-side helpers for the events routes: enums, fee/need validation,
// the status-transition matrix, and code helpers. Kept out of the route files so
// create (POST) and update (PATCH) share exactly the same rules.

export const EVENT_TYPES = ['fahui', 'gongxiu', 'foxueban', 'fangsheng', 'xingquban', 'other'] as const;
export const FEE_ITEMS = ['registration', 'meal', 'accommodation', 'transfer', 'uniform', 'other'] as const;
export const BILLINGS = ['per_person', 'per_day', 'per_night', 'per_item'] as const;
export const EVENT_STATUSES = ['draft', 'open', 'full', 'closed', 'completed'] as const;

// Billing must match the item's nature (016 design).
export const BILLING_BY_ITEM: Record<string, readonly string[]> = {
  registration: ['per_person'],
  transfer: ['per_person'],
  meal: ['per_day'],
  accommodation: ['per_night'],
  uniform: ['per_item'],
  other: ['per_person', 'per_day', 'per_night', 'per_item'],
};

// Allowed status transitions (the /status route enforces this exactly).
export const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['open'],
  open: ['full', 'closed', 'completed'],
  full: ['open', 'completed'],
  closed: ['completed'],
  completed: [],
};

// 'YYYY-MM-DD' → 'YYMM' (e.g. 2026-08-15 → 2608). Used for the XLFM-YYMM code.
export function yymm(dateStr: string): string {
  const [y, m] = dateStr.split('-');
  return `${(y ?? '').slice(2)}${m ?? ''}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isValidDate(s: unknown): s is string {
  return typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(new Date(s).getTime());
}

export type NormalizedFee = {
  item: string;
  label_cn: string | null;
  amount: number;
  billing: string;
  sort: number;
};

// Validate a fees[] payload → normalized rows (unique items, valid billing, amount>=0).
export function validateFees(raw: unknown): { fees: NormalizedFee[] } | { error: string } {
  if (raw === undefined || raw === null) return { fees: [] };
  if (!Array.isArray(raw)) return { error: 'fees 必须是数组' };
  const seen = new Set<string>();
  const fees: NormalizedFee[] = [];
  for (let i = 0; i < raw.length; i++) {
    const f = (raw[i] ?? {}) as Record<string, unknown>;
    const item = typeof f.item === 'string' ? f.item : '';
    if (!(FEE_ITEMS as readonly string[]).includes(item)) return { error: `收费项目无效：${item || '(空)'}` };
    if (seen.has(item)) return { error: `收费项目重复：${item}` };
    seen.add(item);
    const billing = typeof f.billing === 'string' ? f.billing : '';
    if (!(BILLING_BY_ITEM[item] ?? []).includes(billing)) {
      return { error: `${item} 的计费方式无效：${billing || '(空)'}` };
    }
    const amount = Number(f.amount);
    if (!Number.isFinite(amount) || amount < 0) return { error: `${item} 的金额无效` };
    const label_cn = typeof f.label_cn === 'string' && f.label_cn.trim() ? f.label_cn.trim() : null;
    const sort = Number.isFinite(Number(f.sort)) ? Math.trunc(Number(f.sort)) : i;
    fees.push({ item, label_cn, amount, billing, sort });
  }
  return { fees };
}

export type NormalizedNeed = { team_id: string; needed: number };

// Validate a team_needs[] payload → normalized rows (unique teams, needed>0). Team
// existence is checked in the route (needs the DB).
export function validateNeeds(raw: unknown): { needs: NormalizedNeed[] } | { error: string } {
  if (raw === undefined || raw === null) return { needs: [] };
  if (!Array.isArray(raw)) return { error: 'team_needs 必须是数组' };
  const seen = new Set<string>();
  const needs: NormalizedNeed[] = [];
  for (const n of raw as Record<string, unknown>[]) {
    const team_id = typeof n.team_id === 'string' ? n.team_id : '';
    if (!team_id) return { error: 'team_needs 缺少 team_id' };
    if (seen.has(team_id)) return { error: '组别需求重复' };
    seen.add(team_id);
    const needed = Number(n.needed);
    if (!Number.isInteger(needed) || needed <= 0) return { error: '需求人数必须大于 0' };
    needs.push({ team_id, needed });
  }
  return { needs };
}
