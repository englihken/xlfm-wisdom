// scripts/test-foyanfoyu-retrieval.ts
// Quick retrieval test for 佛言佛语 vectors

import { Pinecone } from '@pinecone-database/pinecone';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const NAMESPACE = 'xlfm-wisdom';

async function searchQuery(query: string) {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const indexName = process.env.PINECONE_INDEX_NAME!;
  const description = await pc.describeIndex(indexName);
  const host = description.host;

  const response = await fetch(`https://${host}/records/namespaces/${NAMESPACE}/search`, {
    method: 'POST',
    headers: {
      'Api-Key': process.env.PINECONE_API_KEY!,
      'Content-Type': 'application/json',
      'X-Pinecone-API-Version': '2025-01',
    },
    body: JSON.stringify({
      query: { inputs: { text: query }, top_k: 5 },
      fields: ['book', 'type', 'page_start', 'excerpt', 'language_variant'],
    }),
  });

  if (!response.ok) {
    console.error(`Search failed: ${response.status} ${await response.text()}`);
    return;
  }

  const data = await response.json();
  console.log(`\n🔍 Query: "${query}"\n`);

  for (const hit of data.result?.hits || []) {
    const fields = hit.fields || {};
    const score = hit._score?.toFixed(4) || 'N/A';
    console.log(`  📖 ${fields.book || 'unknown'} (p.${fields.page_start || '?'}) | score: ${score} | ${fields.type || ''} | ${fields.language_variant || ''}`);
    console.log(`     ${(fields.excerpt || '').slice(0, 120)}`);
    console.log();
  }
}

async function main() {
  console.log('=== 佛言佛语 Retrieval Test ===\n');

  await searchQuery('如何修心');
  await searchQuery('什么是智慧');
}

main().catch(console.error);
