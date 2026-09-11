// scripts/prompt-size-report.ts — batch 4 report numbers: v1 vs v2 characters,
// sections, and the cached-prefix token count (messages.countTokens with the
// same cache_control block care-pipeline sends) for zh / en / id.
//   npx tsx scripts/prompt-size-report.ts
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import Anthropic from '@anthropic-ai/sdk';
import { getSystemPrompt } from '../src/lib/system-prompt';
import { MODULE_ORDER, translatedModuleCount } from '../src/lib/prompt/assemble';
// (not imported from care-pipeline: its static import chain builds a Pinecone client before dotenv runs)
const REPLY_MODEL = process.env.REPLY_MODEL?.trim() || 'claude-opus-5';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

async function tokens(text: string): Promise<number> {
  const r = await anthropic.messages.countTokens({
    model: REPLY_MODEL,
    system: [{ type: 'text', text, cache_control: { type: 'ephemeral', ttl: '1h' } }],
    messages: [{ role: 'user', content: '你好' }],
  });
  return r.input_tokens;
}

async function main() {
  const rows: string[] = ['| 版本 | 语言 | 字符数 | 节数 | 缓存前缀 tokens |', '|---|---|---|---|---|'];
  for (const version of ['v1', 'v2'] as const) {
    for (const lang of ['zh', 'en', 'id'] as const) {
      const text = getSystemPrompt(lang, version);
      const sections = version === 'v1' ? (text.match(/^第[一二三四五六七八九十]+部分/gm) ?? []).length : MODULE_ORDER.length;
      const tk = await tokens(text);
      const note = version === 'v2' && lang !== 'zh' ? `（译文模块 ${translatedModuleCount(lang)}/${MODULE_ORDER.length}）` : '';
      rows.push(`| ${version} | ${lang} | ${text.length.toLocaleString()} | ${sections}${note} | ${tk.toLocaleString()} |`);
      console.log(`${version} ${lang}: ${text.length} chars · ${sections} sections · ${tk} tokens`);
    }
  }
  console.log('\n' + rows.join('\n'));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
