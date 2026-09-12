// src/lib/vector-search.ts
// XLFM Buddhist Wisdom — Vector Search
// Uses Pinecone integrated inference (multilingual-e5-large)
// Data uploaded to namespace 'xlfm-wisdom' by scripts/upload-wave*.ts

import { Pinecone } from '@pinecone-database/pinecone';
import { supabaseAdmin } from './supabase';
import { buildWisdomRecord } from './wisdom-sync';

// === CONFIG ===
const NAMESPACE = 'xlfm-wisdom';
const DEFAULT_TOP_K = 10;
// Average top-K cosine score below which an en/id query falls back to the
// general (cross-language) corpus. Tunable. Pre-rerank scores from
// multilingual-e5-large typically sit in the 0.6–0.95 range for relevant hits.
const LANG_FALLBACK_THRESHOLD = 0.7;

// === INIT ===
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

const indexName = process.env.PINECONE_INDEX_NAME!;
// (the SDK index handle is not used: queries go through the REST search endpoint below)

// Shape of one hit from the Pinecone records search endpoint (fields = the
// metadata written by the upload scripts).
type PineconeHit = {
  _id: string;
  _score?: number;
  fields?: Partial<{
    text: string;
    chunk_text: string;
    book: string;
    type: string;
    categories: string;
    chunk_index: number;
    page_start: number;
    page_end: number;
    excerpt: string;
    language: 'zh' | 'en' | 'id';
    url: string;
    post_title: string;
    original_date: string;
    wp_date: string;
  }>;
};

// Cache the index host URL for REST fallback
let cachedHost: string | null = null;
async function getIndexHost(): Promise<string> {
  if (cachedHost) return cachedHost;
  const description = await pinecone.describeIndex(indexName);
  cachedHost = description.host;
  return cachedHost;
}

// === TYPES ===

export interface RetrievedPassage {
  id: string;
  score: number;
  text: string;
  book: string;
  type?: string;
  categories?: string;
  chunk_index?: number;
  page_start?: number;
  page_end?: number;
  excerpt?: string;
  // Explicit language tag on new uploads. Absent on legacy zh chunks (Option B
  // backfill: untagged → treat as zh by default).
  language?: 'zh' | 'en' | 'id';
  // Website sources (lujunhong2or): link + 开示/节目 date, surfaced in the
  // 参考开示 footer as a clickable link (batch 2 §6). Absent on book chunks.
  url?: string;
  post_title?: string;
  original_date?: string;
  wp_date?: string;
  // 09-12 strip-tails §A: a pinned 组织审定 card (智库 pinned=true) attached to
  // every retrieval regardless of similarity.
  pinned?: boolean;
  // True when this chunk came back via the cross-language fallback path
  // (en/id user, primary lang-filtered results were weak, no-filter retry
  // surfaced this chunk). Internal only — used for logging.
  cross_language_fallback?: boolean;
}

export type Topic =
  | 'marriage_emotion'
  | 'health'
  | 'children'
  | 'karma_debt'
  | 'karma_warning'
  | 'practice_method'
  | 'muslim_boundary'
  | 'canonical_ritual_numbers'
  | 'homework_baseline'
  | 'little_house_baseline';

// ── Follow-up context (入门锚定 brief, 2026-08-29) ───────────────────────────
// A short follow-up like 「没有学过」 embeds to nothing useful on its own: conv
// c47ffe52 retrieved three 白话佛法 passages about 学佛 in general and the
// guard then stripped every 遍数 the prompt had correctly produced. Two
// complementary fixes, both used:
//   (a) query concatenation — for SHORT follow-ups the previous visitor turn
//       is prepended to the RETRIEVAL query only (the model still sees the
//       real conversation history); fixes 「是的」「好」「那小房子呢」 too.
//   (b) triage marker — when the previous assistant turn asked the beginner
//       triage question (有念过经吗 / 刚接触), this turn is forced onto the
//       功课 baseline regardless of wording.
export type RetrievalContext = {
  prevUserMessage?: string;
  prevAssistantMessage?: string;
};

const SHORT_FOLLOWUP_MAX_CHARS = 40;
const TRIAGE_QUESTION_RE =
  /念过经吗|念过经|学过经|刚接触|完全刚|第一次(念|接触)|从哪里开始|have you (ever )?(chanted|recited)|new to (this|chanting)|pernah (membaca|melafalkan)/i;

export function buildRetrievalQuery(message: string, ctx?: RetrievalContext): string {
  const cur = message.trim();
  const prev = ctx?.prevUserMessage?.trim();
  if (prev && cur.length <= SHORT_FOLLOWUP_MAX_CHARS) return `${prev} ${cur}`;
  return cur;
}

export function isBeginnerTriageFollowup(ctx?: RetrievalContext): boolean {
  return Boolean(ctx?.prevAssistantMessage && TRIAGE_QUESTION_RE.test(ctx.prevAssistantMessage));
}

// 组织审定 canonical rulings (type: 'canonical_ruling' in the corpus). These are
// org-verified doctrine tables (e.g. 礼佛大忏悔文特殊日子遍数) that must BEAT
// ordinary book chunks whenever they match: production incidents 29cfd74c /
// 6b6f74ff showed the model reconstructing 遍数 from stray context when the
// real table wasn't retrieved. The boost is far above cosine-score spread, so
// a retrieved canonical chunk always sorts first.
const CANONICAL_TYPE = 'canonical_ruling';
const CANONICAL_BOOST = 0.5;

// 功课 baseline retrieval (see searchRelevantTeachings): fixed queries that
// guarantee the general daily-功课 counts are in context. PRIMARY is
// 《心灵法门入门手册》 — p23 「一般初学者功课」, p24 礼佛 一遍至七遍/一般3遍左右,
// p29 「每天念《大悲咒》7遍、《心经》7遍、礼佛大忏悔文1-3遍左右，《往生咒》21或
// 49遍」. 《佛学问答175问》 stays as a one-chunk second baseline (p82 gives only
// the vague 「一般1遍至7遍」 range, which is why it was the wrong primary).
const HOMEWORK_BASELINE_BOOK = '心灵法门入门手册';
const HOMEWORK_BASELINE_QUERY = '一般初学者功课 每天念大悲咒几遍 心经几遍 礼佛大忏悔文几遍 往生咒几遍';
const HOMEWORK_BASELINE_BOOK_2 = '佛学问答175问';
const HOMEWORK_BASELINE_QUERY_2 = '初学者每天功课：大悲咒、心经、礼佛大忏悔文一般各念几遍';
// EN/ID turns use the English editions (there is no BM edition in the corpus).
const HOMEWORK_BASELINE_BOOK_EN = 'Heart Dharma Intro (EN)';
const HOMEWORK_BASELINE_QUERY_EN =
  'daily recitation for beginners how many times Great Compassion Mantra Heart Sutra Eighty-Eight Buddhas Repentance';

// 小房子 baseline: the recitation guide's own how-to chunks, for questions
// that mention Little Houses directly. ⚠️ Corpus gap (architect to fix): the
// p14 「念诵者条件」 section (「必须做好基本功课的情况下，才能念诵小房子…」 and
// 「在每日功课均有保证的情况下…即可开始念诵小房子」) is NOT in the indexed
// chunks — p12-17 chunks cover uses/printing. Until re-chunked, the threshold
// (「有没有开始做功课」, per p14 + p48 Q14) is carried by the system prompt's
// 【入门轮硬性规则】 only, not by a verbatim quote.
const LITTLE_HOUSE_BASELINE_BOOK = '小房子念诵指南';
const LITTLE_HOUSE_BASELINE_QUERY = '小房子 念诵者条件 尺寸 经文组合 填写 烧送 时间';
const LITTLE_HOUSE_BASELINE_BOOK_EN = 'A Guide to Reciting Little Houses (EN)';
const LITTLE_HOUSE_BASELINE_QUERY_EN = 'Little House recitation who can recite paper size combination of scriptures how to fill in burn time';

// === BOOK PRIORITY (for tie-breaking) ===
// When two passages have similar relevance scores, prefer these sources
const BOOK_PRIORITY: Record<string, number> = {
  '弘法度人辅导手册': 10,   // counseling methodology
  '佛学问答175问': 9,       // direct Master Lu Q&A
  '心灵法门例说': 8,        // real case studies
  '佛教念诵合集': 7,        // scripture texts
};

// DYNAMIC beginner boost (入门锚定 brief): on a 功课/小房子-intent turn the two
// beginner handbooks must outrank 弘法度人辅导手册 (BOOK_PRIORITY 10 → +0.10)
// — a newcomer asking 「我该念什么」 was being answered from the volunteer
// training manual and advanced Q&A compilations (入门手册 ranked 15th over
// 60 days). Dynamic rather than static so 度人手册 still leads when a
// volunteer asks 怎么度人.
const BEGINNER_BOOK_BOOST = 0.12;
const BEGINNER_BOOKS = new Set([
  HOMEWORK_BASELINE_BOOK,
  LITTLE_HOUSE_BASELINE_BOOK,
  HOMEWORK_BASELINE_BOOK_EN,
  LITTLE_HOUSE_BASELINE_BOOK_EN,
]);

// === TOPIC DETECTION ===
// Cheap keyword router so the RAG layer can bias retrieval toward the
// right specialist books instead of whatever the embedding model drifts toward.

const TOPIC_KEYWORDS: Record<Topic, string[]> = {
  marriage_emotion: [
    '老公', '老婆', '丈夫', '妻子', '夫妻', '婚姻', '外遇', '出轨',
    '离婚', '感情', '恋爱', '分手', '家暴', '第三者', '爱情',
    '前夫', '前妻', '再婚',
  ],
  health: [
    '生病', '疾病', '医院', '癌症', '手术', '身体', '健康', '病人',
    '皮肤病', '失眠', '头痛', '痛苦', '不舒服', '治疗',
  ],
  children: [
    '孩子', '小孩', '儿子', '女儿', '学生', '孙子', '孙女', '教育',
  ],
  karma_debt: [
    '业障', '冤结', '因果', '前世', '还债', '要经者', '小灵性',
  ],
  // Crisis-shaped karma questions that the four-step crisis protocol needs to
  // answer with factual warnings from 佛子天地游记 / 白话佛法.
  karma_warning: [
    '自杀', '自伤', '轻生', '堕胎', '打胎', '流产', '果报', '报应',
    '杀生', '堕落', '地狱', '死后', '投胎', '超生',
  ],
  practice_method: [
    '念经', '大悲咒', '心经', '礼佛', '解结咒', '小房子', '放生',
    '许愿', '功课', '佛台', '怎么念', '多少遍',
  ],
  // 08-29: 「念什么经好 / 功课怎么做 / 刚开始」-shaped questions (the #1
  // cluster: 失眠 / 家人生病) previously matched only `health`, so no general
  // 功课 baseline was in context and the reply could not state any 遍数.
  // Deliberately NARROWER than practice_method (which fires on any 念经/心经
  // mention): the baseline chunks carry BOOK_PRIORITY and would otherwise
  // crowd the letter/case source out of the 3-slot sources list (R4).
  homework_baseline: [
    '什么经', '哪些经', '什么咒', '念什么', '几遍', '多少遍', '功课',
    '怎么念', '刚开始', '初学', '入门', '第一步',
    // 08-30: 「我可以先学什么？」 (homepage chip) is a 功课 question too.
    '学什么', '先学',
    // 入门锚定 brief: the beginner's own words after the triage question.
    '没学过', '没有学过', '不会念', '不懂念', '零基础', '完全刚接触', '刚接触',
    '新手', '第一次念', '没念过', '没有念过', '从零开始', '怎么开始', '从哪里开始',
    'beginner', 'just started', 'never chanted', 'never recited', 'how to start',
    'pemula', 'baru mulai', 'belum pernah',
    // Batch 2 §6: the EN/ID homepage chips ran at medium effort because none
    // of these matched — 「which sutras should I recite」 is a 功课 question.
    'what should i chant', 'what should i recite', 'which sutras', 'how do i start', 'first step',
    'apa yang harus', 'bagaimana mulai', 'langkah pertama', 'sutra apa',
    // Audit F09: "what is 心灵法门 / introduce it" is a first-step question —
    // without the baseline the reply could not state any 功课.
    '什么是心灵法门', '心灵法门是什么', '介绍一下',
    'what is Guan Yin Citta', 'apa itu',
  ],
  // 小房子 questions → 《小房子念诵指南》 baseline (see LITTLE_HOUSE_BASELINE_*).
  little_house_baseline: [
    '小房子', '要经者', '敬赠', '烧送', '自存', '化解冤结的小房子',
    'little house', 'little houses', 'karmic creditor',
  ],
  // Malaysia legal red line. No dedicated retrieval collection — this topic
  // exists purely to mark the query so Section 21 of the system prompt
  // (穆斯林边界) can enforce the mandatory template. Propagation advice to
  // Muslims is a criminal offense under state-level enactments.
  muslim_boundary: [
    '穆斯林', '回教', '回教徒', '马来人', '伊斯兰',
    'Muslim', 'Islam', 'Malay', 'Melayu',
    '马来朋友', '穆斯林朋友', '回教朋友',
  ],
  // Doctrinal-numbers queries (礼佛遍数 / 特殊日子 / 佛诞 / 小房子张数 …):
  // routes a guaranteed parallel query against the 组织审定 canonical docs so
  // the authoritative table is ALWAYS in context for these questions.
  canonical_ritual_numbers: [
    '礼佛', '遍数', '几遍', '多少遍', '张数', '几张', '多少张',
    '初一', '十五', '佛诞', '圣诞', '诞辰', '成道', '出家日', '涅槃日',
    '年三十', '除夕', '年初一', '大年初一', '元旦', '元宵', '中秋',
    '中元', '清明', '冬至', '重阳', '端午', '春节',
    '孕妇', '坐月子', '自修经文', '自存',
    '地藏王', '弥勒', '阿弥陀', '大势至', '燃灯古佛', '释迦牟尼',
  ],
};

// Score boost applied during re-ranking when a passage's `type` matches a
// detected topic. Chosen to be smaller than 0.1 so cosine-similarity ordering
// still dominates — these only break near-ties.
const TOPIC_TYPE_BOOST: Record<Topic, Record<string, number>> = {
  marriage_emotion: { marriage_case_study: 0.05 },
  health: { case_study: 0.04, disease_encyclopedia: 0.04 },
  children: {},
  karma_debt: { xiaofangzi_guide: 0.04, buddhist_basics: 0.02 },
  karma_warning: { spirit_world: 0.05 },
  practice_method: {
    beginner_guide: 0.03,
    altar_guide: 0.03,
    xiaofangzi_guide: 0.03,
    ethics_guide: 0.02,
  },
  muslim_boundary: {},
  // Canonical docs get CANONICAL_BOOST via their type, not a topic-type boost.
  canonical_ritual_numbers: {},
  // Baseline books get the dynamic BEGINNER_BOOK_BOOST instead.
  homework_baseline: {},
  little_house_baseline: {},
};

export function detectTopics(query: string): Topic[] {
  const detected: Topic[] = [];
  for (const topic of Object.keys(TOPIC_KEYWORDS) as Topic[]) {
    // Case-insensitive so 「What should I chant」 matches the lowercase EN/ID keywords.
    const q = query.toLowerCase();
    if (TOPIC_KEYWORDS[topic].some((kw) => q.includes(kw.toLowerCase()))) {
      detected.push(topic);
    }
  }
  return detected;
}

// === LOW-LEVEL PINECONE SEARCH ===

async function pineconeSearch(
  query: string,
  topK: number,
  filter?: object
): Promise<RetrievedPassage[]> {
  const host = await getIndexHost();

  const body: Record<string, unknown> = {
    query: {
      inputs: { text: query },
      top_k: topK,
      ...(filter ? { filter } : {}),
    },
  };

  const response = await fetch(
    `https://${host}/records/namespaces/${NAMESPACE}/search`,
    {
      method: 'POST',
      headers: {
        'Api-Key': process.env.PINECONE_API_KEY!,
        'Content-Type': 'application/json',
        'X-Pinecone-API-Version': '2025-01',
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[vector-search] Pinecone REST error ${response.status}:`, errText);
    return [];
  }

  const data = await response.json();
  const hits = data?.result?.hits || [];

  return hits.map((hit: PineconeHit) => ({
    id: hit._id,
    score: hit._score || 0,
    // Upload scripts write the passage under `text`; keep chunk_text as a
    // historical fallback in case any older batch used that name.
    text: hit.fields?.text ?? hit.fields?.chunk_text ?? '',
    book: hit.fields?.book || 'Unknown',
    type: hit.fields?.type,
    categories: hit.fields?.categories,
    chunk_index: hit.fields?.chunk_index,
    page_start: hit.fields?.page_start,
    page_end: hit.fields?.page_end,
    excerpt: hit.fields?.excerpt,
    language: hit.fields?.language,
    url: hit.fields?.url,
    post_title: hit.fields?.post_title,
    original_date: hit.fields?.original_date,
    wp_date: hit.fields?.wp_date,
  }));
}

// === PINNED 组织审定 CARDS (09-12 strip-tails brief §A) ===
// Approved 智库 entries with pinned=true (migration 049) — today the 「常用经文
// 标准遍数卡」 — are appended to EVERY retrieval (zh/en/id; the guard reads
// Chinese counts) as canonical_ruling passages, so the standard 遍数 are
// always a grounded source. Not ranked, never dropped by topK. Cached for
// 5 minutes per process; approve/retire/edit clears it through the same
// hook as the chip cache (chip-answers invalidateChipAnswers). Locally
// (scripts without Supabase keys) the same records are read from Pinecone
// through the pinned=true metadata they carry.
const PINNED_TTL_MS = 5 * 60_000;
let pinnedCache: { at: number; passages: RetrievedPassage[] } | null = null;

export function invalidatePinnedCanon(): void {
  pinnedCache = null;
}

export async function getPinnedCanonPassages(): Promise<RetrievedPassage[]> {
  if (pinnedCache && Date.now() - pinnedCache.at < PINNED_TTL_MS) return pinnedCache.passages;
  let passages: RetrievedPassage[] = [];
  try {
    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('wisdom_entries')
        .select('id, canonical_question, variants, keywords, answer_guidance, language, pinned')
        .eq('status', 'approved')
        .eq('pinned', true)
        .order('created_at', { ascending: true });
      if (error) throw error;
      passages = (data ?? []).map((e) => {
        const rec = buildWisdomRecord(e);
        return {
          id: rec._id as string,
          score: 1,
          text: rec.text as string,
          book: '组织审定',
          type: CANONICAL_TYPE,
          language: e.language as 'zh' | 'en' | 'id',
          pinned: true,
        };
      });
    } else {
      const hits = await pineconeSearch('常用经文标准遍数 每天念多少遍', 10, {
        pinned: { $eq: true },
        type: { $eq: CANONICAL_TYPE },
      });
      passages = hits.map((p) => ({ ...p, score: 1, pinned: true }));
    }
  } catch (e) {
    console.error('[vector-search] pinned canon fetch failed:', e);
    passages = pinnedCache?.passages ?? [];
  }
  pinnedCache = { at: Date.now(), passages };
  return passages;
}

/** Append the pinned cards to a ranked result (dedupe by id). */
async function withPinnedCanon(ranked: RetrievedPassage[]): Promise<RetrievedPassage[]> {
  const pinned = await getPinnedCanonPassages();
  if (pinned.length === 0) return ranked;
  const ids = new Set(ranked.map((p) => p.id));
  return [...ranked, ...pinned.filter((p) => !ids.has(p.id))];
}

// === MAIN SEARCH FUNCTION ===

/**
 * Search XLFM content via Pinecone integrated inference.
 *
 * Pipeline:
 *   1. Detect topics from the query (cheap keyword match).
 *   2. For topics with a dedicated book collection (currently marriage_emotion
 *      via book_category='marriage_emotion'), run a filtered query in parallel
 *      with the general query and merge. This guarantees the specialist book
 *      gets a minimum share of the final context instead of being drowned out
 *      by high-scoring-but-off-topic chunks.
 *   3. Dedupe by id (keep the higher score).
 *   4. Re-rank with a light BOOK_PRIORITY boost + topic-type boost.
 */
export async function searchRelevantTeachings(
  rawQuery: string,
  topK: number = DEFAULT_TOP_K,
  userLang: 'zh' | 'en' | 'id' = 'zh',
  ctx?: RetrievalContext,
): Promise<RetrievedPassage[]> {
  if (!rawQuery || rawQuery.trim().length === 0) return [];

  try {
    // Retrieval query = the visitor's turn, with the previous visitor turn
    // prepended for short follow-ups (see RetrievalContext). Topic detection
    // runs on the same text, so 「没有学过」 after 「念什么经好」 still routes
    // to the 功课 baseline; the triage marker forces it regardless.
    const query = buildRetrievalQuery(rawQuery, ctx);
    const topics = detectTopics(query);
    if (isBeginnerTriageFollowup(ctx) && !topics.includes('homework_baseline')) {
      topics.push('homework_baseline');
    }
    const beginnerTurn =
      topics.includes('homework_baseline') || topics.includes('little_house_baseline');

    // Language filter strategy:
    // - zh users: NO filter. The 13,856 legacy zh chunks have no `language`
    //   field, so a `language: $eq: 'zh'` filter would zero them out (Option B
    //   backfill convention). Embedding similarity already biases against
    //   cross-language matches naturally.
    // - en/id users: filter to userLang so language-tagged chunks dominate.
    const langFilter = userLang === 'zh' ? null : { language: { $eq: userLang } };

    const mergeWith = (extra?: object): object | undefined => {
      const merged: Record<string, unknown> = {};
      if (langFilter) Object.assign(merged, langFilter);
      if (extra) Object.assign(merged, extra);
      return Object.keys(merged).length > 0 ? merged : undefined;
    };

    // Build parallel queries. General query first, plus filtered queries for
    // any topic that has a dedicated book collection in the corpus. Language
    // filter (if any) is merged into every primary query.
    // Per-query timing (入门轮 brief problem 3): every query below runs in ONE
    // Promise.all — no serial waits — so wall-clock ≈ the slowest query.
    const timings: Record<string, number> = {};
    const timed = (label: string, p: Promise<RetrievedPassage[]>): Promise<RetrievedPassage[]> => {
      const t0 = Date.now();
      return p.finally(() => {
        timings[label] = Date.now() - t0;
      });
    };
    const tStart = Date.now();
    const queries: Promise<RetrievedPassage[]>[] = [
      timed('general', pineconeSearch(query, topK, mergeWith())),
    ];

    if (topics.includes('marriage_emotion')) {
      queries.push(
        timed('marriage', pineconeSearch(query, 7, mergeWith({ book_category: { $eq: 'marriage_emotion' } })))
      );
    }

    // Wave 6A wiring: health books (疾病百科 / 疾病实例) + spirit-realm books
    // (佛子天地游记) now have book_category, so the same two-query merge
    // pattern can guarantee they surface for illness queries and for crisis
    // protocol karma-warning scenarios.
    if (topics.includes('health')) {
      queries.push(
        timed('health', pineconeSearch(query, 5, mergeWith({ book_category: { $eq: 'health' } })))
      );
    }
    if (topics.includes('karma_warning')) {
      queries.push(
        timed('karma_warning', pineconeSearch(query, 5, mergeWith({ book_category: { $eq: 'spirit_realm' } })))
      );
    }
    // 组织审定 canonical rulings: guaranteed retrieval for doctrinal-numbers
    // queries. Deliberately NOT language-filtered — the canonical tables are
    // zh-only but authoritative for every user language.
    if (topics.includes('canonical_ritual_numbers')) {
      queries.push(timed('canonical', pineconeSearch(query, 4, { type: { $eq: CANONICAL_TYPE } })));
    }
    // 功课 baseline (08-29): for 功课-shaped questions, guarantee the general
    // daily-功课 counts are in context. Without this, a 失眠 question
    // retrieves only 疾病百科/例说 case chunks and the verbatim guard — which
    // only allows counts present in the retrieved text — leaves the reply
    // with no 遍数 to give. Fixed query text (not the visitor's). 入门手册
    // first (3 chunks: p23 一般初学者功课 / p24 / p29), 175问 second (1 chunk).
    if (topics.includes('homework_baseline')) {
      if (userLang === 'zh') {
        queries.push(
          timed('homework_入门手册', pineconeSearch(HOMEWORK_BASELINE_QUERY, 3, { book: { $eq: HOMEWORK_BASELINE_BOOK } })),
          timed('homework_175问', pineconeSearch(HOMEWORK_BASELINE_QUERY_2, 1, { book: { $eq: HOMEWORK_BASELINE_BOOK_2 } }))
        );
      } else {
        queries.push(
          timed('homework_en', pineconeSearch(HOMEWORK_BASELINE_QUERY_EN, 3, { book: { $eq: HOMEWORK_BASELINE_BOOK_EN } }))
        );
      }
    }
    // 小房子 baseline: the recitation guide's own how-to chunks.
    if (topics.includes('little_house_baseline')) {
      queries.push(
        timed(
          'little_house',
          userLang === 'zh'
            ? pineconeSearch(LITTLE_HOUSE_BASELINE_QUERY, 2, { book: { $eq: LITTLE_HOUSE_BASELINE_BOOK } })
            : pineconeSearch(LITTLE_HOUSE_BASELINE_QUERY_EN, 2, { book: { $eq: LITTLE_HOUSE_BASELINE_BOOK_EN } })
        )
      );
    }

    const resultGroups = await Promise.all(queries);
    const primaryResults = resultGroups.flat();
    console.log(`[vector-search] timing parallel=${queries.length} wall_ms=${Date.now() - tStart} per_query=${JSON.stringify(timings)}`);

    // Cross-language fallback: only for en/id users when primary results are
    // weak (zero hits, or average top-K cosine below threshold). Re-runs the
    // general query with NO filter to pull from the broader corpus (mostly
    // legacy zh under Option B).
    let fallbackResults: RetrievedPassage[] = [];
    let fallbackTriggered = false;
    let avgPrimaryScore: number | undefined;

    if (userLang !== 'zh') {
      if (primaryResults.length === 0) {
        fallbackTriggered = true;
      } else {
        const sorted = [...primaryResults].sort((a, b) => b.score - a.score);
        const sample = sorted.slice(0, topK);
        avgPrimaryScore = sample.reduce((s, p) => s + p.score, 0) / sample.length;
        if (avgPrimaryScore < LANG_FALLBACK_THRESHOLD) {
          fallbackTriggered = true;
        }
      }

      if (fallbackTriggered) {
        const fb = await pineconeSearch(query, topK);
        fallbackResults = fb.map(r => ({ ...r, cross_language_fallback: true }));
      }
    }

    console.log('[vector-search]', {
      userLang,
      topics,
      contextual: query !== rawQuery.trim(),
      triageFollowup: isBeginnerTriageFollowup(ctx),
      primaryCount: primaryResults.length,
      avgPrimaryScore: avgPrimaryScore?.toFixed(3),
      fallbackTriggered,
      fallbackCount: fallbackResults.length,
    });

    // Dedupe by id, keeping the highest score per unique chunk. When a chunk
    // appears in both primary and fallback, the higher-score wins; for equal
    // scores existing primary wins (cross_language_fallback flag stays unset).
    const uniqueById = new Map<string, RetrievedPassage>();
    for (const p of [...primaryResults, ...fallbackResults]) {
      const existing = uniqueById.get(p.id);
      if (!existing || p.score > existing.score) {
        uniqueById.set(p.id, p);
      }
    }

    // Re-rank: canonical-ruling boost (always first) + topic-type boost +
    // book-priority tie-breaker
    const ranked = Array.from(uniqueById.values())
      .map((p) => {
        let boost = (BOOK_PRIORITY[p.book] || 0) * 0.01;
        if (p.type === CANONICAL_TYPE) boost += CANONICAL_BOOST;
        if (beginnerTurn && BEGINNER_BOOKS.has(p.book)) boost += BEGINNER_BOOK_BOOST;
        for (const topic of topics) {
          if (p.type && TOPIC_TYPE_BOOST[topic][p.type]) {
            boost += TOPIC_TYPE_BOOST[topic][p.type];
          }
        }
        return { ...p, score: p.score + boost };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return await withPinnedCanon(ranked);
  } catch (err) {
    console.error('[vector-search] Search failed:', err);
    return [];
  }
}

/**
 * Format retrieved passages into a context block for Claude.
 */
export function formatPassagesAsContext(passages: RetrievedPassage[]): string {
  if (passages.length === 0) return '';

  const blocks = passages.map((p, i) => {
    const pageInfo = p.page_start
      ? (p.page_start === p.page_end ? `第 ${p.page_start} 页` : `第 ${p.page_start}-${p.page_end} 页`)
      : '';
    return `【参考 ${i + 1}】出自《${p.book}》${pageInfo}\n${p.text.trim()}`;
  });

  return `以下是从台长著作中检索到的相关开示。请基于这些内容回答用户问题，自然融入，不要生硬抄录。\n\n${blocks.join('\n\n---\n\n')}`;
}

/**
 * One-shot helper: query + format into context block.
 */
export async function getRelevantContext(
  query: string,
  topK: number = DEFAULT_TOP_K,
  userLang: 'zh' | 'en' | 'id' = 'zh',
): Promise<{ context: string; passages: RetrievedPassage[] }> {
  const passages = await searchRelevantTeachings(query, topK, userLang);
  const context = formatPassagesAsContext(passages);
  return { context, passages };
}
