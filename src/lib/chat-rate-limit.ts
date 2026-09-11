// src/lib/chat-rate-limit.ts
// F03 (batch 2 §3): persistent per-visitor rate limit for the public chat
// endpoint. The previous in-memory Map reset on every serverless cold start,
// so one script could burn the Anthropic balance — the same failure mode as
// the five outages. Counters live in Supabase (table rate_limits, function
// rate_limit_hit(key, window_start) → count; architect-created), keyed by
// browserId AND by IP, in 10-minute windows.
//
// Fail-OPEN: if the counter cannot be read (storage off, RPC error) the
// request proceeds — a broken limiter must not take the chat down.

import { supabaseAdmin } from './supabase';

export const RATE_WINDOW_MS = 10 * 60 * 1000;
// Per 10 minutes. A real conversation is one message per 20–60 s; a browser
// id over 20 or an address over 40 in ten minutes is a script (several
// visitors can share a NAT address, hence the looser IP cap).
export const RATE_LIMIT_PER_BROWSER = 20;
export const RATE_LIMIT_PER_IP = 40;

export const RATE_LIMITED_REPLY: Record<string, string> = {
  zh: '你发得有点快了 🙏 为了让每位访客都能得到回复，这里每 10 分钟只能发送有限的问题。请过几分钟再来，你之前的对话都还在。',
  en: "You're sending a little fast 🙏 So that every visitor gets an answer, only a limited number of questions can be sent every 10 minutes. Please come back in a few minutes — your conversation is still here.",
  id: 'Anda mengirim agak cepat 🙏 Agar setiap pengunjung mendapat balasan, hanya sejumlah pertanyaan yang bisa dikirim setiap 10 menit. Silakan kembali beberapa menit lagi — percakapan Anda masih tersimpan.',
};

export type RateLimitHit = { key: string; count: number; limit: number; retryAfterSec: number };

export function windowStart(now = Date.now()): { iso: string; retryAfterSec: number } {
  const start = Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS;
  return { iso: new Date(start).toISOString(), retryAfterSec: Math.max(1, Math.ceil((start + RATE_WINDOW_MS - now) / 1000)) };
}

// Increments both counters for this window and returns the first one over
// its limit (null = allowed). Both keys are always counted so a blocked
// request still shows up in the table (the 24 h blocked count for the report
// = Σ max(0, count − limit) per key/window).
export async function checkChatRateLimit(params: { browserId?: string; ip: string }): Promise<RateLimitHit | null> {
  if (!supabaseAdmin) return null;
  const { iso, retryAfterSec } = windowStart();
  const keys: { key: string; limit: number }[] = [];
  if (params.browserId) keys.push({ key: `bid:${params.browserId}`, limit: RATE_LIMIT_PER_BROWSER });
  if (params.ip && params.ip !== 'unknown') keys.push({ key: `ip:${params.ip}`, limit: RATE_LIMIT_PER_IP });
  if (keys.length === 0) return null;
  try {
    const results = await Promise.all(
      keys.map((k) => supabaseAdmin!.rpc('rate_limit_hit', { p_key: k.key, p_window_start: iso }))
    );
    for (let i = 0; i < keys.length; i++) {
      const { data, error } = results[i];
      if (error) {
        console.error('[rate-limit] rpc failed (fail-open):', error.message);
        continue;
      }
      const count = typeof data === 'number' ? data : Number(data);
      if (Number.isFinite(count) && count > keys[i].limit) {
        return { key: keys[i].key, count, limit: keys[i].limit, retryAfterSec };
      }
    }
    return null;
  } catch (e) {
    console.error('[rate-limit] check failed (fail-open):', e);
    return null;
  }
}
