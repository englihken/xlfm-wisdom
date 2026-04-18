import { Pinecone } from '@pinecone-database/pinecone';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const NAMESPACE = 'xlfm-wisdom';

async function auditBooks() {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const indexName = process.env.PINECONE_INDEX_NAME!;
  const index = pc.index(indexName);
  const description = await pc.describeIndex(indexName);
  const host = description.host;

  const stats = await index.describeIndexStats();
  console.log('\n=== Pinecone Index Stats ===');
  console.log('Total vectors:', stats.totalRecordCount);
  console.log('Namespaces:', Object.keys(stats.namespaces || {}));

  const topics = [
    '婚姻', '夫妻', '感情', '外遇',
    '疾病', '健康', '身体', '皮肤',
    '图腾', '法会', '风水',
    '孩子', '教育', '青少年',
    '工作', '事业', '财运',
    '念经', '小房子', '功课',
    '放生', '许愿', '吃素',
    '忏悔', '业障', '冤结',
    '白话佛法', '弟子开示',
    '广播讲座', '视频开示',
    '佛学问答', '佛言佛语',
    '入门', '例说', '手册', '辅导',
    '佛台', '供奉', '设佛台',
    '念诵合集', '经文',
    '常识', '开示锦集',
    '戒杀', '放生方法',
  ];

  const booksFound = new Map<string, number>();

  for (const topic of topics) {
    try {
      const response = await fetch(`https://${host}/records/namespaces/${NAMESPACE}/search`, {
        method: 'POST',
        headers: {
          'Api-Key': process.env.PINECONE_API_KEY!,
          'Content-Type': 'application/json',
          'X-Pinecone-API-Version': '2025-01',
        },
        body: JSON.stringify({
          query: { inputs: { text: topic }, top_k: 30 },
          fields: ['book', 'type'],
        }),
      });

      if (!response.ok) continue;
      const data = await response.json();

      for (const hit of data.result?.hits || []) {
        const book = hit.fields?.book;
        if (book) {
          booksFound.set(book, (booksFound.get(book) || 0) + 1);
        }
      }
    } catch {
      // skip failed queries
    }

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n=== Books Discovered in Pinecone ===');
  const sorted = Array.from(booksFound.entries()).sort((a, b) => b[1] - a[1]);
  for (const [book, count] of sorted) {
    console.log(`  ${book} (${count} hits)`);
  }
  console.log(`\nTotal unique books: ${sorted.length}`);
}

auditBooks().catch(console.error);
