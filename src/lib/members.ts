// src/lib/members.ts
// Shared server-side helpers for the Members module routes: phone normalization
// and body → DB-row coercion/validation. Kept out of the route files so create
// (POST) and update (PATCH) share exactly the same rules.

// Normalize a typed phone to the canonical international-digits form (no '+') for the
// three communities the org actually serves (MY centres; SG members; the Batam /
// Pekanbaru / Tg. Balai / Tg. Pinang / Dumai Indonesian branches):
//   Malaysia   0123456789 / +60 12-345 6789 / 60123456789   → 60123456789
//   Singapore  81221124 / +65 8122 1124 / 6581221124        → 6581221124
//   Indonesia  081234567890 / +62 812… / 6281234567890      → 6281234567890
//   blank/no digits → { phone: null } (no phone on file); anything else → { error }.
// Disambiguation: a bare 8-digit number starting 8/9 can only be an SG mobile (MY
// numbers are 0/1-leading and longer); a 0-leading '08…' of 11+ digits can only be
// Indonesian (MY 08x Sarawak landlines are 9-10 digits incl. the 0).
export function normalizePhone(raw: string): { phone: string | null; error?: string } {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return { phone: null };
  let d = digits;
  if (/^[89]\d{7}$/.test(d)) d = '65' + d;                // bare SG mobile
  else if (/^08\d{9,11}$/.test(d)) d = '62' + d.slice(1); // Indonesian local 08… (11-13 digits)
  else if (d.startsWith('0')) d = '6' + d;                // MY local → 60…
  if (/^60\d{8,10}$/.test(d) || /^65[3689]\d{7}$/.test(d) || /^62\d{8,12}$/.test(d)) {
    return { phone: d };
  }
  return {
    phone: null,
    error: `电话号码格式不正确（马来西亚 0123456789 / 60…、新加坡 65…、印尼 62…）：${d}`,
  };
}

// The raw shapes a canonical number may still be stored under in registrations rows
// that predate the 038 phone-normalization migration: the source sheets held local
// formats (0122037919) and Excel-stripped leading zeros (122037919). Use with .in()
// so lookups stay index-backed while matching legacy storage.
export function storedPhoneForms(canonical: string): string[] {
  const national = canonical.replace(/^6[025]/, '');
  return [...new Set([canonical, '0' + national, national])];
}

// Canonicalize a STORED phone value (may predate 038): take the first number of an
// 'a/b' dual cell, strip junk characters, recover Excel-eaten leading zeros, then
// normalize. Unparseable values fall back to their raw digits so an exact typed
// match still works.
export function canonicalizeStoredPhone(stored: string | null): string | null {
  if (!stored) return null;
  const digits = String(stored).split('/')[0].replace(/\D/g, '');
  if (!digits) return null;
  let d = digits;
  if (/^1\d{8,9}$/.test(d)) d = '0' + d;       // MY mobile missing its leading 0
  else if (/^8\d{9,11}$/.test(d)) d = '0' + d; // Indonesian mobile missing its leading 0
  const { phone } = normalizePhone(d);
  return phone ?? digits;
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
