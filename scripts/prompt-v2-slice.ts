// scripts/prompt-v2-slice.ts — batch 4 (F08) one-shot generator that wrote the
// FIRST draft of src/lib/prompt/*.ts by copying line ranges of
// src/lib/system-prompt.v1.ts verbatim (section headers 「第N部分：」 become
// 「## 」 headings; '====' separators dropped). The C1–C8 edits were then applied
// by hand on top; the mechanical check that every remaining line still traces
// to v1 is scripts/prompt-v2-verify.ts. Kept in the repo so the slicing is
// reproducible; re-running it would OVERWRITE the hand edits — don't.
//   npx tsx scripts/prompt-v2-slice.ts --force
import * as fs from 'fs';
import * as path from 'path';

const V1 = path.join(__dirname, '..', 'src', 'lib', 'system-prompt.v1.ts');
const OUT = path.join(__dirname, '..', 'src', 'lib', 'prompt');
const lines = fs.readFileSync(V1, 'utf8').split('\n'); // 1-based below

type Range = [number, number] | number;
type Module = { file: string; constName: string; title: string; ranges: Range[] };

// v1 line ranges (inclusive, original numbering). Headers 「第N部分：…」 are
// included as single numbers so the section title travels with its text.
const MODULES: Module[] = [
  {
    file: 'core.ts',
    constName: 'CORE_ZH',
    title: '身份、守则、禁忌、证据与引用规则、来源格式',
    ranges: [6, 9, [12, 20], 23, [26, 43], 46, [49, 92], 1243, [1246, 1293], 640, [643, 653], 1003, [1006, 1159], 2767, [2770, 2815], [2849, 2854], [2659, 2675], 1170, [1173, 1179]],
  },
  {
    file: 'tiers.ts',
    constName: 'TIERS_ZH',
    title: '分档、入门轮规则、给了再问、小房子门槛、长度表、语言与语气',
    ranges: [917, [920, 1000], 2078, [2081, 2207], 2449, [2451, 2471], [2536, 2549], 1296, [1301, 1345], [1374, 1399], [1420, 1436], [2677, 2712], [2741, 2764]],
  },
  {
    file: 'topics/practice.ts',
    constName: 'PRACTICE_ZH',
    title: '五大法宝、三大支柱与功用表、十小咒、念经回向',
    ranges: [95, [98, 251], 506, [509, 637], 1182, [1185, 1240], [2714, 2729]],
  },
  {
    file: 'topics/xiaofangzi.ts',
    constName: 'XIAOFANGZI_ZH',
    title: '小房子方法、SOP、填写念诵、era 规则',
    ranges: [369, [372, 503], [2209, 2276], [2508, 2532], 2874],
  },
  {
    file: 'topics/relationships.ts',
    constName: 'RELATIONSHIPS_ZH',
    title: '关系类结构、男女界线、家庭法律边界',
    ranges: [656, [659, 689], 1631, [1634, 1957]],
  },
  {
    file: 'topics/crisis.ts',
    constName: 'CRISIS_ZH',
    title: '危机与特殊情况（四步协议、热线、家暴）',
    ranges: [692, [695, 914]],
  },
  {
    file: 'topics/altar.ts',
    constName: 'ALTAR_ZH',
    title: '佛台',
    ranges: [254, [257, 366]],
  },
  {
    file: 'topics/sources.ts',
    constName: 'SOURCES_ZH',
    title: '书籍分类、站点来源规则、图腾规则',
    ranges: [[1346, 1372], [1410, 1418], [2863, 2873], [2731, 2739]],
  },
  {
    file: 'topics/misc.ts',
    constName: 'MISC_ZH',
    title: '台长生平、外界质疑、免费承诺、穆斯林边界、期望管理、短回应处理、共修会名单与链接',
    ranges: [1162, [1165, 1167], 1439, [1442, 1535], 1538, [1541, 1628], 1960, [1963, 1989], 1993, [1996, 2074], 2553, [2556, 2652], [2291, 2447], 2449, [2473, 2491]],
  },
];

const HEADER_RE = /^第[一二三四五六七八九十]+部分\s*[:：]\s*(.*)$/;

function emit(m: Module): string {
  const out: string[] = [];
  for (const r of m.ranges) {
    const [a, b] = typeof r === 'number' ? [r, r] : r;
    for (let n = a; n <= b; n++) {
      const l = lines[n - 1];
      if (l === undefined) throw new Error(`${m.file}: line ${n} out of range`);
      if (/^=+$/.test(l.trim())) continue;
      // v1 lines 6 / 2854 / 2874 carry the TS wrapper (`export const X = `…` / trailing `;) — strip it.
      const stripped = l.replace(/^export const \w+ = `/, '').replace(/`;$/, '');
      const h = stripped.match(HEADER_RE);
      out.push(h ? `## ${h[1].trim()}` : stripped);
    }
    out.push('');
  }
  // collapse 3+ blank lines
  const body = out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '');
  return `// src/lib/prompt/${m.file} — system prompt v2 module (batch 4 / F08): ${m.title}.\n// Every line is a verbatim copy of src/lib/system-prompt.v1.ts except the C1–C8\n// edits listed in docs/reviews/batch4-2026-09-11/traceability.md; checked by\n// scripts/prompt-v2-verify.ts. Sliced by scripts/prompt-v2-slice.ts.\n\nexport const ${m.constName} = \`${body}\`;\n`;
}

if (!process.argv.includes('--force')) {
  console.error('refusing to overwrite hand-edited modules; pass --force');
  process.exit(1);
}
for (const m of MODULES) {
  const p = path.join(OUT, m.file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, emit(m));
  console.log(`wrote ${m.file}`);
}
