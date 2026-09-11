// src/lib/prompt/modules-zh.ts — the v2 module registry (batch 4 / F08 / C8).
// Order = assembly order. Each module is a verbatim slice of system-prompt.v1.ts
// plus the C1–C8 edits (docs/reviews/batch4-2026-09-11/traceability.md).

import { CORE_ZH } from './core';
import { TIERS_ZH } from './tiers';
import { PRACTICE_ZH } from './topics/practice';
import { XIAOFANGZI_ZH } from './topics/xiaofangzi';
import { RELATIONSHIPS_ZH } from './topics/relationships';
import { CRISIS_ZH } from './topics/crisis';
import { ALTAR_ZH } from './topics/altar';
import { SOURCES_ZH } from './topics/sources';
import { MISC_ZH } from './topics/misc';

export const MODULE_ORDER = ['core', 'tiers', 'practice', 'xiaofangzi', 'relationships', 'crisis', 'altar', 'sources', 'misc'] as const;
export type ModuleKey = (typeof MODULE_ORDER)[number];

export const ZH_MODULES: Record<ModuleKey, string> = {
  core: CORE_ZH,
  tiers: TIERS_ZH,
  practice: PRACTICE_ZH,
  xiaofangzi: XIAOFANGZI_ZH,
  relationships: RELATIONSHIPS_ZH,
  crisis: CRISIS_ZH,
  altar: ALTAR_ZH,
  sources: SOURCES_ZH,
  misc: MISC_ZH,
};
