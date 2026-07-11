// src/lib/outreach.ts
// Shared 渡人 (outreach) vocabulary — client-safe (no server imports), used by the workbench
// page, the inbox quick-panel, and the events bridge. 渡人 records the GROWTH of 善缘 — no
// rankings, no chasing language. A person's rung is DERIVED from their milestones, never stored.

// The journey ladder, in order (lowest → highest). deriveRung returns the highest present.
export const MILESTONES = [
  { key: 'first_contact', label: '初次接触', emoji: '🌱' },
  { key: 'attended', label: '参加活动·共修', emoji: '🪷' },
  { key: 'started_chanting', label: '开始念经', emoji: '🙏' },
  { key: 'steady_practice', label: '持续修学', emoji: '📿' },
  { key: 'volunteer', label: '发心义工', emoji: '💛' },
] as const;

export type MilestoneKey = (typeof MILESTONES)[number]['key'];
export const MILESTONE_KEYS = MILESTONES.map((m) => m.key) as MilestoneKey[];

const MILESTONE_INDEX: Record<string, number> = Object.fromEntries(MILESTONES.map((m, i) => [m.key, i]));
export const milestoneMeta = (key: string) => MILESTONES.find((m) => m.key === key);
export const milestoneLabel = (key: string) => milestoneMeta(key)?.label ?? key;

// Highest milestone present in a person's ledger — the current rung. Empty → first_contact
// (every real person has at least made contact; the ledger backfill guarantees a row).
export function deriveRung(milestones: { milestone: string }[]): MilestoneKey {
  let best = 0;
  for (const m of milestones) {
    const idx = MILESTONE_INDEX[m.milestone];
    if (idx != null && idx > best) best = idx;
  }
  return MILESTONE_KEYS[best];
}

// The rungs a person hasn't reached yet (the "big friendly next buttons"), in ladder order.
export function nextMilestones(present: string[]): typeof MILESTONES[number][] {
  const have = new Set(present);
  return MILESTONES.filter((m) => !have.has(m.key));
}

export const SOURCES = [
  { key: 'chat', label: '智慧问答' },
  { key: 'event', label: '活动' },
  { key: 'referral', label: '亲友介绍' },
  { key: 'walkin', label: '自己走进来' },
  { key: 'form', label: '表单' }, // 共修会事务信箱 write-in bridged into 渡人 (E2, migration 031)
] as const;

export type SourceKey = (typeof SOURCES)[number]['key'];
export const SOURCE_KEYS = SOURCES.map((s) => s.key) as SourceKey[];
export const sourceLabel = (key: string | null | undefined) => SOURCES.find((s) => s.key === key)?.label ?? '—';

// Legacy care-module stages that warrant a gray 旧记录 chip on the 渡人卡 (contacts.stage is
// owned by the care module and never written here).
export const LEGACY_STAGE_CHIP = new Set(['学习中', '共修者', '义工']);

// ── E3 stage-vocab unification (brief §4) ────────────────────────────────────
// contacts.stage now stores canonical KEYS aligned with the milestone ladder
// above — one vocabulary for stages and milestones. All WRITES use these keys;
// all READS render through stageLabel, whose raw-value fallback keeps legacy
// Chinese rows ('初次接触' / '学习中' / '共修者' / '义工') displaying correctly
// until the architect's data migration (033) rewrites them.
export const STAGES = MILESTONES.map(({ key, label, emoji }) => ({ key, label, emoji }));
export const STAGE_KEYS = MILESTONE_KEYS;
export type StageKey = MilestoneKey;

export function stageLabel(value: string | null | undefined): string {
  if (!value) return '';
  return milestoneMeta(value)?.label ?? value; // key → label; legacy raw value → itself
}
