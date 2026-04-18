// scripts/upload-wave1.ts
// Upload Wave 1 books to Pinecone (integrated inference mode)
// Uses Pinecone's built-in multilingual-e5-large embedding

import * as fs from 'fs';
import * as path from 'path';
import pdfParse from 'pdf-parse';
import { Pinecone } from '@pinecone-database/pinecone';
import * as dotenv from 'dotenv';

// Load env
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

// === CONFIG ===
const BOOKS_DIR = path.join(process.cwd(), 'content', 'books');
const CHUNK_SIZE = 600;          // characters per chunk
const CHUNK_OVERLAP = 100;       // overlap between chunks
const UPLOAD_BATCH_SIZE = 50;    // Pinecone upsertRecords batch
const NAMESPACE = 'xlfm-wisdom'; // namespace for all XLFM content

const BOOKS = [
  {
    filename: '弘法度人辅导手册.pdf',
    name: '弘法度人辅导手册',
    type: 'counseling_manual',
    categories: ['度人', '弘法', '辅导', '修行原则'],
    description: '心灵法门弘法度人的方法、守则、技巧手册',
  },
  {
    filename: '佛学问答175问.pdf',
    name: '佛学问答175问',
    type: 'qa_collection',
    categories: ['问答', '修行疑问', '日常修行'],
    description: '台长回答的175个常见佛学问题（最新版）',
  },
  {
    filename: '心灵法门例说.pdf',
    name: '心灵法门例说',
    type: 'case_studies',
    categories: ['案例', '真实故事', '感应'],
    description: '心灵法门修行案例和真实故事',
  },
  {
    filename: '佛教念诵合集 简体.pdf',
    name: '佛教念诵合集',
    type: 'sutra_collection',
    categories: ['经文', '念诵', '仪轨'],
    description: '心灵法门所用经文、咒语的完整合集',
  },
];

// === INIT PINECONE ===
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

const indexName = process.env.PINECONE_INDEX_NAME!;
const index = pinecone.index(indexName);

// === HELPERS ===

async function extractPdfText(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}

function cleanText(text: string): string {
  return text
    .replace(/^\s*\d+\s*$/gm, '')                             // standalone page numbers
    .replace(/\s{3,}/g, '\n\n')                               // excessive whitespace
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // control chars
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function chunkText(text: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    if ((currentChunk + '\n\n' + para).length <= chunkSize) {
      currentChunk = currentChunk ? currentChunk + '\n\n' + para : para;
    } else {
      if (currentChunk.length > 50) chunks.push(currentChunk);

      if (para.length > chunkSize) {
        // Split big paragraph by Chinese sentence endings
        const sentences = para.split(/(?<=[。！？])/);
        let tempChunk = '';
        for (const sent of sentences) {
          if ((tempChunk + sent).length <= chunkSize) {
            tempChunk += sent;
          } else {
            if (tempChunk.length > 50) chunks.push(tempChunk);
            tempChunk = sent;
          }
        }
        currentChunk = tempChunk.length > 50 ? tempChunk : '';
      } else {
        const overlapText = currentChunk.slice(-overlap);
        currentChunk = overlapText + '\n\n' + para;
      }
    }
  }

  if (currentChunk.length > 50) chunks.push(currentChunk);
  return chunks;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// === MAIN ===

async function uploadBook(book: typeof BOOKS[0]): Promise<number> {
  const pdfPath = path.join(BOOKS_DIR, book.filename);
  if (!fs.existsSync(pdfPath)) {
    console.log(`  ❌ File not found: ${pdfPath}`);
    return 0;
  }

  console.log(`\n📖 Processing: ${book.name}`);
  console.log(`   ⏳ Extracting text...`);
  const rawText = await extractPdfText(pdfPath);
  console.log(`   ✓ Extracted ${rawText.length.toLocaleString()} characters`);

  const cleanedText = cleanText(rawText);
  console.log(`   ✓ Cleaned to ${cleanedText.length.toLocaleString()} characters`);

  const chunks = chunkText(cleanedText);
  console.log(`   ✓ Created ${chunks.length} chunks`);

  let uploaded = 0;
  for (let i = 0; i < chunks.length; i += UPLOAD_BATCH_SIZE) {
    const batch = chunks.slice(i, i + UPLOAD_BATCH_SIZE);
    const records = batch.map((chunk, idx) => ({
      _id: `${book.type}_chunk_${i + idx}`,  // ASCII-only ID
      text: chunk,  // Pinecone integrated inference expects 'text' field
      book: book.name,
      type: book.type,
      categories: book.categories.join(','),  // flatten array to string
      description: book.description,
      chunk_index: i + idx,
    }));

    console.log(`   📤 Uploading batch ${Math.floor(i / UPLOAD_BATCH_SIZE) + 1}/${Math.ceil(chunks.length / UPLOAD_BATCH_SIZE)}...`);

    try {
      // Pinecone SDK v7 integrated inference: upsertRecords takes array directly as positional arg
      const ns = index.namespace(NAMESPACE);
      // @ts-ignore - different SDK versions have different signatures
      await (ns as any).upsertRecords(records);
      uploaded += records.length;
    } catch (err: any) {
      console.error(`   ⚠️  Batch error: ${err.message}`);
      // Try alternative: direct POST to the /records/upsert endpoint via the index host
      try {
        const indexHost = await getIndexHost();
        const response = await fetch(`https://${indexHost}/records/namespaces/${NAMESPACE}/upsert`, {
          method: 'POST',
          headers: {
            'Api-Key': process.env.PINECONE_API_KEY!,
            'Content-Type': 'application/x-ndjson',
            'X-Pinecone-API-Version': '2025-01',
          },
          body: records.map(r => JSON.stringify(r)).join('\n'),
        });
        if (response.ok) {
          uploaded += records.length;
          console.log(`   ✓ Uploaded via REST API`);
        } else {
          const errText = await response.text();
          console.error(`   ❌ REST failed: ${response.status} ${errText}`);
        }
      } catch (err2: any) {
        console.error(`   ❌ REST fallback failed: ${err2.message}`);
      }
    }
    await sleep(1000);
  }

  console.log(`   ✅ Uploaded ${uploaded}/${chunks.length} chunks from "${book.name}"`);
  return uploaded;
}

// Helper to get the index host URL for direct REST calls
let cachedHost: string | null = null;
async function getIndexHost(): Promise<string> {
  if (cachedHost) return cachedHost;
  const description = await pinecone.describeIndex(indexName);
  cachedHost = description.host;
  return cachedHost;
}

async function main() {
  console.log('🙏 XLFM Wave 1 Upload Starting...\n');
  console.log(`📚 Books: ${BOOKS.length}`);
  console.log(`📏 Chunk size: ${CHUNK_SIZE} chars, overlap: ${CHUNK_OVERLAP}`);
  console.log(`🎯 Pinecone index: ${indexName}`);
  console.log(`📦 Namespace: ${NAMESPACE}\n`);

  // Verify connection
  try {
    const stats = await index.describeIndexStats();
    console.log(`✓ Pinecone connected. Total vectors before upload: ${stats.totalRecordCount || 0}\n`);
  } catch (err) {
    console.error('❌ Pinecone connection failed:', err);
    process.exit(1);
  }

  let totalUploaded = 0;
  for (const book of BOOKS) {
    try {
      const count = await uploadBook(book);
      totalUploaded += count;
    } catch (err) {
      console.error(`\n❌ Error processing ${book.name}:`, err);
    }
  }

  console.log(`\n\n🎉 Wave 1 Upload Complete!`);
  console.log(`📊 Total chunks uploaded: ${totalUploaded}`);

  await sleep(3000);
  const finalStats = await index.describeIndexStats();
  console.log(`📊 Pinecone index now has ${finalStats.totalRecordCount} vectors total\n`);

  console.log(`南无大慈大悲观世音菩萨 🙏\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
