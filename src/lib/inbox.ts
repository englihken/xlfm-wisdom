// src/lib/inbox.ts
// Shared 共修会事务信箱 (E2 inbox) vocabulary — client-safe (no server imports), used by
// the 收件箱 module page, settings sections, the public form, and the home cockpit.
// Governance (E2 brief §1): escalation is computed on READ (no cron); crisis is an
// open, immediate national escalation. This module holds the pure helpers both tiers share.

export type ThreadStatus = 'new' | 'in_progress' | 'replied' | 'archived';
export type ThreadKind = 'form' | 'internal';
export type MessageDirection = 'inbound' | 'outbound' | 'note';

export const STATUS_META: Record<ThreadStatus, { label: string; chip: string }> = {
  // chip class names map to the app's pill utilities / inline tokens (globals.css).
  new: { label: '未处理', chip: 'bg-[#EAF1FA] text-[#2E5A8A] border border-[#CBDDF0]' }, // sky
  in_progress: { label: '处理中', chip: 'bg-[#E7F0E0] text-[#3F6B2E] border border-[#CFE3C0]' }, // jade
  replied: { label: '已回复', chip: 'pill-muted' },
  archived: { label: '已归档', chip: 'pill-muted' },
};

export const STATUS_KEYS: ThreadStatus[] = ['new', 'in_progress', 'replied', 'archived'];
export const statusLabel = (s: string): string => STATUS_META[s as ThreadStatus]?.label ?? s;

export const KIND_LABEL: Record<ThreadKind, string> = {
  form: '公开表单',
  internal: '内部往来',
};
export const kindLabel = (k: string): string => KIND_LABEL[k as ThreadKind] ?? k;

// Default escalation thresholds — the live values come from org_settings
// key='inbox.escalation' and override these.
export type Escalation = { remind_centre_days: number; surface_hq_days: number };
export const DEFAULT_ESCALATION: Escalation = { remind_centre_days: 7, surface_hq_days: 14 };

// Whole days between an ISO timestamp and now (server passes last_message_at / created_at).
export function ageDays(iso: string | null | undefined, nowMs: number): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000));
}

// Escalation state of an UNHANDLED thread (status new/in_progress). 'surface' = HQ-visible
// (subject + age only), 'remind' = owner-side highlight, null = within SLA. Handled threads
// (replied/archived) never escalate.
export type Overdue = 'remind' | 'surface' | null;
export function overdueLevel(
  status: string,
  ageInDays: number,
  esc: Escalation
): Overdue {
  if (status === 'replied' || status === 'archived') return null;
  if (ageInDays > esc.surface_hq_days) return 'surface';
  if (ageInDays > esc.remind_centre_days) return 'remind';
  return null;
}

// Case-insensitive substring crisis scan over subject+body against the keyword list.
export function scanCrisis(text: string, keywords: string[]): boolean {
  const hay = (text || '').toLowerCase();
  return keywords.some((k) => k && hay.includes(k.toLowerCase()));
}

// First N chars of a message body, collapsed to one line — the list snippet.
export function snippet(body: string | null | undefined, n = 80): string {
  const s = (body ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// Deep-link a linked_module/record chip to its module route. Plain route mapping only —
// no new integrations (E2 brief §5.1). Returns null when we can't map it.
export function linkedHref(module: string | null, recordId: string | null): string | null {
  if (!module || !recordId) return null;
  switch (module) {
    case 'inventory':
      return `/dashboard/inventory/requests?open=${recordId}`;
    case 'finance':
      return `/dashboard/finance/receipts?open=${recordId}`;
    case 'events':
      return `/dashboard/events/${recordId}`;
    case 'members':
      return `/dashboard/members?open=${recordId}`;
    default:
      return null;
  }
}
