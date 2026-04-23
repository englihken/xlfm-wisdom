// src/lib/vector-search.ts
// XLFM Buddhist Wisdom — Vector Search
// Uses Pinecone integrated inference (multilingual-e5-large)
// Data uploaded to namespace 'xlfm-wisdom' by scripts/upload-wave*.ts

import { Pinecone } from '@pinecone-database/pinecone';

// === CONFIG ===
const NAMESPACE = 'xlfm-wisdom';
const DEFAULT_TOP_K = 10;

// === INIT ===
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

const indexName = process.env.PINECONE_INDEX_NAME!;
const index = pinecone.index(indexName);

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
}

export type Topic =
  | 'marriage_emotion'
  | 'health'
  | 'children'
  | 'karma_debt'
  | 'practice_method';

// === BOOK PRIORITY (for tie-breaking) ===
// When two passages have similar relevance scores, prefer these sources
const BOOK_PRIORITY: Record<string, number> = {
  '弘法度人辅导手册': 10,   // counseling methodology
  '佛学问答175问': 9,       // direct Master Lu Q&A
  '心灵法门例说': 8,        // real case studies
  '佛教念诵合集': 7,        // scripture texts
};

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
  practice_method: [
    '念经', '大悲咒', '心经', '礼佛', '解结咒', '小房子', '放生',
    '许愿', '功课', '佛台', '怎么念', '多少遍',
  ],
};

// Score boost applied during re-ranking when a passage's `type` matches a
// detected topic. Chosen to be smaller than 0.1 so cosine-similarity ordering
// still dominates — these only break near-ties.
const TOPIC_TYPE_BOOST: Record<Topic, Record<string, number>> = {
  marriage_emotion: { marriage_case_study: 0.05 },
  health: {},
  children: {},
  karma_debt: { xiaofangzi_guide: 0.04, buddhist_basics: 0.02 },
  practice_method: {
    beginner_guide: 0.03,
    altar_guide: 0.03,
    xiaofangzi_guide: 0.03,
    ethics_guide: 0.02,
  },
};

export function detectTopics(query: string): Topic[] {
  const detected: Topic[] = [];
  for (const topic of Object.keys(TOPIC_KEYWORDS) as Topic[]) {
    if (TOPIC_KEYWORDS[topic].some((kw) => query.includes(kw))) {
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

  return hits.map((hit: any) => ({
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
  }));
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
  query: string,
  topK: number = DEFAULT_TOP_K
): Promise<RetrievedPassage[]> {
  if (!query || query.trim().length === 0) return [];

  try {
    const topics = detectTopics(query);

    // Build parallel queries. General query first, plus filtered queries for
    // any topic that has a dedicated book collection in the corpus.
    const queries: Promise<RetrievedPassage[]>[] = [
      pineconeSearch(query, topK), // general, no filter
    ];

    if (topics.includes('marriage_emotion')) {
      queries.push(
        pineconeSearch(query, 7, { book_category: { $eq: 'marriage_emotion' } })
      );
    }

    const resultGroups = await Promise.all(queries);

    // Dedupe by id, keeping the highest score per unique chunk
    const uniqueById = new Map<string, RetrievedPassage>();
    for (const group of resultGroups) {
      for (const p of group) {
        const existing = uniqueById.get(p.id);
        if (!existing || p.score > existing.score) {
          uniqueById.set(p.id, p);
        }
      }
    }

    // Re-rank: topic-type boost + book-priority tie-breaker
    const ranked = Array.from(uniqueById.values())
      .map((p) => {
        let boost = (BOOK_PRIORITY[p.book] || 0) * 0.01;
        for (const topic of topics) {
          if (p.type && TOPIC_TYPE_BOOST[topic][p.type]) {
            boost += TOPIC_TYPE_BOOST[topic][p.type];
          }
        }
        return { ...p, score: p.score + boost };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return ranked;
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
  topK: number = DEFAULT_TOP_K
): Promise<{ context: string; passages: RetrievedPassage[] }> {
  const passages = await searchRelevantTeachings(query, topK);
  const context = formatPassagesAsContext(passages);
  return { context, passages };
}
