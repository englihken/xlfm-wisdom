// scripts/test-foyanfoyu-extraction.ts
// Test extraction of 佛言佛语 sayings from volume 1
// Goal: understand PDF structure and find saying boundaries

import * as fs from 'fs';
import * as path from 'path';

// @ts-ignore
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const PDF_PATH = path.join(
  'C:\\Users\\Ken\\Documents\\XLFM Books\\佛言佛语',
  '佛言佛语（第一册）.pdf'
);

interface PageText {
  pageNumber: number;
  text: string;
}

async function extractPages(filePath: string, maxPages: number): Promise<PageText[]> {
  const buffer = fs.readFileSync(filePath);
  const uint8 = new Uint8Array(buffer);
  const loadingTask = getDocument({
    data: uint8,
    useSystemFonts: true,
    standardFontDataUrl: 'node_modules/pdfjs-dist/standard_fonts/',
  });
  const pdf = await loadingTask.promise;
  console.log(`Total pages in PDF: ${pdf.numPages}\n`);

  const pages: PageText[] = [];
  const limit = Math.min(maxPages, pdf.numPages);
  for (let i = 1; i <= limit; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const rawText = textContent.items.map((item: any) => (item.str ?? '')).join(' ');
    const cleaned = rawText
      .replace(/\s{3,}/g, '\n\n')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    pages.push({ pageNumber: i, text: cleaned });
  }
  return pages;
}

interface DetectedSaying {
  number: number;
  text: string;
  page: number;
  charLength: number;
}

function detectSayings(pages: PageText[]): { sayings: DetectedSaying[]; pattern: string } {
  // Combine all page text with page markers
  const allText = pages.map(p => p.text).join('\n\n');

  // Strategy 1: Numbered entries like "1." "2." "1、" "2、" "(1)" at start of line
  const numberedRegex = /(?:^|\n\n)(\d{1,3})[.、．]\s*/g;
  const numberedMatches = [...allText.matchAll(numberedRegex)];
  if (numberedMatches.length >= 3) {
    return splitBySayings(pages, numberedRegex, `Numbered (e.g. "1." or "1、") — found ${numberedMatches.length} markers`);
  }

  // Strategy 2: Bullet markers • · ○
  const bulletRegex = /(?:^|\n\n)[•·○]\s*/g;
  const bulletMatches = [...allText.matchAll(bulletRegex)];
  if (bulletMatches.length >= 3) {
    return splitBySayings(pages, bulletRegex, `Bullet markers — found ${bulletMatches.length} markers`);
  }

  // Strategy 3: Double-newline separated paragraphs (short ones = sayings)
  const paragraphs: DetectedSaying[] = [];
  let sayingNum = 0;
  for (const page of pages) {
    const paras = page.text.split(/\n\n+/).filter(p => p.trim().length > 10);
    for (const para of paras) {
      sayingNum++;
      paragraphs.push({
        number: sayingNum,
        text: para.trim(),
        page: page.pageNumber,
        charLength: para.trim().length,
      });
    }
  }
  return { sayings: paragraphs, pattern: `Paragraph-based (double newline) — found ${paragraphs.length} paragraphs` };
}

function splitBySayings(pages: PageText[], regex: RegExp, patternName: string): { sayings: DetectedSaying[]; pattern: string } {
  const sayings: DetectedSaying[] = [];

  for (const page of pages) {
    // Reset regex
    regex.lastIndex = 0;
    const matches = [...page.text.matchAll(regex)];

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const start = match.index! + match[0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index! : page.text.length;
      const text = page.text.slice(start, end).trim();
      if (text.length > 5) {
        sayings.push({
          number: sayings.length + 1,
          text,
          page: page.pageNumber,
          charLength: text.length,
        });
      }
    }
  }

  return { sayings, pattern: patternName };
}

async function main() {
  console.log('=== 佛言佛语 Volume 1 — Extraction Test ===\n');
  console.log(`PDF: ${PDF_PATH}\n`);

  if (!fs.existsSync(PDF_PATH)) {
    console.error('❌ File not found!');
    process.exit(1);
  }

  // Extract first 10 pages
  const pages = await extractPages(PDF_PATH, 10);

  // === RAW TEXT SAMPLE ===
  console.log('═══════════════════════════════════════');
  console.log('RAW TEXT — First 3 pages (~3000 chars):');
  console.log('═══════════════════════════════════════\n');

  let charCount = 0;
  for (const page of pages) {
    if (charCount >= 3000) break;
    console.log(`--- PAGE ${page.pageNumber} (${page.text.length} chars) ---`);
    const slice = page.text.slice(0, 3000 - charCount);
    console.log(slice);
    console.log();
    charCount += slice.length;
  }

  // === DETECT SAYINGS ===
  console.log('\n═══════════════════════════════════════');
  console.log('SAYING DETECTION RESULTS:');
  console.log('═══════════════════════════════════════\n');

  const { sayings, pattern } = detectSayings(pages);

  console.log(`Detected pattern: ${pattern}`);
  console.log(`Total sayings detected in first 10 pages: ${sayings.length}`);

  // Summary table
  console.log('\n--- Saying Summary (all detected) ---\n');
  for (const s of sayings) {
    const preview = s.text.replace(/\s+/g, ' ').slice(0, 100);
    console.log(`  #${String(s.number).padStart(3)} | Page ${String(s.page).padStart(2)} | ${String(s.charLength).padStart(4)} chars | ${preview}...`);
  }

  // First 5 full sayings
  console.log('\n═══════════════════════════════════════');
  console.log('FIRST 5 FULL SAYINGS:');
  console.log('═══════════════════════════════════════\n');

  for (const s of sayings.slice(0, 5)) {
    console.log(`--- Saying #${s.number} (Page ${s.page}, ${s.charLength} chars) ---`);
    console.log(s.text);
    console.log();
  }

  // Avg length stats
  if (sayings.length > 0) {
    const lengths = sayings.map(s => s.charLength);
    const avg = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
    const min = Math.min(...lengths);
    const max = Math.max(...lengths);
    console.log(`\n📊 Stats: avg=${avg} chars, min=${min}, max=${max}`);
  }

  console.log('\n✅ Test complete. Review output before building upload script.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
