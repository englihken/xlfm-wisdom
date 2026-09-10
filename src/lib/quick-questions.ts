// src/lib/quick-questions.ts
// The six homepage chip questions (×3 languages) — ONE source of truth shared
// by the visitor page (renders them), /api/chat (serves them from the
// chip_answers cache, migration 046) and the nightly refresh.
//
// Order matters: index i in every language is the same chip, keyed by
// CHIP_KEYS[i]. Changing a question's wording invalidates its cache entry
// naturally (the lookup is by exact text), so wording edits are safe.

export type ChipLanguage = 'zh' | 'en' | 'id';

export const CHIP_KEYS = [
  'insomnia',
  'family_conflict',
  'work_karma',
  'child_emotions',
  'beginner_first_step',
  'family_illness',
] as const;
export type ChipKey = (typeof CHIP_KEYS)[number];

export const QUICK_QUESTIONS: Record<ChipLanguage, readonly string[]> = {
  zh: [
    '我最近失眠很严重，念什么经好？',
    '和家人一直吵架，我可以先学什么？',
    '工作一直不顺，是不是有业障？',
    '孩子不听话，我应该如何面对自己的情绪？',
    '刚开始接触心灵法门，第一步应该做什么？',
    '家人生病了，我应该为他念什么经？',
  ],
  en: [
    'I have severe insomnia, which sutras should I recite?',
    'I keep arguing with family, what can I start learning?',
    'Work has been going badly, is it karma?',
    'My child is rebellious, how should I handle my emotions?',
    'I am new to 心灵法门, what is the first step?',
    'My family member is ill, what should I recite for them?',
  ],
  id: [
    'Saya sulit tidur, sutra apa yang harus saya baca?',
    'Saya selalu bertengkar dengan keluarga, apa yang harus saya pelajari?',
    'Pekerjaan saya tidak lancar, apakah ini karma?',
    'Anak saya nakal, bagaimana mengatasi emosi saya?',
    'Saya baru mengenal 心灵法门, apa langkah pertama?',
    'Keluarga saya sakit, apa yang harus saya baca untuk mereka?',
  ],
};

// Exact-text match (whitespace-trimmed) against the chip list of ANY language
// — a visitor can have the UI in zh and still click an EN chip they pasted.
// Returns the chip key + the language the text belongs to, or null.
export function matchChip(message: string): { key: ChipKey; language: ChipLanguage; question: string } | null {
  const text = message.trim();
  if (!text) return null;
  for (const language of Object.keys(QUICK_QUESTIONS) as ChipLanguage[]) {
    const idx = QUICK_QUESTIONS[language].findIndex((q) => q === text);
    if (idx >= 0) return { key: CHIP_KEYS[idx], language, question: QUICK_QUESTIONS[language][idx] };
  }
  return null;
}

// Every (chip, language) pair — the 18 entries the nightly refresh maintains.
export function allChips(): { key: ChipKey; language: ChipLanguage; question: string }[] {
  const out: { key: ChipKey; language: ChipLanguage; question: string }[] = [];
  for (const language of Object.keys(QUICK_QUESTIONS) as ChipLanguage[]) {
    QUICK_QUESTIONS[language].forEach((question, idx) => out.push({ key: CHIP_KEYS[idx], language, question }));
  }
  return out;
}
