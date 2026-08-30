// src/lib/crisis-keywords.ts
// Mechanical crisis detection over VISITOR text (brief 2026-08-30, from the
// 七月复盘 #2 finding, now with a real case: conv df9ffe56 / d5ccd1a4, 08-28
// 21:26 MYT — 「家人网络赌博赔钱 有轻生的念头怎么办」 shipped with
// crisis_flag=false because (a) the Haiku classifier was the only path and
// (b) during the outage the classifier never even ran).
//
// The list is the self-harm subset of vector-search's karma_warning retrieval
// keywords plus the inbox form's defaults (migration 030 inbox.crisis_keywords),
// so retrieval, the inbox form, and the conversation flag agree. Pure
// functions — no I/O — so it can be unit-tested and run on the failure path.

export const CRISIS_KEYWORDS: readonly string[] = [
  // zh — matches karma_warning's self-harm terms + the inbox defaults
  '轻生', '自杀', '自尽', '自伤', '自残', '想死', '不想活', '活不下去', '结束生命',
  '了结', '绝望', '寻死', '想不开', '跳楼', '割腕', '安眠药', '不如死', '死了算了',
  // en
  'suicide', 'suicidal', 'kill myself', 'end my life', 'want to die', 'self-harm', 'self harm',
  // bm
  'bunuh diri', 'mahu mati', 'nak mati', 'tak mahu hidup',
];

function normalize(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

// True when the text contains any built-in or org-configured crisis keyword.
// Keywords are matched as substrings on a whitespace-stripped, lower-cased
// form ("kill  myself" == "killmyself").
export function detectCrisisKeywords(text: string, extraKeywords: readonly string[] = []): boolean {
  if (!text) return false;
  const t = normalize(text);
  for (const kw of [...CRISIS_KEYWORDS, ...extraKeywords]) {
    const k = normalize(kw);
    if (k && t.includes(k)) return true;
  }
  return false;
}

// Which keywords fired (for logs / audit).
export function matchedCrisisKeywords(text: string, extraKeywords: readonly string[] = []): string[] {
  if (!text) return [];
  const t = normalize(text);
  return [...CRISIS_KEYWORDS, ...extraKeywords].filter((kw) => {
    const k = normalize(kw);
    return k && t.includes(k);
  });
}
