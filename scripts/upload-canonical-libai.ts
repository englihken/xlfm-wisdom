// scripts/upload-canonical-libai.ts
// Uploads the 组织审定 canonical doc 「礼佛大忏悔文特殊日子遍数表（依佛学问答161，
// 2025-01官方版核对）」 into the RAG namespace as type 'canonical_ruling'.
//
// Why: production convs 29cfd74c / 6b6f74ff served fabricated 遍数 ("初一十五
// 13遍") because retrieval never surfaced the real numbers table. This doc is
// the authoritative table; vector-search gives 'canonical_ruling' chunks a
// guaranteed parallel query + a rerank boost that puts them above ordinary
// book chunks.
//
// The doc text below is VERBATIM from the approved 组织审定 source — do not
// edit it. It is split into sections ONLY at paragraph boundaries (a 遍数 list
// is never split mid-item), and the script asserts the sections reassemble to
// the exact original before uploading. Re-running is safe (same _ids upsert).
//
//   npx tsx scripts/upload-canonical-libai.ts

import { Pinecone } from '@pinecone-database/pinecone';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const NAMESPACE = 'xlfm-wisdom';
const DOC_TITLE = '组织审定 · 礼佛大忏悔文特殊日子遍数表（依佛学问答161，2025-01官方版核对）';

// ═══ VERBATIM 组织审定 TEXT — DO NOT EDIT ═══
const CANONICAL_TEXT = `年三十、年初一、元旦、元宵节、佛菩萨诞辰日（诞辰日，出家日，成道日）等大节日，都可以多念《礼佛大忏悔文》来忏悔消孽，因为这天佛菩萨及护法神下来很多，多念《礼佛大忏悔文》可以消除很多孽障。
从年三十到年初一这两天一共可以念诵87遍《礼佛大忏悔文》（注：年三十和年初一两天加起来的总遍数最多不超过87遍，不要每天都念87遍，太多了会激活）；大的节日，比如元旦、元宵节等，一天不超过27遍；一些佛菩萨诞辰日可以不超过49遍；中秋节不超过49遍；中元节可以念诵21遍以内；正常的初一十五，一天不超过21遍。
以下是可以多念诵《礼佛大忏悔文》的佛诞日：
正月初一日 弥勒菩萨圣诞—87遍《礼佛大忏悔文》（可以从年三十就开始念诵，两天念完87遍）
二月初八日 释迦牟尼佛出家日—49遍
二月十五日 释迦牟尼佛涅槃日—49遍
二月十九日 观世音菩萨圣诞—49遍
四月初八日 释迦牟尼佛圣诞—49遍
六月十九日 观世音菩萨成道日—49遍
七月十三日 大势至菩萨圣诞—49遍
七月三十日 地藏王菩萨圣诞—79遍
八月廿二日 燃灯古佛圣诞—49遍
九月十九日 观世音菩萨出家日—49遍
十一月十七日 阿弥陀佛圣诞—49遍
十二月初八日 释迦牟尼佛成道日—49遍
以下是可以多念诵《礼佛大忏悔文》的其他特殊日子：
阳历12月到春节之前的初一、十五—21遍
阳历12月29日、30日、31日，1月2日、3日—21遍
阳历1月1日 元旦—27遍
农历十二月二十九日—21遍
农历十二月三十日 除夕和年初一两天加起来—87遍（在没有年三十的特殊年份，可以在农历十二月二十九和年初一两天总共念诵87遍，在农历十二月二十八念诵21遍）
正月初二、初三—21遍
正月十五 元宵节—27遍
五月初五 端午节—49遍
清明节—49遍
七月十五中元节—21遍
八月十五 中秋节—49遍
九月初九 重阳节—63遍
冬至—49遍
平时的初一、十五—21遍
以上遍数是包含当天功课的遍数，当天在念诵或烧送完相应的遍数以后，不要再额外念功课中的礼佛大忏悔文，也不要额外念诵用于自存的礼佛大忏悔文自修经文，否则很容易激活业障。
以上佛诞日、元旦、年初一、元宵节、中元节、中秋节、端午节，家中设有佛台的话，均可以上头香并且在上香的情况下通宵念经，除此以外的日子按照正常的时间上香念经即可。在这些可以上头香的日子，家中设有佛台的话，《礼佛大忏悔文》可以24小时念诵，但是除此以外的日子，包括平时的初一十五，礼佛大忏悔文最好晚上10点至凌晨5点之间不要念诵。如果家中没有设立佛台，在可以上头香的日子，也不宜通宵念经，不能24小时念诵《礼佛大忏悔文》，只能按照正常的时间上心香念经。
这些《礼佛大忏悔文》最好是针对某件具体的今世的事情来忏悔，比如曾经背后阴人家、曾经看过不好的视频书籍等。针对现世某件具体事情的《礼佛大忏悔文》念好以后，诚心忏悔，可以直接消除孽障，而不用担心激活业障，所以这种情况不需要配合小房子。在没有具体事件可以忏悔的情况下，可以泛泛地说"求大慈大悲观世音菩萨保佑我某某某化解冤结，消除业障"。
特殊日子的礼佛大忏悔文一般可以针对今生的某个错事忏悔，这种情况不容易激活，但是对于一些很大的业障，单纯念诵礼佛大忏悔文还是很难彻底消除，最好还是配合小房子。
如果泛泛地祈求消除身上的业障，或者消除由往世业力所导致的某方面业障，就可能会激活。比如泛泛地说忏悔身上的孽障、婚姻感情上的业障，或者针对身上的某种疾病等，由于宿疾或者婚姻感情等方面的问题一般都是往世业障所致，这种大的业力所导致的问题，很难通过一次念诵几十遍《礼佛大忏悔文》而彻底消除，很容易激活业障，所以一定要配合小房子。
所以保险起见，多念诵《礼佛大忏悔文》的同时，可以结合自身情况多烧送小房子，能够更好的消业。
家中没有设立佛台的话，必须要先上心香跟菩萨祈求之后才能以此方法念诵《礼佛大忏悔文》，也可以到设有佛台的同修家中或者附近寺庙的观世音菩萨像前磕头跪拜之后即可在其他地方念诵。家中没有佛台的情况下，如果当天的《礼佛大忏悔文》分多次完成，每次念之前都要先上心香才能念诵。家里设有佛台的同修，如若出门在外当天没有正式上过香的话，必须也要先上心香才能开始念诵。
《礼佛大忏悔文》最好当天念诵，现场跟菩萨忏悔，效果最好。如果当天实在无法念完的话，可以使用预先念好的自修经文当天烧送的方法。自修经文的模板在博客左侧有下载，比如，初一十五可以采用9遍或12遍的版本，提前念好，时间来不及的情况下当天拿出来烧送，其余的遍数可以当天补念完成；年三十、正月初一可以采用81遍及以下遍数的版本；大的佛诞日可以采用27遍及以下遍数的版本。所烧送的《礼佛大忏悔文》自修经文的遍数，不得超过当天应该念诵的《礼佛大忏悔文》的遍数。
自修经文的《礼佛大忏悔文》，必须有佛台上香之后才能烧送；如果没有供奉佛台，不能烧送自修经文的礼佛大忏悔文。
一般来说，从阳历的12月中旬到农历正月十五之间，也最好能够多念《礼佛大忏悔文》消业。按照最新开示，平时普通日子功课的礼佛大忏悔文和自存礼佛大忏悔文加起来可以不超过21遍，所以春节前后这段时间可以根据情况适量多念，有无佛台均可。
在特殊日子，也可以帮助家人念诵《礼佛大忏悔文》，同样不宜超过相应遍数。但是前提是家人必须学佛念经，双方要沟通好，在家人认可可以帮助他念诵《礼佛大忏悔文》的情况下，才可以帮助家人念诵。如果家人平时不信佛，也没有念经念小房子，一点基础都没有的话，效果不好。最好还是自己念经诚心忏悔。在特殊日子中，一人最好不要同时帮助多人念诵如此多数量的《礼佛大忏悔文》。
对于孕妇，或者尚在坐月子的产妇，无论何种情况下，特殊日子中每天念诵《礼佛大忏悔文》的总数（包括功课）不宜超过7遍。
小孩子5岁及以上可以在特殊日子多念诵礼佛大忏悔文，祈求的时候可以说"求大慈大悲观世音菩萨保佑某某某化解冤结，消除业障"。现在的孩子受父母影响一般都心术不干净，也要多念礼佛大忏悔文。平时普通日子，7、8岁的孩子就可以每天念7遍，实在不行可以13岁的孩子（可以根据孩子自身的情况调整）。一般12岁以下的孩子在特殊日子7遍以内比较保险（包括功课），可以根据情况量力而行适量增加。小孩子一般12岁以上才可以念诵自存《礼佛大忏悔文》。18岁以上才可以在大年三十和年初一一共念诵87遍《礼佛大忏悔文》。12岁以上、18岁以下的孩子在年三十年初一最多念诵49遍《礼佛大忏悔文》。
遇到重大节日多念诵、烧送小房子也是很好的，所以保险起见，多念诵《礼佛大忏悔文》的同时，可以多烧送小房子。烧送小房子数量请参照如下:
上文中提到的佛诞日（地藏王菩萨圣诞日除外）：
自己的几种小房子（自己要经者、流产孩子、梦见的亡人、自己名字房子要经者）加起来不超过49张；特殊情况可以最多69张；给其他人的小房子可以单独计算。
【特例】地藏王菩萨圣诞日：给亡人以及自己要经者的小房子分别不超过78张；给其他人的小房子单独计算。
中秋节、端午节：
各种抬头加起来不超过49张。
元宵节：
各种抬头的小房子加起来不超过49张，特殊情况可以不超过69张。
清明、中元节、冬至：
给每个亡人的小房子和给自己的小房子，可以分别不超过49张。（注：自己的小房子包括：自己要经者、流产孩子、房子的要经者等，加起来总共不超过49张）
年初一：
各种抬头的小房子加起来不超过69张。
重阳节：
不同的抬头烧送21张以内，比如给流产的孩子21张、某亡人21张、房子的要经者21张、自己的要经者21张等。
其他可以多念礼佛大忏悔文的日子（阳历12月29日、12月30日、12月31日、1月1日、1月2日、1月3日，农历十二月二十九日、十二月三十日、正月初二、正月初三，平时的初一、十五）：
各种抬头各不超过21张。`;
// ═══ VERBATIM TEXT END ═══

// Section split anchors — each is the FIRST LINE of a new section, so lists
// (佛诞日 / 其他特殊日子 / 小房子张数) always stay whole inside one chunk.
// e5-large embeds ~512 tokens; whole-doc embedding would truncate, so sections
// keep retrieval sharp while each chunk still carries verbatim doc text.
const SECTION_ANCHORS = [
  '以下是可以多念诵《礼佛大忏悔文》的佛诞日：',
  '以下是可以多念诵《礼佛大忏悔文》的其他特殊日子：',
  '以上遍数是包含当天功课的遍数',
  '这些《礼佛大忏悔文》最好是针对',
  '家中没有设立佛台的话，必须要先上心香',
  '在特殊日子，也可以帮助家人念诵',
  '遇到重大节日多念诵、烧送小房子也是很好的',
];

function splitSections(text: string): string[] {
  const cuts: number[] = [0];
  let searchFrom = 0;
  for (const anchor of SECTION_ANCHORS) {
    const idx = text.indexOf(anchor, searchFrom);
    if (idx < 0) throw new Error(`anchor not found: ${anchor}`);
    cuts.push(idx);
    searchFrom = idx + anchor.length;
  }
  const sections: string[] = [];
  for (let i = 0; i < cuts.length; i++) {
    sections.push(text.slice(cuts[i], cuts[i + 1] ?? text.length));
  }
  // Verbatim invariant: sections must reassemble to the exact original.
  if (sections.join('') !== text) throw new Error('section split corrupted the text');
  return sections;
}

async function main() {
  const sections = splitSections(CANONICAL_TEXT);
  console.log(`Split into ${sections.length} sections:`, sections.map((s) => s.length));

  const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const indexName = process.env.PINECONE_INDEX_NAME!;
  const description = await pinecone.describeIndex(indexName);
  const host = description.host;

  const records = sections.map((section, i) => ({
    _id: `canonical_libai_${i + 1}`,
    // Each chunk carries the doc title for provenance, then verbatim doc text.
    text: `【${DOC_TITLE}】\n${section.trim()}`,
    book: '组织审定',
    type: 'canonical_ruling',
    level: 'canonical',
    categories: '组织审定,礼佛大忏悔文,遍数,特殊日子,佛诞,小房子张数',
    chunk_index: i,
    excerpt: DOC_TITLE,
    // Deliberately NO page_start/page_end — citation label is 组织审定 only.
  }));

  const response = await fetch(`https://${host}/records/namespaces/${NAMESPACE}/upsert`, {
    method: 'POST',
    headers: {
      'Api-Key': process.env.PINECONE_API_KEY!,
      'Content-Type': 'application/x-ndjson',
      'X-Pinecone-API-Version': '2025-01',
    },
    body: records.map((r) => JSON.stringify(r)).join('\n'),
  });
  if (!response.ok) {
    throw new Error(`upsert failed: ${response.status} ${await response.text()}`);
  }
  console.log(`✓ Upserted ${records.length} canonical_ruling records (book=组织审定)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
