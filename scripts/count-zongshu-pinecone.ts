// scripts/count-zongshu-pinecone.ts — count zongshu_ records in Pinecone by series id and sample era metadata (batch 3 report).
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Pinecone } from '@pinecone-database/pinecone';
async function main() {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const host = (await pc.describeIndex(process.env.PINECONE_INDEX_NAME!)).host;
  const H = { 'Api-Key': process.env.PINECONE_API_KEY!, 'X-Pinecone-API-Version': '2025-01' };
  let total = 0; let token: string | undefined; const bySeries: Record<string, number> = {};
  do {
    const u = new URL(`https://${host}/vectors/list`);
    u.searchParams.set('namespace', 'xlfm-wisdom'); u.searchParams.set('prefix', 'zongshu_'); u.searchParams.set('limit', '100');
    if (token) u.searchParams.set('paginationToken', token);
    const j = await (await fetch(u, { headers: H })).json() as { vectors?: { id: string }[]; pagination?: { next?: string } };
    const ids = (j.vectors ?? []).map(v => v.id); total += ids.length;
    for (const id of ids) { const k = id.split('_')[1] ?? '?'; bySeries[k] = (bySeries[k] ?? 0) + 1; }
    token = j.pagination?.next;
  } while (token);
  console.log(JSON.stringify({ total, bySeries }, null, 1));
  // era sample
  const u2 = new URL(`https://${host}/vectors/list`); u2.searchParams.set('namespace','xlfm-wisdom'); u2.searchParams.set('prefix','zongshu_'); u2.searchParams.set('limit','50');
  const j2 = await (await fetch(u2, { headers: H })).json() as { vectors?: { id: string }[] };
  const ids = (j2.vectors ?? []).map(v => v.id);
  const f = await (await fetch(`https://${host}/vectors/fetch?namespace=xlfm-wisdom&${ids.map(i=>`ids=${encodeURIComponent(i)}`).join('&')}`, { headers: H })).json() as { vectors?: Record<string, { metadata?: Record<string, unknown> }> };
  const eras: Record<string, number> = {};
  for (const v of Object.values(f.vectors ?? {})) { const e = String(v.metadata?.era ?? 'MISSING'); eras[e] = (eras[e] ?? 0) + 1; }
  console.log('era sample of 50:', JSON.stringify(eras));
}
main().catch(e => { console.error(e); process.exit(1); });
