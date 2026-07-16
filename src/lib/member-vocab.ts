// src/lib/member-vocab.ts
// Canonical CODE value-sets for the constrained member fields (languages, marital
// status, religion, birthplace). Codes (ascii snake_case) are what we STORE; the
// UI renders localized labels via i18n keys `members.opt.<group>.<code>`. This module
// is PURE (no React / no server imports) so it is shared by the form, the detail
// page, parseMemberInput (validation), and the bulk-import engine.
//
// The zh-label maps below exist ONLY for the two non-UI needs: generating the import
// template's 参考 sheet, and lenient import parsing (accept a code OR its zh label).
// They are NOT used for display — display always goes through i18n.

export const LANGUAGES = [
  'mandarin', 'english', 'malay', 'cantonese', 'hokkien', 'hakka',
  'teochew', 'hainanese', 'indonesian', 'tamil', 'other',
] as const;

export const MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed'] as const;

export const RELIGIONS = ['buddhism', 'taoism', 'christianity', 'none', 'other'] as const;

// Malaysian states + the org's common overseas origins. State code is the primary
// value; an optional free-text city rides alongside as `code:city` (see birthplace helpers).
export const BIRTHPLACES = [
  'johor', 'kedah', 'kelantan', 'melaka', 'negeri_sembilan', 'pahang', 'penang',
  'perak', 'perlis', 'sabah', 'sarawak', 'selangor', 'terengganu', 'kl', 'labuan', 'putrajaya',
  'indonesia', 'singapore', 'china', 'other',
] as const;

export type LanguageCode = (typeof LANGUAGES)[number];
export type MaritalCode = (typeof MARITAL_STATUSES)[number];
export type ReligionCode = (typeof RELIGIONS)[number];
export type BirthplaceCode = (typeof BIRTHPLACES)[number];

const has = <T extends readonly string[]>(arr: T, v: string): v is T[number] => (arr as readonly string[]).includes(v);
export const isLanguage = (v: string) => has(LANGUAGES, v);
export const isMarital = (v: string) => has(MARITAL_STATUSES, v);
export const isReligion = (v: string) => has(RELIGIONS, v);
export const isBirthplaceCode = (v: string) => has(BIRTHPLACES, v);

// ── birthplace `code:city` helpers ───────────────────────────────────────────────────
// The stored value is either a bare state/country code, or `code:city` when a free-text
// city detail is present. The code is always the primary, queryable value.
export function splitBirthplace(stored: string | null | undefined): { code: string; city: string } {
  const s = (stored ?? '').trim();
  if (!s) return { code: '', city: '' };
  const i = s.indexOf(':');
  return i < 0 ? { code: s, city: '' } : { code: s.slice(0, i).trim(), city: s.slice(i + 1).trim() };
}
export function joinBirthplace(code: string, city: string): string {
  const c = code.trim();
  const town = city.trim();
  if (!c) return '';
  return town ? `${c}:${town}` : c;
}

// ── zh labels — template generation + lenient import parsing ONLY (never display) ────
export const LANG_ZH: Record<LanguageCode, string> = {
  mandarin: '华语', english: '英语', malay: '马来语', cantonese: '广东话', hokkien: '福建话',
  hakka: '客家话', teochew: '潮州话', hainanese: '海南话', indonesian: '印尼语', tamil: '淡米尔语', other: '其他',
};
export const MARITAL_ZH: Record<MaritalCode, string> = {
  single: '单身', married: '已婚', divorced: '离异', widowed: '丧偶',
};
export const RELIGION_ZH: Record<ReligionCode, string> = {
  buddhism: '佛教', taoism: '道教', christianity: '基督教', none: '无', other: '其他',
};
export const BIRTHPLACE_ZH: Record<BirthplaceCode, string> = {
  johor: '柔佛', kedah: '吉打', kelantan: '吉兰丹', melaka: '马六甲', negeri_sembilan: '森美兰',
  pahang: '彭亨', penang: '槟城', perak: '霹雳', perlis: '玻璃市', sabah: '沙巴', sarawak: '砂拉越',
  selangor: '雪兰莪', terengganu: '登嘉楼', kl: '吉隆坡', labuan: '纳闽', putrajaya: '布城',
  indonesia: '印尼', singapore: '新加坡', china: '中国', other: '其他',
};

// Reverse zh-label → code, for lenient import (a cell may hold the code OR the zh label).
function reverse<T extends string>(m: Record<T, string>): Map<string, T> {
  const out = new Map<string, T>();
  for (const [code, label] of Object.entries(m) as [T, string][]) out.set(label, code);
  return out;
}
const LANG_BY_ZH = reverse(LANG_ZH);
const MARITAL_BY_ZH = reverse(MARITAL_ZH);
const RELIGION_BY_ZH = reverse(RELIGION_ZH);
const BIRTHPLACE_BY_ZH = reverse(BIRTHPLACE_ZH);

// Coerce one import cell (code or zh label, any case for latin codes) → code or null.
export const langToCode = (v: string): LanguageCode | null =>
  isLanguage(v.toLowerCase()) ? (v.toLowerCase() as LanguageCode) : LANG_BY_ZH.get(v.trim()) ?? null;
export const maritalToCode = (v: string): MaritalCode | null =>
  isMarital(v.toLowerCase()) ? (v.toLowerCase() as MaritalCode) : MARITAL_BY_ZH.get(v.trim()) ?? null;
export const religionToCode = (v: string): ReligionCode | null =>
  isReligion(v.toLowerCase()) ? (v.toLowerCase() as ReligionCode) : RELIGION_BY_ZH.get(v.trim()) ?? null;
export const birthplaceToCode = (v: string): BirthplaceCode | null =>
  isBirthplaceCode(v.toLowerCase()) ? (v.toLowerCase() as BirthplaceCode) : BIRTHPLACE_BY_ZH.get(v.trim()) ?? null;
