// src/lib/system-prompt.ts
// 心灵法门 AI 智慧同修 — System Prompt entry point (batch 4 / F08).
//
// Two versions live side by side:
//   v1  src/lib/system-prompt.v1.ts   — the frozen 26-section prompt (DEFAULT)
//   v2  src/lib/prompt/*              — the same text split into modules with the
//                                       eight architect decisions C1–C8 applied
//                                       (docs/reviews/batch4-2026-09-11/traceability.md)
// SYSTEM_PROMPT_VERSION=v2 selects v2. The default stays v1 until the architect
// has read the traceability tables — do not flip it here.
// Based on 卢军宏台长's teachings, including 弘法度人辅导手册
// Built by Ken (BCS) for free distribution — never for sale

import { getSystemPrompt as getSystemPromptV1 } from './system-prompt.v1';
import { assembleSystemPrompt } from './prompt/assemble';

export type SystemPromptVersion = 'v1' | 'v2';

/** Read at call time so scripts can flip it per run (SYSTEM_PROMPT_VERSION=v2 npx tsx …). */
export function systemPromptVersion(): SystemPromptVersion {
  return process.env.SYSTEM_PROMPT_VERSION?.trim() === 'v2' ? 'v2' : 'v1';
}

/**
 * Get system prompt by language code (and by SYSTEM_PROMPT_VERSION).
 */
export function getSystemPrompt(lang: 'zh' | 'en' | 'id' = 'zh', version: SystemPromptVersion = systemPromptVersion()): string {
  return version === 'v2' ? assembleSystemPrompt(lang) : getSystemPromptV1(lang);
}
