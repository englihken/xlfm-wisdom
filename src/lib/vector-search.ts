// src/lib/vector-search.ts
// XLFM Buddhist Wisdom — Vector Search
// Uses Pinecone integrated inference (multilingual-e5-large)
// Data uploaded to namespace 'xlfm-wisdom' by scripts/upload-wave1.ts

import { Pinecone } from '@pinecone-database/pinecone';

// === CONFIG ===
const NAMESPACE = 'xlfm-wisdom';
const DEFAULT_TOP_K = 6;

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

// === BOOK PRIORITY (for tie-breaking) ===
// When two passages have similar relevance scores, prefer these sources
const BOOK_PRIORITY: Record<string, number> = {
  '弘法度人辅导手册': 10,   // counseling methodology
  '佛学问答175问': 9,       // direct Master Lu Q&A
  '心灵法门例说': 8,        // real case studies
  '佛教念诵合集': 7,        // scripture texts
};

// === MAIN SEARCH FUNCTION ===

/**
 * Search XLFM content via Pinecone integrated inference.
 * Pinecone automatically embeds the query using multilingual-e5-large
 * and returns the most relevant passages from our uploaded books.
 */
export async function searchRelevantTeachings(
  query: string,
  topK: number = DEFAULT_TOP_K
): Promise<RetrievedPassage[]> {
  if (!query || query.trim().length === 0) return [];

  try {
    // Use Pinecone's integrated inference via REST API
    // (The SDK's searchRecords has an API inconsistency in v7)
    const host = await getIndexHost();
    const response = await fetch(
      `https://${host}/records/namespaces/${NAMESPACE}/search`,
      {
        method: 'POST',
        headers: {
          'Api-Key': process.env.PINECONE_API_KEY!,
          'Content-Type': 'application/json',
          'X-Pinecone-API-Version': '2025-01',
        },
        body: JSON.stringify({
          query: {
            inputs: { text: query },
            top_k: topK,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[vector-search] Pinecone REST error ${response.status}:`, errText);
      return [];
    }

    const data = await response.json();
    const hits = data?.result?.hits || [];

    // Map to our RetrievedPassage type and apply priority tie-breaking
    const passages: RetrievedPassage[] = hits.map((hit: any) => ({
      id: hit._id,
      score: hit._score || 0,
      text: hit.fields?.chunk_text || '',
      book: hit.fields?.book || 'Unknown',
      type: hit.fields?.type,
      categories: hit.fields?.categories,
      chunk_index: hit.fields?.chunk_index,
      page_start: hit.fields?.page_start,
      page_end: hit.fields?.page_end,
      excerpt: hit.fields?.excerpt,
    }));

    // Light re-ranking: boost scores slightly based on book priority
    const ranked = passages
      .map(p => ({
        ...p,
        score: p.score + (BOOK_PRIORITY[p.book] || 0) * 0.01,
      }))
      .sort((a, b) => b.score - a.score);

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
