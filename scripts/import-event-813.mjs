// scripts/import-event-813.mjs
// ONE-OFF, IDEMPOTENT import of the first real event: 卢军宏台长恩师纪念法会
// (XLFM-2608, 2026-08-13, Monkey Canopy) + 918 confirmed volunteers, from the
// architect-cleaned source file scripts/data/event-813-volunteers.json.
//
//   node scripts/import-event-813.mjs [--dry-run]
//
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (from .env.local /
// .env, same dotenv pattern as the other scripts). --dry-run connects and computes
// everything (including the verification report preview) but writes NOTHING.
//
// What it writes (and the conventions each part follows):
//   • events        — find-or-create by code XLFM-2608. status 'open',
//                     requires_approval false, organizing_centre = HQ,
//                     starts_on = ends_on = 2026-08-13, capacity null,
//                     public_registration_enabled stays false (schema default).
//   • event_fees    — one 'meal' row at RM0 billed per_item. WITHOUT a per_item
//                     meal fee, every selections-edit path (PATCH …/selections,
//                     the 代报名 dialog) strips selections.meals ("delete
//                     selections.meals when !mealPerItem"), silently destroying
//                     the kitchen roster. RM0 keeps fee_total 0 while making the
//                     imported meal picks first-class. Flagged in the run report.
//   • event_meal_slots — the full date×meal grid over the span of meals that
//                     actually appear in the data (expected 2026-08-10 dinner →
//                     2026-08-14 breakfast), offered = that cell appears in the
//                     data. Grid shape matches syncMealSlots' convention; upsert
//                     on (event_id, slot_date, meal). NOTE: the event itself is
//                     single-day 08-13, so a later staff edit that changes the
//                     event DATES would regenerate the grid to 08-13-only and
//                     delete these slots (event-slots.ts syncMealSlots) — flagged
//                     to the architect in the run report.
//   • registrations — one per source record. reg_no follows the app convention
//                     `${event.code}-${String(seq).padStart(4,'0')}` continuing
//                     after the highest existing suffix. member_id null,
//                     applicant_name/phone from the record, volunteer_team_id by
//                     team slug (null = unassigned), status 'approved',
//                     payment_status 'waived' (RM12 meal boxes settled offline by
//                     总会), fee_total 0, fee_breakdown [] (the schema/computeFees
//                     snapshot shape). selections = { meals: [...], import813:
//                     <full source record> } — meals uses the app's
//                     'YYYY-MM-DD:meal' keys so kitchen stats work; everything
//                     else lives untouched under the import813 namespace.
//
// IDEMPOTENT: a volunteer is skipped when their src_no already exists in this
// event's registrations (selections->import813->>src_no). Batches of 200.
//
// SHARED PHONES: migration 018's registrations_public_dupe unique index forbids two
// member_id-NULL pending/approved rows with the same (event_id, applicant_phone).
// Family members sharing one phone are normal in a 918-person fahui, so only the
// FIRST record with a given phone keeps applicant_phone; later ones get null (the
// phone stays intact in selections.import813). Every such case is reported.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const DRY_RUN = process.argv.includes('--dry-run');
const DATA_FILE = path.join(process.cwd(), 'scripts', 'data', 'event-813-volunteers.json');
const EVENT_CODE = 'XLFM-2608';
const EVENT_DATE = '2026-08-13'; // starts_on = ends_on (single-day fahui)
const HQ_CODE = 'HQ';
const MEALS = ['breakfast', 'lunch', 'dinner'];
const BATCH_SIZE = 200;
const PAGE = 1000; // PostgREST per-request row cap

function die(msg) {
  console.error(`\n✗ ABORT: ${msg}`);
  process.exit(1);
}

// ── env + client ───────────────────────────────────────────────────────────────────
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) die('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from env');
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

// ── load + validate the source file ────────────────────────────────────────────────
if (!fs.existsSync(DATA_FILE)) die(`data file not found: ${DATA_FILE}`);
const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const srcEvent = raw?.event;
const volunteers = raw?.volunteers;
if (!srcEvent || srcEvent.code !== EVENT_CODE) die(`event.code mismatch: expected ${EVENT_CODE}, got ${srcEvent?.code}`);
if (!Array.isArray(volunteers) || volunteers.length === 0) die('volunteers[] missing or empty');

const seenSrc = new Set();
for (const v of volunteers) {
  if (v.src_no === undefined || v.src_no === null || String(v.src_no).trim() === '') {
    die(`record without src_no (applicant_name=${JSON.stringify(v.applicant_name)})`);
  }
  const key = String(v.src_no);
  if (seenSrc.has(key)) die(`duplicate src_no in source data: ${key}`);
  seenSrc.add(key);
  if (typeof v.applicant_name !== 'string' || !v.applicant_name.trim()) {
    die(`record src_no=${key} has no applicant_name`);
  }
}
console.log(`Loaded ${volunteers.length} volunteer records from ${path.relative(process.cwd(), DATA_FILE)}`);

// ── meal-key handling: source 'YYYY-MM-DD_meal' → app 'YYYY-MM-DD:meal' ────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseSourceMealKey(k) {
  const i = k.lastIndexOf('_');
  const date = k.slice(0, i);
  const meal = k.slice(i + 1);
  if (i < 0 || !DATE_RE.test(date) || !MEALS.includes(meal)) die(`unrecognised meal key in source data: ${JSON.stringify(k)}`);
  return { date, meal, appKey: `${date}:${meal}` };
}
function mealKeysOf(v) {
  const out = [];
  if (v.meals && typeof v.meals === 'object') {
    for (const [k, picked] of Object.entries(v.meals)) {
      if (picked === true) out.push(parseSourceMealKey(k).appKey);
    }
  }
  return [...new Set(out)].sort();
}

// The offered grid = full date×meal rectangle over the span of meals seen in the data,
// offered=true only for cells some volunteer actually picked (syncMealSlots grid shape).
const pickedCells = new Set();
for (const v of volunteers) for (const k of mealKeysOf(v)) pickedCells.add(k);
if (pickedCells.size === 0) die('no meals found anywhere in the data — source file looks wrong');
const slotDates = [...new Set([...pickedCells].map((k) => k.split(':')[0]))].sort();
const gridRows = [];
{
  const first = new Date(`${slotDates[0]}T00:00:00Z`);
  const last = new Date(`${slotDates[slotDates.length - 1]}T00:00:00Z`);
  for (const d = first; d.getTime() <= last.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    for (const meal of MEALS) gridRows.push({ slot_date: date, meal, offered: pickedCells.has(`${date}:${meal}`) });
  }
}
console.log(`Meal grid: ${gridRows.length} cells over ${slotDates[0]}…${slotDates[slotDates.length - 1]}, ${pickedCells.size} offered`);

// ── reference data: HQ centre + teams by slug ──────────────────────────────────────
const { data: hq, error: hqErr } = await db.from('centres').select('id').eq('code', HQ_CODE).single();
if (hqErr || !hq) die(`HQ centre lookup failed: ${hqErr?.message}`);

const { data: teamRows, error: teamErr } = await db.from('teams').select('id, slug, name_cn').eq('is_active', true);
if (teamErr) die(`teams lookup failed: ${teamErr.message}`);
const teamBySlug = new Map(teamRows.map((t) => [t.slug, t]));
const teamById = new Map(teamRows.map((t) => [t.id, t]));

const unknownSlugs = [...new Set(volunteers.map((v) => v.team_slug).filter((s) => s && !teamBySlug.has(s)))];
if (unknownSlugs.length) die(`team_slug values not in teams table: ${unknownSlugs.join(', ')}`);

// ── 1. EVENT — find-or-create by code ──────────────────────────────────────────────
let { data: event, error: evErr } = await db
  .from('events')
  .select('id, code, status, starts_on, ends_on')
  .eq('code', EVENT_CODE)
  .maybeSingle();
if (evErr) die(`event lookup failed: ${evErr.message}`);

if (event) {
  console.log(`Event ${EVENT_CODE} already exists (${event.id}) — reusing`);
} else if (DRY_RUN) {
  console.log(`[dry-run] would create event ${EVENT_CODE} "${srcEvent.title}"`);
} else {
  const { data: created, error } = await db
    .from('events')
    .insert({
      code: EVENT_CODE,
      title: srcEvent.title,
      event_type: srcEvent.event_type,
      organizing_centre_id: hq.id,
      co_centre_ids: [],
      starts_on: EVENT_DATE,
      ends_on: EVENT_DATE,
      location: srcEvent.location ?? null,
      capacity: null,
      reg_deadline: null,
      requires_approval: false,
      status: 'open',
      created_by: null,
      updated_by: null,
    })
    .select('id, code, status, starts_on, ends_on')
    .single();
  if (error || !created) die(`event create failed: ${error?.message}`);
  event = created;
  console.log(`Created event ${EVENT_CODE} (${event.id})`);
}

if (!DRY_RUN) {
  // RM0 per_item meal fee — keeps selections.meals alive through every edit path
  // (see header). find-or-create on the (event_id, item) unique.
  const { data: mealFee, error: feeSelErr } = await db
    .from('event_fees').select('id, amount, billing').eq('event_id', event.id).eq('item', 'meal').maybeSingle();
  if (feeSelErr) die(`event_fees lookup failed: ${feeSelErr.message}`);
  if (!mealFee) {
    const { error } = await db.from('event_fees').insert({
      event_id: event.id, item: 'meal', label_cn: '餐点（义工餐）', amount: 0, billing: 'per_item', sort: 0,
    });
    if (error) die(`meal fee insert failed: ${error.message}`);
    console.log('Created RM0 per_item meal fee row');
  }

  const { error: slotErr } = await db
    .from('event_meal_slots')
    .upsert(gridRows.map((r) => ({ ...r, event_id: event.id })), { onConflict: 'event_id,slot_date,meal' });
  if (slotErr) die(`meal-slot upsert failed: ${slotErr.message}`);
  console.log(`Upserted ${gridRows.length} meal-slot cells`);
}

// ── 2. IDEMPOTENCY — src_nos already imported for this event ───────────────────────
const existingSrc = new Set();
const usedPhones = new Set(); // phones already occupying the 018 partial-unique slot
let maxSeq = 0;
if (event) {
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('registrations')
      .select('reg_no, member_id, applicant_phone, status, src_no:selections->import813->>src_no')
      .eq('event_id', event.id)
      .range(from, from + PAGE - 1);
    if (error) die(`existing-registrations scan failed: ${error.message}`);
    for (const r of data) {
      if (r.src_no != null) existingSrc.add(String(r.src_no));
      if (r.member_id === null && r.applicant_phone && ['pending', 'approved'].includes(r.status)) {
        usedPhones.add(r.applicant_phone);
      }
      const m = /-(\d+)$/.exec(r.reg_no ?? '');
      if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
    }
    if (data.length < PAGE) break;
  }
}
const todo = volunteers.filter((v) => !existingSrc.has(String(v.src_no)));
console.log(`${existingSrc.size} already imported, ${todo.length} to insert`);

// ── 3. REGISTRATIONS — batched inserts ─────────────────────────────────────────────
const nowIso = new Date().toISOString();
let seq = maxSeq;
const sharedPhone = []; // src_nos whose phone moved to import813-only (018 dupe index)
const rows = todo.map((v) => {
  const meals = mealKeysOf(v);
  seq += 1;
  let phone = v.phone ?? null;
  if (phone) {
    if (usedPhones.has(phone)) {
      sharedPhone.push(String(v.src_no));
      phone = null; // 018 registrations_public_dupe — phone preserved in import813
    } else {
      usedPhones.add(phone);
    }
  }
  return {
    event_id: event?.id, // set for real runs; dry-run may have no event yet
    reg_no: `${EVENT_CODE}-${String(seq).padStart(4, '0')}`,
    member_id: null,
    applicant_name: v.applicant_name.trim(),
    applicant_phone: phone,
    volunteer_team_id: v.team_slug ? teamBySlug.get(v.team_slug).id : null,
    selections: { ...(meals.length ? { meals } : {}), import813: v },
    fee_total: 0,
    fee_breakdown: [],
    status: 'approved',
    decided_by: null,
    decided_at: nowIso,
    notes: null,
    created_by: null,
    updated_by: null,
    payment_status: 'waived',
    paid_amount: 0,
    payment_note: 'RM12 餐盒由总会线下结算（813 导入豁免）',
  };
});

if (DRY_RUN) {
  console.log(`[dry-run] would insert ${rows.length} registrations (${EVENT_CODE}-${String(maxSeq + 1).padStart(4, '0')}…)`);
} else {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await db.from('registrations').insert(batch);
    if (error) die(`batch insert failed after ${inserted} inserts (re-run to resume — import is idempotent): ${error.message}`);
    inserted += batch.length;
    console.log(`  inserted ${inserted}/${rows.length}`);
  }
}

// ── 4. VERIFY + REPORT — recount from the DB, not from what we think we wrote ──────
if (!event) {
  console.log('[dry-run] no event in DB — skipping DB verification');
  process.exit(0);
}
const dbRows = [];
for (let from = 0; ; from += PAGE) {
  const { data, error } = await db
    .from('registrations')
    .select('volunteer_team_id, selections')
    .eq('event_id', event.id)
    .range(from, from + PAGE - 1);
  if (error) die(`verification scan failed: ${error.message}`);
  dbRows.push(...data);
  if (data.length < PAGE) break;
}

const byCentre = new Map();
const byTeam = new Map();
let accom = 0;
let noTeam = 0;
for (const r of dbRows) {
  const imp = r.selections?.import813 ?? {};
  const centre = imp.centre ?? '(无)';
  byCentre.set(centre, (byCentre.get(centre) ?? 0) + 1);
  const teamName = r.volunteer_team_id ? (teamById.get(r.volunteer_team_id)?.name_cn ?? r.volunteer_team_id) : '(未分组)';
  byTeam.set(teamName, (byTeam.get(teamName) ?? 0) + 1);
  const needsAccom = imp.needs_accommodation ?? imp.accommodation?.needs_accommodation;
  if (needsAccom === true) accom += 1;
  if (!r.volunteer_team_id) noTeam += 1;
}

const fmt = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${k}: ${n}`).join('\n');
console.log(`\n══ VERIFICATION (${EVENT_CODE}) ══`);
console.log(`Total registrations: ${dbRows.length} (expect 918)`);
console.log(`needs_accommodation: ${accom} (expect 780)`);
console.log(`no team (未分组):     ${noTeam} (expect 141)`);
console.log(`\nBy centre:\n${fmt(byCentre)}`);
console.log(`\nBy team:\n${fmt(byTeam)}`);
console.log(`\nOffered meal slots (${pickedCells.size}): ${[...pickedCells].sort().join(', ')}`);
if (sharedPhone.length) {
  console.log(`\nShared phones (applicant_phone set NULL to satisfy the 018 dupe index; number kept in import813) — src_no: ${sharedPhone.join(', ')}`);
}
console.log(`\nFlags for the architect:
  • event is single-day ${EVENT_DATE} but meal slots span ${slotDates[0]}…${slotDates[slotDates.length - 1]} —
    a staff edit that CHANGES THE EVENT DATES will regenerate the grid and delete
    the out-of-range slots (syncMealSlots). Consider starts_on 08-10 / ends_on 08-14
    if that becomes a problem.
  • a RM0 per_item meal fee row was created so selections.meals survives the
    selections-edit paths (they strip meals when no per_item meal fee exists).
  • the selections PATCH route rebuilds selections via parseSelections, which drops
    unknown keys — an edit through that route would WIPE selections.import813 for
    that registration. Consider preserving unknown namespaces there.
  • 018's registrations_public_dupe index forbids duplicate applicant_phone among
    member_id-null pending/approved rows per event — records sharing a phone were
    imported with applicant_phone NULL (see shared-phones list above). The number
    is still in import813 and can be restored during the later member import.`);
