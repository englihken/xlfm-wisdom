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
  | 'outreach.milestone_delete';

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
