// src/app/api/dashboard/members/import/template/route.ts
// GET — generate the 会员 bulk-import .xlsx template FRESH on every call so the
// centre dropdown always reflects the live centres table (members:edit).
// Sheet 会员: bilingual header + two grey example rows (skipped on import — the
// parser drops any row whose name contains 示例/example). Sheet 参考: read-only
// allowed-value lists backing the data-validation dropdowns.

import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireModuleAccess } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { IMPORT_COLUMNS, IMPORT_SHEET, REF_SHEET, SHIRT_SIZES } from '@/lib/member-import';
import { LANG_ZH, MARITAL_ZH, RELIGION_ZH, BIRTHPLACE_ZH } from '@/lib/member-vocab';

export const runtime = 'nodejs';

// Example rows — column order matches IMPORT_COLUMNS. Vocab cells use zh labels to show
// they're accepted (import parses code OR zh label); languages is comma-separated.
const EXAMPLES: string[][] = [
  ['', '（示例）王小明', 'Example Wong', 'M', '1968-01-31', '0123456789', 'ming@example.com', '', '是', 'D1234', '2015', '是', '2016', 'L', '华语，英语', '已婚', '佛教', '雪兰莪', '教师', 'volunteer', '示例行：导入时自动跳过，可整行删除'],
  ['', '', '(Example) Mary Lee', 'F', '', '6581234567', '', '', '否', '', '', '否', '', 'S', 'english, cantonese', '单身', '佛教', 'singapore', '', '', '示例行：导入时自动跳过，可整行删除'],
];

export async function GET() {
  const access = await requireModuleAccess('members', 'edit');
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: access.status });
  }
  if (!supabaseAdmin) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });

  const { data: centreRows, error } = await supabaseAdmin
    .from('centres').select('name_cn').eq('is_active', true).order('name_cn');
  if (error) {
    console.error('[member-import] centres load failed:', error);
    return NextResponse.json({ error: 'Failed to build template' }, { status: 500 });
  }
  const centres = (centreRows ?? []).map((c) => c.name_cn as string);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(IMPORT_SHEET);
  const ref = wb.addWorksheet(REF_SHEET);

  // ── 参考 sheet (backs the dropdowns; kept simple and read-only by convention) ──
  ref.getCell('A1').value = '共修会（可选值）';
  centres.forEach((c, i) => { ref.getCell(`A${i + 2}`).value = c; });
  ref.getCell('C1').value = '性别'; ['M', 'F'].forEach((v, i) => { ref.getCell(`C${i + 2}`).value = v; });
  ref.getCell('D1').value = '是/否'; ['是', '否'].forEach((v, i) => { ref.getCell(`D${i + 2}`).value = v; });
  ref.getCell('E1').value = 'T恤尺寸'; SHIRT_SIZES.forEach((v, i) => { ref.getCell(`E${i + 2}`).value = v; });
  ref.getCell('F1').value = '会员类型'; ['member', 'volunteer'].forEach((v, i) => { ref.getCell(`F${i + 2}`).value = v; });
  ref.getCell('G1').value = '婚姻状况'; Object.values(MARITAL_ZH).forEach((v, i) => { ref.getCell(`G${i + 2}`).value = v; });
  ref.getCell('I1').value = '宗教'; Object.values(RELIGION_ZH).forEach((v, i) => { ref.getCell(`I${i + 2}`).value = v; });
  ref.getCell('J1').value = '出生地'; Object.values(BIRTHPLACE_ZH).forEach((v, i) => { ref.getCell(`J${i + 2}`).value = v; });
  ref.getCell('K1').value = '语言（多选，逗号分隔）'; Object.values(LANG_ZH).forEach((v, i) => { ref.getCell(`K${i + 2}`).value = v; });
  ref.getCell('M1').value = '说明：本表为下拉选项参考，请勿修改。共修会名称以中文为准（导入也接受英文名/代码）。语言可填多个，用逗号分隔。';
  ref.getRow(1).font = { bold: true };
  for (const col of ['A', 'C', 'D', 'E', 'F', 'G', 'I', 'J', 'K']) ref.getColumn(col).width = 16;

  // ── 会员 sheet ──
  const headerRow = ws.getRow(1);
  IMPORT_COLUMNS.forEach((c, i) => { headerRow.getCell(i + 1).value = c.label; });
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E8D2' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  IMPORT_COLUMNS.forEach((c, i) => { ws.getColumn(i + 1).width = ['centre', 'address', 'notes', 'email'].includes(c.key) ? 26 : 16; });

  EXAMPLES.forEach((vals, r) => {
    const row = ws.getRow(r + 2);
    vals.forEach((v, i) => { row.getCell(i + 1).value = v; });
    row.getCell(1).value = centres[0] ?? '';
    row.font = { italic: true, color: { argb: 'FF9A8F7A' } };
  });

  // ── data-validation dropdowns (rows 2-1001) ──
  const col = (key: string) => IMPORT_COLUMNS.findIndex((c) => c.key === key) + 1;
  const letter = (n: number) => ws.getColumn(n).letter;
  const addList = (key: string, formulae: string[]) => {
    const L = letter(col(key));
    for (let r = 2; r <= 1001; r++) {
      ws.getCell(`${L}${r}`).dataValidation = { type: 'list', allowBlank: true, formulae };
    }
  };
  addList('centre', [`${REF_SHEET}!$A$2:$A$${centres.length + 1}`]);
  addList('gender', ['"M,F"']);
  addList('disciple', ['"是,否"']);
  addList('full_veg', ['"是,否"']);
  addList('shirt_size', [`"${SHIRT_SIZES.join(',')}"`]);
  addList('member_type', ['"member,volunteer"']);
  // single-select vocab dropdowns (zh labels from 参考). languages is multi → free text
  // (Excel lists can't multi-select); its allowed values are listed on 参考 for reference.
  addList('marital_status', [`${REF_SHEET}!$G$2:$G$${Object.keys(MARITAL_ZH).length + 1}`]);
  addList('religion', [`${REF_SHEET}!$I$2:$I$${Object.keys(RELIGION_ZH).length + 1}`]);
  addList('birthplace', [`${REF_SHEET}!$J$2:$J$${Object.keys(BIRTHPLACE_ZH).length + 1}`]);

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="member-import-template.xlsx"; filename*=UTF-8''${encodeURIComponent('会员导入模板.xlsx')}`,
      'Cache-Control': 'no-store',
    },
  });
}
