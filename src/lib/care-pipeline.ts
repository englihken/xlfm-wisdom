// src/lib/care-pipeline.ts
// The shared "brains" of the care assistant, extracted so BOTH the streaming web
// chat (/api/chat, powering 智慧问答) and the non-streaming WhatsApp channel
// (/api/webhooks/whatsapp) run the exact same RAG retrieval, system prompt,
// Claude model, source-building, and post-reply classification — one source of
// truth, never duplicated.
//
// The web route keeps its own streaming loop; it just calls the shared building
// blocks here (buildSystemBlocks / buildSources / classifyConversation). WhatsApp
// uses generateReply(), a non-streaming single-shot variant with identical inputs.

import Anthropic from '@anthropic-ai/sdk';
import { getSystemPrompt } from './system-prompt';
import {
  searchRelevantTeachings,
  formatPassagesAsContext,
  detectTopics,
  buildRetrievalQuery,
  isBeginnerTriageFollowup,
  type RetrievedPassage,
  type RetrievalContext,
} from './vector-search';
import { supabaseAdmin } from './supabase';
import { loadCareCategories } from './org-settings';
import {
  checkDraft,
  stripViolations,
  normalizeForGuard,
  chooseGuardTail,
  scrubContradictoryRefusal,
  hasBlanketRefusal,
  isOverStripped,
  extractNumberTokens,
  type GuardViolation,
  type GuardTail,
} from './verbatim-guard';
import { wisdomEntryIdsInPassages, incrementWisdomUseCounts } from './wisdom-sync';
import { levelFromCues, needsCareFromCues, maxLevel, stageToLevel, isVisitorLevel, type VisitorLevel } from './prompt/level-cues';
import { writeAudit } from './audit';
import { detectCrisisKeywords, matchedCrisisKeywords } from './crisis-keywords';

// Fast retry (brief "别再把访客弄丢" §3, sync side): the SDK retries 408/409/429/
// 5xx and connection errors with exponential backoff (~0.5 s → 1 s → …,
// honouring retry-after). Two retries ≈ the 1 s / 3 s ladder asked for. A
// 400 "credit balance is too low" is NOT retried — nothing to gain.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 2 });

// Shared by the web chat route (imported there) and the WhatsApp channel.
// Opus 5 runs with adaptive thinking ON by default, and thinking tokens count
// against max_tokens — so the budget is far above the ~2000-token visible reply
// we actually expect, or thinking would truncate the answer mid-sentence.
// Model switch 2026-09-11 (docs/briefs/2026-09-11-model-switch.md): the default
// reply model is Sonnet 4.6 — on the consolidated v2 prompt it passed the same
// R1–R21 + chips suite as Opus 5 (39/41 vs 38/41) at first-token 2.9 s vs 8.7 s.
// Rollback is one env var: REPLY_MODEL=claude-opus-5. REPLY_MODEL_HIGH (default
// = REPLY_MODEL) overrides the model for `high`-effort turns only (canonical
// numbers / karma warnings / crisis), so a weak high tier can go back to Opus
// without moving everything.
export const DEFAULT_REPLY_MODEL = 'claude-sonnet-4-6';
export const REPLY_MODEL = process.env.REPLY_MODEL?.trim() || DEFAULT_REPLY_MODEL;
export const REPLY_MODEL_HIGH = process.env.REPLY_MODEL_HIGH?.trim() || REPLY_MODEL;
export const REPLY_MAX_TOKENS = 8000;

// ── Thinking effort by turn type (brief 09-10 §3; the 08-30 §6 plan) ─────────
// Thinking was the largest latency item (6–31 s per call). Routine 功课 turns
// need little of it; doctrinal-number and crisis turns need all of it.
//   low    — homework_baseline / little_house_baseline / 分诊跟进 (the answer is
//            a fixed 功课 block copied from the baseline chunks)
//   high   — canonical_ritual_numbers / karma_warning / crisis keyword hit
//   medium — everything else
// How the tier is sent matters for the prompt cache (measured 09-10 with
// scripts/measure-latency.ts): a TOP-LEVEL `output_config.effort` gives every
// tier its own cached copy of the ~49k-token system prefix on Opus 5 (the
// first low / medium / high call each paid a cache write). The per-message
// form — an effort-only `role: 'system'` message inside `messages`, beta
// `mid-conversation-output-config-2026-07-01` — shares ONE cached prefix
// across tiers (probe: low created, high + medium both read 49,276 tokens).
// Opus 5 uses the per-message form; any other model (the Sonnet A/B) gets the
// top-level form; a 400 on the beta falls back to top-level automatically.
export type ReplyEffort = 'low' | 'medium' | 'high';
const EFFORT_BETA = 'mid-conversation-output-config-2026-07-01';
/** The model a turn of this effort tier runs on (REPLY_MODEL_HIGH for `high`). */
export function replyModelFor(effort?: ReplyEffort): string {
  return effort === 'high' ? REPLY_MODEL_HIGH : REPLY_MODEL;
}
// Per model: only Opus 5 takes the per-message effort form; a 400 on the beta
// flips the entry to false for the rest of the process.
const perMessageEffortSupported = new Map<string, boolean>();
const supportsPerMessageEffort = (model: string) => perMessageEffortSupported.get(model) ?? model === 'claude-opus-5';

// ── Citation date soft check (model switch §3) ───────────────────────────────
// A website-QA citation (解答来信疑惑 / 玄艺问答 / 玄艺综述 / 玄学问答 / 精彩节目
// 摘录) must carry its 开示/节目 date (LETTERS_SOURCE_RULES 1). When a line cites
// one without a date the draft is regenerated ONCE with a format reminder; if
// the date is still missing the reply ships as is — no strip, no tail — and the
// turn is flagged `citation_no_date` (messages.flags + audit_log) so the review
// queue and the Sonnet watch can count it.
const WEBSITE_SOURCE_RE = /解答来信疑惑|玄艺问答|玄艺综述|玄学问答|精彩节目摘录/;
const CITATION_DATE_RE = /开示于\s*\d{4}\s*年|\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}\s*年\s*\d{1,2}\s*月|\d{4}-\d{2}-\d{2}|节目日期/;
export function citationsMissingDate(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (!WEBSITE_SOURCE_RE.test(line)) continue;
    // Quoted passages (> …) are the visitor-facing 原话, not the citation line.
    if (/^\s*>/.test(line) && !/参考|来源|——|—— /.test(line)) continue;
    if (!CITATION_DATE_RE.test(line)) out.push(line.trim().slice(0, 80));
  }
  return out;
}
// 09-12 strip-tails §C: programmatic date fill. When a citation line still has
// no date after the model retry, take the date from the retrieved passage's
// metadata (post_title / original_date) — no model involved. Matching:
//   解答来信疑惑（第N篇） → the passage whose post_title carries 「（N）」;
//   玄艺问答 / 玄艺综述 / 玄学问答 / 精彩节目摘录 → all retrieved passages of that
//   book share one original_date → use it; otherwise leave it for the flag.
const CN_NUM_RE = /[零〇一二两三四五六七八九十百千]+/;
function fmtDate(iso: string): string | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}年${Number(m[2])}月${Number(m[3])}日` : null;
}
export function fillCitationDates(text: string, passages: RetrievedPassage[]): { text: string; filled: string[] } {
  const filled: string[] = [];
  const lines = text.split('\n').map((line) => {
    if (!WEBSITE_SOURCE_RE.test(line) || CITATION_DATE_RE.test(line)) return line;
    if (/^\s*>/.test(line) && !/参考|来源|——|—— /.test(line)) return line;
    let date: string | null = null;
    let label = '';
    const letter = line.match(/解答来信疑惑[（(]第?([零〇一二两三四五六七八九十百千\d]+)篇?[)）]/);
    if (letter) {
      const n = letter[1];
      const hit = passages.find((p) => /解答来信疑惑/.test(p.book) && p.post_title && p.post_title.includes(`（${n}）`) && p.original_date);
      if (hit?.original_date) {
        date = fmtDate(hit.original_date);
        label = date ? `（开示于${date}）` : '';
      }
    } else {
      const family = (line.match(/玄艺问答|玄艺综述|玄学问答|精彩节目摘录/) ?? [])[0];
      if (family) {
        const dates = new Set(
          passages
            .filter((p) => p.original_date && (p.book.includes(family) || (p.post_title ?? '').includes(family)))
            .map((p) => p.original_date as string)
        );
        if (dates.size === 1) {
          date = fmtDate([...dates][0]);
          label = date ? `（${date}节目）` : '';
        }
      }
    }
    if (!label) return line;
    // Put the date right after the 《…》 title when there is one, else at the end.
    const anchored = line.replace(/(《[^》]*(解答来信疑惑|玄艺问答|玄艺综述|玄学问答|精彩节目摘录)[^》]*》)/, `$1${label}`);
    const out = anchored === line ? `${line}${label}` : anchored;
    filled.push(out.trim().slice(0, 80));
    return out;
  });
  return { text: lines.join('\n'), filled };
}
void CN_NUM_RE;

function buildCitationDateInstruction(missing: string[]): string {
  return `【引用格式提醒】你的回复引用了网站问答类来源，但下面这些引用没有写开示／节目日期：\n${missing.map((m) => `- ${m}`).join('\n')}\n请按〔网站问答 来源规则〕第 1 条重写引用：《解答来信疑惑（第N篇）》（开示于YYYY年M月D日）／《玄艺问答》（YYYY年M月D日节目）／《玄艺综述》（YYYY年M月D日节目）。日期只能取自检索段落开头【…】标题里的日期；标题里没有日期就省略日期，绝不推算。其余内容保持不变——不要因此删掉已经写出的遍数、祈求词或引用本身。`;
}

export function chooseReplyEffort(params: {
  message: string;
  messages: CareMessage[];
  ctx?: RetrievalContext;
}): ReplyEffort {
  const effort = chooseReplyEffortByTopic(params);
  // 同修轮 (09-13 §三): an experienced practitioner gets at least medium —
  // 2–3 verbatim passages plus how they apply is not a low-effort answer.
  return params.ctx?.level === 'experienced' && effort === 'low' ? 'medium' : effort;
}

function chooseReplyEffortByTopic(params: {
  message: string;
  messages: CareMessage[];
  ctx?: RetrievalContext;
}): ReplyEffort {
  const visitorTurns = params.messages.filter((m) => m.role === 'user').map((m) => m.content);
  if (!visitorTurns.includes(params.message)) visitorTurns.push(params.message);
  if (visitorTurns.some((t) => detectCrisisKeywords(t))) return 'high';
  const topics = detectTopics(buildRetrievalQuery(params.message, params.ctx));
  if (topics.includes('canonical_ritual_numbers') || topics.includes('karma_warning')) return 'high';
  if (
    topics.includes('homework_baseline') ||
    topics.includes('little_house_baseline') ||
    isBeginnerTriageFollowup(params.ctx)
  ) {
    return 'low';
  }
  return 'medium';
}

// Progress stages surfaced to the visitor while the reply is being produced
// (brief 09-10 §4). Purely informational — no generation logic keys off them.
export type ReplyStage = 'retrieving' | 'drafting' | 'verifying';

// F07 crisis fast lane (batch 2 §4): sent as the FIRST text block, before
// retrieval, when the visitor's turn carries a crisis keyword. Wording is the
// hotline block of the prompt's 危机四步 template (第十部分) plus one sentence
// of companionship; the full guarded reply follows as a second block.
export const CRISIS_FAST_LANE: Record<Language, string> = {
  zh: '我在这里，先陪你一下 🙏 如果你现在很难受、有伤害自己的念头，请先打这个电话：\n📞 Befrienders KL：03-7627 2929（24 小时免费，不评判你）\n📞 Talian Kasih：15999\n他们会陪你说话。先打电话，下面我再慢慢跟你说。',
  en: "I'm here with you 🙏 If you are in pain right now or having thoughts of hurting yourself, please call first:\n📞 Befrienders KL: 03-7627 2929 (24 hours, free, no judgement)\n📞 Talian Kasih: 15999\nThey will stay on the line with you. Call first — the rest of my reply follows below.",
  id: 'Saya di sini menemani Anda 🙏 Jika saat ini Anda sangat tertekan atau berpikir untuk menyakiti diri sendiri, tolong telepon dulu:\n📞 Befrienders KL: 03-7627 2929 (24 jam, gratis, tanpa menghakimi)\n📞 Talian Kasih: 15999\nMereka akan menemani Anda berbicara. Telepon dulu — jawaban lengkap saya menyusul di bawah.',
};

export function crisisFastLaneText(language: Language): string {
  return CRISIS_FAST_LANE[language] ?? CRISIS_FAST_LANE.zh;
}
// The post-reply categorisation is a one-label task visitors never see — the
// cheapest model is plenty.
const CLASSIFY_MODEL = 'claude-haiku-4-5';
const MAX_SOURCES = 3;

// Opus 5's safety classifiers can decline a request (HTTP 200 with
// stop_reason 'refusal' and empty/partial content). Rare for this bot, but the
// visitor must never be left with a blank bubble — both channels fall back to
// this gentle hand-off instead.
export const REFUSAL_REPLY: Record<Language, string> = {
  zh: '抱歉，这个问题我不方便回答。您可以换一个方式提问，或留下想聊的内容，我们的义工会尽快与您交流 🙏',
  en: "I'm sorry, but I'm not able to answer this question. You could try rephrasing it, or leave a message and one of our volunteers will follow up with you soon 🙏",
  id: 'Maaf, saya tidak dapat menjawab pertanyaan ini. Anda dapat mencoba bertanya dengan cara lain, atau tinggalkan pesan dan relawan kami akan segera menghubungi Anda 🙏',
};

// ── Verbatim guard plumbing (anti-fabrication; see verbatim-guard.ts) ─────────

// Appended to a stripped reply so the visitor knows why numbers are missing.
// ONLY for the case where no counts survive in the reply — after correct
// figures it would contradict them (the 08-16 production defect).
const GUARD_DISCLAIMER: Record<Language, string> = {
  zh: '关于具体的遍数／张数，我目前查不到相关原文，不敢随意告诉您数字。建议咨询就近共修会的义工，以官方资料为准 🙏',
  en: 'I could not find the exact source text for the specific counts involved, so I would rather not quote numbers from memory. Please check with the volunteers at your nearest 共修会 for the official guidance 🙏',
  id: 'Saya tidak menemukan teks sumber untuk jumlah pastinya, jadi saya tidak berani memberikan angka. Silakan tanyakan kepada relawan di 共修会 terdekat untuk panduan resmi 🙏',
};

// Scoped note when SOME number statements were stripped but grounded counts
// remain above. Must never read as "I found no source" — the surviving numbers
// ARE sourced. (Deliberately avoids the 查不到相关原文 / 不敢随意告诉您数字
// phrasing, which regression R9 asserts absent after grounded answers.)
const GUARD_PARTIAL_DISCLAIMER: Record<Language, string> = {
  zh: '补充说明：个别涉及遍数／张数的细节因暂未能核对到原文，已略去未写；以上写出的数字均出自检索到的官方资料。如需进一步确认，请咨询就近共修会的义工 🙏',
  en: 'Note: one or two count-related details were left out because I could not verify them against the source texts; the numbers given above come from the retrieved official materials. For anything further, please check with the volunteers at your nearest 共修会 🙏',
  id: 'Catatan: beberapa detail jumlah dihilangkan karena tidak dapat saya verifikasi dengan teks sumber; angka-angka di atas berasal dari materi resmi yang ditemukan. Silakan konfirmasi lebih lanjut dengan relawan di 共修会 terdekat 🙏',
};

// Full safe answer when stripping leaves nothing usable.
const GUARD_SAFE_REPLY: Record<Language, string> = {
  zh: '抱歉，您问的这个修行细节，我目前查不到相关原文，不方便凭记忆随意回答，以免误导您。建议您联系就近共修会的义工确认，以官方资料为准 🙏\n\n🌐 https://xlfm.my/contact-us',
  en: 'I could not find the source text for this practice detail, and I would rather not answer from memory and risk misleading you. Please confirm with the volunteers at your nearest 共修会 🙏\n\n🌐 https://xlfm.my/contact-us',
  id: 'Maaf, saya tidak menemukan teks sumber untuk detail praktik ini, dan saya tidak ingin menjawab dari ingatan. Silakan konfirmasi dengan relawan di 共修会 terdekat 🙏\n\n🌐 https://xlfm.my/contact-us',
};

// Corrective system block for the single regeneration attempt. TARGETED: it
// names exactly which quote/number failed and why, and tells the model to keep
// every number that IS grounded. The 08-09 version said "no numbers outside
// 组织审定 at all" — so a quote-only trip on a 失眠 answer regenerated with
// zero 遍数 and a 查不到 line (production 08-19→08-29: 14/14 失眠 answers).
function buildRetryInstruction(violations: GuardViolation[], level?: VisitorLevel | null): string {
  // 同修轮 (09-13): an experienced practitioner's reply carries no counts, so a
  // number violation means 「take the number out」 — never 「use a grounded one
  // instead」 and never 「say the figure is not in the materials」.
  if (level === 'experienced') {
    const numbers = [...new Set(violations.filter((v) => v.type === 'number').map((v) => v.text))];
    return [
      '【重要纠正】这是同修轮（访客是已在修行的同修），请重写整个回答：',
      ...violations
        .filter((v) => v.type === 'quote')
        .map((v) => `- 引文「${v.text.length > 60 ? `${v.text.slice(0, 60)}…` : v.text}」不是检索段落的逐字原文：引文块（"> "）必须逐字照抄检索段落；做不到就删去，或改为不带引文块的转述。`),
      ...(numbers.length > 0
        ? [`- 同修轮不写遍数／张数：把「${numbers.join('」「')}」连同所在句子改成不带数字的建议（例如「多念心经开智慧」），不要换成别的数字。`]
        : []),
      '重写时不要写「查不到相关原文」「资料里没有写明」一类的话；其余内容保持不变。',
    ].join('\n');
  }
  const lines: string[] = [
    '【重要纠正】你上一稿有以下内容未通过与检索段落的逐字核对，请重写整个回答：',
  ];
  for (const v of violations) {
    if (v.type === 'quote') {
      const shown = v.text.length > 60 ? `${v.text.slice(0, 60)}…` : v.text;
      lines.push(
        `- 引文「${shown}」不是检索段落的逐字原文：引文块（"> "）必须逐字照抄检索段落；做不到就改为不带引文块的转述，或删去。`
      );
    } else if (v.reason === 'number_not_in_sources') {
      const bound = v.subject ? `「${v.subject} ${v.text}」这一组合` : `数字「${v.text}」`;
      lines.push(
        `- ${bound}在本次检索段落和访客原话中都不存在（数字必须和它所属的经文/小房子一起出现在同一来源里，别的经文的遍数不能挪用）：删去它，或改用检索段落中确实为该经文写明的遍数/张数。`
      );
    } else if (v.reason === 'number_visitor_as_advice') {
      lines.push(
        `- 数字「${v.subject ? `${v.subject} ` : ''}${v.text}」只出现在访客自己的话里，检索段落里没有：可以用"你说的/你念的N遍"的方式引用访客的话，但不能把它写成建议（"建议/每天念/可以念N遍"）。`
      );
    } else if (v.reason === 'number_case_generalized') {
      lines.push(
        `- 数字「${v.subject ? `${v.subject} ` : ''}${v.text}」只出现在台长给某位听众/同修的个案记录里：只能以"台长曾对一位同修/听众说…情况因人而异"的方式转述，不能写成给访客的建议或通用标准。`
      );
    } else {
      lines.push(
        `- 数字「${v.text}」出现在关于礼佛大忏悔文／特殊日子的段落里，但它不在【组织审定】段落中：这类主题一律以【组织审定】的数字为准，不得提及其他来源的不同数字。`
      );
    }
  }
  lines.push(
    '重写时请遵守：',
    '(1) 检索段落（任何来源）或访客原话中确实出现的 N遍/N张 可以正常使用——上一稿中其他有依据的数字请保留，不要因为个别数字被拦就删掉全部遍数；',
    '(2) 礼佛大忏悔文的遍数、特殊日子的小房子张数，若检索到【组织审定】段落，只能用其中的数字；',
    '(3) 心灵法门例说等案例书、解答来信疑惑／法会弟子提问／玄艺问答／玄艺综述中的数字是台长给某一位同修的个案，只能以"台长对类似情况的开示…情况因人而异"的方式转述，不可当作通用标准或上限；',
    '(4) 只有某个具体遍数/张数在检索段落中确实没有时，才针对该项写"这一项的遍数本次资料中没有写明"；已经给出有依据的数字之后，绝不要再写"查不到相关原文／不敢乱给数字"这类笼统免责。'
  );
  return lines.join('\n');
}

// Over-strip regeneration (conv c47ffe52): the previous draft's 功课 sentences
// were all removed, so the model is told which counts the passages DO carry
// and asked for 经名＋遍数＋祈求词 built only from those.
function buildOverStripInstruction(violations: GuardViolation[], chunkTokens: string[]): string {
  const bad = [...new Set(violations.filter((v) => v.type === 'number').map((v) => v.text))];
  const avail = chunkTokens.length > 0 ? chunkTokens.join('、') : '（本次检索段落中没有任何遍数/张数）';
  return [
    '【重要纠正】你上一稿的功课句子全部被核对系统删除了（数字' +
      (bad.length ? `「${bad.join('」「')}」` : '') +
      '在检索段落中不存在），剩下的回答只有祈求词、没有经名，访客不知道该念什么、念几遍。请重写整个回答：',
    `(1) 检索段落中确实写明的遍数/张数只有：${avail}。功课只能用这些数字，逐字采用，不得改动、不得补充其他数字；`,
    '(2) 每一部经文都要写成「经名 ＋ 遍数 ＋ 祈求词」三件套（例如「📿 《大悲咒》每天N遍，祈求：……」），至少给出一部；',
    '(3) 如果检索段落里完全没有遍数，就只给经名和祈求词，并说明「这一项的遍数本次资料中没有写明」，不要写笼统的「查不到相关原文／不敢给数字」；',
    '(4) 共修会只能作为结尾邀请，不能替代答案。',
  ].join('\n');
}

export type GuardOutcome = 'clean' | 'passed_after_retry' | 'stripped';

// One decision record per guarded reply that the guard touched. Written to
// console (Vercel logs) AND, for real conversations, to audit_log as
// module='care' action='care.guard' record_id=<conversation_id> — so the next
// regression is visible in 系统日志 (filter action=care.guard) without waiting
// for a visitor complaint. No new table: audit_log is append-only jsonb.
export type GuardDecisionLog = {
  outcome: GuardOutcome;
  canonicalPresent: boolean;
  // Every violation from all attempts (3 = the over-strip regeneration), with
  // the reason it failed.
  violations: { attempt: 1 | 2 | 3; type: 'quote' | 'number'; text: string; reason: string }[];
  tail?: GuardTail | 'safe-reply';
  // Stripping left a 祈求词 with no sutra named → an extra regeneration ran.
  overStripRegen?: boolean;
  // N遍/N张 available in the retrieved chunks vs. what the shipped reply states.
  chunkTokens: string[];
  replyTokens: string[];
  // Blanket 查不到/不敢给 sentences removed because the reply states counts.
  scrubbed: string[];
  // A blanket refusal shipped while the chunks DID carry counts — the 08-29
  // regression shape. Not blocked (the model may have had good reason), but
  // it must be countable.
  refusalWithCountsAvailable: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function logGuardDecision(convId: string, log: GuardDecisionLog): Promise<void> {
  const touched =
    log.violations.length > 0 || log.scrubbed.length > 0 || log.refusalWithCountsAvailable;
  if (!touched) return;
  console.error(`[verbatim-guard] conversation=${convId} decision=${JSON.stringify(log)}`);
  // Test harnesses pass labels like 'regression-test' — console only for those.
  if (!UUID_RE.test(convId)) return;
  await writeAudit({
    actorId: null,
    actorEmail: null,
    module: 'care',
    action: 'care.guard',
    tableName: 'conversations',
    recordId: convId,
    after: log,
  });
}

// Generate one guarded reply: draft → mechanical verbatim/numbers check →
// regenerate once with the corrective instruction → strip + disclaimer as the
// last resort. Shared by the web chat (which buffers, then sends) and the
// WhatsApp channel. Every guard trip is logged with the conversation id.
export async function generateGuardedReplyText(params: {
  messages: CareMessage[];
  language: Language;
  passages: RetrievedPassage[];
  contextBlock: string;
  conversationId?: string | null;
  // Thinking tier for this turn (see chooseReplyEffort). Omitted → the API
  // default (high), which is what production ran before 09-10.
  effort?: ReplyEffort;
  onStage?: (stage: ReplyStage) => void;
  // 同修轮 (09-13): visitor level for this turn — shapes the retry instruction
  // and the post-strip tail (see decideTurnLevel).
  level?: VisitorLevel | null;
}): Promise<{ fullText: string; refused: boolean; guard: GuardOutcome; modelCalls: number; flags: string[] }> {
  const { messages, language, passages, contextBlock, effort } = params;
  const convId = params.conversationId ?? 'unknown';
  const model = replyModelFor(effort);
  const stage = (s: ReplyStage) => {
    try {
      params.onStage?.(s);
    } catch {
      /* a UI hint must never break generation */
    }
  };

  // 智库 use_count (P2 §3): a wisdom_ chunk in this reply's retrieved passages
  // counts as a use. Fire-and-forget, service role, never blocks the reply.
  if (supabaseAdmin) {
    const wisdomIds = wisdomEntryIdsInPassages(passages);
    if (wisdomIds.length > 0) void incrementWisdomUseCounts(supabaseAdmin, wisdomIds);
  }

  let modelCalls = 0;
  const callModel = async (extraSystem?: string): Promise<Anthropic.Message> => {
    const system = [
      ...buildSystemBlocks(language, contextBlock),
      ...(extraSystem ? [{ type: 'text' as const, text: extraSystem }] : []),
    ];
    // Streamed under the hood (large max_tokens + thinking would risk HTTP
    // timeouts on a blocking call); the caller still receives the full message.
    const attempt = ++modelCalls;
    stage(attempt === 1 ? 'drafting' : 'verifying');
    const t0 = Date.now();
    let ttfbMs = -1;
    let firstTextMs = -1;
    const turnMessages = messages.map((m) => ({ role: m.role, content: m.content }));
    const onEvents = (stream: { on: (ev: 'streamEvent' | 'text', cb: (e: { type: string }) => void) => unknown }) => {
      stream.on('streamEvent', (ev) => {
        if (ttfbMs < 0 && ev.type === 'message_start') ttfbMs = Date.now() - t0;
      });
      stream.on('text', () => {
        if (firstTextMs < 0) firstTextMs = Date.now() - t0;
      });
    };
    const topLevel = () => {
      const stream = anthropic.messages.stream({
        model,
        max_tokens: REPLY_MAX_TOKENS,
        ...(effort ? { output_config: { effort } } : {}),
        system,
        messages: turnMessages,
      });
      onEvents(stream);
      return stream.finalMessage();
    };
    let effortMode: 'per_message' | 'top_level' | 'none' = effort ? (supportsPerMessageEffort(model) ? 'per_message' : 'top_level') : 'none';
    let msg: Anthropic.Message;
    if (effort && supportsPerMessageEffort(model)) {
      try {
        const stream = anthropic.beta.messages.stream({
          model,
          max_tokens: REPLY_MAX_TOKENS,
          betas: [EFFORT_BETA],
          system: system as Anthropic.Beta.BetaTextBlockParam[],
          messages: [
            { role: 'system', content: [], output_config: { effort } } as unknown as Anthropic.Beta.BetaMessageParam,
            ...turnMessages,
          ],
        });
        onEvents(stream);
        msg = (await stream.finalMessage()) as unknown as Anthropic.Message;
      } catch (e) {
        // The beta was withdrawn or is not enabled for this key: fall back to
        // the top-level form for the rest of this process and retry now.
        if (e instanceof Anthropic.BadRequestError && /anthropic-beta|output_config|role 'system'|per-turn effort/i.test(e.message)) {
          console.error(`[care-pipeline] per-message effort rejected (${e.message.slice(0, 120)}) — falling back to top-level output_config.effort`);
          perMessageEffortSupported.set(model, false);
          effortMode = 'top_level';
          msg = await topLevel();
        } else {
          throw e;
        }
      }
    } else {
      msg = await topLevel();
    }
    // Latency breakdown (入门轮 brief problem 3): time-to-first-byte, time to
    // the first visible text (thinking sits in between), total, and the
    // prompt-cache split — cache_read ≈ the ~2,860-line system prompt when
    // the 1-hour ephemeral cache hits, cache_creation when it missed.
    const u = msg.usage as Anthropic.Usage & { cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
    console.log(
      `[care-pipeline] timing conversation=${convId} model=${model} effort=${effort ?? 'default'} effort_mode=${effortMode} attempt=${attempt} ttfb_ms=${ttfbMs} first_text_ms=${firstTextMs} total_ms=${Date.now() - t0} input=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_create=${u.cache_creation_input_tokens ?? 0} output=${u.output_tokens} stop=${msg.stop_reason}`
    );
    return msg;
  };

  const textOf = (result: Anthropic.Message): string =>
    result.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

  const chunkTexts = passages.map((p) => p.text);
  const visitorTexts = messages.filter((m) => m.role === 'user').map((m) => m.content);
  // 组织审定 canonical chunks: when present, prose 遍数/张数 in paragraphs on
  // the canonical subject (礼佛 / 特殊日子) must come from them (or the
  // visitor). Numbers on any other subject are grounded by ANY retrieved
  // chunk — books, letters, wenda, cases (see verbatim-guard.ts, 08-29 fix).
  const canonicalTexts = passages
    .filter((p) => p.type === 'canonical_ruling')
    .map((p) => p.text);
  // F01: case records (玄艺综述 / 玄艺问答) ground a count only when the
  // sentence narrates the case — never as advice.
  const caseTexts = passages.filter((p) => p.type === 'case_qa').map((p) => p.text);
  const guardOpts = { canonicalTexts, caseTexts };

  const decision: GuardDecisionLog = {
    outcome: 'clean',
    canonicalPresent: canonicalTexts.length > 0,
    violations: [],
    chunkTokens: [...new Set(extractNumberTokens(chunkTexts.join('\n')))],
    replyTokens: [],
    scrubbed: [],
    refusalWithCountsAvailable: false,
  };
  const recordViolations = (attempt: 1 | 2 | 3, violations: GuardViolation[]) => {
    for (const v of violations) {
      console.error(
        `[verbatim-guard] conversation=${convId} violation=${v.type} attempt=${attempt} reason=${v.reason} text=${JSON.stringify(v.text)}`
      );
      decision.violations.push({ attempt, type: v.type, text: v.text, reason: v.reason });
    }
  };

  // Every non-refused reply leaves through here. The contradiction scrub is
  // the final mechanical step: a blanket 「查不到相关原文／不敢乱给数字」
  // sentence next to grounded counts is removed whoever wrote it (the model
  // on a clean pass, or the model following the old retry instruction). Then
  // the decision is logged if the guard did anything at all.
  const finish = async (
    text: string,
    guard: GuardOutcome,
    tail?: GuardTail | 'safe-reply'
  ): Promise<{ fullText: string; refused: boolean; guard: GuardOutcome; modelCalls: number; flags: string[] }> => {
    const scrub0 = scrubContradictoryRefusal(text);
    // Citation date soft check: the retry already happened on the first draft;
    // now fill programmatically from passage metadata (§C), then flag what is
    // still missing.
    const flags: string[] = [];
    const dated = fillCitationDates(scrub0.text, passages);
    if (dated.filled.length > 0) console.log(`[care-pipeline] conversation=${convId} citation dates filled from metadata: ${JSON.stringify(dated.filled)}`);
    const scrub = { ...scrub0, text: dated.text };
    const stillMissing = citationsMissingDate(scrub.text);
    if (stillMissing.length > 0) {
      flags.push('citation_no_date');
      console.error(`[care-pipeline] conversation=${convId} citation_no_date after retry: ${JSON.stringify(stillMissing)}`);
      if (UUID_RE.test(convId)) {
        await writeAudit({ actorId: null, actorEmail: null, module: 'care', action: 'care.citation_no_date', tableName: 'conversations', recordId: convId, after: { missing: stillMissing, model } });
      }
    }
    decision.outcome = guard;
    decision.tail = tail;
    decision.scrubbed = scrub.removed;
    decision.replyTokens = [...new Set(extractNumberTokens(scrub.text))];
    decision.refusalWithCountsAvailable =
      decision.replyTokens.length === 0 &&
      decision.chunkTokens.length > 0 &&
      hasBlanketRefusal(scrub.text);
    if (scrub.removed.length > 0) {
      console.error(
        `[verbatim-guard] conversation=${convId} scrubbed contradictory refusal: ${JSON.stringify(scrub.removed)}`
      );
    }
    await logGuardDecision(convId, decision);
    return { fullText: scrub.text, refused: false, guard, modelCalls, flags };
  };

  let result = await callModel();
  if (result.stop_reason === 'refusal') {
    console.warn('[care-pipeline] model refused; sending hand-off reply');
    return { fullText: REFUSAL_REPLY[language], refused: true, guard: 'clean', modelCalls, flags: [] };
  }
  // Citation date soft check: one format-reminder regeneration, before the
  // verbatim guard looks at the draft (the guard then checks whatever came back).
  {
    const missing = citationsMissingDate(textOf(result));
    if (missing.length > 0) {
      console.error(`[care-pipeline] conversation=${convId} citation without date (${missing.length}) — regenerating once with the format reminder`);
      const retried = await callModel(buildCitationDateInstruction(missing));
      if (retried.stop_reason !== 'refusal') result = retried;
    }
  }
  // Observability only (P2 §5): REPLY_MAX_TOKENS=8000 is ~4x the longest reply
  // seen in production, but a genuine cap hit should never again be diagnosable
  // only through a reviewer complaint.
  if (result.stop_reason === 'max_tokens') {
    console.error(`[care-pipeline] conversation=${convId} reply hit REPLY_MAX_TOKENS — truncated mid-reply`);
  }

  let draft = textOf(result);
  stage('verifying');
  let violations = checkDraft(draft, chunkTexts, visitorTexts, guardOpts);
  if (violations.length === 0) return finish(draft, 'clean');
  recordViolations(1, violations);

  // One corrective regeneration, told exactly what failed and what to keep.
  result = await callModel(buildRetryInstruction(violations, params.level));
  if (result.stop_reason === 'refusal') {
    console.warn('[care-pipeline] model refused on guard retry; sending hand-off reply');
    return { fullText: REFUSAL_REPLY[language], refused: true, guard: 'passed_after_retry', modelCalls, flags: [] };
  }
  draft = textOf(result);
  violations = checkDraft(draft, chunkTexts, visitorTexts, guardOpts);
  if (violations.length === 0) return finish(draft, 'passed_after_retry');
  recordViolations(2, violations);

  // Last resort: strip the offending content, then choose a tail that cannot
  // contradict what survived (08-16 defect: blanket 查不到 after correct 21遍).
  let stripped = stripViolations(draft, violations);

  // Over-strip guard (conv c47ffe52): if stripping left a 祈求词 with no sutra
  // named, the 功课 answer was gutted — regenerate once more, telling the
  // model exactly which counts the retrieved passages DO state, instead of
  // shipping a prayer with nothing to pray before. Numbers check unchanged.
  if (isOverStripped(stripped)) {
    console.error(`[verbatim-guard] conversation=${convId} over-stripped (祈求词 without 经名) — regenerating`);
    decision.overStripRegen = true;
    result = await callModel(buildOverStripInstruction(violations, decision.chunkTokens));
    if (result.stop_reason === 'refusal') {
      console.warn('[care-pipeline] model refused on over-strip retry; sending hand-off reply');
      return { fullText: REFUSAL_REPLY[language], refused: true, guard: 'stripped', modelCalls, flags: [] };
    }
    draft = textOf(result);
    violations = checkDraft(draft, chunkTexts, visitorTexts, guardOpts);
    if (violations.length === 0) return finish(draft, 'passed_after_retry');
    recordViolations(3, violations);
    stripped = stripViolations(draft, violations);
  }

  if (normalizeForGuard(stripped).length < 40) {
    console.error(`[verbatim-guard] conversation=${convId} stripped tail=safe-reply`);
    return finish(GUARD_SAFE_REPLY[language], 'stripped', 'safe-reply');
  }
  const tail = chooseGuardTail(stripped, violations, { level: params.level });
  console.error(`[verbatim-guard] conversation=${convId} stripped tail=${tail}`);
  const fullText =
    tail === 'none'
      ? stripped
      : tail === 'partial'
        ? `${stripped}\n\n${GUARD_PARTIAL_DISCLAIMER[language]}`
        : `${stripped}\n\n${GUARD_DISCLAIMER[language]}`;
  return finish(fullText, 'stripped', tail);
}

export type Language = 'zh' | 'en' | 'id';
export type CareMessage = { role: 'user' | 'assistant'; content: string };
export type CareSource = {
  book: string;
  page_start?: number;
  page_end?: number;
  excerpt?: string;
  count: number;
  // Website sources only (batch 2 §6): clickable link + the 开示/节目 date.
  url?: string;
  post_title?: string;
  original_date?: string;
  wp_date?: string;
};

// ── Retrieval + prompt assembly (shared by stream + non-stream) ───────────────

// The previous visitor turn and previous assistant turn from a history array
// (everything BEFORE the current message), for context-aware retrieval of
// short follow-ups (入门锚定 brief). Shared by the web route and WhatsApp.
export function retrievalContextFrom(history: CareMessage[]): RetrievalContext {
  const nonEmpty = history.filter((m) => m.content && m.content.trim().length > 0);
  const prevUser = [...nonEmpty].reverse().find((m) => m.role === 'user');
  const prevAssistant = [...nonEmpty].reverse().find((m) => m.role === 'assistant');
  return {
    prevUserMessage: prevUser?.content,
    prevAssistantMessage: prevAssistant?.content,
  };
}

// The two-block system param: the stable base prompt (cached) + the per-query
// RAG context (varies, uncached). Byte-identical to the array the web route
// used inline.
//
// 1-hour cache TTL (brief 08-30 §1, a cost decision): the cached prefix is
// ~49k tokens; production sees ~35 messages/day in clusters, so the 5-minute
// TTL missed almost every time and each miss paid 1.25× full price. 1h costs
// 2× on write and 0.1× on read — two messages within an hour already win.
export function buildSystemBlocks(
  language: Language,
  contextBlock: string
): Anthropic.TextBlockParam[] {
  return [
    {
      type: 'text',
      text: getSystemPrompt(language),
      cache_control: { type: 'ephemeral', ttl: '1h' },
    },
    ...(contextBlock ? [{ type: 'text' as const, text: contextBlock }] : []),
  ];
}

// Deduplicate retrieved passages by book+page into the capped source list the UI
// and dashboard render. Extracted verbatim from the web route's Step 5.
//
// `replyText` (08-30): books the reply itself cites (《白话佛法视频开示（第三册）》
// in the prose) are listed FIRST, so the 参考开示 footer always includes what
// the reader will try to look up — production showed a reply citing 视频开示
// while the top-3 footer listed only 例说 + 解答来信疑惑 (the cited chunk was
// retrieved, just outside the 3 slots).
export function buildSources(passages: RetrievedPassage[], replyText?: string): CareSource[] {
  const cited = replyText ? replyText.replace(/\s+/g, '') : '';
  const ordered = cited
    ? [...passages].sort((a, b) => Number(cited.includes(b.book)) - Number(cited.includes(a.book)))
    : passages;
  const sourcesMap = new Map<string, CareSource>();
  for (const p of ordered) {
    // Pageless sources (组织审定, 解答来信疑惑, 法会弟子提问) dedupe by excerpt
    // (= doc/post title) so two different letters posts stay distinct entries.
    const key = `${p.book}:${p.page_start ?? p.excerpt ?? 0}`;
    const existing = sourcesMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      sourcesMap.set(key, {
        book: p.book,
        page_start: p.page_start,
        page_end: p.page_end,
        excerpt: p.excerpt,
        count: 1,
        ...(p.url ? { url: p.url } : {}),
        ...(p.post_title ? { post_title: p.post_title } : {}),
        ...(p.original_date ? { original_date: p.original_date } : {}),
        ...(p.wp_date ? { wp_date: p.wp_date } : {}),
      });
    }
  }
  return Array.from(sourcesMap.values()).slice(0, MAX_SOURCES);
}

// ── 同修轮: visitor level (09-13 fellow-practitioner brief + addendum) ────────
export type PersistedLevel = { level: VisitorLevel | null; needsCare: boolean; stageLevel: VisitorLevel | null };

/**
 * What storage already knows before this turn: conversations.level / needs_care
 * (migration 051, upgrade-only) and the volunteer-set contacts.stage (同修 →
 * experienced). By conversation id; on a first turn, the returning browser's
 * contact stage alone. Fail-safe: empty on any error, never throws.
 */
export async function loadPersistedLevel(params: {
  conversationId?: string | null;
  browserId?: string | null;
}): Promise<PersistedLevel> {
  const empty: PersistedLevel = { level: null, needsCare: false, stageLevel: null };
  if (!supabaseAdmin) return empty;
  try {
    if (params.conversationId) {
      const { data } = await supabaseAdmin
        .from('conversations')
        .select('level, needs_care, contact:contacts ( stage )')
        .eq('id', params.conversationId)
        .maybeSingle();
      const row = data as unknown as {
        level: string | null;
        needs_care: boolean | null;
        contact: { stage: string | null } | { stage: string | null }[] | null;
      } | null;
      if (!row) return empty;
      const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact;
      return {
        level: isVisitorLevel(row.level) ? row.level : null,
        needsCare: row.needs_care === true,
        stageLevel: stageToLevel(contact?.stage ?? null),
      };
    }
    if (params.browserId) {
      const { data } = await supabaseAdmin.from('contacts').select('stage').eq('browser_id', params.browserId).maybeSingle();
      return { ...empty, stageLevel: stageToLevel((data as { stage: string | null } | null)?.stage ?? null) };
    }
    return empty;
  } catch (e) {
    console.error('[level] persisted level read failed:', e);
    return empty;
  }
}

export type TurnLevel = { level: VisitorLevel; needsCare: boolean; cueHits: string[]; source: 'cues' | 'persisted' | 'stage' };

/** Pre-reply level: cues over every visitor turn, maxed with what storage knows. */
export function decideTurnLevel(messages: CareMessage[], persisted?: PersistedLevel | null): TurnLevel {
  const visitorTurns = messages.filter((m) => m.role === 'user').map((m) => m.content);
  const cues = levelFromCues(visitorTurns);
  const care = needsCareFromCues(visitorTurns);
  const level = maxLevel(cues.level, persisted?.level, persisted?.stageLevel);
  const source = level === cues.level ? 'cues' : level === persisted?.stageLevel ? 'stage' : 'persisted';
  return {
    level,
    needsCare: care.needsCare || persisted?.needsCare === true,
    cueHits: [...cues.hits, ...care.hits],
    source,
  };
}

/** Per-turn instruction for the (uncached) context block; empty for new／beginner without care signals. */
export function levelContextBlock(turn: Pick<TurnLevel, 'level' | 'needsCare'>): string {
  const parts: string[] = [];
  if (turn.level === 'experienced') {
    parts.push('【本轮判级：同修轮】访客是已在修行的同修。按系统提示词【同修轮】回答：不出 📿 功课块，不写遍数张数（访客明确问数字除外），不问「有没有念经」；师父原文 2–3 段，引文逐字、带出处，再用白话讲怎么用在他身上。');
  } else if (turn.level === 'practising') {
    parts.push('【本轮判级：practising】访客已在念功课。默认不给遍数；访客问「念几遍／几张」或话题本身是教义数字（小房子规格、礼佛特殊日子、369）时才给，给就按功课卡／《佛学问答》161。');
  }
  if (turn.needsCare) {
    parts.push('【关怀】访客可能是长者或需要关怀：句子短、字少，一段师父原文就够；不自创遍数张数；结尾邀请义工联系（「共修会的义工可以来看您／打电话给您」）。');
  }
  return parts.join('\n');
}

/** The retrieval context block with this turn's level instruction appended. */
export function withLevelBlock(contextBlock: string, turn: Pick<TurnLevel, 'level' | 'needsCare'>): string {
  return [contextBlock, levelContextBlock(turn)].filter(Boolean).join('\n\n');
}

// ── Non-streaming reply (WhatsApp) ────────────────────────────────────────────
// Same retrieval + system prompt + model + verbatim guard as the web chat, in
// one blocking call. Retrieval keys off the latest user turn (as the web route
// does); the full message history is passed to Claude for multi-turn context.
export async function generateReply(
  messages: CareMessage[],
  language: Language = 'zh',
  opts: { conversationId?: string | null } = {}
): Promise<{ fullText: string; sources: CareSource[] }> {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const query = lastUser?.content ?? '';
  // 同修轮 (09-13): same pre-reply level judgement as the web route.
  const persisted = opts.conversationId ? await loadPersistedLevel({ conversationId: opts.conversationId }) : null;
  const turnLevel = decideTurnLevel(messages, persisted);
  const ctx: RetrievalContext = { ...retrievalContextFrom(messages.slice(0, -1)), level: turnLevel.level };
  console.log(`[level] conversation=${opts.conversationId ?? 'unknown'} channel=whatsapp level=${turnLevel.level} source=${turnLevel.source} needs_care=${turnLevel.needsCare} cues=${JSON.stringify(turnLevel.cueHits)}`);

  const passages = await searchRelevantTeachings(query, undefined, language, ctx);
  const contextBlock = withLevelBlock(formatPassagesAsContext(passages), turnLevel);

  const { fullText, refused } = await generateGuardedReplyText({
    messages,
    language,
    passages,
    contextBlock,
    conversationId: opts.conversationId,
    effort: chooseReplyEffort({ message: query, messages, ctx }),
    level: turnLevel.level,
  });

  return { fullText, sources: refused ? [] : buildSources(passages, fullText) };
}

// ── Conversation categorisation (cheap, post-reply) ───────────────────────────
// Moved verbatim from the web chat route. A tiny classification pass that runs
// AFTER the reply is delivered; never touches the reply text and is fully
// fail-safe (returns null on any failure so the caller leaves the tag untouched).
//
// E3 (brief §3.3): the category list now comes from org_settings
// 'care.categories' (editable in 设置 → 智慧问答设定); this hardcoded list is
// the FALLBACK when the key is missing or unreachable. Off-list answers fold to
// 其他, which is always appended if the configured list omits it.

export const CONVERSATION_CATEGORIES = [
  '感情婚姻', '家庭', '健康', '事业财运', '学业', '人际关系',
  '修行方法', '因果业障', '解梦', '玄学问答', '闲聊测试', '其他',
] as const;
export type ConversationCategory = string;

export async function classifyConversation(
  messages: CareMessage[]
): Promise<{ category: ConversationCategory; crisis_flag: boolean; level: VisitorLevel | null; needs_care: boolean } | null> {
  try {
    // org_settings list with built-in fallback (never throws; null → fallback).
    const configured = await loadCareCategories();
    const categories = configured ?? [...CONVERSATION_CATEGORIES];
    if (!categories.includes('其他')) categories.push('其他');

    // Only the recent turns, as plain transcript text — keeps the call small.
    const transcript = messages
      .slice(-10)
      .map((m) => `${m.role === 'user' ? '访客' : '助手'}: ${m.content}`)
      .join('\n');

    const result = await anthropic.messages.create({
      model: CLASSIFY_MODEL,
      max_tokens: 40,
      messages: [
        {
          role: 'user',
          content:
            'Read this conversation between a person and a Buddhist care assistant. ' +
            'Reply with EXACTLY ONE line in the form 类别|level|care and nothing else.\n' +
            '类别 = ONE category label from this list:\n' +
            categories.join('、') +
            '\nIf the conversation shows crisis / self-harm / severe distress signals, ' +
            'prefix the category with "危机:" (e.g. "危机:家庭|new|0").\n' +
            // 同修轮 (09-13, migration 051): the visitor's practice level and a
            // care flag, persisted upgrade-only by classifyAndSaveCategory.
            "level = the VISITOR's practice level: new (no practice signs, or asks how/why to start) | " +
            'beginner (just started, cannot recite yet, follows videos) | ' +
            'practising (already does daily 功课 / 小房子 / has an altar, asks count details) | ' +
            'experienced (清修, 境界, 弘法度人, 拜师/弟子, vows already made, 自存, 7749, years of practice, quotes 师父 to ask, elderly long-time practitioner). ' +
            'When unsure between two levels, choose the higher one.\n' +
            'care = 1 if the visitor seems elderly or vulnerable (年事已高, 安老院, 身体不好, 孤单, 家人不修, 独居), else 0.\n\n' +
            `对话:\n${transcript}`,
        },
      ],
    });

    const textPart = result.content.find((b) => b.type === 'text');
    const line = textPart && textPart.type === 'text' ? textPart.text.trim().split('\n')[0].trim() : '';
    if (!line) return null;
    // 类别|level|care — a bare one-label answer (older shape) still parses.
    const [rawLabel, rawLevel, rawCare] = line.split(/[|｜]/).map((s) => s.trim());
    let label = rawLabel ?? '';
    const level = isVisitorLevel(rawLevel) ? rawLevel : null;
    const needs_care = rawCare === '1';

    // Crisis overlay: a "危机:" prefix (half- or full-width colon) applies to any
    // category. Strip it off, then validate the remaining label.
    let crisis_flag = false;
    if (label.startsWith('危机:') || label.startsWith('危机：')) {
      crisis_flag = true;
      label = label.replace(/^危机[:：]\s*/, '').trim();
    }

    const category: ConversationCategory = categories.includes(label) ? label : '其他';

    return { category, crisis_flag, level, needs_care };
  } catch (e) {
    console.error('[classify] conversation classification failed:', e);
    return null;
  }
}

// ── Crisis-protocol reply detection (P1 §1.4) ────────────────────────────────
// The crisis four-step protocol (system-prompt.ts 第十部分) instructs the model
// to hand out these exact hotline identifiers. A normal reply never mentions
// them, so their presence in an ASSISTANT turn is a mechanical (non-fuzzy)
// signal that the reply activated the protocol. Matching is done on a
// whitespace/dash-stripped lowercase form so "03-7627 2929" == "03 7627 2929".
const CRISIS_REPLY_MARKERS = ['befrienders', '0376272929', 'taliankasih', '15999'];

export function replyActivatesCrisisProtocol(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[\s-]+/g, '');
  return CRISIS_REPLY_MARKERS.some((m) => normalized.includes(m));
}

// Classify a conversation and persist the category + crisis overlay onto its row.
// Fully fail-safe (no-ops without storage, never throws). Shared by the web chat
// and WhatsApp so the post-reply tagging behaves identically on both channels.
//
// crisis_flag: the classifier's judgement OR-ed with the mechanical protocol
// detection over every assistant turn in the transcript (P1 §1.4) — a reply
// that handed out a crisis hotline marks the conversation even if the cheap
// classifier misses it, and re-tagging on a later calm message can't erase a
// protocol activation earlier in the same transcript. Crisis conversations are
// thereby excluded from the nightly review pass (eligibility: crisis_flag=false).
// Org-configured crisis keywords (设置 → inbox.crisis_keywords), merged with the
// built-in list. Fail-safe: [] when unreadable.
async function loadOrgCrisisKeywords(): Promise<string[]> {
  if (!supabaseAdmin) return [];
  try {
    const { data } = await supabaseAdmin.from('org_settings').select('value').eq('key', 'inbox.crisis_keywords').maybeSingle();
    const v = data?.value;
    return Array.isArray(v) ? (v as unknown[]).filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

// Keyword crisis floor over the VISITOR turns — mechanical, no model. Used by
// classifyAndSaveCategory and, on its own, by the generation-failure path
// (where the classifier never runs). Returns the keywords that fired.
export async function visitorCrisisKeywords(messages: CareMessage[]): Promise<string[]> {
  const extra = await loadOrgCrisisKeywords();
  const hits = new Set<string>();
  for (const m of messages) {
    if (m.role !== 'user') continue;
    for (const k of matchedCrisisKeywords(m.content, extra)) hits.add(k);
  }
  return [...hits];
}

// Set crisis_flag from keywords alone (failure path: the reply never came, so
// classifyAndSaveCategory is not called — the flag must still land so the
// conversation sorts to the top of the inbox). Never throws.
export async function flagCrisisByKeywords(conversationId: string, messages: CareMessage[]): Promise<boolean> {
  if (!supabaseAdmin) return false;
  try {
    const hits = await visitorCrisisKeywords(messages);
    if (hits.length === 0) return false;
    await supabaseAdmin.from('conversations').update({ crisis_flag: true }).eq('id', conversationId);
    console.error(`[classify] conversation=${conversationId} crisis_flag=true by keywords ${JSON.stringify(hits)} (no classifier run)`);
    return true;
  } catch (e) {
    console.error('[classify] keyword crisis flag failed:', e);
    return false;
  }
}

// Upgrade-only level / needs_care values for one conversation (migration 051):
// max(current, cues over every visitor turn, classifier). Returns only the
// columns that change. Fail-safe: {} on any error.
async function levelUpdateFor(
  conversationId: string,
  messages: CareMessage[],
  tag: { level: VisitorLevel | null; needs_care: boolean } | null
): Promise<{ level?: VisitorLevel; needs_care?: boolean }> {
  if (!supabaseAdmin) return {};
  try {
    const visitorTurns = messages.filter((m) => m.role === 'user').map((m) => m.content);
    const { data } = await supabaseAdmin.from('conversations').select('level, needs_care').eq('id', conversationId).maybeSingle();
    const row = data as { level: string | null; needs_care: boolean | null } | null;
    const current: VisitorLevel | null = row && isVisitorLevel(row.level) ? row.level : null;
    const next = maxLevel(current, levelFromCues(visitorTurns).level, tag?.level);
    const care = needsCareFromCues(visitorTurns).needsCare || tag?.needs_care === true;
    const update: { level?: VisitorLevel; needs_care?: boolean } = {};
    if (next !== current) update.level = next;
    if (care && row?.needs_care !== true) update.needs_care = true;
    if (Object.keys(update).length > 0) {
      console.log(`[level] conversation=${conversationId} persist ${JSON.stringify(update)} (was level=${current} needs_care=${row?.needs_care ?? null}; classifier=${tag?.level ?? null}/${tag?.needs_care ?? null})`);
    }
    return update;
  } catch (e) {
    console.error('[level] level update read failed:', e);
    return {};
  }
}

export async function classifyAndSaveCategory(
  conversationId: string,
  messages: CareMessage[]
): Promise<void> {
  if (!supabaseAdmin) return;
  try {
    // Mechanical floor: the reply handed out a hotline, OR the visitor used a
    // crisis keyword (轻生/不想活/…). The classifier can only ADD to this.
    const keywordHits = await visitorCrisisKeywords(messages);
    const mechanicalCrisis =
      keywordHits.length > 0 ||
      messages.some((m) => m.role === 'assistant' && replyActivatesCrisisProtocol(m.content));
    if (keywordHits.length > 0) {
      console.error(`[classify] conversation=${conversationId} crisis keywords ${JSON.stringify(keywordHits)}`);
    }
    const tag = await classifyConversation(messages);
    // 同修轮 (migration 051): level only ever goes up and needs_care only ever
    // turns on. Cues over every visitor turn are OR-ed in, so a classifier miss
    // or failure never loses what the pre-reply judgement already saw.
    const levelUpdate = await levelUpdateFor(conversationId, messages, tag);
    if (tag) {
      await supabaseAdmin
        .from('conversations')
        .update({ category: tag.category, crisis_flag: tag.crisis_flag || mechanicalCrisis, ...levelUpdate })
        .eq('id', conversationId);
    } else if (mechanicalCrisis || Object.keys(levelUpdate).length > 0) {
      // Classifier failed: persist what is certain — the protocol trip and/or
      // the cue-derived level.
      await supabaseAdmin
        .from('conversations')
        .update({ ...(mechanicalCrisis ? { crisis_flag: true } : {}), ...levelUpdate })
        .eq('id', conversationId);
    }
  } catch (e) {
    console.error('[classify] category save failed:', e);
  }
}
