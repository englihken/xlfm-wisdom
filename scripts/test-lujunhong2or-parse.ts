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
  parseTranscriptPost,
  parseTranscriptPosts,
  extractOriginalDate,
  extractDateLoose,
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

// ═══ Phase B: transcript mode (玄艺问答 / 玄艺综述) ═══════════════════════════

// ── 2010-era wenda: timestamp + topic label + 问/答 inside one <p> ────────────
console.log('\n═══ transcript: timestamp/topic 问答 variant (2010 wenda) ═══');
{
  const html = `<p>尊敬的卢台长博客朋友们：</p>
<p>东方台秘书处从今天开始将新开一个栏目给大家，我们会陆续把《玄艺问答》中的一些栏目上网，以飨网友，这里是编者按的长篇说明文字。</p>
<p> 02.00<br /> 风水<br /> 问：厕所间不能放鞋子，那放在门口能放吗？<br /> 答：可以的，放在房间的房门口没有问题。</p>
<p> 03.20<br /> 念经<br /> 问：给女儿念礼佛大忏悔文说消除前世孽障对吗？<br /> 答：不可以的。只能说去除身上的孽障。</p>`;
  const post = mkPost(4679, '《玄艺问答》节目2010年6月11日', html);
  const { chunks } = parseTranscriptPost(post, 'wenda');
  check('2 exchanges', chunks.length === 2, `got ${chunks.length}`);
  check('topic label becomes heading', chunks[0].heading === '风水' && chunks[1].heading === '念经');
  check('timestamps dropped', !chunks[0].text.includes('02.00'));
  check('preamble not in chunks', chunks.every((c) => !c.text.includes('编者按')));
  check('ids wenda_{postId}_{n}', chunks[0].id === 'wenda_4679_1');
}

// ── 听众/台长 dialogue variant ────────────────────────────────────────────────
console.log('\n═══ transcript: 男听众/女听众…台长 dialogue variant ═══');
{
  const html = `<p>女听众：台长您好！请问初一十五可以多念心经吗？</p>
<p>台长：可以的，心经开智慧，多念没有问题。</p>
<p>男听众A：那我梦见亡人要怎么办呢？</p>
<p>台 长：给亡人念小房子超度。</p>`;
  const post = mkPost(9001, '《玄艺问答》节目2015年3月6日', html);
  const { chunks } = parseTranscriptPost(post, 'wenda');
  check('2 caller exchanges', chunks.length === 2, `got ${chunks.length}`);
  check('听众 turn kept with 台长 turn', chunks[0].text.includes('女听众：') && chunks[0].text.includes('台长：'));
  check('台 长 (spaced) variant matches', chunks[1].text.includes('台 长：'));
}

// ── spacer between 问 and 答 (2008 zongshu 预测实例) — carryQ merge ───────────
console.log('\n═══ transcript: 问 ⏐ &nbsp; ⏐ 答 reunification (zongshu) ═══');
{
  const html = `<p>在我的众多遥测解答的例子中，这个例子比较特殊，平时我们不常接触到，正因为如此，才更显示出灵界的真实存在，以下为当时的完整记录。</p>
<p>&nbsp;</p>
<p>问：我的弟弟查出脑瘤，明天动手术，有什么办法可以救救他？</p>
<p>&nbsp;</p>
<p>答：（看了图腾后答）你这个弟弟得罪了一个道行比较高的人。放生，这是最直接、最有效的办法。</p>`;
  const post = mkPost(5147, '悉尼东方电台台长预测实例4', html);
  const { chunks, warnings } = parseTranscriptPost(post, 'zongshu');
  check('1 exchange (问 reunited with 答 across spacer)', chunks.length === 1, `got ${chunks.length}`);
  check('问 present in chunk', chunks[0].text.includes('问：我的弟弟'));
  check('long narrative preamble logged as stray', warnings.some((w) => w.includes('preamble/stray')));
}

// ── numbered 1．问： variant + broadcast-date extraction ─────────────────────
console.log('\n═══ transcript: 1．问： variant + 节目日期 ═══');
{
  const html = `<p>1．问：快到农历十月初一了，送寒衣的习俗玄学上有说法吗？<br />答：有类似的说法，但你不知道亡人在哪个道。</p>
<p>2．问：念经分神怎么办？<br />答：可以看着经文念。</p>`;
  const post = mkPost(4681, '《玄艺问答》节目2010年11月5日', html);
  const { chunks } = parseTranscriptPost(post, 'wenda');
  check('numbered pairs parse (2 exchanges)', chunks.length === 2, `got ${chunks.length}`);
  check('broadcast date extracted', extractDateLoose(post.title.rendered) === '2010-11-05');
  check('no-date title → null', extractDateLoose('悉尼东方电台台长预测实例4') === null);
}

// ── 秘书处-answered posts are unparseable (never attributed to 台长) ──────────
console.log('\n═══ transcript: 秘书处 letters rejected ═══');
{
  const html = `<p>【秘书处编者按】近日秘书处收到一封网友来信，阐述了自己的很多疑问，很有代表性，于是将问题及秘书处的回复摘录出来供大家借鉴理解，消除疑虑。</p>
<p>网友来信问题一：我以前修过其他法门，出现了好多不顺，跟修法门有关吗？</p>
<p>秘书处：非常感谢您的来信，越是修的法门多越是容易引起一些麻烦，所以佛法讲要一门深入，这些问题应该是暂时的。</p>`;
  const post = mkPost(4680, '关于卢台长法门和其它法门的关系解答', html);
  const { chunks, unparseable } = parseTranscriptPosts([post], 'wenda');
  check('0 chunks (秘书处 is not 台长)', chunks.length === 0);
  check('logged as unparseable', unparseable.length === 1 && unparseable[0].postId === 4680);
}

console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} CHECKS FAILED`}`);
if (failed > 0) process.exit(1);
