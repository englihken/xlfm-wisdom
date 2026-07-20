// src/lib/audit.ts
// Append-only audit trail writer for ERP mutations (audit_log, migrations/014).
// Called by EVERY members mutation route. Fire-and-forget SAFE: the audit is a
// trail, not a gate — an audit failure must be logged LOUDLY (console.error) but
// must NEVER throw or fail the user's mutation. writeAudit therefore swallows all
// errors after logging them.

import { supabaseAdmin } from './supabase';

export type AuditAction =
  | 'create'
  | 'update'
  | 'deactivate'
  | 'reactivate'
  | 'import'
  // 渡人 (outreach) — precise event names; audit_log.action is free text.
  | 'outreach.person_create'
  | 'outreach.person_update'
  | 'outreach.milestone_record'
  | 'outreach.milestone_update'
  | 'outreach.milestone_delete'
  | 'outreach.notify_opt_in_changed'
  // 共修会事务信箱 (E2 inbox) — module='inbox' unless noted (centres → module='settings').
  | 'thread_created'
  | 'replied'
  | 'note_added'
  | 'status_changed'
  | 'assigned'
  | 'transferred'
  | 'break_glass_view'
  | 'mailbox_updated'
  | 'owner_added'
  | 'owner_removed'
  | 'template_created'
  | 'template_updated'
  | 'template_deleted'
  | 'settings_updated'
  | 'centre_created'
  | 'centre_updated'
  // public self-service (status page v2) — actor is the registrant (actor_id null).
  | 'reg.self_update'
  // 活动签到 (event check-in) — precise names following the reg.* precedent. The
  // undo is NOT 'deactivate': it voids one attendance row, it does not retire a
  // record, and the trail should say which of the two happened at a door.
  | 'reg.check_in'
  | 'reg.check_in_void'
  // 活动收款 (event payment collection). fee_assign is a BATCH action recorded once
  // per run against the event id, not once per registration — 918 rows of noise
  // would bury the signal it exists to carry.
  | 'reg.fee_assign'
  | 'reg.pay_verify'
  | 'reg.pay_cash'
  | 'reg.pay_reconcile'
  | 'event.cash_close'
  | 'event.cash_banked'
  // 关怀 (care) conversation mutations + credential rotation (security audit M3).
  | 'care.takeover'
  | 'care.reply'
  | 'care.handback'
  | 'care.contact_update'
  | 'password_changed';

export async function writeAudit(entry: {
  actorId: string | null;
  actorEmail: string | null;
  module: string;
  action: AuditAction;
  tableName: string;
  recordId: string;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  if (!supabaseAdmin) {
    console.error(
      '[audit] supabaseAdmin unavailable — audit NOT written:',
      entry.module,
      entry.action,
      entry.tableName,
      entry.recordId
    );
    return;
  }

  try {
    const { error } = await supabaseAdmin.from('audit_log').insert({
      actor_id: entry.actorId,
      actor_email: entry.actorEmail,
      module: entry.module,
      action: entry.action,
      table_name: entry.tableName,
      record_id: entry.recordId,
      before: entry.before ?? null,
      after: entry.after ?? null,
    });
    if (error) {
      console.error(
        '[audit] insert FAILED (mutation still succeeded):',
        error,
        entry.module,
        entry.action,
        entry.tableName,
        entry.recordId
      );
    }
  } catch (e) {
    // Never let an audit problem surface to the user's request.
    console.error('[audit] insert THREW (mutation still succeeded):', e);
  }
}
