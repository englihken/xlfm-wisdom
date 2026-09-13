// scripts/probe-prod.ts — production probe (brief 2026-09-13-xfz-retrieval-and-prayer-guard §1.3).
// Three questions through the REAL production /api/chat, as a synthetic
// visitor (browserId test-suite:probe → contacts.is_test: never in the inbox,
// counts, summaries or reviews), asserting that the standard numbers land
// paired with their sutra, with no guard placeholder and no tail. R17 stayed
// green locally while production answered 「一张小房子的经文组合是」 without
// 84／87 — this is the check that runs where visitors are.
//   npx tsx scripts/probe-prod.ts [--base https://xlfm-wisdom.vercel.app]
// One line per question and a final 「probe: N/3 ok」 line for the watch report;
// exit 1 on any failure.

const argOf = (name: string, dflt: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt;
};
const BASE = argOf('--base', 'https://xlfm-wisdom.vercel.app');

const SUTRA_ALIASES: Record<string, string> = {
  大悲咒: '大悲咒|大悲心陀罗尼',
  心经: '心经',
  往生咒: '往生咒|往生净土神咒',
  七佛灭罪真言: '七佛灭罪真言',
};
const COMPOSITION: [string, number][] = [
  ['大悲咒', 27],
  ['心经', 49],
  ['往生咒', 84],
  ['七佛灭罪真言', 87],
];
const PLACEHOLDER = '（遍数以官方资料为准）';
const TAIL_RE = /查不到相关原文|个别涉及遍数／张数的细节因暂未能核对到原文/;

/**
 * The count sits next to ITS sutra (same line, within 24 characters, either
 * order); an enumeration counts — 「往生咒一般需要念诵 21、27 或 49 遍」 pairs 21.
 */
function paired(reply: string, sutra: string, n: number): boolean {
  const s = reply.replace(/[ \t]+/g, '').replace(/\*\*/g, '');
  const names = SUTRA_ALIASES[sutra] ?? sutra;
  const enumWith = `(?<!\\d)(?:\\d+[、，,/或和及])*${n}(?:[、，,/或和及]\\d+)*遍`;
  return new RegExp(`(${names})[^。\\n📿]{0,24}?${enumWith}|${enumWith}[^。\\n📿]{0,4}(${names})`).test(s);
}

const PROBES: { q: string; pairs: [string, number][] }[] = [
  { q: '一张小房子的经文组合是什么', pairs: COMPOSITION },
  { q: '小房子的篇数是多少？', pairs: COMPOSITION },
  // 功课卡: 往生咒一般 21、27、49 遍 — 21 must be there, paired.
  { q: '往生咒念多少遍', pairs: [['往生咒', 21]] },
];

async function ask(q: string): Promise<{ text: string; ms: number; status: number }> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ message: q, conversation: [], language: 'zh', browserId: 'test-suite:probe' }),
  });
  const body = await res.text();
  let text = '';
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try {
      const j = JSON.parse(line.slice(5)) as { type?: string; text?: string };
      if (j.type === 'text' && typeof j.text === 'string') text += j.text;
    } catch {
      /* [DONE] and keep-alives */
    }
  }
  return { text, ms: Date.now() - t0, status: res.status };
}

async function main() {
  let ok = 0;
  for (const p of PROBES) {
    const { text, ms, status } = await ask(p.q);
    const missing = p.pairs.filter(([s, n]) => !paired(text, s, n)).map(([s, n]) => `${s}${n}`);
    const placeholder = text.includes(PLACEHOLDER);
    const tail = TAIL_RE.test(text);
    const pass = status === 200 && text.length > 0 && missing.length === 0 && !placeholder && !tail;
    if (pass) ok++;
    console.log(
      `${pass ? '✓' : '✗'} 「${p.q}」 · ${missing.length === 0 ? 'pairs ok' : `missing ${missing.join('、')}`} · placeholder=${placeholder} · tail=${tail} · ${(ms / 1000).toFixed(1)}s`
    );
    if (!pass) console.log(`   reply: ${text.slice(0, 400).replace(/\n/g, '⏎')}`);
  }
  console.log(`probe: ${ok}/${PROBES.length} ok · ${BASE} · ${new Date().toISOString()}`);
  if (ok < PROBES.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
