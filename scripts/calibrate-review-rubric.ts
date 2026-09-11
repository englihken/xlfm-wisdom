// scripts/calibrate-review-rubric.ts
// Batch 3 §4: re-run the (new) review rubric over exported transcripts and
// compare with the verdict on record. Historical verdicts are NOT rewritten.
//
// Input: one or more plain-text exports (see docs/reviews/2026-09-11-batch-3.md
// for the SQL), each conversation shaped as
//   ### <conversation_id> | <recorded verdict> | <question_key>
//   @user\n<text>\n@assistant\n<text>\n@sources <书目、书目>
//   npx tsx scripts/calibrate-review-rubric.ts --label A path1.txt path2.txt …
// Output: per-conversation recorded → new verdict (+ reason), and the counts
// the brief asks for (flipped to needs_improvement/ok; stayed good).

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import * as fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { REVIEW_MODEL, REVIEW_MAX_TOKENS, buildReviewPrompt, parseReviewOutput, type TranscriptMessage } from '../src/lib/care-review';

type Conv = { id: string; recorded: string; questionKey: string; messages: TranscriptMessage[] };

function parseExport(text: string): Conv[] {
  const out: Conv[] = [];
  // Split ONLY on conversation headers (uuid first) — assistant replies may
  // themselves contain markdown "### " headings.
  const blocks = text.split(/^### (?=[0-9a-f]{8}-[0-9a-f]{4}-)/m).filter((b) => b.trim());
  for (const b of blocks) {
    const [header, ...rest] = b.split('\n');
    const [id, recorded = '-', questionKey = '-'] = header.split('|').map((s) => s.trim());
    const messages: TranscriptMessage[] = [];
    let cur: TranscriptMessage | null = null;
    for (const line of rest) {
      const roleMatch = line.match(/^@(user|assistant|volunteer)$/);
      if (roleMatch) {
        if (cur) messages.push(cur);
        cur = { role: roleMatch[1], content: '' };
        continue;
      }
      const src = line.match(/^@sources (.*)$/);
      if (src && cur) {
        cur.sources = src[1].split('、').map((book) => ({ book: book.trim() })).filter((s) => s.book);
        continue;
      }
      if (cur) cur.content += (cur.content ? '\n' : '') + line;
    }
    if (cur) messages.push(cur);
    for (const m of messages) m.content = m.content.replace(/\n+$/, '');
    out.push({ id, recorded, questionKey, messages });
  }
  return out;
}

async function main() {
  const labelIdx = process.argv.indexOf('--label');
  const label = labelIdx >= 0 ? process.argv[labelIdx + 1] : 'set';
  const files = process.argv.slice(2).filter((a, i, arr) => a !== '--label' && arr[i - 1] !== '--label');
  const convs = files.flatMap((f) => parseExport(fs.readFileSync(f, 'utf8')));
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  console.log(`[${label}] ${convs.length} conversations · model=${REVIEW_MODEL}`);

  const rows: { id: string; recorded: string; verdict: string; reason: string; key: string }[] = [];
  const CONCURRENCY = 4;
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < convs.length) {
        const c = convs[next++];
        try {
          const res = await anthropic.messages.create({
            model: REVIEW_MODEL,
            max_tokens: REVIEW_MAX_TOKENS,
            messages: [{ role: 'user', content: buildReviewPrompt(c.messages) }],
          });
          const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
          const parsed = parseReviewOutput(text);
          rows.push({ id: c.id, recorded: c.recorded, verdict: parsed?.verdict ?? 'unparsed', reason: parsed?.reason ?? text.slice(0, 120), key: c.questionKey });
        } catch (e) {
          rows.push({ id: c.id, recorded: c.recorded, verdict: 'error', reason: e instanceof Error ? e.message : String(e), key: c.questionKey });
        }
      }
    })
  );
  rows.sort((a, b) => a.id.localeCompare(b.id));
  for (const r of rows) console.log(`${r.id.slice(0, 8)}  ${r.recorded.padEnd(17)} → ${r.verdict.padEnd(17)} ${r.key.padEnd(18)} ${r.reason}`);
  const flipped = rows.filter((r) => r.recorded === 'good' && (r.verdict === 'needs_improvement' || r.verdict === 'ok')).length;
  const stayedGood = rows.filter((r) => r.recorded === 'good' && r.verdict === 'good').length;
  const byVerdict = rows.reduce<Record<string, number>>((acc, r) => ((acc[r.verdict] = (acc[r.verdict] ?? 0) + 1), acc), {});
  console.log(`\n[${label}] summary: ${JSON.stringify(byVerdict)} · recorded good → ni/ok: ${flipped} · recorded good → good: ${stayedGood} · total ${rows.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
