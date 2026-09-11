// src/lib/prompt/assemble.ts — system prompt v2 assembly (batch 4 / F08 / C8).
// v2 = the nine modules in MODULE_ORDER. zh serves the zh modules; en/id serve
// the TRANSLATED modules (src/lib/prompt/i18n/*, generated line-for-line from
// the zh modules) instead of v1's 「中文全文 + 第二十五部分英文覆盖」. A module
// whose translation is missing falls back to the zh text so the prompt is never
// silently shorter.
//
// The per-language wrapper lines are v1's SYSTEM_PROMPT_EN / SYSTEM_PROMPT_ID
// intro and closing (L2821–2831 / L2833–2842) minus the sentence that said the
// rules below are written in Chinese — in v2 they are not (C8).

import { ZH_MODULES, MODULE_ORDER, type ModuleKey } from './modules-zh';
import { EN } from './i18n/en';
import { ID } from './i18n/id';

export type PromptLanguage = 'zh' | 'en' | 'id';

const SEPARATOR = '\n\n================================================================\n\n';

const EN_INTRO = `You are an AI assistant for the Heart Dharma Door (心灵法门), Master Lu Jun Hong's teachings, serving English-speaking users in Malaysia.

CRITICAL: All teaching rules and principles below apply UNIVERSALLY. You MUST follow every rule. When responding to users:
- Respond in English (unless user asks otherwise)
- All restrictions, Tier system, Qualify-first patterns, link rules, expectation management, and all other principles below apply
- Translate Master Lu's teachings faithfully when retrieving from English chunks (uploaded books)
- Use English approved terminology (vows, gratitude) — never generic Buddhist terms (merit dedication, transfer of merit) unless explicitly in retrieved Master Lu English chunks`;
const EN_OUTRO = `REMEMBER: Respond in English. All rules above apply.`;

const ID_INTRO = `You are an AI assistant for the Heart Dharma Door (心灵法门), Master Lu Jun Hong's teachings, serving Indonesian-speaking users.

CRITICAL: All teaching rules below apply UNIVERSALLY. You MUST follow every rule.
- Respond in Bahasa Indonesia (kecuali pengguna meminta bahasa lain)
- All Tier system, Qualify-first, link rules, expectation management apply
- Use Indonesian approved terminology when possible (sumpah, syukur) — never generic Buddhist terms unless explicitly in retrieved Master Lu chunks`;
const ID_OUTRO = `REMEMBER: Respond in Bahasa Indonesia. All rules above apply.`;

function modulesFor(lang: PromptLanguage): string[] {
  const translated: Partial<Record<ModuleKey, string>> = lang === 'en' ? EN : lang === 'id' ? ID : {};
  return MODULE_ORDER.map((k) => translated[k] ?? ZH_MODULES[k]);
}

/** How many modules of `lang` are served in translation (for the report / a smoke check). */
export function translatedModuleCount(lang: PromptLanguage): number {
  const translated: Partial<Record<ModuleKey, string>> = lang === 'en' ? EN : lang === 'id' ? ID : {};
  return MODULE_ORDER.filter((k) => Boolean(translated[k])).length;
}

export function assembleSystemPrompt(lang: PromptLanguage = 'zh'): string {
  const body = modulesFor(lang).join(SEPARATOR);
  if (lang === 'en') return `${EN_INTRO}${SEPARATOR}${body}${SEPARATOR}${EN_OUTRO}`;
  if (lang === 'id') return `${ID_INTRO}${SEPARATOR}${body}${SEPARATOR}${ID_OUTRO}`;
  return body;
}

export { MODULE_ORDER };
