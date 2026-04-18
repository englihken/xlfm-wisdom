// scripts/upload-wave1-v2.ts
// Upload Wave 1 books to Pinecone with page-aware chunks
// Uses pdfjs-dist for accurate page tracking + Pinecone integrated inference

import * as fs from 'fs';
import * as path from 'path';
import { Pinecone } from '@pinecone-database/pinecone';
import * as dotenv from 'dotenv';

// @ts-ignore - pdfjs-dist legacy build for Node
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

// === CONFIG ===
const BOOKS_DIR = path.join(process.cwd(), 'content', 'books');
const CHUNK_SIZE = 600;
const CHUNK_OVERLAP = 100;
const UPLOAD_BATCH_SIZE = 50;
const NAMESPACE = 'xlfm-wisdom';

const BOOKS = [
  {
    filename: '弘法度人辅导手册.pdf',
    name: '弘法度人辅导手册',
    type: 'counseling_manual',
    categories: '度人,弘法,辅导,修行原则',
    description: '心灵法门弘法度人的方法、守则、技巧手册',
  },
  {
    filename: '佛学问答175问.pdf',
    name: '佛学问答175问',
    type: 'qa_collection',
    categories: '问答,修行疑问,日常修行',
    description: '台长回答的175个常见佛学问题（最新版）',
  },
  {
    filename: '心灵法门例说.pdf',
    name: '心灵法门例说',
    type: 'case_studies',
    categories: '案例,真实故事,感应',
    description: '心灵法门修行案例和真实故事',
  },
  {
    filename: '佛教念诵合集 简体.pdf',
    name: '佛教念诵合集',
    type: 'sutra_collection',
    categories: '经文,念诵,仪轨',
    description: '心灵法门所用经文、咒语的完整合集',
  },
];

// === INIT ===
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
const indexName = process.env.PINECONE_INDEX_NAME!;
const index = pinecone.index(indexName);

let cachedHost: string | null = null;
async function getIndexHost(): Promise<string> {
  if (cachedHost) return cachedHost;
  const description = await pinecone.describeIndex(indexName);
  cachedHost = description.host;
  return cachedHost;
}

// === HELPERS ===

interface PageText {
  pageNumber: number;
  text: string;
}

async function extractPdfPages(filePath: string): Promise<PageText[]> {
  const buffer = fs.readFileSync(filePath);
  const uint8 = new Uint8Array(buffer);

  const loadingTask = getDocument({
    data: uint8,
    useSystemFonts: true,
    standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/',
  });

  const pdf = await loadingTask.promise;
  const pages: PageText[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const rawText = textContent.items
      .map((item: any) => (item.str ?? ''))
      .join(' ');

    pages.push({
      pageNumber: i,
      text: cleanText(rawText),
    });
  }

  return pages;
}

function cleanText(text: string): string {
  return text
    .replace(/\s{3,}/g, '\n\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface Chunk {
  text: string;
  pageStart: number;
  pageEnd: number;
  excerpt: string;
}

function chunkPagesWithPageTracking(pages: PageText[]): Chunk[] {
  const chunks: Chunk[] = [];

  type ParaWithPage = { text: string; page: number };
  const paragraphs: ParaWithPage[] = [];

  for (const p of pages) {
    const paras = p.text.split(/\n\n+/).filter(x => x.trim().length > 0);
    for (const para of paras) {
      paragraphs.push({ text: para.trim(), page: p.pageNumber });
    }
  }

  let currentText = '';
  let currentPageStart = 0;
  let currentPageEnd = 0;

  const flushChunk = () => {
    if (currentText.trim().length < 50) return;
    chunks.push({
      text: currentText.trim(),
      pageStart: currentPageStart,
      pageEnd: currentPageEnd,
      excerpt: extractExcerpt(currentText.trim()),
    });
  };

  for (const para of paragraphs) {
    if (currentText.length === 0) {
      currentText = para.text;
      currentPageStart = para.page;
      currentPageEnd = para.page;
    } else if ((currentText + '\n\n' + para.text).length <= CHUNK_SIZE) {
      currentText += '\n\n' + para.text;
      currentPageEnd = para.page;
    } else {
      flushChunk();

      if (para.text.length > CHUNK_SIZE) {
        const sentences = para.text.split(/(?<=[。！？])/);
        let temp = '';
        for (const sent of sentences) {
          if ((temp + sent).length <= CHUNK_SIZE) {
            temp += sent;
          } else {
            if (temp.length > 50) {
              chunks.push({
                text: temp.trim(),
                pageStart: para.page,
                pageEnd: para.page,
                excerpt: extractExcerpt(temp.trim()),
              });
            }
            temp = sent;
          }
        }
        currentText = temp;
        currentPageStart = para.page;
        currentPageEnd = para.page;
      } else {
        const overlapText = currentText.slice(-CHUNK_OVERLAP);
        currentText = overlapText + '\n\n' + para.text;
        currentPageStart = para.page;
        currentPageEnd = para.page;
      }
    }
  }

  flushChunk();
  return chunks;
}

function extractExcerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const match = flat.match(/^.{20,100}?[。！？]/);
  if (match) return match[0];
  return flat.slice(0, 80) + (flat.length > 80 ? '...' : '');
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
  console.log(`   ⏳ Extracting pages...`);

  const pages = await extractPdfPages(pdfPath);
  console.log(`   ✓ Extracted ${pages.length} pages`);

  const chunks = chunkPagesWithPageTracking(pages);
  console.log(`   ✓ Created ${chunks.length} chunks with page tracking`);

  const host = await getIndexHost();
  let uploaded = 0;

  for (let i = 0; i < chunks.length; i += UPLOAD_BATCH_SIZE) {
    const batch = chunks.slice(i, i + UPLOAD_BATCH_SIZE);

    const records = batch.map((chunk, idx) => ({
      _id: `${book.type}_v2_${i + idx}`,
      text: chunk.text,
      book: book.name,
      type: book.type,
      categories: book.categories,
      description: book.description,
      chunk_index: i + idx,
      page_start: chunk.pageStart,
      page_end: chunk.pageEnd,
      excerpt: chunk.excerpt,
    }));

    console.log(`   📤 Uploading batch ${Math.floor(i / UPLOAD_BATCH_SIZE) + 1}/${Math.ceil(chunks.length / UPLOAD_BATCH_SIZE)}...`);

    try {
      const response = await fetch(
        `https://${host}/records/namespaces/${NAMESPACE}/upsert`,
        {
          method: 'POST',
          headers: {
            'Api-Key': process.env.PINECONE_API_KEY!,
            'Content-Type': 'application/x-ndjson',
            'X-Pinecone-API-Version': '2025-01',
          },
          body: records.map(r => JSON.stringify(r)).join('\n'),
        }
      );

      if (response.ok) {
        uploaded += records.length;
      } else {
        const errText = await response.text();
        console.error(`   ❌ REST upload failed: ${response.status} ${errText}`);
        await sleep(5000);
      }
    } catch (err: any) {
      console.error(`   ⚠️  Batch error: ${err.message}`);
    }

    await sleep(1500);
  }

  console.log(`   ✅ Uploaded ${uploaded}/${chunks.length} chunks`);
  return uploaded;
}

async function clearNamespace() {
  console.log(`🗑️  Clearing namespace '${NAMESPACE}' before re-upload...`);
  try {
    await index.namespace(NAMESPACE).deleteAll();
    console.log(`   ✓ Namespace cleared`);
    await sleep(3000);
  } catch (err: any) {
    console.log(`   ⚠️  Namespace may already be empty: ${err.message}`);
  }
}

async function main() {
  console.log('🙏 XLFM Wave 1 v2 Upload (with page tracking)...\n');
  console.log(`📚 Books: ${BOOKS.length}`);
  console.log(`🎯 Index: ${indexName}`);
  console.log(`📦 Namespace: ${NAMESPACE}\n`);

  try {
    const stats = await index.describeIndexStats();
    console.log(`✓ Pinecone connected. Current vectors: ${stats.totalRecordCount || 0}\n`);
  } catch (err) {
    console.error('❌ Pinecone connection failed:', err);
    process.exit(1);
  }

  await clearNamespace();

  let totalUploaded = 0;
  for (const book of BOOKS) {
    try {
      const count = await uploadBook(book);
      totalUploaded += count;
    } catch (err) {
      console.error(`❌ Error processing ${book.name}:`, err);
    }
  }

  console.log(`\n🎉 Upload complete!`);
  console.log(`📊 Total chunks uploaded: ${totalUploaded}`);

  await sleep(3000);
  const finalStats = await index.describeIndexStats();
  console.log(`📊 Index now has ${finalStats.totalRecordCount} vectors\n`);
  console.log(`南无大慈大悲观世音菩萨 🙏\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
