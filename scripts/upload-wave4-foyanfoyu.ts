// scripts/upload-wave4-foyanfoyu.ts
// Upload Wave 4: 佛言佛语 volumes 1-14 (golden quote teaching cards)
// 1 vector per page — preserves 台长's card-based design
// Usage: npx tsx scripts/upload-wave4-foyanfoyu.ts --dry-run  (test only)
//        npx tsx scripts/upload-wave4-foyanfoyu.ts              (real upload)

import * as fs from 'fs';
import * as path from 'path';
import { Pinecone } from '@pinecone-database/pinecone';
import * as dotenv from 'dotenv';

// @ts-ignore
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const DRY_RUN = process.argv.includes('--dry-run');
const BOOKS_DIR = 'C:\\Users\\Ken\\Documents\\XLFM Books\\佛言佛语';
const UPLOAD_BATCH_SIZE = 96;
const NAMESPACE = 'xlfm-wisdom';

const VOLUME_CHINESE = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四'];

const VOLUME_FILES = VOLUME_CHINESE.map((cn, i) => ({
  filename: `佛言佛语（第${cn}册）.pdf`,
  volumeNum: i + 1,
  volumeCn: cn,
  bookName: `佛言佛语(${cn})`,
  idPrefix: `foyanfoyu-v${i + 1}`,
}));

// --- Text cleaning ---

function cleanFoyanText(raw: string): string {
  let text = raw;

  // Remove boilerplate — both simplified and traditional Chinese
  text = text.replace(/卢军宏台长佛言佛语/g, '');
  text = text.replace(/盧軍宏台長佛言佛語/g, '');
  text = text.replace(/卢军宏台长/g, '');
  text = text.replace(/盧軍宏台長/g, '');
  text = text.replace(/佛言佛语/g, '');
  text = text.replace(/佛言佛語/g, '');

  // Remove volume markers: （一）, （二）, (一), (二), etc.
  text = text.replace(/[（(][一二三四五六七八九十]+[）)]/g, '');

  // Fix character-spaced CJK text: "当 一 个 人" → "当一个人"
  // Matches CJK unified ideographs + CJK Extension A + common CJK punctuation
  const spaceJoinRegex = /([\u4e00-\u9fff\u3400-\u4dbf\uff0c\u3002\uff01\uff1f\u3001\uff1a\uff1b\u201c\u201d\u2018\u2019\uff08\uff09\u300c\u300d]) ([\u4e00-\u9fff\u3400-\u4dbf\uff0c\u3002\uff01\uff1f\u3001\uff1a\uff1b\u201c\u201d\u2018\u2019\uff08\uff09\u300c\u300d])/g;
  // Run 3 times to catch overlapping matches
  text = text.replace(spaceJoinRegex, '$1$2');
  text = text.replace(spaceJoinRegex, '$1$2');
  text = text.replace(spaceJoinRegex, '$1$2');

  // Remove standalone page numbers (digits surrounded by whitespace or at boundaries)
  text = text.replace(/\s+\d{1,3}\s+/g, ' ');
  text = text.replace(/^\d{1,3}\s+/gm, '');
  text = text.replace(/\s+\d{1,3}$/gm, '');

  // Collapse multiple spaces/newlines
  text = text.replace(/\s{2,}/g, ' ');
  text = text.trim();

  return text;
}

function detectLanguageVariant(text: string): 'simplified' | 'traditional' | 'mixed' {
  const traditionalChars = text.match(/[盧軍長語門學習體問個這來說經願種無對開從過還書義]/g)?.length || 0;
  const simplifiedChars = text.match(/[卢军长语门学习体问个这来说经愿种无对开从过还书义]/g)?.length || 0;
  if (traditionalChars > simplifiedChars * 2) return 'traditional';
  if (simplifiedChars > traditionalChars * 2) return 'simplified';
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

// --- Card creation ---

interface TeachingCard {
  id: string;
  text: string;
  book: string;
  volume: number;
  type: string;
  categories: string;
  page_start: number;
  page_end: number;
  excerpt: string;
  chunk_index: number;
  level: string;
  description: string;
  language_variant: string;
}

function createCards(pages: PageText[], vol: typeof VOLUME_FILES[0], startIndex: number): TeachingCard[] {
  const cards: TeachingCard[] = [];
  let idx = startIndex;

  for (const page of pages) {
    const cleaned = cleanFoyanText(page.text);
    if (cleaned.length < 30) continue; // skip blank/fragment pages

    // Skip publication/copyright pages (contain ISBN, addresses, phone numbers)
    if (/ISBN|印\s*數|印\s*数|版\s*次|出\s*版|電\s*話|电\s*话|Chippendale|Australia|guanyincitta|lujunhong2or\.com|秘書處|秘书处|出版社|國際刊號|国际刊号/.test(cleaned)) continue;

    cards.push({
      id: `${vol.idPrefix}-page-${page.pageNumber}`,
      text: cleaned,
      book: vol.bookName,
      volume: vol.volumeNum,
      type: 'golden_quote',
      categories: '佛言佛语,金句,智慧语录,修心',
      page_start: page.pageNumber,
      page_end: page.pageNumber,
      excerpt: cleaned.slice(0, 100),
      chunk_index: idx,
      level: 'beginner',
      description: `台长${vol.bookName} - 智慧金句教学卡`,
      language_variant: detectLanguageVariant(cleaned),
    });
    idx++;
  }

  return cards;
}

// --- Upload ---

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

let cachedHost: string | null = null;
async function getIndexHost(pinecone: Pinecone, indexName: string): Promise<string> {
  if (cachedHost) return cachedHost;
  const description = await pinecone.describeIndex(indexName);
  cachedHost = description.host;
  return cachedHost;
}

async function uploadCards(cards: TeachingCard[], pinecone: Pinecone, indexName: string): Promise<number> {
  const host = await getIndexHost(pinecone, indexName);
  let uploaded = 0;

  for (let i = 0; i < cards.length; i += UPLOAD_BATCH_SIZE) {
    const batch = cards.slice(i, i + UPLOAD_BATCH_SIZE);
    const records = batch.map(card => ({
      _id: card.id,
      text: card.text,
      book: card.book,
      volume: card.volume,
      type: card.type,
      categories: card.categories,
      page_start: card.page_start,
      page_end: card.page_end,
      excerpt: card.excerpt,
      chunk_index: card.chunk_index,
      level: card.level,
      description: card.description,
      language_variant: card.language_variant,
    }));

    const batchNum = Math.floor(i / UPLOAD_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(cards.length / UPLOAD_BATCH_SIZE);

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
        } else {
          const errText = await response.text();
          if (response.status === 429) {
            retries++;
            console.log(`      ⏳ Rate limited (attempt ${retries}/3), waiting 5s...`);
            await sleep(5000);
          } else {
            console.error(`      ❌ Upload failed: ${response.status} ${errText.slice(0, 200)}`);
            break;
          }
        }
      } catch (err: any) {
        retries++;
        console.error(`      ⚠️ Error (attempt ${retries}/3): ${err.message}`);
        await sleep(3000);
      }
    }

    await sleep(2000);
  }

  return uploaded;
}

// --- Main ---

async function main() {
  console.log(`🙏 Wave 4: 佛言佛语 1-14 ${DRY_RUN ? '(DRY RUN — no upload)' : '(LIVE UPLOAD)'}...\n`);

  let pinecone: Pinecone | null = null;
  let indexName = '';

  if (!DRY_RUN) {
    pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
    indexName = process.env.PINECONE_INDEX_NAME!;
    const index = pinecone.index(indexName);
    const stats = await index.describeIndexStats();
    console.log(`✓ Current vectors: ${stats.totalRecordCount}\n`);
  }

  let globalIndex = 0;
  let totalCards = 0;
  let totalUploaded = 0;
  const allCards: TeachingCard[] = [];
  const volumeSummary: { name: string; pages: number; cards: number; lang: string }[] = [];

  for (const vol of VOLUME_FILES) {
    const pdfPath = path.join(BOOKS_DIR, vol.filename);
    if (!fs.existsSync(pdfPath)) {
      console.log(`  ❌ Not found: ${vol.filename}`);
      continue;
    }

    console.log(`📖 ${vol.bookName}`);
    const pages = await extractAllPages(pdfPath);
    console.log(`   ✓ ${pages.length} pages extracted`);

    const cards = createCards(pages, vol, globalIndex);
    const volLang = cards.length > 0 ? detectLanguageVariant(cards.map(c => c.text).join('')) : 'unknown';
    console.log(`   ✓ ${cards.length} teaching cards created (${volLang})`);

    volumeSummary.push({ name: vol.bookName, pages: pages.length, cards: cards.length, lang: volLang });
    allCards.push(...cards);
    globalIndex += cards.length;
    totalCards += cards.length;

    if (!DRY_RUN && pinecone) {
      const uploaded = await uploadCards(cards, pinecone, indexName);
      totalUploaded += uploaded;
      console.log(`   ✅ Uploaded ${uploaded}/${cards.length}`);
    }
  }

  // --- Summary ---
  console.log('\n═══════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════\n');

  for (const v of volumeSummary) {
    console.log(`  ${v.name.padEnd(16)} | ${v.lang.padEnd(11)} | ${String(v.pages).padStart(3)} pages → ${String(v.cards).padStart(3)} cards`);
  }
  console.log(`  ${'─'.repeat(40)}`);
  console.log(`  TOTAL${' '.repeat(15)} ${String(totalCards).padStart(3)} cards\n`);

  if (DRY_RUN) {
    // Show targeted samples: vol 1 (simplified), vol 2 (traditional), mid-volume
    console.log('═══════════════════════════════════════');
    console.log('SAMPLE CLEANED CARDS:');
    console.log('═══════════════════════════════════════\n');

    // Find one card from vol 1 (simplified), vol 2 (traditional), vol 8 (traditional)
    // Skip early pages (covers/copyright) by picking page > 5
    const targets = [1, 2, 8];
    for (const targetVol of targets) {
      const card = allCards.find(c => c.volume === targetVol && c.page_start > 5 && c.text.length > 50);
      if (!card) continue;
      console.log(`--- ${card.book} Page ${card.page_start} (${card.language_variant}, ${card.text.length} chars) ---`);
      console.log(`ID: ${card.id}`);
      console.log(card.text);
      console.log();
    }

    console.log(`\n📊 Estimated vectors for full upload: ${totalCards}`);
    console.log(`\n⏸️  DRY RUN complete. Run without --dry-run to upload.`);
  } else {
    console.log(`🎉 Wave 4 complete! Uploaded: ${totalUploaded}/${totalCards}`);
    await sleep(3000);
    const finalStats = await pinecone!.index(indexName).describeIndexStats();
    console.log(`📊 Index total: ${finalStats.totalRecordCount}`);
  }

  console.log(`\n南无大慈大悲观世音菩萨 🙏\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
