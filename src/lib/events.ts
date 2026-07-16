// src/lib/events.ts
// Shared server-side helpers for the events routes: enums, fee/need validation,
// the status-transition matrix, and code helpers. Kept out of the route files so
// create (POST) and update (PATCH) share exactly the same rules.

export const EVENT_TYPES = ['fahui', 'gongxiu', 'foxueban', 'fangsheng', 'xingquban', 'other'] as const;
export const FEE_ITEMS = ['registration', 'meal', 'accommodation', 'transfer', 'uniform', 'other'] as const;
export const BILLINGS = ['per_person', 'per_day', 'per_night', 'per_item'] as const;
export const EVENT_STATUSES = ['draft', 'open', 'full', 'closed', 'completed'] as const;

// Billing must match the item's nature (016 design). meal may bill per_day (legacy —
// qty = selections.meal_days) OR per_item (每餐 — qty = selections.meals.length); C0.
export const BILLING_BY_ITEM: Record<string, readonly string[]> = {
  registration: ['per_person'],
  transfer: ['per_person'],
  meal: ['per_day', 'per_item'],
  accommodation: ['per_night'],
  uniform: ['per_item'],
  other: ['per_person', 'per_day', 'per_night', 'per_item'],
};

// The three meal slots, in serving order (used for the offering grid + kitchen stats).
export const MEALS = ['breakfast', 'lunch', 'dinner'] as const;
export type Meal = (typeof MEALS)[number];

// A selections.meals key: 'YYYY-MM-DD:breakfast' | ':lunch' | ':dinner'.
export function mealSlotKey(date: string, meal: string): string {
  return `${date}:${meal}`;
}

// 'YYYY-MM-DD' shifted by n days (UTC-anchored). Used for the selections-edit cutoff.
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Today in Malaysia time (YYYY-MM-DD) — the timezone every cutoff rule anchors to.
export function todayMYT(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}

// THE selections-edit cutoff rule (single home — staff PATCH and the public
// self-edit route both call this): edits are open while today (MYT) is strictly
// BEFORE starts_on − cutoffDays. With starts_on 2026-08-13 and cutoff 7, the last
// editable day is 2026-08-05; edits are locked ON 2026-08-06.
export function regEditOpen(startsOn: string, cutoffDays: number, today: string): boolean {
  return today < addDays(startsOn, -(Number(cutoffDays) || 0));
}

// Enumerate every date in [startsOn, endsOn] inclusive (endsOn null = single day).
// UTC-anchored so DST/local offsets never shift a day. Bounded to a sane span.
export function datesInRange(startsOn: string, endsOn: string | null): string[] {
  if (!isValidDate(startsOn)) return [];
  const end = endsOn && isValidDate(endsOn) && endsOn >= startsOn ? endsOn : startsOn;
  const out: string[] = [];
  const cur = new Date(`${startsOn}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  for (let guard = 0; guard < 366 && cur.getTime() <= last.getTime(); guard++) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

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
