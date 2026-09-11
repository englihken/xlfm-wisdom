// scripts/prompt-v2-translate.ts — batch 4 (F08 / C8): produce the EN and ID
// versions of every v2 module as TRANSLATIONS of the zh module (v1 served the
// Chinese text to every language plus a 第二十五部分 override). Line-for-line:
// the output keeps the same number of lines as the input so each translated
// line traces to its zh line (and through that to v1). Invariants that must
// survive verbatim — 《book/sutra names》, every digit, URL, phone number,
// 【marker】, emoji, and every quoted 祈求词 (the Chinese original is kept and
// the rendering follows in parentheses) — are checked by
// scripts/prompt-v2-verify.ts --i18n after this runs.
//   npx tsx scripts/prompt-v2-translate.ts [--only en|id] [--module core,tiers,…]
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { ZH_MODULES, MODULE_ORDER, type ModuleKey } from '../src/lib/prompt/modules-zh';

const MODEL = 'claude-opus-5';
const OUT_DIR = path.join(__dirname, '..', 'src', 'lib', 'prompt', 'i18n');
const CHUNK_MAX = 5500; // chars per request (split on headings)

const LANG_NAME = { en: 'English', id: 'Bahasa Indonesia' } as const;
const TERMS = {
  en: 'Use the English terminology already used by the platform: 大悲咒 = Great Compassion Mantra, 心经 = Heart Sutra, 礼佛大忏悔文 = Repentance Mantra (Eighty-Eight Buddhas Great Repentance), 消灾吉祥神咒 = Disaster-Eliminating Mantra, 准提神咒 = Cundi Mantra, 往生咒 = Amitabha Pure Land Rebirth Mantra, 七佛灭罪真言 = Seven Buddhas Karma-Eliminating Mantra, 解结咒 = Karmic-Knot-Untying Mantra (解结咒), 小房子 = Little House, 要经者 = karmic creditors, 台长/师父 = Master Lu, 观世音菩萨 = Guan Yin Bodhisattva, 共修会 = Dharma practice centre, 组织审定 = organisation-approved ruling, 许愿 = making vows, 放生 = life liberation, 回向 = dedication (keep Master Lu\'s simple "祈求 + 念经" framing).',
  id: 'Gunakan istilah yang sudah dipakai platform: 大悲咒 = Mantra Welas Asih Agung (Da Bei Zhou), 心经 = Sutra Hati (Xin Jing), 礼佛大忏悔文 = Mantra Pertobatan Agung (Li Fo Da Chan Hui Wen), 消灾吉祥神咒 = Mantra Penolak Bencana, 准提神咒 = Mantra Cundi, 往生咒 = Mantra Wang Sheng, 七佛灭罪真言 = Mantra Tujuh Buddha Penghapus Karma, 解结咒 = Mantra Pengurai Simpul Karma (Jie Jie Zhou), 小房子 = Rumah Kecil (Xiao Fang Zi), 要经者 = kreditor karma, 台长/师父 = Master Lu, 观世音菩萨 = Bodhisattva Guan Yin, 共修会 = pusat latihan bersama, 组织审定 = ketetapan resmi organisasi, 许愿 = berikrar, 放生 = melepas makhluk hidup, 回向 = pelimpahan jasa.',
} as const;

function systemFor(lang: 'en' | 'id'): string {
  return `You translate a Chinese system prompt (rules for an AI companion of 心灵法门, Master Lu Jun Hong's teachings) into ${LANG_NAME[lang]}. This is a MOVE, not a rewrite: translate faithfully, sentence by sentence, keeping the meaning, tone, emphasis and markdown exactly.

HARD RULES (a verifier rejects output that breaks them):
1. Output EXACTLY the same number of lines as the input, in the same order. Blank lines stay blank. A line that is only markdown punctuation (---, |---|, ===) stays as is. Never merge or split lines.
2. Keep VERBATIM, character for character: every 《…》 book/sutra title (you may add the ${LANG_NAME[lang]} name in parentheses right after it), every 【…】 marker, every number and count (3 遍 → "3 times", keep the digit), every URL, phone number and e-mail, every emoji, every "XXX"/"YYY"/"(姓名)" placeholder, markdown markers (#, >, -, *, |, 📿, ✅, ❌), and every Chinese personal/place name.
3. Every quoted prayer (祈求词 — text in quotes that begins 请大慈大悲 / 感恩南无 / 如放生活动 / 心灵法门所有法宝 / "XXX放生, or lines that start with > and quote such a prayer) must keep the ORIGINAL CHINESE quote verbatim, immediately followed by the ${LANG_NAME[lang]} rendering in parentheses. Same for the closing 南无大慈大悲观世音菩萨 🙏 lines and the 三称 line 感恩南无大慈大悲救苦救难广大灵感观世音菩萨: keep the Chinese, add the rendering in parentheses.
4. Chinese sutra/mantra names outside 《》 (e.g. 大悲咒 in a list) → the standard ${LANG_NAME[lang]} name followed by the Chinese in parentheses on first use in the chunk, e.g. "Great Compassion Mantra (大悲咒)". ${TERMS[lang]}
5. Sample replies and templates inside the prompt (lines starting with > that are example answers to a visitor) are translated too — they are what the AI should say in ${LANG_NAME[lang]}.
6. Do not add, drop, soften or strengthen any rule. Do not add explanations, notes or a preamble. Output only the translated lines.`;
}

function splitChunks(text: string): string[] {
  const lines = text.split('\n');
  const chunks: string[][] = [[]];
  for (const l of lines) {
    const cur = chunks[chunks.length - 1];
    const isHeading = /^#{2,4} /.test(l);
    if (cur.join('\n').length + l.length > CHUNK_MAX && isHeading && cur.length > 0) chunks.push([l]);
    else cur.push(l);
  }
  return chunks.map((c) => c.join('\n'));
}

async function translateChunk(client: Anthropic, lang: 'en' | 'id', chunk: string, attempt = 1): Promise<string> {
  // Leading/trailing blank lines are dropped by the model (→ N-1 lines): keep
  // them out of the request and put them back afterwards.
  const allLines = chunk.split('\n');
  let lead = 0;
  while (lead < allLines.length && allLines[lead].trim() === '') lead++;
  let trail = 0;
  while (trail < allLines.length - lead && allLines[allLines.length - 1 - trail].trim() === '') trail++;
  if (lead + trail === allLines.length) return chunk; // all blank
  if (lead > 0 || trail > 0) {
    const inner = await translateChunk(client, lang, allLines.slice(lead, allLines.length - trail).join('\n'), attempt);
    return [...Array(lead).fill(''), inner, ...Array(trail).fill('')].join('\n');
  }
  const wantLines = chunk.split('\n').length;
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: systemFor(lang),
    messages: [{ role: 'user', content: `Translate the following ${wantLines} lines. Output exactly ${wantLines} lines.\n\n<input>\n${chunk}\n</input>` }],
  });
  let out = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  out = out.replace(/^\s*<output>\n?/, '').replace(/\n?<\/output>\s*$/, '').replace(/^```[a-z]*\n/, '').replace(/\n```\s*$/, '');
  // trailing newline handling: input chunk may end without newline
  if (chunk.endsWith('\n') && !out.endsWith('\n')) out += '\n';
  if (!chunk.endsWith('\n')) out = out.replace(/\n+$/, '');
  const gotLines = out.split('\n').length;
  if (gotLines !== wantLines) {
    if (attempt < 2) {
      console.warn(`  · line count ${gotLines} ≠ ${wantLines} (attempt ${attempt}) — retrying`);
      return translateChunk(client, lang, chunk, attempt + 1);
    }
    // Long chunks drift on line count; halve at a blank line and translate each half.
    const lines = chunk.split('\n');
    if (lines.length >= 12) {
      let cut = Math.floor(lines.length / 2);
      while (cut > 2 && lines[cut].trim() !== '') cut--;
      if (cut <= 2) cut = Math.floor(lines.length / 2);
      console.warn(`  · line count ${gotLines} ≠ ${wantLines} — splitting ${lines.length} lines at ${cut}`);
      const a = await translateChunk(client, lang, lines.slice(0, cut).join('\n'), 1);
      const b = await translateChunk(client, lang, lines.slice(cut).join('\n'), 1);
      return `${a}\n${b}`;
    }
    // Tiny chunk: translate line by line (blank lines stay blank) — cannot drift.
    console.warn(`  · line count ${gotLines} ≠ ${wantLines} — translating ${lines.length} lines one by one`);
    const outLines: string[] = [];
    for (const l of lines) {
      if (l.trim() === '') {
        outLines.push('');
        continue;
      }
      const r = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        system: systemFor(lang),
        messages: [{ role: 'user', content: `Translate this ONE line. Output exactly one line, nothing else.\n\n<input>\n${l}\n</input>` }],
      });
      const t = r.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').replace(/\s*\n\s*/g, ' ').trim();
      outLines.push(t);
    }
    return outLines.join('\n');
  }
  return out;
}

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const onlyIdx = process.argv.indexOf('--only');
  const langs = (onlyIdx >= 0 ? [process.argv[onlyIdx + 1]] : ['en', 'id']) as ('en' | 'id')[];
  const modIdx = process.argv.indexOf('--module');
  const mods = (modIdx >= 0 ? process.argv[modIdx + 1].split(',') : MODULE_ORDER) as ModuleKey[];
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const lang of langs) {
    const file = path.join(OUT_DIR, `${lang}.ts`);
    const existing: Partial<Record<ModuleKey, string>> = fs.existsSync(file) ? (await import(pathToFileURL(file).href))[lang.toUpperCase() as 'EN' | 'ID'] ?? {} : {};
    const result: Partial<Record<ModuleKey, string>> = { ...existing };
    for (const key of mods) {
      const zh = ZH_MODULES[key];
      const chunks = splitChunks(zh);
      console.log(`[${lang}] ${key}: ${zh.length} chars · ${chunks.length} chunk(s)`);
      const t0 = Date.now();
      const outChunks: string[] = new Array(chunks.length);
      let next = 0;
      await Promise.all(
        Array.from({ length: 3 }, async () => {
          while (next < chunks.length) {
            const i = next++;
            outChunks[i] = await translateChunk(client, lang, chunks[i]);
            console.log(`  · chunk ${i + 1}/${chunks.length} done`);
          }
        })
      );
      result[key] = outChunks.join('\n');
      const zhLines = zh.split('\n').length;
      const outLines = result[key]!.split('\n').length;
      console.log(`  ✓ ${key} in ${Math.round((Date.now() - t0) / 1000)} s · lines ${outLines}/${zhLines}`);
      if (outLines !== zhLines) throw new Error(`${lang}/${key}: line count ${outLines} ≠ ${zhLines}`);
      writeFile(lang, result);
    }
  }
}

function writeFile(lang: 'en' | 'id', result: Partial<Record<ModuleKey, string>>) {
  const file = path.join(OUT_DIR, `${lang}.ts`);
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  const body = MODULE_ORDER.filter((k) => result[k] !== undefined)
    .map((k) => `  ${k}: \`${esc(result[k]!)}\`,`)
    .join('\n');
  fs.writeFileSync(
    file,
    `// src/lib/prompt/i18n/${lang}.ts — GENERATED by scripts/prompt-v2-translate.ts (batch 4 / C8).\n// ${LANG_NAME[lang]} translation of the zh v2 modules, line-for-line (each line traces\n// to the same line of the zh module → v1). Do not hand-edit: re-run the script.\n\nimport type { ModuleKey } from '../modules-zh';\n\nexport const ${lang.toUpperCase()}: Partial<Record<ModuleKey, string>> = {\n${body}\n};\n`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
