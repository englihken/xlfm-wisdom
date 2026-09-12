// src/lib/chip-answers.ts
// Cached, guard-verified replies for the six homepage chip questions
// (migration 046 chip_answers). 20.4% of conversations open with a chip and
// each one paid the full Opus turn (30–60 s) for a fixed answer.
//
//   lookupChipAnswer  — /api/chat: exact question match, not invalidated,
//                       generated within CHIP_TTL_MS → serve in <1 s
//   storeChipAnswer   — /api/chat after a live miss, and the refresh: only
//                       guard=clean | passed_after_retry (the table's CHECK
//                       rejects anything else; a stripped reply is never cached)
//   invalidateChipAnswers — 智库 approve: the corpus changed, so every cached
//                       chip answer is stale until regenerated
//   refreshChipAnswers — nightly: regenerate whatever is expired/invalidated,
//                       a few in parallel, inside a time budget
//
// Every function is fail-safe: storage off or any error → behaves as a miss.

import { supabaseAdmin } from './supabase';
import { invalidatePinnedCanon } from './vector-search';
import { allChips, type ChipKey, type ChipLanguage } from './quick-questions';
import type { CareSource, GuardOutcome } from './care-pipeline';

export const CHIP_TTL_MS = 24 * 60 * 60 * 1000;

export type ChipAnswerHit = {
  chipKey: ChipKey;
  language: ChipLanguage;
  answerText: string;
  sources: CareSource[];
  model: string;
  generatedAt: string;
};

export async function lookupChipAnswer(
  question: string,
  language: ChipLanguage
): Promise<ChipAnswerHit | null> {
  if (!supabaseAdmin) return null;
  try {
    const { data, error } = await supabaseAdmin
      .from('chip_answers')
      .select('chip_key, language, answer_text, sources, model, generated_at')
      .eq('question', question)
      .eq('language', language)
      .is('invalidated_at', null)
      .gte('generated_at', new Date(Date.now() - CHIP_TTL_MS).toISOString())
      .maybeSingle();
    if (error || !data) return null;
    return {
      chipKey: data.chip_key as ChipKey,
      language: data.language as ChipLanguage,
      answerText: data.answer_text as string,
      sources: (Array.isArray(data.sources) ? data.sources : []) as CareSource[],
      model: data.model as string,
      generatedAt: data.generated_at as string,
    };
  } catch (e) {
    console.error('[chip-answers] lookup failed:', e);
    return null;
  }
}

export async function storeChipAnswer(params: {
  chipKey: ChipKey;
  language: ChipLanguage;
  question: string;
  answerText: string;
  sources: CareSource[];
  model: string;
  guard: GuardOutcome;
  refused: boolean;
}): Promise<boolean> {
  if (!supabaseAdmin) return false;
  // Only a reply that passed the verbatim guard is worth serving 24h.
  if (params.refused) return false;
  if (params.guard !== 'clean' && params.guard !== 'passed_after_retry') return false;
  try {
    const { error } = await supabaseAdmin.from('chip_answers').upsert(
      {
        chip_key: params.chipKey,
        language: params.language,
        question: params.question,
        answer_text: params.answerText,
        sources: params.sources,
        model: params.model,
        guard_outcome: params.guard,
        generated_at: new Date().toISOString(),
        invalidated_at: null,
      },
      { onConflict: 'chip_key,language' }
    );
    if (error) {
      console.error('[chip-answers] store failed:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[chip-answers] store failed:', e);
    return false;
  }
}

// Mark every cached chip answer stale (智库 entry approved → the retrieval
// corpus changed). The next visitor click regenerates and re-caches; the
// nightly refresh does the rest.
export async function invalidateChipAnswers(reason: string): Promise<number> {
  // Same hook for the pinned 组织审定 cards (09-12 §A): the corpus changed.
  invalidatePinnedCanon();
  if (!supabaseAdmin) return 0;
  try {
    const { data, error } = await supabaseAdmin
      .from('chip_answers')
      .update({ invalidated_at: new Date().toISOString() })
      .is('invalidated_at', null)
      .select('id');
    if (error) {
      console.error('[chip-answers] invalidate failed:', error);
      return 0;
    }
    const n = (data ?? []).length;
    console.log(`[chip-answers] invalidated ${n} cached answers (${reason})`);
    return n;
  } catch (e) {
    console.error('[chip-answers] invalidate failed:', e);
    return 0;
  }
}

export type ChipRefreshRun = {
  total: number;
  stale: number;
  attempted: number;
  stored: number;
  notCacheable: number;
  failed: number;
  skippedBudget: number;
};

// Regenerate stale chip answers. `staleAfterMs` defaults to 20h so a nightly
// run refreshes everything served during the day before the 24h TTL lapses.
// Generation goes through the SAME retrieval + guarded pipeline as a live
// turn, so a cached answer is exactly what the visitor would have received.
export async function refreshChipAnswers(opts: {
  budgetMs?: number;
  concurrency?: number;
  staleAfterMs?: number;
  force?: boolean;
} = {}): Promise<ChipRefreshRun> {
  const run: ChipRefreshRun = { total: 0, stale: 0, attempted: 0, stored: 0, notCacheable: 0, failed: 0, skippedBudget: 0 };
  if (!supabaseAdmin) return run;
  const deadline = Date.now() + (opts.budgetMs ?? 240_000);
  const concurrency = Math.max(1, opts.concurrency ?? 6);
  const staleAfterMs = opts.staleAfterMs ?? 20 * 60 * 60 * 1000;

  const chips = allChips();
  run.total = chips.length;

  // Current rows: fresh = same question text, not invalidated, generated recently.
  const { data: rows, error } = await supabaseAdmin
    .from('chip_answers')
    .select('chip_key, language, question, generated_at, invalidated_at');
  if (error) {
    console.error('[chip-answers] refresh select failed:', error);
    return run;
  }
  // Age of each chip's usable row (Infinity = none / invalidated / wording changed).
  const ageMs = new Map<string, number>();
  for (const r of (rows ?? []) as { chip_key: string; language: string; question: string; generated_at: string; invalidated_at: string | null }[]) {
    if (r.invalidated_at) continue;
    ageMs.set(`${r.chip_key}|${r.language}|${r.question}`, Date.now() - new Date(r.generated_at).getTime());
  }
  const age = (c: { key: string; language: string; question: string }) =>
    ageMs.get(`${c.key}|${c.language}|${c.question}`) ?? Number.POSITIVE_INFINITY;
  // Oldest first, so a tight budget goes to the entries closest to expiry.
  const stale = chips
    .filter((c) => opts.force || age(c) > staleAfterMs)
    .sort((a, b) => age(b) - age(a));
  run.stale = stale.length;
  if (stale.length === 0) return run;

  // Imported lazily so this module stays cheap to load from the wisdom route.
  const { searchRelevantTeachings, formatPassagesAsContext } = await import('./vector-search');
  const { generateGuardedReplyText, buildSources, chooseReplyEffort, REPLY_MODEL } = await import('./care-pipeline');

  const queue = [...stale];
  const worker = async () => {
    while (queue.length > 0) {
      // Leave headroom: one chip turn can take 60–90 s with a guard retry.
      if (Date.now() > deadline - 90_000) {
        run.skippedBudget += queue.length;
        queue.length = 0;
        return;
      }
      const chip = queue.shift()!;
      run.attempted++;
      try {
        const passages = await searchRelevantTeachings(chip.question, undefined, chip.language);
        const contextBlock = formatPassagesAsContext(passages);
        const messages = [{ role: 'user' as const, content: chip.question }];
        const out = await generateGuardedReplyText({
          messages,
          language: chip.language,
          passages,
          contextBlock,
          conversationId: `chip-refresh:${chip.key}:${chip.language}`,
          effort: chooseReplyEffort({ message: chip.question, messages }),
        });
        const sources = out.refused ? [] : buildSources(passages, out.fullText);
        const ok = await storeChipAnswer({
          chipKey: chip.key,
          language: chip.language,
          question: chip.question,
          answerText: out.fullText,
          sources,
          model: REPLY_MODEL,
          guard: out.guard,
          refused: out.refused,
        });
        if (ok) run.stored++;
        else {
          run.notCacheable++;
          console.warn(`[chip-answers] ${chip.key}/${chip.language} not cached (guard=${out.guard} refused=${out.refused})`);
        }
      } catch (e) {
        run.failed++;
        console.error(`[chip-answers] refresh ${chip.key}/${chip.language} failed:`, e);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, stale.length) }, worker));
  console.log('[chip-answers] refresh', JSON.stringify(run));
  return run;
}
