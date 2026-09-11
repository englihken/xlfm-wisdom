// scripts/warm-chips-prod.ts — warm chip_answers through the visitor path when
// CRON_SECRET is not at hand: POST each of the 18 chip questions as an opening
// turn to production /api/chat (a cache miss regenerates and writes back via
// storeChipAnswer). Conversations are tagged browserId=chip-warm:<lang>.
//   npx tsx scripts/warm-chips-prod.ts [--base https://xlfm-wisdom.vercel.app] [--concurrency 3] [--only key:lang,…]
import { allChips } from '../src/lib/quick-questions';

const arg = (name: string, dflt: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] ?? dflt : dflt; };
const BASE = arg('--base', 'https://xlfm-wisdom.vercel.app');
const CONCURRENCY = parseInt(arg('--concurrency', '3'), 10);

async function warm(chip: { key: string; language: string; question: string }) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: chip.question, conversation: [], language: chip.language, browserId: `chip-warm:${chip.language}` }),
  });
  if (!res.ok || !res.body) return { ...chip, ok: false, ms: Date.now() - t0, note: `HTTP ${res.status} ${(await res.text()).slice(0, 120)}` };
  const reader = res.body.getReader();
  let bytes = 0; let text = '';
  const dec = new TextDecoder();
  for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; text += dec.decode(value, { stream: true }); }
  const stages = [...text.matchAll(/"stage":"([a-z_]+)"/g)].map((m) => m[1]);
  return { ...chip, ok: true, ms: Date.now() - t0, note: `${bytes} bytes · stages ${stages.join('>') || '-'}` };
}

async function main() {
  const onlyArg = arg("--only", ""); // key:lang,key:lang
  const chips = allChips().filter((c) => !onlyArg || onlyArg.split(",").includes(`${c.key}:${c.language}`));
  console.log(`warming ${chips.length} chips against ${BASE} · concurrency ${CONCURRENCY}`);
  let next = 0; const rows: Awaited<ReturnType<typeof warm>>[] = [];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < chips.length) { const c = chips[next++]; const r = await warm(c).catch((e) => ({ ...c, ok: false, ms: 0, note: String(e) })); rows.push(r); console.log(`${r.ok ? '✓' : '✗'} ${r.language} ${r.key.padEnd(20)} ${(r.ms / 1000).toFixed(1)}s ${r.note}`); }
  }));
  console.log(`done: ${rows.filter((r) => r.ok).length}/${rows.length} ok`);
}
main().catch((e) => { console.error(e); process.exit(1); });
