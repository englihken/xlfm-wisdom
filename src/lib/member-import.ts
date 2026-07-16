// src/lib/member-import.ts
// The 会员 bulk-import engine (Phase 1): template column spec, sheet parsing, row
// validation, and the DEDUP RULE shared verbatim by preview and commit. Service-role
// only (classify queries members) — never import into a client component.
//
// DEDUP RULE (v1 — NEVER auto-merge):
//   1. normalized phone present AND matches exactly ONE ACTIVE member → DUPLICATE.
//      (members_phone_unique is a GLOBAL partial-unique index, so a phone matching an
//       INACTIVE member cannot be inserted as new either → needs review, not new.)
//   2. no phone match path → name_cn + gyt_centre_id exact: one match → DUPLICATE.
//   3. ambiguous (>1 match on either rule) or an in-file collision → REVIEW; reason
//      recorded in legacy_rows.issues. Duplicates are SKIPPED on commit (no overwrite).

import type { SupabaseClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import { supabaseAdmin } from './supabase';
import { normalizePhone } from './members';
import { isValidDate } from './events';

export const IMPORT_SHEET = '会员';
export const REF_SHEET = '参考';
export const SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'] as const;
export const MAX_IMPORT_ROWS = 5000;

// Column order IS the template contract (parse is positional; the header row is
// verified loosely before parsing so a foreign file fails loudly).
export const IMPORT_COLUMNS = [
  { key: 'centre', label: '共修会 Centre *' },
  { key: 'name_cn', label: '中文姓名 Chinese Name' },
  { key: 'name_en', label: 'English Name' },
  { key: 'gender', label: '性别 Gender (M/F)' },
  { key: 'dob', label: '出生日期 DOB (YYYY-MM-DD)' },
  { key: 'phone', label: '联络电话 Phone' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: '地址 Address' },
  { key: 'disciple', label: '是否弟子 Disciple (是/否)' },
  { key: 'disciple_no', label: '弟子编号 Disciple No.' },
  { key: 'baishi_year', label: '拜师年份 Baishi Year' },
  { key: 'full_veg', label: '是否全素 Full Veg (是/否)' },
  { key: 'veg_since', label: '全素年份 Veg Since' },
  { key: 'shirt_size', label: 'T恤尺寸 T-shirt Size' },
  { key: 'occupation', label: '职业 Occupation' },
  { key: 'member_type', label: '会员类型 Type (member/volunteer)' },
  { key: 'notes', label: '备注 Notes' },
] as const;
export type ImportColumnKey = (typeof IMPORT_COLUMNS)[number]['key'];

export type CentreRef = { id: string; code: string; name_cn: string; name_en: string };

export type ImportRowClass = 'new' | 'duplicate' | 'review' | 'error';
export type ImportRow = {
  rowNo: number;                          // 1-based sheet row number (incl. header)
  raw: Record<string, string>;            // original cell text, keyed by column key
  issues: string[];                       // validation errors / review reasons
  cls: ImportRowClass;
  matchMethod: 'phone' | 'name_centre' | null; // how a DUPLICATE matched
  matchedMemberId: string | null;
  values: Record<string, unknown> | null; // ready-to-insert members row (new rows only)
};

// ── cell coercion (exceljs cell values: string/number/Date/richText/hyperlink) ───────
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text.trim();                       // hyperlink
    if (Array.isArray(o.richText)) return o.richText.map((r) => (r as { text?: string }).text ?? '').join('').trim();
    if (o.result !== undefined) return cellText(o.result);                      // formula
    return '';
  }
  return String(v).trim();
}

const YES = new Set(['是', 'Y', 'y', 'yes', 'YES']);
const NO = new Set(['否', 'N', 'n', 'no', 'NO']);

// Example rows ship in the template and are skipped on import.
export function isExampleRow(raw: Record<string, string>): boolean {
  return raw.name_cn.includes('示例') || raw.name_en.toLowerCase().includes('example');
}

function isEmptyRow(raw: Record<string, string>): boolean {
  return Object.values(raw).every((v) => v === '');
}

// ── per-row validation → insertable values (or issues) ───────────────────────────────
export function validateRow(raw: Record<string, string>, centres: CentreRef[]): { values: Record<string, unknown> | null; issues: string[] } {
  const issues: string[] = [];
  const values: Record<string, unknown> = {};

  // centre — accept 中文名 / English name / code, case-insensitive on the latin forms
  const centreIn = raw.centre;
  if (!centreIn) {
    issues.push('缺少共修会');
  } else {
    const hit = centres.find(
      (c) => c.name_cn === centreIn || c.name_en.toLowerCase() === centreIn.toLowerCase() || c.code.toLowerCase() === centreIn.toLowerCase()
    );
    if (!hit) issues.push(`共修会无效：${centreIn}`);
    else values.gyt_centre_id = hit.id;
  }

  values.name_cn = raw.name_cn || null;
  values.name_en = raw.name_en || null;
  if (!raw.name_cn && !raw.name_en) issues.push('缺少姓名（中文或英文至少一项）');

  if (raw.gender) {
    const g = raw.gender === '男' ? 'M' : raw.gender === '女' ? 'F' : raw.gender.toUpperCase();
    if (g !== 'M' && g !== 'F') issues.push(`性别无效：${raw.gender}`);
    else values.gender = g;
  } else values.gender = null;

  if (raw.dob) {
    if (!isValidDate(raw.dob)) issues.push(`出生日期无效（须为 YYYY-MM-DD）：${raw.dob}`);
    else values.dob = raw.dob;
  } else values.dob = null;

  if (raw.phone) {
    const { phone, error } = normalizePhone(raw.phone);
    if (error) issues.push(error);
    else values.phone = phone;
  } else values.phone = null;

  for (const k of ['email', 'address', 'disciple_no', 'occupation', 'notes'] as const) {
    values[k] = raw[k] || null;
  }

  for (const k of ['disciple', 'full_veg'] as const) {
    if (!raw[k]) values[k] = null;
    else if (YES.has(raw[k])) values[k] = true;
    else if (NO.has(raw[k])) values[k] = false;
    else issues.push(`${k === 'disciple' ? '是否弟子' : '是否全素'}无效（须为 是/否）：${raw[k]}`);
  }

  for (const [k, label] of [['baishi_year', '拜师年份'], ['veg_since', '全素年份']] as const) {
    if (!raw[k]) { values[k] = null; continue; }
    const n = Number(raw[k]);
    if (!Number.isInteger(n) || n < 1900 || n > 2100) issues.push(`${label}无效：${raw[k]}`);
    else values[k] = n;
  }

  if (raw.shirt_size) {
    if (!(SHIRT_SIZES as readonly string[]).includes(raw.shirt_size.toUpperCase())) issues.push(`T恤尺寸无效：${raw.shirt_size}`);
    else values.shirt_size = raw.shirt_size.toUpperCase();
  } else values.shirt_size = null;

  const mt = raw.member_type.toLowerCase();
  if (!mt) values.member_type = 'member';
  else if (mt === 'member' || mt === 'volunteer') values.member_type = mt;
  else issues.push(`会员类型无效（member/volunteer）：${raw.member_type}`);

  values.status = 'active';
  return { values: issues.length ? null : values, issues };
}

// ── classification (THE dedup rule; batched queries, no N+1) ─────────────────────────
export async function classifyRows(
  db: SupabaseClient,
  rows: { rowNo: number; raw: Record<string, string>; values: Record<string, unknown> | null; issues: string[] }[]
): Promise<ImportRow[]> {
  const valid = rows.filter((r) => r.values);
  const phones = [...new Set(valid.map((r) => r.values!.phone).filter(Boolean))] as string[];
  const names = [...new Set(valid.map((r) => r.values!.name_cn).filter(Boolean))] as string[];

  const [phoneRes, nameRes] = await Promise.all([
    phones.length
      ? db.from('members').select('id, phone, status').in('phone', phones)
      : Promise.resolve({ data: [] }),
    names.length
      ? db.from('members').select('id, name_cn, gyt_centre_id, status').in('name_cn', names)
      : Promise.resolve({ data: [] }),
  ]);
  const byPhone = new Map<string, { id: string; status: string }[]>();
  for (const m of (phoneRes.data ?? []) as { id: string; phone: string; status: string }[]) {
    if (!byPhone.has(m.phone)) byPhone.set(m.phone, []);
    byPhone.get(m.phone)!.push(m);
  }
  const byNameCentre = new Map<string, { id: string; status: string }[]>();
  for (const m of (nameRes.data ?? []) as { id: string; name_cn: string; gyt_centre_id: string | null; status: string }[]) {
    const k = `${m.name_cn}␟${m.gyt_centre_id ?? ''}`;
    if (!byNameCentre.has(k)) byNameCentre.set(k, []);
    byNameCentre.get(k)!.push(m);
  }

  const seenPhones = new Map<string, number>();      // in-file collisions → review
  const seenNameCentre = new Map<string, number>();

  return rows.map((r) => {
    const out: ImportRow = { rowNo: r.rowNo, raw: r.raw, issues: [...r.issues], cls: 'error', matchMethod: null, matchedMemberId: null, values: r.values };
    if (!r.values) return out; // validation already failed → error

    const phone = r.values.phone as string | null;
    const nameKey = r.values.name_cn ? `${r.values.name_cn}␟${r.values.gyt_centre_id ?? ''}` : null;

    // in-file collisions first — the second occurrence must never insert
    if (phone) {
      const first = seenPhones.get(phone);
      if (first !== undefined) {
        out.cls = 'review';
        out.issues.push(`与文件内第 ${first} 行电话相同`);
        return out;
      }
      seenPhones.set(phone, r.rowNo);
    }

    if (phone) {
      const hits = byPhone.get(phone) ?? [];
      const active = hits.filter((h) => h.status === 'active');
      if (active.length === 1) {
        out.cls = 'duplicate';
        out.matchMethod = 'phone';
        out.matchedMemberId = active[0].id;
        if (nameKey) seenNameCentre.set(nameKey, r.rowNo);
        return out;
      }
      if (hits.length > 0) {
        // >1 match, or an inactive member holds this phone (global unique — cannot insert)
        out.cls = 'review';
        out.issues.push(active.length > 1 ? '电话与多位会员匹配，需人工确认' : '电话与已停用会员相同，需人工确认');
        return out;
      }
    }

    if (nameKey) {
      const first = seenNameCentre.get(nameKey);
      if (first !== undefined) {
        out.cls = 'review';
        out.issues.push(`与文件内第 ${first} 行姓名+共修会相同`);
        return out;
      }
      seenNameCentre.set(nameKey, r.rowNo);
      const hits = byNameCentre.get(nameKey) ?? [];
      if (hits.length === 1) {
        out.cls = 'duplicate';
        out.matchMethod = 'name_centre';
        out.matchedMemberId = hits[0].id;
        return out;
      }
      if (hits.length > 1) {
        out.cls = 'review';
        out.issues.push('姓名+共修会与多位会员匹配，需人工确认');
        return out;
      }
    }

    out.cls = 'new';
    return out;
  });
}

// ── upload → classified rows (shared verbatim by the preview and commit routes) ──────
export async function loadAndClassify(req: Request): Promise<
  | { ok: true; fileName: string; rows: ImportRow[] }
  | { ok: false; status: number; error: string }
> {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file === 'string') return { ok: false, status: 400, error: '请选择要上传的 .xlsx 文件' };
  if (file.size > 8 * 1024 * 1024) return { ok: false, status: 400, error: '文件过大（上限 8MB）' };

  const wb = new ExcelJS.Workbook();
  try {
    // exceljs.load wants a Node Buffer — a bare ArrayBuffer throws in the nodejs runtime.
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()));
  } catch {
    return { ok: false, status: 400, error: '无法读取文件 — 请上传 .xlsx 格式' };
  }
  const ws = wb.getWorksheet(IMPORT_SHEET) ?? wb.worksheets[0];
  if (!ws) return { ok: false, status: 400, error: '文件中没有工作表' };

  const parsed = parseSheet(ws);
  if (parsed.error) return { ok: false, status: 400, error: parsed.error };
  if (parsed.rows.length === 0) return { ok: false, status: 400, error: '文件中没有可导入的数据行' };

  const { data: centreRows, error } = await supabaseAdmin!
    .from('centres').select('id, code, name_cn, name_en').eq('is_active', true);
  if (error) return { ok: false, status: 500, error: 'Failed to load centres' };
  const centres = (centreRows ?? []) as CentreRef[];

  const validated = parsed.rows.map((r) => ({ ...r, ...validateRow(r.raw, centres) }));
  const rows = await classifyRows(supabaseAdmin!, validated);
  return { ok: true, fileName: (file as File).name || 'upload.xlsx', rows };
}

export function tally(rows: ImportRow[]) {
  const counts = { new: 0, duplicate: 0, review: 0, error: 0 };
  for (const r of rows) counts[r.cls] += 1;
  return counts;
}

// ── whole-workbook parse (positional per IMPORT_COLUMNS; loose header check) ─────────
// worksheet is an exceljs Worksheet; typed loosely to keep exceljs out of client bundles.
export function parseSheet(worksheet: {
  rowCount: number;
  getRow: (n: number) => { getCell: (c: number) => { value: unknown } };
}): { rows: { rowNo: number; raw: Record<string, string> }[]; error?: string } {
  const header = IMPORT_COLUMNS.map((_, i) => cellText(worksheet.getRow(1).getCell(i + 1).value));
  if (!header[0].includes('共修会')) {
    return { rows: [], error: '文件格式不符 — 请使用「下载导入模板」生成的模板。' };
  }
  const rows: { rowNo: number; raw: Record<string, string> }[] = [];
  const last = Math.min(worksheet.rowCount, MAX_IMPORT_ROWS + 1);
  for (let n = 2; n <= last; n++) {
    const raw: Record<string, string> = {};
    IMPORT_COLUMNS.forEach((c, i) => { raw[c.key] = cellText(worksheet.getRow(n).getCell(i + 1).value); });
    if (isEmptyRow(raw) || isExampleRow(raw)) continue;
    rows.push({ rowNo: n, raw });
  }
  return { rows };
}
