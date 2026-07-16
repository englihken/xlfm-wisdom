// convert.mjs — regenerate scripts/data/event-813-volunteers.json from the raw xlsx
// per the architect's normative cleaning spec, then validate EVERY architect checksum.
// Exits non-zero on any mismatch (nothing is written unless all checks pass).
import * as XLSX from 'xlsx';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = 'C:/Users/Ken/Downloads/A Master 813 copy.xlsx';
const OUT = 'C:/Users/Ken/xlfm-wisdom/scripts/data/event-813-volunteers.json';

const buf = fs.readFileSync(SRC);
const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
const ws = wb.Sheets['Sheet1'];
const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
const fmt = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });

const fail = [];
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) fail.push(`${name}: got ${a}, expected ${e}`);
};

// ── cell helpers (spec rules) ───────────────────────────────────────────────────────
const isBlank = (v) => v === null || String(v).trim() === '';
const asStr = (v) => {
  if (v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
const asBool = (v) => {
  const s = v === null ? '' : String(v).trim();
  return s === '1' ? true : s === '0' ? false : null;
};
const serialToISO = (n) => new Date(Math.round(n) * 86400000 + Date.UTC(1899, 11, 30)).toISOString().slice(0, 10);
check('serial 46245', serialToISO(46245), '2026-08-11');
check('serial 46247', serialToISO(46247), '2026-08-13');
check('serial 46248', serialToISO(46248), '2026-08-14');
let stringDates = 0;
const asDate = (v) => {
  if (v === null || String(v).trim() === '') return null;
  if (typeof v === 'number') return serialToISO(v);
  stringDates += 1;
  return String(v).trim();
};
const asPhone = (v) => {
  if (v === null) return null;
  const s = typeof v === 'number' ? String(v) : String(v).trim();
  if (s === '' || s === '-') return null;
  // Canonicalize to the app's international-digits form (same rules as normalizePhone
  // in src/lib/members.ts + migration 038): MY 60…, SG 65…, ID 62…. Recovers
  // Excel-eaten leading zeros; takes the first number of an 'a/b' dual cell.
  // Unparseable values keep the original strip-spaces/dashes behaviour so no data is lost.
  const digits = s.split('/')[0].replace(/\D/g, '');
  if (!digits) return null;
  let d = digits;
  if (/^1\d{8,9}$/.test(d)) d = '0' + d;        // MY mobile missing its leading 0
  else if (/^8\d{9,11}$/.test(d)) d = '0' + d;  // Indonesian mobile missing its leading 0
  if (/^[89]\d{7}$/.test(d)) d = '65' + d;      // bare SG mobile
  else if (/^08\d{9,11}$/.test(d)) d = '62' + d.slice(1); // Indonesian local 08…
  else if (d.startsWith('0')) d = '6' + d;      // MY local → 60…
  return /^(60\d{8,10}|65[3689]\d{7}|62\d{8,12})$/.test(d) ? d : s.replace(/[\s-]/g, '');
};

// meal columns 30-41 → slot key (underscore style, import813 shape) or paid box
const MEAL_COLS = {
  30: '2026-08-10_dinner',
  31: '2026-08-11_breakfast',
  32: '2026-08-11_lunch',
  33: '2026-08-11_dinner', // 晚餐饭盒 RM12 — counts as that day's dinner + paid box
  34: '2026-08-12_breakfast',
  35: '2026-08-12_lunch',
  36: '2026-08-12_dinner',
  37: '2026-08-13_breakfast',
  38: '2026-08-13_lunch',
  39: '2026-08-13_dinner',
  40: '2026-08-14_breakfast',
};
const BOX_COLS = { 33: '2026-08-11_dinner_box_rm12', 41: '2026-08-14_takeaway_box_rm12' };

const TEAM_MAP = new Map(Object.entries({
  '佛台': 'altar', '膳食 - 派餐': 'meals', '煮食 - 分会': 'meals',
  '物流': 'logistics', '物流 A': 'logistics', '物流A': 'logistics',
  '卫生环保': 'hygiene', '宣传': 'publicity', '技术': 'tech', '医务': 'medical',
  '场务': 'venue', '交通': 'transport', '酒店': 'hotel', '插花': 'floral',
  '礼袋': 'gift-bags', '结缘': 'dharma-gifts', '仓库': 'warehouse', '摄影': 'photography',
  '巴士义工': 'transport', '巴士带队义工': 'transport', '茶艺组': 'tea',
}));
const NULL_TEAMS = new Set(['第一次报名', '随缘']);

// ── row loop ────────────────────────────────────────────────────────────────────────
const volunteers = [];
let skipped = 0;
const unknownTeams = new Set();
for (let i = 1; i < raw.length; i++) {
  const r = raw[i] ?? [];
  const f = fmt[i] ?? [];
  if (isBlank(r[2]) && isBlank(r[3])) { skipped += 1; continue; }

  const group = asStr(r[8]);
  let team_slug = null;
  if (group !== null && !NULL_TEAMS.has(group)) {
    team_slug = TEAM_MAP.get(group) ?? null;
    if (team_slug === null) unknownTeams.add(group);
  }

  const meals = {};
  for (const [col, key] of Object.entries(MEAL_COLS)) {
    if (String(r[col] ?? '').trim() === '1') meals[key] = true;
  }
  const paid_meal_boxes = [];
  for (const [col, key] of Object.entries(BOX_COLS)) {
    if (String(r[col] ?? '').trim() === '1') paid_meal_boxes.push(key);
  }

  const name_cn = asStr(r[2]);
  const name_en = asStr(r[3]);
  volunteers.push({
    src_row: i + 1, // Excel row number — the ONLY unique key ((centre, src_no) collides; see report)
    src_no: typeof r[0] === 'number' ? r[0] : asStr(r[0]),
    centre: asStr(r[1]),
    name_cn,
    name_en,
    applicant_name: name_cn ?? name_en,
    gender: asStr(r[4]),
    age: typeof r[5] === 'number' ? r[5] : asStr(r[5]),
    phone: asPhone(r[6]),
    tshirt: asStr(r[7]),
    group_2025: group,
    team_slug,
    special_note: asStr(r[9]),
    occupation: asStr(r[10]),
    skills: asStr(r[11]),
    carpenter_electrician: asBool(r[12]),
    full_veg: asBool(r[13]),
    disciple: asBool(r[14]),
    temple_duty: asBool(r[15]),
    bhff_study: asBool(r[16]),
    needs_accommodation: asBool(r[17]),
    room_type: asStr(r[18]),
    room_assign: asStr(r[19]),
    check_in: asDate(r[20]),
    check_out: asDate(r[21]),
    airport_pickup: asBool(r[22]),
    arrival_date: asDate(r[23]),
    arrival_time: asStr(f[24]),
    flight_arr: asStr(r[25]),
    airport_dropoff: asBool(r[26]),
    departure_date: asDate(r[27]),
    departure_time: asStr(f[28]),
    flight_dep: asStr(r[29]),
    meals,
    paid_meal_boxes,
    westmy_bus: asStr(f[42]),
    remarks: asStr(r[43]),
  });
}

// ── architect checksums ─────────────────────────────────────────────────────────────
check('total records', volunteers.length, 918);
check('skipped rows', skipped, 3);
check('unknown team labels', [...unknownTeams], []);
check('needs_accommodation', volunteers.filter((v) => v.needs_accommodation === true).length, 780);
check('team_slug null', volunteers.filter((v) => v.team_slug === null).length, 141);

const tally = (fn) => {
  const m = new Map();
  for (const v of volunteers) { const k = fn(v) ?? 'null'; m.set(k, (m.get(k) ?? 0) + 1); }
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
};
const EXPECT_CENTRE = {
  Selayang: 106, Puchong: 68, Cheras: 63, 'Ulu Tiram': 57, Kuching: 56, Batam: 50,
  Klang: 44, 'Petaling Jaya': 39, Skudai: 35, Jerantut: 31, Seremban: 30, Ipoh: 29,
  'Kota Kinabalu': 28, Melaka: 28, Sibu: 27, Kluang: 25, Segamat: 23, Sandakan: 21,
  Kuantan: 19, Muar: 18, Kulai: 18, 'Yong Peng': 17, 'Kota Bharu': 15, 'Tg. Balai': 15,
  Sg: 9, Sitiawan: 8, 'Batu Pahat': 7, 'Tg. Pinang': 7, 'Alor Setar': 6, Pekanbaru: 6,
  Tawau: 5, 'Kuala Selangor': 5, 'Teluk Intan': 2, Dumai: 1,
};
const EXPECT_TEAM = {
  meals: 275, venue: 109, logistics: 70, transport: 63, 'gift-bags': 60, floral: 41,
  hygiene: 37, publicity: 26, 'dharma-gifts': 26, altar: 24, tech: 14, warehouse: 13,
  hotel: 8, medical: 6, photography: 3, tea: 2, null: 141,
};
const byCentre = tally((v) => v.centre);
const byTeam = tally((v) => v.team_slug);
for (const [k, n] of Object.entries(EXPECT_CENTRE)) check(`centre ${k}`, byCentre[k] ?? 0, n);
check('centre count', Object.keys(byCentre).length, Object.keys(EXPECT_CENTRE).length);
for (const [k, n] of Object.entries(EXPECT_TEAM)) check(`team ${k}`, byTeam[k] ?? 0, n);
check('team count', Object.keys(byTeam).length, Object.keys(EXPECT_TEAM).length);

// meal slot totals vs the sheet's own totals row (row 921) + box counts
const totalsRow = raw[921] ?? [];
for (const [col, key] of Object.entries(MEAL_COLS)) {
  const n = volunteers.filter((v) => v.meals[key] && (col !== '33' || true)).length;
  // col 33 contributes to 2026-08-11_dinner only via the box — count directly:
  const direct = volunteers.filter((v) => v.meals[key] === true).length;
  check(`meal col ${col} (${key})`, direct, Number(totalsRow[col] ?? 0));
  void n;
}
check('takeaway boxes', volunteers.filter((v) => v.paid_meal_boxes.includes('2026-08-14_takeaway_box_rm12')).length, Number(totalsRow[41] ?? 0));
check('dinner boxes', volunteers.filter((v) => v.paid_meal_boxes.includes('2026-08-11_dinner_box_rm12')).length, Number(totalsRow[33] ?? 0));

// (centre, src_no) collisions are DATA REALITY (Selayang's No. restarts mid-file) —
// reported, not fatal. src_row (Excel row) is the actual dedupe key and must be unique.
const keys = new Map();
const csnDupes = [];
for (const v of volunteers) {
  const k = `${v.centre}␟${v.src_no}`;
  if (keys.has(k)) csnDupes.push(`${v.centre}#${v.src_no} (rows ${keys.get(k)} & ${v.src_row})`);
  else keys.set(k, v.src_row);
}
console.log(`(centre, src_no) collisions: ${csnDupes.length}`);
for (const d of csnDupes) console.log('  ' + d);
const rowKeys = new Set();
for (const v of volunteers) {
  if (rowKeys.has(v.src_row)) fail.push(`duplicate src_row: ${v.src_row}`);
  rowKeys.add(v.src_row);
}

// offered slot union (expect exactly the 11 architect cells) — meal keys are
// 'YYYY-MM-DD_meal', so split each at its LAST underscore to get the app form.
const offered = [...new Set(volunteers.flatMap((v) => Object.keys(v.meals)))].map((k) => {
  const i = k.lastIndexOf('_');
  return `${k.slice(0, i)}:${k.slice(i + 1)}`;
}).sort();
check('offered slots', offered, [
  '2026-08-10:dinner', '2026-08-11:breakfast', '2026-08-11:dinner', '2026-08-11:lunch',
  '2026-08-12:breakfast', '2026-08-12:dinner', '2026-08-12:lunch',
  '2026-08-13:breakfast', '2026-08-13:dinner', '2026-08-13:lunch', '2026-08-14:breakfast',
]);

// shared phones preview (dedupe happens at import time, file order)
const seenPhones = new Map();
const shared = [];
for (const v of volunteers) {
  if (!v.phone) continue;
  if (seenPhones.has(v.phone)) shared.push({ centre: v.centre, src_no: v.src_no, phone_of: seenPhones.get(v.phone) });
  else seenPhones.set(v.phone, `${v.centre}#${v.src_no}`);
}
console.log(`shared-phone rows (would be nulled at import): ${shared.length}`);
for (const s of shared) console.log(`  ${s.centre} src_no=${s.src_no} (first holder: ${s.phone_of})`);
console.log(`string dates kept verbatim: ${stringDates}`);

if (fail.length) {
  console.error(`\n✗ ${fail.length} CHECKSUM FAILURE(S):`);
  for (const f of fail) console.error('  ' + f);
  process.exit(1);
}

const out = {
  event: {
    code: 'XLFM-2608',
    title: '卢军宏台长恩师纪念法会',
    event_type: 'fahui',
    date: '2026-08-13',
    location: 'Monkey Canopy',
    capacity: null,
  },
  volunteers,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
console.log(`\n✓ ALL CHECKSUMS PASS — wrote ${OUT} (${volunteers.length} records)`);
