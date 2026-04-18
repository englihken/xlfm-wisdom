// scripts/upload-wave5-marriage.ts
// Upload Wave 5: 婚姻·情感 volumes 1-2 (marriage case studies)
// Usage: npx tsx scripts/upload-wave5-marriage.ts --dry-run
//        npx tsx scripts/upload-wave5-marriage.ts

import * as fs from 'fs';
import * as path from 'path';
import { Pinecone } from '@pinecone-database/pinecone';
import * as dotenv from 'dotenv';

// @ts-ignore
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const DRY_RUN = process.argv.includes('--dry-run');
const BOOKS_DIR = 'C:\\Users\\Ken\\Documents\\XLFM Books\\婚姻·情感-案例';
const CHUNK_SIZE = 600;
const CHUNK_OVERLAP = 100;
const UPLOAD_BATCH_SIZE = 50;
const NAMESPACE = 'xlfm-wisdom';

const VOLUMES = [
  { filename: '婚姻·情感（第一册）.pdf', volumeNum: 1, volumeCn: '第一册', bookName: '婚姻·情感（第一册）', idPrefix: 'marriage-v1' },
  { filename: '婚姻·情感（第二册）.pdf', volumeNum: 2, volumeCn: '第二册', bookName: '婚姻·情感（第二册）', idPrefix: 'marriage-v2' },
];

// --- Cleaning ---

function cleanMarriageText(raw: string): string {
  let text = raw;

  // Remove boilerplate (simplified + traditional)
  text = text.replace(/婚姻[·•]情感/g, '');
  text = text.replace(/婚姻[·•]情感/g, '');
  text = text.replace(/卢军宏台长/g, '');
  text = text.replace(/盧軍宏台長/g, '');

  // Remove volume markers
  text = text.replace(/[（(][第]?[一二三四五六七八九十]+[册冊]?[）)]/g, '');

  // Fix character-spaced CJK
  const spaceJoinRegex = /([\u4e00-\u9fff\u3400-\u4dbf\uff0c\u3002\uff01\uff1f\u3001\uff1a\uff1b\u201c\u201d\u2018\u2019\uff08\uff09\u300c\u300d]) ([\u4e00-\u9fff\u3400-\u4dbf\uff0c\u3002\uff01\uff1f\u3001\uff1a\uff1b\u201c\u201d\u2018\u2019\uff08\uff09\u300c\u300d])/g;
  text = text.replace(spaceJoinRegex, '$1$2');
  text = text.replace(spaceJoinRegex, '$1$2');
  text = text.replace(spaceJoinRegex, '$1$2');

  // Remove standalone page numbers
  text = text.replace(/\s+\d{1,3}\s+/g, ' ');
  text = text.replace(/^\d{1,3}\s+/gm, '');
  text = text.replace(/\s+\d{1,3}$/gm, '');

  // Collapse whitespace
  text = text.replace(/\s{2,}/g, ' ');
  text = text.trim();

  return text;
}

function detectLanguageVariant(text: string): 'simplified' | 'traditional' | 'mixed' {
  const trad = text.match(/[盧軍長語門學習體問個這來說經願種無對開從過還書義]/g)?.length || 0;
  const simp = text.match(/[卢军长语门学习体问个这来说经愿种无对开从过还书义]/g)?.length || 0;
  if (trad > simp * 2) return 'traditional';
  if (simp > trad * 2) return 'simplified';
  return 'mixed';
}

// --- PDF extraction ---

interface PageText { pageNumber: number; text: string; }

async function extractAllPages(filePath: string): Promise<PageText[]> {
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
    pages.push({ pageNumber: i, text: rawText });
  }
  return pages;
}

// --- Chunking (page-aware, same as wave 1-3) ---

interface Chunk { text: string; pageStart: number; pageEnd: number; excerpt: string; }

function chunkPages(pages: PageText[]): Chunk[] {
  const chunks: Chunk[] = [];
  type ParaWithPage = { text: string; page: number };
  const paragraphs: ParaWithPage[] = [];

  for (const p of pages) {
    const cleaned = cleanMarriageText(p.text);
    if (cleaned.length < 30) continue;
    // Skip publication/copyright pages
    if (/ISBN|印\s*數|印\s*数|版\s*次|出\s*版|電\s*話|电\s*话|Chippendale|Australia|guanyincitta|lujunhong2or\.com|秘書處|秘书处|出版社|國際刊號|国际刊号/.test(cleaned)) continue;

    const paras = cleaned.split(/\n\n+/).filter(x => x.trim().length > 0);
    for (const para of paras) paragraphs.push({ text: para.trim(), page: p.pageNumber });
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
      excerpt: currentText.trim().replace(/\s+/g, ' ').slice(0, 100),
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
          if ((temp + sent).length <= CHUNK_SIZE) temp += sent;
          else {
            if (temp.length > 50) chunks.push({ text: temp.trim(), pageStart: para.page, pageEnd: para.page, excerpt: temp.trim().replace(/\s+/g, ' ').slice(0, 100) });
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

// --- Upload ---

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

let cachedHost: string | null = null;
async function getIndexHost(pc: Pinecone, indexName: string): Promise<string> {
  if (cachedHost) return cachedHost;
  const desc = await pc.describeIndex(indexName);
  cachedHost = desc.host;
  return cachedHost;
}

async function uploadChunks(chunks: Chunk[], vol: typeof VOLUMES[0], pc: Pinecone, indexName: string, startIdx: number): Promise<number> {
  const host = await getIndexHost(pc, indexName);
  let uploaded = 0;

  for (let i = 0; i < chunks.length; i += UPLOAD_BATCH_SIZE) {
    const batch = chunks.slice(i, i + UPLOAD_BATCH_SIZE);
    const records = batch.map((chunk, idx) => ({
      _id: `${vol.idPrefix}-${startIdx + i + idx}`,
      text: chunk.text,
      book: vol.bookName,
      volume: vol.volumeNum,
      type: 'marriage_case_study',
      book_category: 'marriage_emotion',
      categories: '婚姻,感情,夫妻,冤结,案例',
      page_start: chunk.pageStart,
      page_end: chunk.pageEnd,
      excerpt: chunk.excerpt,
      chunk_index: startIdx + i + idx,
      level: 'all',
      language_variant: detectLanguageVariant(chunk.text),
      description: `台长${vol.bookName} - 婚姻情感案例`,
    }));

    const batchNum = Math.floor(i / UPLOAD_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(chunks.length / UPLOAD_BATCH_SIZE);

    let retries = 0;
    while (retries < 3) {
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
        if (response.ok) {
          uploaded += records.length;
          console.log(`      📤 Batch ${batchNum}/${totalBatches} ✓`);
          break;
        } else if (response.status === 429) {
          retries++;
          console.log(`      ⏳ Rate limited (${retries}/3), waiting 5s...`);
          await sleep(5000);
        } else {
          console.error(`      ❌ Failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
          break;
        }
      } catch (err: any) {
        retries++;
        console.error(`      ⚠️ Error (${retries}/3): ${err.message}`);
        await sleep(3000);
      }
    }
    await sleep(2000);
  }
  return uploaded;
}

// --- Main ---

async function main() {
  console.log(`🙏 Wave 5: 婚姻·情感 1-2 ${DRY_RUN ? '(DRY RUN)' : '(LIVE UPLOAD)'}...\n`);

  let pc: Pinecone | null = null;
  let indexName = '';

  if (!DRY_RUN) {
    pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    indexName = process.env.PINECONE_INDEX_NAME!;
    const stats = await pc.index(indexName).describeIndexStats();
    console.log(`✓ Current vectors: ${stats.totalRecordCount}\n`);
  }

  let globalIdx = 0;
  let totalChunks = 0;
  let totalUploaded = 0;
  const allChunks: (Chunk & { vol: string; lang: string })[] = [];

  for (const vol of VOLUMES) {
    const pdfPath = path.join(BOOKS_DIR, vol.filename);
    if (!fs.existsSync(pdfPath)) {
      console.log(`  ❌ Not found: ${vol.filename}`);
      continue;
    }

    console.log(`📖 ${vol.bookName}`);
    const pages = await extractAllPages(pdfPath);
    console.log(`   ✓ ${pages.length} pages extracted`);

    const chunks = chunkPages(pages);
    const lang = chunks.length > 0 ? detectLanguageVariant(chunks.map(c => c.text).join('')) : 'unknown';
    console.log(`   ✓ ${chunks.length} chunks created (${lang})`);

    for (const c of chunks) allChunks.push({ ...c, vol: vol.bookName, lang });
    totalChunks += chunks.length;

    if (!DRY_RUN && pc) {
      const uploaded = await uploadChunks(chunks, vol, pc, indexName, globalIdx);
      totalUploaded += uploaded;
      console.log(`   ✅ Uploaded ${uploaded}/${chunks.length}`);
    }

    globalIdx += chunks.length;
  }

  // Summary
  console.log('\n═══════════════════════════════════════');
  console.log(`TOTAL: ${totalChunks} chunks\n`);

  if (DRY_RUN) {
    // Show raw text from first 5 pages of Book 1
    const vol1Path = path.join(BOOKS_DIR, VOLUMES[0].filename);
    if (fs.existsSync(vol1Path)) {
      const rawPages = await extractAllPages(vol1Path);
      console.log('═══ RAW TEXT (first 5 content pages, Book 1) ═══\n');
      let shown = 0;
      for (const p of rawPages) {
        if (p.text.trim().length < 30) continue;
        if (shown >= 5) break;
        console.log(`--- Page ${p.pageNumber} (${p.text.length} raw chars) ---`);
        console.log(p.text.slice(0, 500));
        console.log();
        shown++;
      }
    }

    // Show 3 sample cleaned chunks
    console.log('═══ SAMPLE CLEANED CHUNKS ═══\n');
    const samples = [
      allChunks[Math.floor(allChunks.length * 0.15)],
      allChunks[Math.floor(allChunks.length * 0.5)],
      allChunks[Math.floor(allChunks.length * 0.85)],
    ];
    for (const s of samples) {
      if (!s) continue;
      console.log(`--- ${s.vol} p.${s.pageStart}-${s.pageEnd} (${s.lang}, ${s.text.length} chars) ---`);
      console.log(s.text.slice(0, 300));
      console.log();
    }

    console.log(`📊 Estimated vectors: ${totalChunks}`);
    console.log(`⏸️  DRY RUN complete. Run without --dry-run to upload.`);
  } else {
    console.log(`🎉 Wave 5 complete! Uploaded: ${totalUploaded}/${totalChunks}`);
    await sleep(3000);
    const finalStats = await pc!.index(indexName).describeIndexStats();
    console.log(`📊 Index total: ${finalStats.totalRecordCount}`);
  }

  console.log(`\n南无大慈大悲观世音菩萨 🙏\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
