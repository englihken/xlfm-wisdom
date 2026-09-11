// src/lib/prompt/assemble.ts — system prompt v2 assembly (batch 4 / F08 / C8).
// v2 = the nine modules in MODULE_ORDER.
//
// en/id (addendum 2026-09-11 §0.1, option c): DEFAULT = "overlay" — the nine
// CHINESE modules + the per-language wrapper lines (v1's SYSTEM_PROMPT_EN / _ID
// intro and closing, L2821–2831 / L2833–2842, verbatim; the 第二十五部分 content
// now travels inside the modules). Size ≈ zh. The machine translations in
// src/lib/prompt/i18n/* (not human-proofread; en 64.8k / id 87.2k cached tokens)
// stay behind SYSTEM_PROMPT_I18N=translated as an experiment for a later A/B
// once a bilingual volunteer has proofread them.

import { ZH_MODULES, MODULE_ORDER, type ModuleKey } from './modules-zh';
import { EN } from './i18n/en';
import { ID } from './i18n/id';

export type PromptLanguage = 'zh' | 'en' | 'id';

const SEPARATOR = '\n\n================================================================\n\n';

export type I18nMode = 'overlay' | 'translated';
/** Read at call time so scripts can flip it per run. */
export function i18nMode(): I18nMode {
  return process.env.SYSTEM_PROMPT_I18N?.trim() === 'translated' ? 'translated' : 'overlay';
}

// v1 L2823 / L2835 verbatim — true in overlay mode (the modules are Chinese).
const EN_INTRO_OVERLAY_LINE = `CRITICAL: All teaching rules and principles below are written in Chinese but apply UNIVERSALLY to all languages including English. You MUST follow every rule, regardless of language. When responding to users:`;
const ID_INTRO_OVERLAY_LINE = `CRITICAL: All teaching rules below are written in Chinese but apply UNIVERSALLY to all languages including Indonesian. You MUST follow every rule.`;

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

function translationsFor(lang: PromptLanguage, mode: I18nMode): Partial<Record<ModuleKey, string>> {
  if (mode !== 'translated') return {};
  return lang === 'en' ? EN : lang === 'id' ? ID : {};
}

function modulesFor(lang: PromptLanguage, mode: I18nMode): string[] {
  const translated = translationsFor(lang, mode);
  return MODULE_ORDER.map((k) => translated[k] ?? ZH_MODULES[k]);
}

/** How many modules of `lang` are served in translation under `mode` (for the report / a smoke check). */
export function translatedModuleCount(lang: PromptLanguage, mode: I18nMode = i18nMode()): number {
  const translated = translationsFor(lang, mode);
  return MODULE_ORDER.filter((k) => Boolean(translated[k])).length;
}

export function assembleSystemPrompt(lang: PromptLanguage = 'zh', mode: I18nMode = i18nMode()): string {
  const body = modulesFor(lang, mode).join(SEPARATOR);
  if (lang === 'en') {
    const intro = mode === 'overlay' ? EN_INTRO.replace(/^CRITICAL: .*$/m, EN_INTRO_OVERLAY_LINE) : EN_INTRO;
    return `${intro}${SEPARATOR}${body}${SEPARATOR}${EN_OUTRO}`;
  }
  if (lang === 'id') {
    const intro = mode === 'overlay' ? ID_INTRO.replace(/^CRITICAL: .*$/m, ID_INTRO_OVERLAY_LINE) : ID_INTRO;
    return `${intro}${SEPARATOR}${body}${SEPARATOR}${ID_OUTRO}`;
  }
  return body;
}

export { MODULE_ORDER };
