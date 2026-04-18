// scripts/upload-wave2.ts
// Upload Wave 2 books to Pinecone with page-aware chunks
// ADDS to existing namespace (does NOT clear previous data)

import * as fs from 'fs';
import * as path from 'path';
import { Pinecone } from '@pinecone-database/pinecone';
import * as dotenv from 'dotenv';

// @ts-ignore
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const BOOKS_DIR = path.join(process.cwd(), 'content', 'books');
const CHUNK_SIZE = 600;
const CHUNK_OVERLAP = 100;
const UPLOAD_BATCH_SIZE = 50;
const NAMESPACE = 'xlfm-wisdom';

const BOOKS = [
  {
    filename: '心灵法门入门手册.pdf',
    name: '心灵法门入门手册',
    type: 'beginner_guide',
    categories: '入门,初学,功课,基础',
    description: '心灵法门初学者入门手册，每日功课和基础指导',
  },
  {
    filename: '设佛台开示合集.pdf',
    name: '设佛台开示合集',
    type: 'altar_guide',
    categories: '佛台,供奉,仪轨,菩萨',
    description: '台长关于设立佛台的完整开示合集',
  },
  {
    filename: '佛教经典组合小房子念诵指南-小房子.pdf',
    name: '小房子念诵指南',
    type: 'xiaofangzi_guide',
    categories: '小房子,超度,念诵,要经者',
    description: '小房子念诵方法的详细指南',
  },
  {
    filename: '佛学常识开示锦集（第一册）.pdf',
    name: '佛学常识开示锦集（第一册）',
    type: 'buddhist_basics',
    categories: '佛学常识,基础,开示,概念',
    description: '台长开示的佛学常识锦集第一册',
  },
  {
    filename: '佛学常识开示锦集（第二册）.pdf',
    name: '佛学常识开示锦集（第二册）',
    type: 'buddhist_basics',
    categories: '佛学常识,基础,开示,概念',
    description: '台长开示的佛学常识锦集第二册',
  },
  {
    filename: '吃素•戒杀•放生.pdf',
    name: '吃素戒杀放生',
    type: 'ethics_guide',
    categories: '吃素,戒杀,放生,护生',
    description: '台长关于吃素、戒杀、放生的完整开示',
  },
];

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

interface PageText { pageNumber: number; text: string; }

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
    const rawText = textContent.items.map((item: any) => (item.str ?? '')).join(' ');
    pages.push({ pageNumber: i, text: cleanText(rawText) });
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

interface Chunk { text: string; pageStart: number; pageEnd: number; excerpt: string; }

function chunkPagesWithPageTracking(pages: PageText[]): Chunk[] {
  const chunks: Chunk[] = [];
  type ParaWithPage = { text: string; page: number };
  const paragraphs: ParaWithPage[] = [];
  for (const p of pages) {
    const paras = p.text.split(/\n\n+/).filter(x => x.trim().length > 0);
    for (const para of paras) paragraphs.push({ text: para.trim(), page: p.pageNumber });
  }
  let currentText = '';
  let currentPageStart = 0;
  let currentPageEnd = 0;
  const flushChunk = () => {
    if (currentText.trim().length < 50) return;
    chunks.push({ text: currentText.trim(), pageStart: currentPageStart, pageEnd: currentPageEnd, excerpt: extractExcerpt(currentText.trim()) });
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
          if ((temp + sent).length <= CHUNK_SIZE) temp += sent;
          else {
            if (temp.length > 50) chunks.push({ text: temp.trim(), pageStart: para.page, pageEnd: para.page, excerpt: extractExcerpt(temp.trim()) });
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

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function uploadBook(book: typeof BOOKS[0], bookIndex: number): Promise<number> {
  const pdfPath = path.join(BOOKS_DIR, book.filename);
  if (!fs.existsSync(pdfPath)) {
    console.log(`  ❌ File not found: ${pdfPath}`);
    return 0;
  }
  console.log(`\n📖 Processing: ${book.name}`);
  const pages = await extractPdfPages(pdfPath);
  console.log(`   ✓ Extracted ${pages.length} pages`);
  const chunks = chunkPagesWithPageTracking(pages);
  console.log(`   ✓ Created ${chunks.length} chunks`);
  const host = await getIndexHost();
  let uploaded = 0;
  for (let i = 0; i < chunks.length; i += UPLOAD_BATCH_SIZE) {
    const batch = chunks.slice(i, i + UPLOAD_BATCH_SIZE);
    const records = batch.map((chunk, idx) => ({
      _id: `${book.type}_w2b${bookIndex}_${i + idx}`,
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
    console.log(`   📤 Batch ${Math.floor(i / UPLOAD_BATCH_SIZE) + 1}/${Math.ceil(chunks.length / UPLOAD_BATCH_SIZE)}...`);
    try {
      const response = await fetch(`https://${host}/records/namespaces/${NAMESPACE}/upsert`, {
        method: 'POST',
        headers: {
          'Api-Key': process.env.PINECONE_API_KEY!,
          'Content-Type': 'application/x-ndjson',
          'X-Pinecone-API-Version': '2025-01',
        },
        body: records.map(r => JSON.stringify(r)).join('\n'),
      });
      if (response.ok) uploaded += records.length;
      else {
        const errText = await response.text();
        console.error(`   ❌ Upload failed: ${response.status} ${errText}`);
        await sleep(5000);
      }
    } catch (err: any) {
      console.error(`   ⚠️  Error: ${err.message}`);
    }
    await sleep(2000);
  }
  console.log(`   ✅ Uploaded ${uploaded}/${chunks.length}`);
  return uploaded;
}

async function main() {
  console.log('🙏 Wave 2 Upload (adds to existing namespace)...\n');
  try {
    const stats = await index.describeIndexStats();
    console.log(`✓ Current vectors: ${stats.totalRecordCount || 0}\n`);
  } catch (err) {
    console.error('❌ Pinecone connection failed:', err);
    process.exit(1);
  }
  let totalUploaded = 0;
  for (let bi = 0; bi < BOOKS.length; bi++) {
    const book = BOOKS[bi];
    try {
      const count = await uploadBook(book, bi);
      totalUploaded += count;
    } catch (err) {
      console.error(`❌ Error: ${book.name}:`, err);
    }
  }
  console.log(`\n🎉 Wave 2 complete! Uploaded: ${totalUploaded}`);
  await sleep(3000);
  const finalStats = await index.describeIndexStats();
  console.log(`📊 Index total: ${finalStats.totalRecordCount}\n`);
  console.log(`南无大慈大悲观世音菩萨 🙏\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
