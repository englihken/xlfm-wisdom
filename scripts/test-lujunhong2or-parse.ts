// scripts/test-lujunhong2or-parse.ts
// Unit tests for scripts/lujunhong2or-parse.ts (corpus Phase A regression):
// sample post → expected pair count · 开示-date extraction · unparseable
// logging · oversized-group splitting. Fixtures mirror the real WordPress
// content.rendered shape, INCLUDING the raw newlines between </p> and <p>
// (which must not create exchange boundaries — only <p>&nbsp;</p> does).
//   npx tsx scripts/test-lujunhong2or-parse.ts

import {
  parsePost,
  parsePosts,
  extractOriginalDate,
  htmlToLines,
  WpPost,
} from './lujunhong2or-parse';

let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (!ok) failed++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
}

const mkPost = (id: number, title: string, html: string): WpPost => ({
  id,
  slug: `post-${id}`,
  link: `https://lujunhong2or.com/post-${id}/`,
  title: { rendered: title },
  date: '2026-08-14T00:04:13',
  modified: '2026-08-14T00:04:19',
  content: { rendered: html },
});

// ── Fixture 1: letters post — 3 exchanges, middle one has follow-up 问/答 ─────
// Structure copied from real post 37789 (卢台长开示解答来信疑惑 七百五十).
const LETTERS_HTML = `<p><strong>问：</strong>同修念经的时候感觉莲花海水池在他前面，这是否正常？</p>
<p><strong>答：</strong>正常的，让他不要有意观想，否则会走火入魔。</p>
<p>&nbsp;</p>
<p><strong>问：</strong>同修5月份梦里说&#8220;这次有六个人很危险&#8221;。</p>
<p><strong>答：</strong>很多都是预示梦，不可不防的。</p>
<p><strong>问：</strong>她两天后又梦见有人说要许450张小房子，还是许108张就可以了？</p>
<p><strong>答：</strong>先许108张。</p>
<p>&nbsp;</p>
<p><strong>问：</strong>同修梦见有人看他的手相，请问这个梦是什么意思？</p>
<p><strong>答：</strong>就是他的生命之密码。</p>`;

console.log('\n═══ letters post: pair count & grouping ═══');
{
  const post = mkPost(37789, '卢台长开示解答来信疑惑（七百五十）（开示于2015年8月17日）', LETTERS_HTML);
  const { chunks, warnings } = parsePost(post, 'letters');
  check('3 exchanges (follow-up 问/答 stays in one chunk)', chunks.length === 3, `got ${chunks.length}`);
  check('ids are letters_{postId}_{n}', chunks.map((c) => c.id).join(',') === 'letters_37789_1,letters_37789_2,letters_37789_3');
  check('chunk 1 keeps 问 AND 答', chunks[0].text.includes('问：') && chunks[0].text.includes('答：'));
  check('chunk 2 holds both 问/答 pairs', (chunks[1].text.match(/问：/g) ?? []).length === 2);
  check('post title prepended', chunks[0].text.startsWith('【卢台长开示解答来信疑惑（七百五十）（开示于2015年8月17日）】'));
  check('quotes decoded (&#8220; → “)', chunks[1].text.includes('“这次有六个人很危险”'));
  check('no warnings', warnings.length === 0, warnings.join('; '));
}

// ── Fixture 2: fahui post — headings, 台长语 block, continuation paragraph ────
const FAHUI_HTML = `<p><strong>梦中许愿过大，现实做不到怎么办</strong></p>
<p><strong>问：</strong>如果睡梦中许了很大的愿，醒来后需要履行吗？</p>
<p><strong>答：</strong>在梦中属阴，都应该去实行。</p>
<p>&nbsp;</p>
<p><strong>不贪不求，无得亦无失</strong></p>
<p><strong>台长语：</strong>救人其实很痛苦，救人很不容易的。</p>
<p>大家都是佛缘，好好努力，好好修心，开心一点儿。</p>`;

console.log('\n═══ fahui post: heading, 台长语, continuation ═══');
{
  const post = mkPost(35352, '弟子提问 师父回答——卢台长2017年4月马来西亚印尼大型弘法活动（8）', FAHUI_HTML);
  const { chunks, warnings } = parsePost(post, 'fahui');
  check('2 exchanges (Q&A + 台长语 block)', chunks.length === 2, `got ${chunks.length}`);
  check('heading captured', chunks[0].heading === '梦中许愿过大，现实做不到怎么办');
  check('台长语 chunk kept with its heading', chunks[1].heading === '不贪不求，无得亦无失' && chunks[1].text.includes('台长语：'));
  check('continuation paragraph folded into 台长语 turn', chunks[1].text.includes('大家都是佛缘'));
  check('ids are fahui_{postId}_{n}', chunks[0].id === 'fahui_35352_1' && chunks[1].id === 'fahui_35352_2');
  check('no warnings', warnings.length === 0, warnings.join('; '));
}

// ── Format variant: 问1、/答1、 (early letters series 五十二…六十三) ──────────
console.log('\n═══ 问1、/答1、 enumeration-comma variant ═══');
{
  const html = `<p>【东方台秘书处编者按】卢台长在百忙之中回答一些疑难的问题。</p>
<p>&nbsp;</p>
<p>问1、【梦】同修梦见妈妈病了，请问什么意思？</p>
<p>答1、这个梦说明需要念小房子超度。</p>
<p>&nbsp;</p>
<p>问2、胸前长了几颗痣，有什么说法？</p>
<p>答2、长在中间的痣都是好的，偏了就不好。</p>`;
  const post = mkPost(7148, '卢台长开示解答来信疑惑（五十二）', html);
  const { chunks } = parsePost(post, 'letters');
  check('2 exchanges parsed from 、variant', chunks.length === 2, `got ${chunks.length}`);
  check('numbered 问 kept in text', chunks[0].text.includes('问1、'));
}

// ── Format variant: 问N：<br>答N： inside one <p> (letters 五十七…六十三) ─────
console.log('\n═══ 问N：<br />答N： single-paragraph variant ═══');
{
  const answer = '会有点麻烦的。动因果的事情最好都不要做。'.repeat(20); // makes the group oversized (8×400 > threshold)
  const pairs = Array.from({ length: 8 }, (_, i) =>
    `<p>问${105 + i}：这是第${i + 1}个问题吗？<br />\n答${105 + i}：${answer}</p>`
  ).join('\n');
  const html = `<p>【东方台秘书处编者按】卢台长在百忙之中回答一些疑难的问题。</p>\n${pairs}`;
  const post = mkPost(7658, '卢台长开示解答来信疑惑（五十七）', html);
  const { chunks } = parsePost(post, 'letters');
  check('8 pair-chunks parsed', chunks.length === 8, `got ${chunks.length}`);
  check('问 and 答 both present per chunk', chunks.every((c) => /问\d+：/.test(c.text) && /答\d+：/.test(c.text)));
  check('编者按 boilerplate not prepended to chunks', chunks.every((c) => !c.text.includes('编者按')));
}

// ── 开示-date extraction ──────────────────────────────────────────────────────
console.log('\n═══ 开示-date extraction ═══');
check('（开示于2015年8月17日）→ 2015-08-17', extractOriginalDate('卢台长开示解答来信疑惑（七百五十）（开示于2015年8月17日）') === '2015-08-17');
check('single-digit month/day zero-padded', extractOriginalDate('标题（开示于2016年1月3日）') === '2016-01-03');
check('no date → null (never guessed)', extractOriginalDate('弟子提问 师父回答——卢台长2017年4月马来西亚印尼大型弘法活动（8）') === null);

// ── Unparseable logging ───────────────────────────────────────────────────────
console.log('\n═══ unparseable posts are logged, never guessed ═══');
{
  const good = mkPost(1, '正常帖（开示于2015年8月17日）', LETTERS_HTML);
  const bad = mkPost(2, '通知：法会时间调整', '<p>各位同修，本次法会时间调整如下，请相互转告。</p>');
  const { chunks, unparseable, perPost } = parsePosts([good, bad], 'letters');
  check('good post parsed (3 pairs)', perPost.get(1) === 3);
  check('bad post yields 0 chunks', !perPost.has(2));
  check('bad post recorded in unparseable list', unparseable.length === 1 && unparseable[0].postId === 2);
  check('unparseable reason present', unparseable[0]?.reason.includes('问/答'));
  check('total chunks only from good post', chunks.length === 3);
}

// ── Format variant: no spacer paragraphs, oversized → split at 问-boundaries ──
console.log('\n═══ oversized spacer-less post splits at 问-boundaries ═══');
{
  const filler = '这里是很长的回答内容。'.repeat(60); // ~660 chars per 答 (4×660 > split threshold)
  const pairs = Array.from({ length: 4 }, (_, i) =>
    `<p><strong>问：</strong>第${i + 1}个问题？</p>\n<p><strong>答：</strong>${filler}</p>`
  ).join('\n');
  const post = mkPost(3, '无分隔符变体（开示于2015年8月17日）', pairs);
  const { chunks, warnings } = parsePost(post, 'letters');
  check('split into 4 pair-chunks', chunks.length === 4, `got ${chunks.length}`);
  check('split logged as warning', warnings.some((w) => w.includes('split')));
  check('each chunk has its own 问', chunks.every((c) => (c.text.match(/问：/g) ?? []).length === 1));
}

// ── htmlToLines: inter-tag newlines are NOT separators ────────────────────────
console.log('\n═══ htmlToLines separator semantics ═══');
{
  const lines = htmlToLines('<p>a</p>\n<p>b</p>\n<p>&nbsp;</p>\n<p>c</p>');
  check('inter-tag newlines produce no empty lines', JSON.stringify(lines) === JSON.stringify(['a', 'b', '', 'c']), JSON.stringify(lines));
}

console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} CHECKS FAILED`}`);
if (failed > 0) process.exit(1);
