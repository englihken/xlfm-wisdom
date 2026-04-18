// scripts/upload-wave3.ts
// Upload Wave 3: 白话佛法 core wisdom collection (20 books)
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
  { filename: '白话佛法（第一册）.pdf', name: '白话佛法（第一册）', id_prefix: 'bhff1', type: 'core_wisdom', level: 'intermediate_core', categories: '白话佛法,核心智慧,修心', description: '台长白话佛法第一册 - 核心智慧开示' },
  { filename: '白话佛法（第二册）.pdf', name: '白话佛法（第二册）', id_prefix: 'bhff2', type: 'core_wisdom', level: 'intermediate_core', categories: '白话佛法,核心智慧,修心', description: '台长白话佛法第二册 - 核心智慧开示' },
  { filename: '白话佛法（第三册）.pdf', name: '白话佛法（第三册）', id_prefix: 'bhff3', type: 'core_wisdom', level: 'intermediate_core', categories: '白话佛法,核心智慧,修心', description: '台长白话佛法第三册 - 核心智慧开示' },
  { filename: '白话佛法（第四册）.pdf', name: '白话佛法（第四册）', id_prefix: 'bhff4', type: 'core_wisdom', level: 'intermediate_core', categories: '白话佛法,核心智慧,修心', description: '台长白话佛法第四册 - 核心智慧开示' },
  { filename: '白话佛法（第五册）.pdf', name: '白话佛法（第五册）', id_prefix: 'bhff5', type: 'core_wisdom', level: 'intermediate_core', categories: '白话佛法,核心智慧,修心', description: '台长白话佛法第五册 - 核心智慧开示' },
  { filename: '白话佛法（第六册）.pdf', name: '白话佛法（第六册）', id_prefix: 'bhff6', type: 'core_wisdom', level: 'intermediate_core', categories: '白话佛法,核心智慧,修心', description: '台长白话佛法第六册 - 核心智慧开示' },
  { filename: '白话佛法（第七册）.pdf', name: '白话佛法（第七册）', id_prefix: 'bhff7', type: 'core_wisdom', level: 'intermediate_core', categories: '白话佛法,核心智慧,修心', description: '台长白话佛法第七册 - 核心智慧开示' },
  { filename: '白话佛法（第八册）.pdf', name: '白话佛法（第八册）', id_prefix: 'bhff8', type: 'core_wisdom', level: 'intermediate_core', categories: '白话佛法,核心智慧,修心', description: '台长白话佛法第八册 - 核心智慧开示' },
  { filename: '白话佛法（第九册）.pdf', name: '白话佛法（第九册）', id_prefix: 'bhff9', type: 'core_wisdom', level: 'intermediate_core', categories: '白话佛法,核心智慧,修心', description: '台长白话佛法第九册 - 核心智慧开示' },
  { filename: '白话佛法（第十册）.pdf', name: '白话佛法（第十册）', id_prefix: 'bhff10', type: 'core_wisdom', level: 'intermediate_core', categories: '白话佛法,核心智慧,修心', description: '台长白话佛法第十册 - 核心智慧开示' },
  { filename: '白话佛法（第十一册）.pdf', name: '白话佛法（第十一册）', id_prefix: 'bhff11', type: 'core_wisdom', level: 'intermediate_core', categories: '白话佛法,核心智慧,修心', description: '台长白话佛法第十一册 - 核心智慧开示' },
  { filename: '白话佛法（第十二册）.pdf', name: '白话佛法（第十二册）', id_prefix: 'bhff12', type: 'core_wisdom', level: 'intermediate_core', categories: '白话佛法,核心智慧,修心', description: '台长白话佛法第十二册 - 核心智慧开示' },
  { filename: '弟子开示（第一册）.pdf', name: '弟子开示（第一册）', id_prefix: 'dzks1', type: 'disciple_teaching', level: 'advanced', categories: '弟子开示,深度修行,进阶', description: '台长给弟子的开示第一册 - 进阶修行' },
  { filename: '弟子开示（第二册）.pdf', name: '弟子开示（第二册）', id_prefix: 'dzks2', type: 'disciple_teaching', level: 'advanced', categories: '弟子开示,深度修行,进阶', description: '台长给弟子的开示第二册 - 进阶修行' },
  { filename: '白话佛法广播讲座（第一册）.pdf', name: '白话佛法广播讲座（第一册）', id_prefix: 'gbjz1', type: 'radio_teaching', level: 'beginner_wisdom', categories: '广播讲座,入门智慧,白话', description: '台长广播讲座第一册 - 入门白话智慧' },
  { filename: '白话佛法广播讲座（第二册）.pdf', name: '白话佛法广播讲座（第二册）', id_prefix: 'gbjz2', type: 'radio_teaching', level: 'beginner_wisdom', categories: '广播讲座,入门智慧,白话', description: '台长广播讲座第二册 - 入门白话智慧' },
  { filename: '白话佛法视频开示（第一册）.pdf', name: '白话佛法视频开示（第一册）', id_prefix: 'spks1', type: 'video_teaching', level: 'mixed_depth', categories: '视频开示,晚期开示,深度教学', description: '台长视频开示第一册 - 混合深度教学' },
  { filename: '白话佛法视频开示（第二册）.pdf', name: '白话佛法视频开示（第二册）', id_prefix: 'spks2', type: 'video_teaching', level: 'mixed_depth', categories: '视频开示,晚期开示,深度教学', description: '台长视频开示第二册 - 混合深度教学' },
  { filename: '白话佛法视频开示（第三册）.pdf', name: '白话佛法视频开示（第三册）', id_prefix: 'spks3', type: 'video_teaching', level: 'mixed_depth', categories: '视频开示,晚期开示,深度教学', description: '台长视频开示第三册 - 混合深度教学' },
  { filename: '白话佛法视频开示（第四册）.pdf', name: '白话佛法视频开示（第四册）', id_prefix: 'spks4', type: 'video_teaching', level: 'mixed_depth', categories: '视频开示,晚期开示,深度教学', description: '台长视频开示第四册 - 混合深度教学' },
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

async function uploadBook(book: typeof BOOKS[0]): Promise<number> {
  const pdfPath = path.join(BOOKS_DIR, book.filename);
  if (!fs.existsSync(pdfPath)) {
    console.log(`  ❌ File not found: ${pdfPath}`);
    return 0;
  }
  console.log(`\n📖 Processing: ${book.name} (${book.level})`);
  const pages = await extractPdfPages(pdfPath);
  console.log(`   ✓ Extracted ${pages.length} pages`);
  const chunks = chunkPagesWithPageTracking(pages);
  console.log(`   ✓ Created ${chunks.length} chunks`);
  const host = await getIndexHost();
  let uploaded = 0;
  for (let i = 0; i < chunks.length; i += UPLOAD_BATCH_SIZE) {
    const batch = chunks.slice(i, i + UPLOAD_BATCH_SIZE);
    const records = batch.map((chunk, idx) => ({
      _id: `${book.id_prefix}_${i + idx}`,
      text: chunk.text,
      book: book.name,
      type: book.type,
      level: book.level,
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
    await sleep(2500); // longer delay for 20 books to avoid rate limits
  }
  console.log(`   ✅ Uploaded ${uploaded}/${chunks.length}`);
  return uploaded;
}

async function main() {
  console.log('🙏 Wave 3 Upload: 白话佛法 Core Wisdom (20 books)...\n');
  try {
    const stats = await index.describeIndexStats();
    console.log(`✓ Current vectors: ${stats.totalRecordCount || 0}\n`);
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
      console.error(`❌ Error: ${book.name}:`, err);
    }
  }
  console.log(`\n🎉 Wave 3 complete! Uploaded: ${totalUploaded}`);
  await sleep(3000);
  const finalStats = await index.describeIndexStats();
  console.log(`📊 Index total: ${finalStats.totalRecordCount}\n`);
  console.log(`南无大慈大悲观世音菩萨 🙏\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
