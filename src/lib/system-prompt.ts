// src/lib/system-prompt.ts
// 心灵法门 AI 智慧同修 — System Prompt entry point (batch 4 / F08).
//
// Two versions live side by side:
//   v1  src/lib/system-prompt.v1.ts   — the frozen 26-section prompt (rollback)
//   v2  src/lib/prompt/*              — the same text split into modules with the
//                                       eight architect decisions C1–C8 + the
//                                       2026-09-11 addendum applied (DEFAULT since
//                                       the architect approved traceability.md)
// SYSTEM_PROMPT_VERSION=v1 rolls back to v1 without a code change.
// Based on 卢军宏台长's teachings, including 弘法度人辅导手册
// Built by Ken (BCS) for free distribution — never for sale

import { getSystemPrompt as getSystemPromptV1 } from './system-prompt.v1';
import { assembleSystemPrompt } from './prompt/assemble';

export type SystemPromptVersion = 'v1' | 'v2';

/** Read at call time so scripts can flip it per run (SYSTEM_PROMPT_VERSION=v1 npx tsx …). */
export function systemPromptVersion(): SystemPromptVersion {
  return process.env.SYSTEM_PROMPT_VERSION?.trim() === 'v1' ? 'v1' : 'v2';
}

/**
 * Get system prompt by language code (and by SYSTEM_PROMPT_VERSION).
 */
export function getSystemPrompt(lang: 'zh' | 'en' | 'id' = 'zh', version: SystemPromptVersion = systemPromptVersion()): string {
  return version === 'v2' ? assembleSystemPrompt(lang) : getSystemPromptV1(lang);
}
