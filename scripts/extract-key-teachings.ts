const fs = require('fs');
const path = require('path');

const INPUT_FILE = 'data/hongfa-duren-shouce.txt';
const OUTPUT_FILE = 'data/counseling-principles-extract.txt';

const text = fs.readFileSync(INPUT_FILE, 'utf8');

// Keywords organized by category
const KEYWORD_GROUPS = {
  '守则与原则 (Principles)': ['守则', '原则', '必须', '切记', '切忌', '绝对不', '一定要'],
  '度人方法 (Methods)': ['度人的方法', '如何度', '如何开始', '第一步', '第一句', '先要', '应该先'],
  '对不同人 (Different People)': ['年长', '年老', '重病', '癌症', '忙碌', '不信', '无神论', '其他宗教', '初学', '没有基础', '外国人', '文盲', '孩子', '业障重'],
  '注意事项 (Precautions)': ['注意事项', '禁忌', '避免', '不要', '不能', '不可', '切勿', '以免', '否则'],
  '心态 (Mindset)': ['心态', '发心', '慈悲心', '随缘', '不要急', '耐心', '放下', '不执着'],
  '背业 (Karma Transfer)': ['背业', '背不起', '业障上身', '代人', '替人', '承担'],
  '祈求 (Prayers)': ['祈求', '求菩萨', '保佑', '请观世音', '可以这样说'],
  '失败原因 (Why It Fails)': ['度不了', '度人失败', '不成功', '反效果', '适得其反'],
};

const allPassages = [];

for (const [category, keywords] of Object.entries(KEYWORD_GROUPS)) {
  for (const keyword of keywords) {
    let index = 0;
    while ((index = text.indexOf(keyword, index)) !== -1) {
      const start = Math.max(0, index - 300);
      const end = Math.min(text.length, index + 500);
      const passage = text.substring(start, end);
      allPassages.push({
        category,
        keyword,
        position: index,
        passage: passage.trim(),
      });
      index += keyword.length;
    }
  }
}

// Deduplicate by position (passages within 200 chars of each other)
allPassages.sort((a, b) => a.position - b.position);
const deduped = [];
let lastPos = -999;
for (const p of allPassages) {
  if (p.position - lastPos > 200) {
    deduped.push(p);
    lastPos = p.position;
  }
}

// Group by category for output
const byCategory = {};
for (const p of deduped) {
  if (!byCategory[p.category]) byCategory[p.category] = [];
  byCategory[p.category].push(p);
}

// Build output
let output = '# 弘法度人辅导手册 — 关键教导提取\n\n';
output += `总共提取 ${deduped.length} 段关键内容\n\n`;
output += '=' .repeat(80) + '\n\n';

for (const [category, passages] of Object.entries(byCategory)) {
  output += `\n\n## ${category}\n\n`;
  output += `(${passages.length} 段)\n\n`;
  passages.forEach((p, idx) => {
    output += `### [${idx + 1}] 关键词: ${p.keyword}\n\n`;
    output += p.passage + '\n\n';
    output += '---\n\n';
  });
}

fs.writeFileSync(OUTPUT_FILE, output, 'utf8');

console.log(`✓ Total passages found: ${allPassages.length}`);
console.log(`✓ After dedup: ${deduped.length}`);
console.log(`✓ Output file: ${OUTPUT_FILE}`);
console.log(`✓ Output size: ${(output.length / 1024).toFixed(1)} KB`);
console.log('\nBreakdown by category:');
for (const [cat, passages] of Object.entries(byCategory)) {
  console.log(`  ${cat}: ${passages.length}`);
}
