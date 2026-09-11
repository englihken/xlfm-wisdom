// scripts/era-audit-pinecone.ts — batch 3 §1: which zongshu_ records lack `era`,
// and do they carry a date we could derive it from? `--fix` sets era on records
// that have original_date but no era (setMetadata only, no re-embedding).
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Pinecone } from '@pinecone-database/pinecone';
const FIX = process.argv.includes('--fix');
async function main() {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const host = (await pc.describeIndex(process.env.PINECONE_INDEX_NAME!)).host;
  const H = { 'Api-Key': process.env.PINECONE_API_KEY!, 'X-Pinecone-API-Version': '2025-01', 'Content-Type': 'application/json' };
  const ids: string[] = []; let token: string | undefined;
  do {
    const u = new URL(`https://${host}/vectors/list`);
    u.searchParams.set('namespace', 'xlfm-wisdom'); u.searchParams.set('prefix', 'zongshu_'); u.searchParams.set('limit', '100');
    if (token) u.searchParams.set('paginationToken', token);
    const j = await (await fetch(u, { headers: H })).json() as { vectors?: { id: string }[]; pagination?: { next?: string } };
    ids.push(...(j.vectors ?? []).map(v => v.id)); token = j.pagination?.next;
  } while (token);
  const stats = { total: ids.length, withEra: 0, noEraWithDate: 0, noEraNoDate: 0, pre: 0, std: 0, fixed: 0 };
  const keysSeen: Record<string, number> = {}; const noDateSample: string[] = []; const bookOfNoDate: Record<string, number> = {};
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const f = await (await fetch(`https://${host}/vectors/fetch?namespace=xlfm-wisdom&${batch.map(x => `ids=${encodeURIComponent(x)}`).join('&')}`, { headers: H })).json() as { vectors?: Record<string, { metadata?: Record<string, unknown> }> };
    for (const [id, v] of Object.entries(f.vectors ?? {})) {
      const md = v.metadata ?? {};
      for (const k of Object.keys(md)) keysSeen[k] = (keysSeen[k] ?? 0) + 1;
      if (md.era) { stats.withEra++; if (md.era === 'pre_xiaofangzi') stats.pre++; else stats.std++; continue; }
      const date = typeof md.original_date === 'string' ? md.original_date : typeof md.date === 'string' ? md.date : null;
      if (!date) { stats.noEraNoDate++; if (noDateSample.length < 5) noDateSample.push(id); const b = String(md.book ?? md.subseries ?? '?'); bookOfNoDate[b] = (bookOfNoDate[b] ?? 0) + 1; continue; }
      stats.noEraWithDate++;
      if (FIX) {
        const era = date < '2010-01-01' ? 'pre_xiaofangzi' : 'standard';
        const r = await fetch(`https://${host}/vectors/update`, { method: 'POST', headers: H, body: JSON.stringify({ id, namespace: 'xlfm-wisdom', setMetadata: { era } }) });
        if (r.ok) stats.fixed++; else console.error('update failed', id, r.status, await r.text());
      }
    }
    if ((i / 100) % 10 === 0) console.log(`· ${i}/${ids.length}`);
  }
  console.log(JSON.stringify({ stats, keysSeen, noDateSample, bookOfNoDate }, null, 1));
}
main().catch(e => { console.error(e); process.exit(1); });
