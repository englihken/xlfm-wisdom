// scripts/upload-zongshu-v2.ts
// 玄艺综述 re-parse + upload (batch 2 §2). Classifies every post into a format
// family (scripts/zongshu-parse.ts), parses A/B/C/D/F, prints the per-family
// report the architect asked for (posts / pairs / zero-pair posts + reasons,
// 3 parsed samples per family, 3 raw samples per held G sub-series), and
// upserts ONLY ids that do not already exist in Pinecone — the Phase-B
// zongshu_{postId}_{n} records are never touched.
//
//   npx tsx scripts/upload-zongshu-v2.ts --dry-run      # parse + report only
//   npx tsx scripts/upload-zongshu-v2.ts                # parse + report + upload new ids
//   --report docs/reviews/batch2-2026-09-11/zongshu-parse-report.md (default)

import { Pinecone } from '@pinecone-database/pinecone';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { type WpPost } from './lujunhong2or-parse';
import { parseZongshuPost, postTitle, postLines, type Family, type ZsChunk } from './zongshu-parse';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const NAMESPACE = 'xlfm-wisdom';
const SRC_DIR = path.join(__dirname, '..', 'corpus-sources', 'lujunhong2or');
const BATCH_SIZE = 90;
const BATCH_DELAY_MS = 500;

interface Snapshot { category: string; fetched_at: string; posts: WpPost[] }

function loadPosts(filePrefix: string): WpPost[] {
  const files = fs.readdirSync(SRC_DIR).filter((f) => f.startsWith(filePrefix) && f.endsWith('.json')).sort();
  const byId = new Map<number, WpPost>();
  for (const f of files) {
    const snap = JSON.parse(fs.readFileSync(path.join(SRC_DIR, f), 'utf8')) as Snapshot;
    for (const p of snap.posts) byId.set(p.id, p);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

async function existingIds(prefix: string): Promise<Set<string>> {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const host = (await pc.describeIndex(process.env.PINECONE_INDEX_NAME!)).host;
  const ids = new Set<string>();
  let token: string | undefined;
  do {
    const u = new URL(`https://${host}/vectors/list`);
    u.searchParams.set('namespace', NAMESPACE);
    u.searchParams.set('prefix', prefix);
    u.searchParams.set('limit', '100');
    if (token) u.searchParams.set('paginationToken', token);
    const r = await fetch(u, { headers: { 'Api-Key': process.env.PINECONE_API_KEY!, 'X-Pinecone-API-Version': '2025-01' } });
    if (!r.ok) throw new Error(`list ids failed: ${r.status} ${await r.text()}`);
    const d = (await r.json()) as { vectors?: { id: string }[]; pagination?: { next?: string } };
    for (const v of d.vectors ?? []) ids.add(v.id);
    token = d.pagination?.next;
  } while (token);
  return ids;
}

const FAMILY_LABEL: Record<Family, string> = {
  A: 'A 听众：/台长：',
  B: 'B 问：…答：',
  C: 'C 卢台长：/听 众：',
  D: 'D 《图腾世界》',
  E: 'E 同修分享／反馈（不上传）',
  F: 'F 开示／解答会记录（teaching）',
  G: 'G 待批（未解析）',
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const reportArg = process.argv.indexOf('--report');
  const reportPath = reportArg >= 0 ? process.argv[reportArg + 1] : 'docs/reviews/batch2-2026-09-11/zongshu-parse-report.md';

  // Cross-filed dedupe, same precedence as upload-lujunhong2or.ts.
  const crossFiled = new Set<number>();
  for (const prefix of ['letters-', 'fahui-qa-', 'wenda-']) for (const p of loadPosts(prefix)) crossFiled.add(p.id);
  const all = loadPosts('zongshu-');
  const posts = all.filter((p) => !crossFiled.has(p.id));
  console.log(`zongshu posts: ${all.length} · cross-filed (letters/fahui/wenda precedence) skipped: ${all.length - posts.length} · to classify: ${posts.length}`);

  type Stat = { posts: number; chunks: number; inLib: number; zero: { id: number; title: string; reason: string }[]; samples: ZsChunk[]; totem: number; warnings: string[] };
  const stats: Record<Family, Stat> = Object.fromEntries((['A', 'B', 'C', 'D', 'E', 'F', 'G'] as Family[]).map((f) => [f, { posts: 0, chunks: 0, inLib: 0, zero: [], samples: [], totem: 0, warnings: [] }])) as Record<Family, Stat>;
  const held: Record<string, WpPost[]> = {};
  const records: ZsChunk[] = [];
  const perPostFamily = new Map<number, Family>();

  for (const post of posts) {
    const r = parseZongshuPost(post);
    const st = stats[r.family];
    st.posts++;
    perPostFamily.set(post.id, r.family);
    st.warnings.push(...r.warnings);
    if (r.family === 'G' || r.family === 'E') {
      (held[r.subseries ?? r.family] ??= []).push(post);
      continue;
    }
    if (r.chunks.length === 0) {
      st.zero.push({ id: post.id, title: postTitle(post), reason: r.zeroReason ?? 'unknown' });
      continue;
    }
    st.chunks += r.chunks.length;
    st.totem += r.chunks.filter((c) => c.case_kind === 'totem_reading').length;
    if (st.samples.length < 3) st.samples.push(r.chunks[0]);
    records.push(...r.chunks);
  }

  // Never touch existing ids.
  const existing = dryRun && process.argv.includes('--offline') ? new Set<string>() : await existingIds('zongshu_');
  const fresh = records.filter((c) => !existing.has(c.id));
  const skippedExisting = records.length - fresh.length;
  const existingPosts = new Set([...existing].map((id) => Number(id.split('_')[1])));
  for (const c of records) if (existing.has(c.id)) stats[c.family].inLib++;

  // ── Report ────────────────────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push(`# 玄艺综述 解析报告（${new Date().toISOString().slice(0, 10)}）`, '');
  lines.push(`快照 \`zongshu-20260815.json\`：${all.length} 篇；letters/fahui/wenda 已收录的交叉发布 ${all.length - posts.length} 篇跳过；分类 ${posts.length} 篇。Pinecone 中已有 \`zongshu_\` id ${existing.size} 条（${existingPosts.size} 篇），本次**不动**；新 id ${fresh.length} 条。`, '');
  lines.push('| 家族 | 篇数 | 解析出对/块数 | 图腾类 | 零对篇数 | 已在库块（不动） | 新增块 |', '|---|---|---|---|---|---|---|');
  for (const f of ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as Family[]) {
    const st = stats[f];
    const held = f === 'E' || f === 'G';
    lines.push(`| ${FAMILY_LABEL[f]} | ${st.posts} | ${held ? '—' : st.chunks} | ${held ? '—' : st.totem} | ${held ? '—' : st.zero.length} | ${held ? '—' : st.inLib} | ${held ? '—' : st.chunks - st.inLib} |`);
  }
  lines.push('', `已在库的 ${skippedExisting} 条 id 被跳过（旧的不动）；本次新增 ${fresh.length} 条。`, '');
  for (const f of ['A', 'B', 'C', 'D', 'F'] as Family[]) {
    const st = stats[f];
    lines.push(`## ${FAMILY_LABEL[f]} — ${st.posts} 篇 / ${st.chunks} 块`, '');
    if (st.zero.length) {
      lines.push(`零对篇（${st.zero.length}）：`);
      for (const z of st.zero.slice(0, 40)) lines.push(`- ${z.id} 「${z.title.slice(0, 50)}」 — ${z.reason}`);
      if (st.zero.length > 40) lines.push(`- …另 ${st.zero.length - 40} 篇`);
      lines.push('');
    }
    if (st.warnings.length) lines.push(`解析警告 ${st.warnings.length} 条（前 5）：`, ...st.warnings.slice(0, 5).map((w) => `- ${w}`), '');
    lines.push('解析样本（各家族前 3 块，截 500 字）：', '');
    for (const c of st.samples) {
      lines.push(`**${c.id}** · case_kind=${c.case_kind}${c.original_date ? ` · original_date=${c.original_date}` : ''}${c.editor_note ? ` · editor_note=「${c.editor_note.slice(0, 80).replace(/\n/g, ' ')}…」` : ''}`, '');
      lines.push('```', c.text.slice(0, 500), '```', '');
    }
  }
  lines.push('## E / G — 未上传，供审批', '');
  for (const [sub, ps] of Object.entries(held)) {
    lines.push(`### ${sub} — ${ps.length} 篇（前 3 篇原文，截 600 字）`, '');
    for (const p of ps.slice(0, 3)) {
      lines.push(`**${p.id}** 「${postTitle(p)}」 ${p.link}`, '', '```', postLines(p).filter(Boolean).join('\n').slice(0, 600), '```', '');
    }
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, lines.join('\n'));
  console.log(lines.slice(0, 14).join('\n'));
  console.log(`\nreport → ${reportPath}`);

  if (dryRun) { console.log('--dry-run: skipping upload'); return; }

  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const host = (await pinecone.describeIndex(process.env.PINECONE_INDEX_NAME!)).host;
  const postById = new Map(posts.map((p) => [p.id, p]));
  const payload = fresh.map((c) => {
    const post = postById.get(c.postId)!;
    return {
      _id: c.id,
      text: c.text,
      book: '玄艺综述',
      type: c.case_kind === 'teaching' ? 'teaching' : 'case_qa',
      source: 'lujunhong2or',
      category: '玄艺综述',
      family: c.family,
      speaker: c.speaker,
      case_kind: c.case_kind,
      post_title: postTitle(post),
      url: post.link,
      wp_date: post.date,
      ...(c.original_date ? { original_date: c.original_date } : {}),
      ...(c.editor_note ? { editor_note: c.editor_note } : {}),
      chunk_index: c.index,
      excerpt: postTitle(post),
    };
  });
  for (let i = 0; i < payload.length; i += BATCH_SIZE) {
    const batch = payload.slice(i, i + BATCH_SIZE);
    const response = await fetch(`https://${host}/records/namespaces/${NAMESPACE}/upsert`, {
      method: 'POST',
      headers: { 'Api-Key': process.env.PINECONE_API_KEY!, 'Content-Type': 'application/x-ndjson', 'X-Pinecone-API-Version': '2025-01' },
      body: batch.map((r) => JSON.stringify(r)).join('\n'),
    });
    if (!response.ok) throw new Error(`upsert batch @${i} failed: ${response.status} ${await response.text()}`);
    console.log(`  ✓ upserted ${i + batch.length}/${payload.length}`);
    if (i + BATCH_SIZE < payload.length) await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }
  console.log(`\n✓ Upserted ${payload.length} new 玄艺综述 records (case_qa/teaching, no ranking boost)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
