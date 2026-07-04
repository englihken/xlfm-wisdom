// src/lib/members.ts
// Shared server-side helpers for the Members module routes: phone normalization
// and body → DB-row coercion/validation. Kept out of the route files so create
// (POST) and update (PATCH) share exactly the same rules.

// Normalize a Malaysian phone to the canonical 60… form.
//   blank/no digits            → { phone: null }                     (no phone on file)
//   leading 0 (012…)           → 6 + digits (== 60 + national)       (0123456789 → 60123456789)
//   already 60…                → kept
//   anything not ^60\d{8,10}$  → { error, phone: null }              (ambiguous — reject)
export function normalizePhone(raw: string): { phone: string | null; error?: string } {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return { phone: null };
  let d = digits;
  if (d.startsWith('0')) d = '6' + d;
  if (!/^60\d{8,10}$/.test(d)) {
    return {
      phone: null,
      error: `电话号码格式不正确（应为马来西亚号码，如 60123456789）：${d}`,
    };
  }
  return { phone: d };
}

const SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];

// Fields that are plain trimmed free text (null when blank).
const TEXT_FIELDS = [
  'name_cn', 'name_en', 'email', 'address', 'birthplace', 'religion', 'marital_status',
  'occupation', 'disciple_no', 'baishi_place', 'emergency_contact_name',
  'emergency_contact_phone', 'referrer_name', 'referrer_phone', 'photo_path',
  'photo_source_url', 'notes', 'dob', 'gyt_centre_id', 'referrer_member_id',
];
const BOOL_FIELDS = ['disciple', 'full_veg', 'snoring'];
const INT_FIELDS = ['baishi_year', 'veg_since', 'start_practice_year'];

function text(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
function tristate(v: unknown): boolean | null {
  return v === true ? true : v === false ? false : null;
}
function intOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// Coerce/validate an incoming body into a partial members row. Only keys PRESENT in
// the body are included (so PATCH leaves absent fields untouched). Returns an error
// string on a bad enum/phone. Name-presence + phone-unique are enforced by callers.
export function parseMemberInput(
  body: Record<string, unknown>
): { values: Record<string, unknown> } | { error: string } {
  const values: Record<string, unknown> = {};

  for (const f of TEXT_FIELDS) if (f in body) values[f] = text(body[f]);
  for (const f of BOOL_FIELDS) if (f in body) values[f] = tristate(body[f]);
  for (const f of INT_FIELDS) if (f in body) values[f] = intOrNull(body[f]);

  if ('gender' in body) {
    const g = text(body.gender);
    if (g !== null && g !== 'M' && g !== 'F') return { error: '性别无效' };
    values.gender = g;
  }
  if ('shirt_size' in body) {
    const s = text(body.shirt_size);
    if (s !== null && !SHIRT_SIZES.includes(s)) return { error: '衣服尺码无效' };
    values.shirt_size = s;
  }
  if ('member_type' in body) {
    const t = text(body.member_type);
    if (t !== 'member' && t !== 'volunteer') return { error: '类型无效（信众/义工）' };
    values.member_type = t;
  }
  if ('status' in body) {
    const st = text(body.status);
    if (st !== 'active' && st !== 'inactive') return { error: '状态无效' };
    values.status = st;
  }
  if ('languages' in body) {
    const raw = body.languages;
    values.languages = Array.isArray(raw)
      ? raw.map((x) => String(x).trim()).filter((x) => x !== '')
      : null;
  }
  if ('phone' in body) {
    const { phone, error } = normalizePhone(String(body.phone ?? ''));
    if (error) return { error };
    values.phone = phone;
  }

  return { values };
}
