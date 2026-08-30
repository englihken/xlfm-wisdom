// src/lib/ops-alerts.ts
// "别再把访客弄丢" (brief 2026-08-30): the reply pipeline must never fail
// silently. Over 30 days 508/1,128 conversations (45%) got no reply at all —
// three whole days (08-26..28, 116 visitors) went dark because the Anthropic
// balance ran out and nobody was told.
//
// This module is the observability + alerting half:
//   - classifyAnthropicError(): quota / rate_limit / timeout / other
//   - recordReplyFailure(): audit_log row (module=care, action=care.reply_failed)
//     + failed_replies queue row (see reply-recovery.ts) + burst alert check
//   - maybeAlertFailureBurst(): ≥3 failures in 10 min → email Ken at once
//     (30-min cooldown), with the failure-type breakdown
//   - checkAnthropicHealth(): daily canary + (with an Admin key) cost-report
//     based remaining-credit estimate; emails below the threshold
//   - sendOpsEmail(): the existing Resend channel (same env as the review cron)
//
// No new tables: failures are counted from audit_log, which already exists;
// the failed_replies queue (architect-created) is used when present.

import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from './supabase';
import { writeAudit } from './audit';

export type ReplyErrorKind = 'quota' | 'rate_limit' | 'timeout' | 'other';

export function classifyAnthropicError(e: unknown): { kind: ReplyErrorKind; detail: string } {
  const clip = (s: string) => s.replace(/\s+/g, ' ').slice(0, 300);
  if (e instanceof Anthropic.APIConnectionTimeoutError) return { kind: 'timeout', detail: clip(e.message) };
  if (e instanceof Anthropic.RateLimitError) return { kind: 'rate_limit', detail: clip(e.message) };
  if (e instanceof Anthropic.APIError) {
    const msg = e.message ?? '';
    // Exhausted balance is a 400 invalid_request_error with this message.
    if (/credit balance|insufficient.*credit|billing/i.test(msg) || e.status === 402) {
      return { kind: 'quota', detail: clip(msg) };
    }
    if (e.status === 429 || e.status === 529) return { kind: 'rate_limit', detail: clip(`HTTP ${e.status}: ${msg}`) };
    if (e.status === 408 || e.status === 504) return { kind: 'timeout', detail: clip(`HTTP ${e.status}: ${msg}`) };
    return { kind: 'other', detail: clip(`HTTP ${e.status ?? '?'}: ${msg}`) };
  }
  if (e instanceof Anthropic.APIConnectionError) return { kind: 'timeout', detail: clip(e.message) };
  const msg = e instanceof Error ? e.message : String(e);
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|aborted/i.test(msg)) return { kind: 'timeout', detail: clip(msg) };
  return { kind: 'other', detail: clip(msg) };
}

// ── Email (Resend — the channel the review cron already uses) ─────────────────

export async function sendOpsEmail(subject: string, text: string): Promise<'sent' | 'skipped' | 'failed'> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.OPS_ALERT_EMAIL_TO ?? process.env.REVIEW_ALERT_EMAIL_TO;
  if (!key || !to) {
    console.error(`[ops-alerts] email NOT sent (RESEND_API_KEY / REVIEW_ALERT_EMAIL_TO unset): ${subject}`);
    return 'skipped';
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.REVIEW_ALERT_EMAIL_FROM ?? 'xlfm-wisdom <onboarding@resend.dev>',
        to: to.split(',').map((s) => s.trim()),
        subject,
        text,
      }),
    });
    if (!res.ok) console.error(`[ops-alerts] Resend ${res.status}: ${await res.text()}`);
    return res.ok ? 'sent' : 'failed';
  } catch (e) {
    console.error('[ops-alerts] Resend threw:', e);
    return 'failed';
  }
}

// ── Failure recording + burst alert ───────────────────────────────────────────

export const FAILURE_BURST_THRESHOLD = 3;
export const FAILURE_BURST_WINDOW_MS = 10 * 60 * 1000;
export const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

const KIND_CN: Record<ReplyErrorKind, string> = {
  quota: '额度（余额用完）',
  rate_limit: '限流',
  timeout: '超时',
  other: '其他',
};

// Insert (or refresh) the dead-letter row. Tolerates the table not existing
// yet (the architect creates failed_replies) — logs once and moves on.
let failedRepliesTableMissing = false;
export async function enqueueFailedReply(params: {
  conversationId: string;
  kind: ReplyErrorKind;
  detail: string;
}): Promise<boolean> {
  if (!supabaseAdmin || failedRepliesTableMissing) return false;
  try {
    const { data: open } = await supabaseAdmin
      .from('failed_replies')
      .select('id')
      .eq('conversation_id', params.conversationId)
      .in('status', ['queued', 'retrying'])
      .limit(1)
      .maybeSingle();
    if (open) {
      await supabaseAdmin
        .from('failed_replies')
        .update({ error_kind: params.kind, error_detail: params.detail })
        .eq('id', open.id);
      return true;
    }
    const { error } = await supabaseAdmin.from('failed_replies').insert({
      conversation_id: params.conversationId,
      error_kind: params.kind,
      error_detail: params.detail,
      attempts: 0,
      status: 'queued',
      last_attempt_at: new Date().toISOString(),
    });
    if (error) {
      if (error.code === '42P01' || /failed_replies/.test(error.message)) {
        failedRepliesTableMissing = true;
        console.error('[ops-alerts] failed_replies table missing — dead-letter queue disabled until it is created');
      } else {
        console.error('[ops-alerts] failed_replies insert failed:', error);
      }
      return false;
    }
    return true;
  } catch (e) {
    console.error('[ops-alerts] enqueueFailedReply threw:', e);
    return false;
  }
}

export async function recordReplyFailure(params: {
  conversationId: string | null;
  channel: 'web' | 'whatsapp';
  error: unknown;
}): Promise<{ kind: ReplyErrorKind; detail: string }> {
  const { kind, detail } = classifyAnthropicError(params.error);
  console.error(
    `[ops-alerts] reply FAILED conversation=${params.conversationId ?? 'unknown'} channel=${params.channel} kind=${kind} detail=${JSON.stringify(detail)}`
  );
  await writeAudit({
    actorId: null,
    actorEmail: null,
    module: 'care',
    action: 'care.reply_failed',
    tableName: 'conversations',
    recordId: params.conversationId ?? 'unknown',
    after: { kind, detail, channel: params.channel },
  });
  if (params.conversationId) {
    await enqueueFailedReply({ conversationId: params.conversationId, kind, detail });
  }
  await maybeAlertFailureBurst();
  return { kind, detail };
}

// ≥3 generation failures in 10 minutes → one email (30-min cooldown), with
// the breakdown by failure type so the reader knows whether it's the balance,
// rate limits, or the model.
export async function maybeAlertFailureBurst(): Promise<'sent' | 'skipped' | 'failed' | 'below_threshold' | 'cooldown'> {
  if (!supabaseAdmin) return 'skipped';
  const since = new Date(Date.now() - FAILURE_BURST_WINDOW_MS).toISOString();
  const { data: failures, error } = await supabaseAdmin
    .from('audit_log')
    .select('id, at, record_id, after')
    .eq('action', 'care.reply_failed')
    .gte('at', since);
  if (error) {
    console.error('[ops-alerts] failure count query failed:', error);
    return 'failed';
  }
  const rows = failures ?? [];
  if (rows.length < FAILURE_BURST_THRESHOLD) return 'below_threshold';

  const cooldownSince = new Date(Date.now() - ALERT_COOLDOWN_MS).toISOString();
  const { data: recent } = await supabaseAdmin
    .from('audit_log')
    .select('id')
    .eq('action', 'care.alert_sent')
    .gte('at', cooldownSince)
    .limit(1);
  if (recent && recent.length > 0) return 'cooldown';

  const byKind: Record<string, number> = {};
  for (const r of rows) {
    const k = ((r.after as { kind?: string } | null)?.kind ?? 'other') as string;
    byKind[k] = (byKind[k] ?? 0) + 1;
  }
  const breakdown = Object.entries(byKind)
    .map(([k, n]) => `${KIND_CN[k as ReplyErrorKind] ?? k}: ${n}`)
    .join('，');
  const dominant = Object.entries(byKind).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other';
  const hint =
    dominant === 'quota'
      ? '→ Anthropic 余额已用完：请到 console.anthropic.com → Plans & Billing 充值。充值后系统会自动重放排队中的回复。'
      : dominant === 'rate_limit'
        ? '→ 触发限流：通常几分钟内自愈；若持续，请检查 Anthropic 用量上限。'
        : dominant === 'timeout'
          ? '→ 超时/网络：请检查 Vercel 与 Anthropic 状态页。'
          : '→ 请查看 Vercel 运行日志中的 [ops-alerts] 行。';
  const text =
    `过去 10 分钟内有 ${rows.length} 次 AI 回复生成失败（阈值 ${FAILURE_BURST_THRESHOLD}）。\n` +
    `失败类型：${breakdown}\n${hint}\n\n` +
    `涉及对话：${[...new Set(rows.map((r) => String(r.record_id).slice(0, 8)))].join(', ')}\n` +
    `未回复的对话会出现在关怀收件箱「未回复」标签，并进入自动重试队列。\n` +
    `https://xlfm-wisdom.vercel.app/dashboard`;
  const result = await sendOpsEmail(`[智慧问答] 🔴 ${rows.length} 次回复失败 / 10 分钟 — ${KIND_CN[dominant as ReplyErrorKind] ?? dominant}`, text);
  await writeAudit({
    actorId: null,
    actorEmail: null,
    module: 'care',
    action: 'care.alert_sent',
    tableName: 'audit_log',
    recordId: 'failure_burst',
    after: { failures: rows.length, byKind, email: result },
  });
  return result;
}

// ── Daily Anthropic health / balance check ────────────────────────────────────
// Canary: a 1-token Haiku call — an exhausted balance fails even this (400
// "credit balance is too low"). Balance: Anthropic exposes no balance endpoint;
// with an ADMIN key (sk-ant-admin…, env ANTHROPIC_ADMIN_API_KEY) we read the
// org cost report since the last top-up and estimate what is left. The
// top-up is recorded in org_settings (anthropic.credit.amount_usd +
// anthropic.credit.since), alert threshold in anthropic.credit.alert_usd.

export type AnthropicHealth = {
  canary: 'ok' | ReplyErrorKind;
  canaryDetail?: string;
  spentUsd?: number;
  remainingUsd?: number;
  thresholdUsd: number;
  creditSince?: string;
  alert: 'sent' | 'skipped' | 'failed' | 'not_needed';
};

async function readSettingNumber(key: string): Promise<number | undefined> {
  if (!supabaseAdmin) return undefined;
  const { data } = await supabaseAdmin.from('org_settings').select('value').eq('key', key).maybeSingle();
  const v = data?.value;
  return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : undefined;
}
async function readSettingString(key: string): Promise<string | undefined> {
  if (!supabaseAdmin) return undefined;
  const { data } = await supabaseAdmin.from('org_settings').select('value').eq('key', key).maybeSingle();
  const v = data?.value;
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

// Sum the org cost report (lowest currency unit = cents, decimal strings)
// from `since` until now. Paginates (≤31 buckets per page).
export async function fetchSpendSinceUsd(adminKey: string, sinceIso: string): Promise<number> {
  let cents = 0;
  let page: string | null = null;
  for (let guard = 0; guard < 12; guard++) {
    const qs = new URLSearchParams({ starting_at: sinceIso, bucket_width: '1d', limit: '31' });
    if (page) qs.set('page', page);
    const res = await fetch(`https://api.anthropic.com/v1/organizations/cost_report?${qs.toString()}`, {
      headers: { 'x-api-key': adminKey, 'anthropic-version': '2023-06-01' },
    });
    if (!res.ok) throw new Error(`cost_report HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as {
      data: { results: { amount: string; currency: string }[] }[];
      has_more: boolean;
      next_page: string | null;
    };
    for (const bucket of body.data ?? []) {
      for (const r of bucket.results ?? []) cents += Number(r.amount) || 0;
    }
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return cents / 100;
}

export async function checkAnthropicHealth(): Promise<AnthropicHealth> {
  const thresholdUsd = (await readSettingNumber('anthropic.credit.alert_usd')) ?? 20;
  const out: AnthropicHealth = { canary: 'ok', thresholdUsd, alert: 'not_needed' };

  try {
    await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 0 }).messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
  } catch (e) {
    const c = classifyAnthropicError(e);
    out.canary = c.kind;
    out.canaryDetail = c.detail;
  }

  const adminKey = process.env.ANTHROPIC_ADMIN_API_KEY;
  const creditUsd = await readSettingNumber('anthropic.credit.amount_usd');
  const since = await readSettingString('anthropic.credit.since');
  if (adminKey && creditUsd !== undefined && since) {
    try {
      out.spentUsd = await fetchSpendSinceUsd(adminKey, new Date(since).toISOString());
      out.remainingUsd = Math.round((creditUsd - out.spentUsd) * 100) / 100;
      out.creditSince = since;
    } catch (e) {
      console.error('[ops-alerts] cost report failed:', e);
    }
  }

  const low = out.remainingUsd !== undefined && out.remainingUsd < thresholdUsd;
  if (out.canary !== 'ok' || low) {
    const lines = [
      out.canary !== 'ok'
        ? `🔴 Anthropic 探测调用失败：${KIND_CN[out.canary]} — ${out.canaryDetail ?? ''}`
        : '✅ Anthropic 探测调用正常',
      out.remainingUsd !== undefined
        ? `余额估算：约 US$${out.remainingUsd.toFixed(2)}（自 ${out.creditSince} 起已花费 US$${(out.spentUsd ?? 0).toFixed(2)}；告警阈值 US$${thresholdUsd}）`
        : '余额估算：未配置（需要 ANTHROPIC_ADMIN_API_KEY 及设置 anthropic.credit.amount_usd / anthropic.credit.since）',
      '',
      '请到 console.anthropic.com → Plans & Billing 充值；充值后请在 设置 更新 anthropic.credit.amount_usd / since。',
      '排队中的失败回复会在余额恢复后自动重放。',
    ];
    out.alert = await sendOpsEmail(
      out.canary !== 'ok' ? '[智慧问答] 🔴 Anthropic API 不可用' : `[智慧问答] ⚠️ Anthropic 余额偏低（约 US$${out.remainingUsd?.toFixed(0)}）`,
      lines.join('\n')
    );
  }
  await writeAudit({
    actorId: null,
    actorEmail: null,
    module: 'care',
    action: 'care.balance_checked',
    tableName: 'audit_log',
    recordId: 'anthropic',
    after: out,
  });
  return out;
}
