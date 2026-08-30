// scripts/backfill-unanswered.ts
// Backfill for the 508 unanswered conversations (brief "别再把访客弄丢" §5).
//
//   npx tsx scripts/backfill-unanswered.ts            → report only (counts + ids)
//   npx tsx scripts/backfill-unanswered.ts --apply    → do it:
//     · last user message within 48 h  → failed_replies row (queued,
//       error_kind 'backfill') so the dead-letter worker answers it
//       normally (needs the architect-created failed_replies table)
//     · older                          → conversation status needs_human +
//       audit care.handed_off (a human decides; no surprise AI reply to a
//       question from two weeks ago)
// Idempotent: conversations that already have an open queue row or are
// already needs_human / volunteer_handling are left alone.
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const WINDOW_DAYS = 30;
const AUTO_HOURS = 48;

async function main() {
  const apply = process.argv.includes('--apply');
  const { supabaseAdmin } = await import('../src/lib/supabase');
  const { writeAudit } = await import('../src/lib/audit');
  if (!supabaseAdmin) throw new Error('SUPABASE env missing in .env.local');
  const db = supabaseAdmin;

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const { data: convs, error } = await db
    .from('conversations')
    .select('id, status, channel, created_at, messages ( role, created_at )')
    .gte('created_at', since);
  if (error) throw error;

  type Row = { id: string; status: string; channel: string; created_at: string; messages: { role: string; created_at: string }[] | null };
  const cutoff = Date.now() - AUTO_HOURS * 3_600_000;
  const auto: Row[] = [];
  const manual: Row[] = [];
  for (const c of (convs ?? []) as Row[]) {
    const msgs = c.messages ?? [];
    const hasUser = msgs.some((m) => m.role === 'user');
    const hasReply = msgs.some((m) => m.role === 'assistant' || m.role === 'volunteer');
    if (!hasUser || hasReply) continue;
    const lastUser = Math.max(...msgs.filter((m) => m.role === 'user').map((m) => new Date(m.created_at).getTime()));
    (lastUser >= cutoff ? auto : manual).push(c);
  }
  console.log(`unanswered in ${WINDOW_DAYS}d: ${auto.length + manual.length} — auto-retry (≤${AUTO_HOURS}h): ${auto.length}, hand to 关怀组 (older): ${manual.length}`);
  if (!apply) {
    console.log('auto ids:', auto.map((c) => c.id.slice(0, 8)).join(' '));
    console.log('(dry run — pass --apply to enqueue / hand off)');
    return;
  }

  let queued = 0;
  let queueSkipped = 0;
  let tableMissing = false;
  for (const c of auto) {
    if (c.status === 'volunteer_handling') { queueSkipped++; continue; }
    const { data: open, error: selErr } = await db
      .from('failed_replies').select('id').eq('conversation_id', c.id).in('status', ['queued', 'retrying']).limit(1);
    if (selErr) {
      if (selErr.code === '42P01' || /failed_replies/.test(selErr.message)) { tableMissing = true; break; }
      throw selErr;
    }
    if (open && open.length > 0) { queueSkipped++; continue; }
    const { error: insErr } = await db.from('failed_replies').insert({
      conversation_id: c.id, error_kind: 'backfill', error_detail: 'unanswered within 48h (backfill 2026-08-30)',
      attempts: 0, status: 'queued', last_attempt_at: new Date(Date.now() - 120_000).toISOString(), // due now
    });
    if (insErr) throw insErr;
    queued++;
  }

  let handed = 0;
  let handSkipped = 0;
  for (const c of manual) {
    if (c.status === 'needs_human' || c.status === 'volunteer_handling') { handSkipped++; continue; }
    const { error: updErr } = await db.from('conversations').update({ status: 'needs_human' }).eq('id', c.id);
    if (updErr) throw updErr;
    await writeAudit({
      actorId: null, actorEmail: null, module: 'care', action: 'care.handed_off',
      tableName: 'conversations', recordId: c.id,
      after: { reason: `unanswered >${AUTO_HOURS}h at backfill 2026-08-30`, previousStatus: c.status },
    });
    handed++;
  }

  console.log(`queued for auto-retry: ${queued} (skipped ${queueSkipped})${tableMissing ? ' — STOPPED: failed_replies table missing; re-run after it exists' : ''}`);
  console.log(`handed to 关怀组 (needs_human): ${handed} (skipped ${handSkipped})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
