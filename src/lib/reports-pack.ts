// src/lib/reports-pack.ts
// Server-side assembly for the E3 月度检讨包 (brief §2). ONE function builds the
// whole scope-aware pack — the /api/reports/pack route returns it verbatim and
// the .csv route flattens it, so the numbers can never drift between the two.
//
// Definitions are the brief's source-of-truth list (as amended by the
// architect-verified fix batch 2026-07-11):
//   新结缘  = contacts counted by first_seen in the MYT month (the auto-created
//             first_contact milestone stamps a UTC date — counting it put the
//             contact tiles a window behind the conversation numbers)
//   开始念经 = started_chanting milestones in the month (keys from lib/outreach;
//             happened_on is a date column, compared as stored)
//   发心义工 = volunteer milestones inside the rolling funnel window
//   funnel  = milestone counts over org_settings outreach.event_window_days
//   收入    = 月费 fee_payments (non-void, paid_at in month) + 随喜 event fees
//             (registrations payment_verified_at in month, MYT-bucketed)
// EVERY month boundary comes from the ONE mytMonthWindow helper below: date
// columns compare as YYYY-MM-DD against its calendar dates, timestamptz
// columns against its UTC instants of MYT midnight — one implementation, so
// code paths can't drift between timezones again.
//
// Scope: national roles see everything; a locked centre_head sees the own-centre
// slice — per-centre rollups collapse to their row, the 关怀 and 运营·财务 pages
// are OMITTED from the payload (uniform wall, nothing greyed), events collapse
// to their centre's, and inbox health is their own mailbox.

import { supabaseAdmin } from './supabase';
import type { Volunteer } from './supabase-server';
import { MILESTONES, sourceLabel } from './outreach';
import { loadEventWindowDays } from './org-settings';
import { countsByMailbox, ownersByMailbox, loadEscalation } from './inbox-server';
import { ageDays, overdueLevel } from './inbox';

type Db = NonNullable<typeof supabaseAdmin>;

// Roles whose reports view is NATIONAL (brief §2 gate). centre_head is locked to
// its centre; centre_finance holds no reports grant and never reaches here.
const NATIONAL_REPORT_ROLES = new Set(['admin', 'erp_admin', 'committee', 'finance_director', 'volunteer']);

// ── THE ONE MYT month-window helper (fix batch 2026-07-11) ───────────────────
// Every month-scoped metric on all 5 pages goes through mytMonthWindow /
// mytMonthOf — no per-metric window math, so contact-based and conversation-
// based numbers can never drift apart again (the E3 browser-round bug: contact
// tiles counted UTC months while the relocated conversation queries counted
// MYT). Rules:
//   - timestamptz columns → filter with window.startUtc / endUtc (the UTC
//     instant of MYT midnight), or bucket with mytMonthOf (shift +8h, then
//     take YYYY-MM);
//   - date-typed columns (happened_on, paid_at, spent_at, starts_on) compare
//     as stored against window.startDate / endDate — NO tz shifting;
//   - "today" for rolling windows is the MYT calendar date (mytToday).
const MYT_MS = 8 * 60 * 60 * 1000;

export type MonthWindow = {
  ym: string;
  startUtc: string; // UTC instant of MYT month start — for timestamptz filters
  endUtc: string;
  startDate: string; // YYYY-MM-01 — for date-typed columns, as stored
  endDate: string;
};

export function mytMonthWindow(ym: string): MonthWindow {
  return {
    ym,
    startUtc: new Date(`${ym}-01T00:00:00+08:00`).toISOString(),
    endUtc: new Date(`${monthAdd(ym, 1)}-01T00:00:00+08:00`).toISOString(),
    startDate: `${ym}-01`,
    endDate: `${monthAdd(ym, 1)}-01`,
  };
}

// MYT calendar month of a timestamptz value: shift +8h, then take YYYY-MM.
export function mytMonthOf(isoTs: string): string {
  return new Date(new Date(isoTs).getTime() + MYT_MS).toISOString().slice(0, 7);
}

// Today's MYT calendar date (during the first 8h of a new MYT day, UTC still
// shows yesterday — rolling windows must anchor here, not on the UTC date).
export function mytToday(): string {
  return new Date(Date.now() + MYT_MS).toISOString().slice(0, 10);
}

export function currentMonthMYT(): string {
  return mytToday().slice(0, 7);
}

export function monthAdd(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

// The platform's first operational month — the earliest SELECTABLE report month, and
// the floor the two-level (year + month) selector opens down to. Months before this
// predate the system and render disabled in the selector. It is also the earliest month
// the legacy flat chip row (rolling last-6 + current) would have shown at launch.
export const REPORTS_GENESIS_MONTH = '2026-01';

// Every 'YYYY-MM' from `from` to `to` inclusive, oldest→newest. Lexicographic compare is
// correct for zero-padded YYYY-MM. Bounded (600 = 50y) as an infinite-loop backstop.
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 600; m = monthAdd(m, 1)) out.push(m);
  return out;
}

const firstDay = (ym: string) => `${ym}-01`;

function ymdAddDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── pack types (shared shape with the client) ────────────────────────────────
export type Delta = { dir: 'up' | 'flat' | 'down'; text: string } | null;

export type ReportsPack = {
  month: string;
  months: string[]; // full selectable range (genesis → current), oldest→newest — the selector's enabled set
  windowDays: number;
  scope: { locked: boolean; centreId: string | null; centreName: string | null };
  pages: string[]; // dept page keys present in this payload
  outreach: {
    newContacts: number;
    newContactsPrev: number;
    newContactsDelta: Delta;
    chanting: number;
    chantingPrev: number;
    chantingDelta: Delta;
    volunteersWindow: number;
    trend: { months: string[]; newContacts: number[]; chanting: number[] };
    sources: { label: string; value: number }[];
    funnel: { key: string; label: string; value: number }[];
    events: {
      id: string;
      title: string;
      month: string;
      upcoming: boolean;
      registrations: number;
      newContacts: number;
      chanting: number;
      ratePct: number | null;
    }[];
    centres: { name: string; newContacts: number; chanting: number }[];
  };
  care: {
    conversations: number;
    conversationsPrev: number;
    conversationsDelta: Delta;
    crisis: number;
    chatNewContacts: number;
    chatNewContactsPrev: number;
    chatNewContactsDelta: Delta;
    categories: { label: string; value: number; folded: boolean }[];
  } | null;
  ops: {
    activeMembers: number;
    coverage: { paid: number; pledged: number; pct: number };
    income: number;
    expenses: number;
    surplus: number;
    sixMonth: { months: string[]; income: number[]; expenses: number[] };
    centreCoverage: { name: string; paid: number; pledged: number; pct: number }[];
  } | null;
  eventsInv: {
    capacity: { title: string; registrations: number; capacity: number }[];
    lowStock: { name: string; qty: number; line: number }[];
    stocktakeDiff: number;
    releasePhotos: number;
  };
  inbox: {
    board: {
      centre_name: string;
      owners_label: string;
      new_n: number;
      oldest_unhandled_days: number;
      crisis_n: number;
    }[];
    avgFirstResponseDays: number | null;
    surfaceDays: number;
    surfaced: { subject: string; age_days: number }[];
  };
};

function delta(cur: number, prev: number, pctMode: boolean): Delta {
  if (cur === prev) return { dir: 'flat', text: '' };
  if (cur > prev) {
    if (pctMode && prev > 0) return { dir: 'up', text: `+${Math.round(((cur - prev) / prev) * 100)}%` };
    return { dir: 'up', text: `+${cur - prev}` };
  }
  return { dir: 'down', text: `${cur - prev}` };
}

// ── assembly ──────────────────────────────────────────────────────────────────
export async function assembleReportsPack(volunteer: Volunteer, monthParam: string | null): Promise<ReportsPack> {
  const db = supabaseAdmin as Db;

  const current = currentMonthMYT();
  // Full selectable range: system genesis → current month (MYT). The client's year+month
  // selector reads this as the enabled set; anything outside it renders disabled.
  const months = monthRange(REPORTS_GENESIS_MONTH, current);
  const month =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam) && monthParam >= REPORTS_GENESIS_MONTH && monthParam <= current
      ? monthParam
      : current;
  const prev = monthAdd(month, -1);
  const trendMonths = Array.from({ length: 6 }, (_, i) => monthAdd(month, i - 5));

  // scope
  const { data: vrow } = await db
    .from('volunteers')
    .select('scope, centre_id, role, centre:centres!centre_id ( name_cn )')
    .eq('id', volunteer.id)
    .maybeSingle();
  const scopeVal = (vrow?.scope as string | undefined) ?? 'own_center';
  const role = (vrow?.role as string | undefined) ?? volunteer.role;
  const locked = scopeVal !== 'all_centers' && !NATIONAL_REPORT_ROLES.has(role);
  const centreId = locked ? ((vrow?.centre_id as string | null) ?? null) : null;
  const centreJoin = vrow ? (Array.isArray(vrow.centre) ? vrow.centre[0] : vrow.centre) : null;
  const centreName = locked ? ((centreJoin?.name_cn as string | undefined) ?? null) : null;

  const windowDays = await loadEventWindowDays();
  // ALL month boundaries come from the one MYT helper (fix batch 2026-07-11).
  const w = mytMonthWindow(month);
  const wPrev = mytMonthWindow(prev);
  const wTrendStart = mytMonthWindow(trendMonths[0]);
  const monthStart = w.startDate;
  const monthEnd = w.endDate;
  const prevStart = wPrev.startDate;
  const windowStart = ymdAddDays(monthEnd, -windowDays);
  const monthStartUtc = w.startUtc;
  const monthEndUtc = w.endUtc;
  const prevStartUtc = wPrev.startUtc;
  const trendStart = wTrendStart.startDate;
  const trendStartUtc = wTrendStart.startUtc;

  // ── batched reads ───────────────────────────────────────────────────────────
  const [
    contactsRes,
    milestonesRes,
    convsRes,
    centresRes,
    membersRes,
    paysRes,
    expensesRes,
    regPaysRes,
    eventsRes,
    itemsRes,
    hqRes,
    stocktakesRes,
    movesRes,
  ] = await Promise.all([
    db.from('contacts').select('id, centre_id, source_type, source_event_id, first_seen').limit(50000),
    db.from('contact_milestones').select('contact_id, milestone, happened_on').limit(50000),
    locked
      ? Promise.resolve({ data: [] as Record<string, unknown>[], error: null })
      : db.from('conversations').select('created_at, category, crisis_flag').gte('created_at', prevStartUtc).lt('created_at', monthEndUtc),
    db.from('centres').select('id, name_cn').eq('is_active', true),
    locked
      ? Promise.resolve({ data: [] as Record<string, unknown>[], error: null })
      : db.from('members').select('id, gyt_centre_id, fee_pledge_amount, fee_waived_from').eq('status', 'active').limit(50000),
    locked
      ? Promise.resolve({ data: [] as Record<string, unknown>[], error: null })
      : db.from('fee_payments').select('centre_id, member_id, amount, paid_at, months_to').is('voided_at', null).limit(50000),
    locked
      ? Promise.resolve({ data: [] as Record<string, unknown>[], error: null })
      : db.from('expenses').select('centre_id, amount, spent_at').is('voided_at', null).gte('spent_at', trendStart).lt('spent_at', monthEnd),
    locked
      ? Promise.resolve({ data: [] as Record<string, unknown>[], error: null })
      : db.from('registrations').select('paid_amount, payment_verified_at').eq('payment_status', 'verified').gte('payment_verified_at', trendStartUtc).lt('payment_verified_at', monthEndUtc),
    db
      .from('events')
      .select('id, code, title, status, starts_on, ends_on, capacity, organizing_centre_id')
      .neq('status', 'draft')
      .order('starts_on', { ascending: false })
      .limit(12),
    db.from('inventory_items').select('id, name_cn, low_stock_line').eq('is_active', true),
    db.from('inventory_locations').select('id').eq('kind', 'hq_warehouse').maybeSingle(),
    db.from('inventory_stocktakes').select('id, confirmed_at').eq('status', 'confirmed').gte('confirmed_at', monthStartUtc).lt('confirmed_at', monthEndUtc),
    db
      .from('inventory_movements')
      .select('id, photo_path, request_id, moved_at')
      .gte('moved_at', monthStart)
      .lt('moved_at', monthEnd)
      .not('photo_path', 'is', null),
  ]);

  for (const [name, r] of [
    ['contacts', contactsRes],
    ['milestones', milestonesRes],
    ['conversations', convsRes],
    ['centres', centresRes],
  ] as const) {
    if ((r as { error: unknown }).error) console.error(`[reports-pack] ${name} read failed:`, (r as { error: unknown }).error);
  }

  const contacts = (contactsRes.data ?? []) as {
    id: string;
    centre_id: string | null;
    source_type: string | null;
    source_event_id: string | null;
    first_seen: string | null;
  }[];
  const milestones = (milestonesRes.data ?? []) as { contact_id: string; milestone: string; happened_on: string }[];
  const centres = ((centresRes.data ?? []) as { id: string; name_cn: string }[]).sort((a, b) => a.name_cn.localeCompare(b.name_cn, 'zh'));
  const centreNameById = new Map(centres.map((c) => [c.id, c.name_cn]));
  const contactById = new Map(contacts.map((c) => [c.id, c]));

  const inScope = (c: { centre_id: string | null } | undefined): boolean =>
    !locked || (!!c && c.centre_id != null && c.centre_id === centreId);

  // ── 渡人 page ────────────────────────────────────────────────────────────────
  const inMonth = (d: string, start: string, end: string) => d >= start && d < end;
  let newContacts = 0;
  let newPrev = 0;
  let chanting = 0;
  let chantingPrev = 0;
  let volunteersWindow = 0;
  const trendNew = trendMonths.map(() => 0);
  const trendChant = trendMonths.map(() => 0);
  const funnelCounts = new Map<string, number>(MILESTONES.map((m) => [m.key, 0]));
  const sourceCounts = new Map<string, number>();
  const centreRoll = new Map<string, { newContacts: number; chanting: number }>();
  let chatNew = 0;
  let chatNewPrev = 0;

  // 新结缘-family metrics (tile + 上月 + trend + 来源 donut + 随喜各会 + 经聊天
  // 新结缘) count CONTACTS by first_seen bucketed into MYT calendar months via
  // the shared helper — the architect-verified source (fix batch 2026-07-11).
  // The auto-created first_contact milestone stamps a UTC date, which is what
  // put the contact tiles a window behind the conversation numbers.
  for (const c of contacts) {
    if (!inScope(c) || !c.first_seen) continue;
    const ym = mytMonthOf(c.first_seen);
    if (ym === month) {
      newContacts++;
      const src = c.source_type ?? null;
      sourceCounts.set(src ?? '__null', (sourceCounts.get(src ?? '__null') ?? 0) + 1);
      if (c.centre_id) {
        const r = centreRoll.get(c.centre_id) ?? { newContacts: 0, chanting: 0 };
        r.newContacts++;
        centreRoll.set(c.centre_id, r);
      }
      if (src === 'chat') chatNew++;
    } else if (ym === prev) {
      newPrev++;
      if ((c.source_type ?? null) === 'chat') chatNewPrev++;
    }
    const ti = trendMonths.indexOf(ym);
    if (ti >= 0) trendNew[ti]++;
  }

  // Milestone-based metrics (开始念经, 发心义工, funnel) keep happened_on AS
  // STORED — it is a date column, no tz shifting (fix brief rule 5). The
  // window boundaries are the helper's MYT calendar dates.
  for (const m of milestones) {
    const c = contactById.get(m.contact_id);
    if (!inScope(c)) continue;
    const d = m.happened_on;
    if (m.milestone === 'started_chanting') {
      if (inMonth(d, monthStart, monthEnd)) {
        chanting++;
        if (c?.centre_id) {
          const r = centreRoll.get(c.centre_id) ?? { newContacts: 0, chanting: 0 };
          r.chanting++;
          centreRoll.set(c.centre_id, r);
        }
      }
      if (inMonth(d, prevStart, monthStart)) chantingPrev++;
      const ti = trendMonths.findIndex((tm) => inMonth(d, firstDay(tm), firstDay(monthAdd(tm, 1))));
      if (ti >= 0) trendChant[ti]++;
    }
    if (m.milestone === 'volunteer' && d >= windowStart && d < monthEnd) volunteersWindow++;
    if (d >= windowStart && d < monthEnd && funnelCounts.has(m.milestone)) {
      funnelCounts.set(m.milestone, (funnelCounts.get(m.milestone) ?? 0) + 1);
    }
  }

  // sources: named top 4 (fixed categorical order by count), rest + nulls fold 其他
  const namedSources = [...sourceCounts.entries()]
    .filter(([k]) => k !== '__null')
    .map(([k, v]) => ({ key: k, label: sourceLabel(k), value: v }))
    .sort((a, b) => b.value - a.value);
  const top = namedSources.slice(0, 4);
  const foldValue = namedSources.slice(4).reduce((s, x) => s + x.value, 0) + (sourceCounts.get('__null') ?? 0);
  const sources = [...top.map(({ label, value }) => ({ label, value })), ...(foldValue > 0 ? [{ label: '其他', value: foldValue }] : [])];

  // 活动效果 — per published event (E3 decision #4: NO 出席 column, footnote instead)
  const events = ((eventsRes.data ?? []) as {
    id: string; code: string; title: string; status: string; starts_on: string; ends_on: string | null; capacity: number | null; organizing_centre_id: string | null;
  }[]).filter((e) => !locked || e.organizing_centre_id === centreId);
  let regs: { event_id: string; status: string }[] = [];
  if (events.length) {
    const { data: regRows, error: regErr } = await db
      .from('registrations')
      .select('event_id, status')
      .in('event_id', events.map((e) => e.id));
    if (regErr) console.error('[reports-pack] registrations read failed:', regErr);
    regs = (regRows ?? []) as { event_id: string; status: string }[];
  }
  const regCount = new Map<string, number>();
  const pendingRegCount = new Map<string, number>();
  for (const r of regs) {
    if (r.status === 'cancelled' || r.status === 'rejected') continue;
    regCount.set(r.event_id, (regCount.get(r.event_id) ?? 0) + 1);
    if (r.status === 'pending' || r.status === 'approved') pendingRegCount.set(r.event_id, (pendingRegCount.get(r.event_id) ?? 0) + 1);
  }
  const contactsByEvent = new Map<string, Set<string>>();
  for (const c of contacts) {
    if (!c.source_event_id || !inScope(c)) continue;
    const set = contactsByEvent.get(c.source_event_id) ?? new Set<string>();
    set.add(c.id);
    contactsByEvent.set(c.source_event_id, set);
  }
  const today = mytToday();
  const eventRows = events.map((e) => {
    const eventContacts = contactsByEvent.get(e.id) ?? new Set<string>();
    const end = e.ends_on ?? e.starts_on;
    const chantCutoff = ymdAddDays(end, windowDays);
    let evChanting = 0;
    for (const m of milestones) {
      if (m.milestone === 'started_chanting' && eventContacts.has(m.contact_id) && m.happened_on <= chantCutoff) evChanting++;
    }
    const evNew = eventContacts.size;
    return {
      id: e.id,
      title: e.title,
      month: e.starts_on.slice(0, 7),
      upcoming: e.starts_on > today,
      registrations: regCount.get(e.id) ?? 0,
      newContacts: evNew,
      chanting: evChanting,
      ratePct: evNew > 0 ? Math.round((evChanting / evNew) * 100) : null,
    };
  });

  // 随喜各会 — name-sorted, never ranked, no deltas (E3 decision #5)
  const centreRows = centres
    .filter((c) => !locked || c.id === centreId)
    .map((c) => ({
      name: c.name_cn,
      newContacts: centreRoll.get(c.id)?.newContacts ?? 0,
      chanting: centreRoll.get(c.id)?.chanting ?? 0,
    }));

  // ── 关怀 page (national only) ────────────────────────────────────────────────
  let care: ReportsPack['care'] = null;
  if (!locked) {
    const convs = (convsRes.data ?? []) as { created_at: string; category: string | null; crisis_flag: boolean }[];
    let convMonth = 0;
    let convPrev = 0;
    let crisis = 0;
    const catCounts = new Map<string, number>();
    for (const cv of convs) {
      const inCur = cv.created_at >= monthStartUtc && cv.created_at < monthEndUtc;
      if (inCur) {
        convMonth++;
        if (cv.crisis_flag) crisis++;
        const label = cv.category ?? '其他';
        catCounts.set(label, (catCounts.get(label) ?? 0) + 1);
      } else {
        convPrev++;
      }
    }
    const sortedCats = [...catCounts.entries()].sort((a, b) => b[1] - a[1]);
    const top5 = sortedCats.filter(([l]) => l !== '其他').slice(0, 5);
    const fold = sortedCats.filter(([l]) => l !== '其他').slice(5).reduce((s, [, v]) => s + v, 0) + (catCounts.get('其他') ?? 0);
    care = {
      conversations: convMonth,
      conversationsPrev: convPrev,
      conversationsDelta: delta(convMonth, convPrev, true),
      crisis,
      chatNewContacts: chatNew,
      chatNewContactsPrev: chatNewPrev,
      chatNewContactsDelta: delta(chatNew, chatNewPrev, false),
      categories: [
        ...top5.map(([label, value]) => ({ label, value, folded: false })),
        ...(fold > 0 ? [{ label: '其他类', value: fold, folded: true }] : []),
      ],
    };
  }

  // ── 运营·财务 page (national only; reuses the finance coverage logic) ────────
  let ops: ReportsPack['ops'] = null;
  if (!locked) {
    const members = (membersRes.data ?? []) as { id: string; gyt_centre_id: string | null; fee_pledge_amount: number | null; fee_waived_from: string | null }[];
    const pays = (paysRes.data ?? []) as { centre_id: string; member_id: string; amount: number; paid_at: string; months_to: string }[];
    const expenses = (expensesRes.data ?? []) as { centre_id: string; amount: number; spent_at: string }[];
    const regPays = (regPaysRes.data ?? []) as { paid_amount: number | null; payment_verified_at: string }[];

    // coverage — same rule as finance/stats: of pledged (active, pledge set, not
    // waived), paid = max non-void coverage months_to >= month start
    const maxTo = new Map<string, string>();
    for (const p of pays) {
      const cur = maxTo.get(p.member_id);
      if (!cur || p.months_to > cur) maxTo.set(p.member_id, p.months_to);
    }
    let pledged = 0;
    let paid = 0;
    const centreCov = new Map<string, { pledged: number; paid: number }>();
    for (const m of members) {
      if (m.fee_pledge_amount == null || m.fee_waived_from != null) continue;
      pledged++;
      const covered = (maxTo.get(m.id) ?? '') >= monthStart;
      if (covered) paid++;
      if (m.gyt_centre_id) {
        const c = centreCov.get(m.gyt_centre_id) ?? { pledged: 0, paid: 0 };
        c.pledged++;
        if (covered) c.paid++;
        centreCov.set(m.gyt_centre_id, c);
      }
    }

    const incomeByMonth = new Map<string, number>();
    const expenseByMonth = new Map<string, number>();
    for (const p of pays) {
      if (p.paid_at >= trendStart && p.paid_at < monthEnd) {
        const ym = p.paid_at.slice(0, 7);
        incomeByMonth.set(ym, (incomeByMonth.get(ym) ?? 0) + Number(p.amount));
      }
    }
    for (const rp of regPays) {
      // MYT month of the verification instant (shared helper)
      const ym = mytMonthOf(rp.payment_verified_at);
      incomeByMonth.set(ym, (incomeByMonth.get(ym) ?? 0) + Number(rp.paid_amount ?? 0));
    }
    for (const e of expenses) {
      const ym = e.spent_at.slice(0, 7);
      expenseByMonth.set(ym, (expenseByMonth.get(ym) ?? 0) + Number(e.amount));
    }
    const income = incomeByMonth.get(month) ?? 0;
    const expensesMonth = expenseByMonth.get(month) ?? 0;

    ops = {
      activeMembers: members.length,
      coverage: { paid, pledged, pct: pledged > 0 ? (paid / pledged) * 100 : 0 },
      income,
      expenses: expensesMonth,
      surplus: income - expensesMonth,
      sixMonth: {
        months: trendMonths,
        income: trendMonths.map((tm) => incomeByMonth.get(tm) ?? 0),
        expenses: trendMonths.map((tm) => expenseByMonth.get(tm) ?? 0),
      },
      centreCoverage: centres
        .map((c) => {
          const cc = centreCov.get(c.id);
          return cc && cc.pledged > 0
            ? { name: c.name_cn, paid: cc.paid, pledged: cc.pledged, pct: (cc.paid / cc.pledged) * 100 }
            : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    };
  }

  // ── 活动·库存 page ───────────────────────────────────────────────────────────
  const openEvents = events.filter((e) => (e.status === 'open' || e.status === 'full') && e.capacity != null && e.capacity > 0);
  const capacityRows = openEvents.map((e) => ({
    title: e.title,
    registrations: pendingRegCount.get(e.id) ?? 0,
    capacity: e.capacity as number,
  }));

  const hqId = (hqRes.data?.id as string | undefined) ?? null;
  const items = (itemsRes.data ?? []) as { id: string; name_cn: string; low_stock_line: number | null }[];
  const hqQty = new Map<string, number>();
  if (hqId) {
    const { data: bal, error: balErr } = await db
      .from('inventory_balances')
      .select('item_id, qty')
      .eq('location_id', hqId)
      .limit(20000);
    if (balErr) console.error('[reports-pack] balances read failed:', balErr);
    for (const b of (bal ?? []) as { item_id: string; qty: number }[]) hqQty.set(b.item_id, b.qty);
  }
  const lowStock = items
    .filter((i) => i.low_stock_line != null)
    .map((i) => ({ name: i.name_cn, qty: hqQty.get(i.id) ?? 0, line: i.low_stock_line as number }))
    .filter((r) => r.qty <= r.line)
    .sort((a, b) => a.qty / Math.max(1, a.line) - b.qty / Math.max(1, b.line));

  let stocktakeDiff = 0;
  const stIds = ((stocktakesRes.data ?? []) as { id: string }[]).map((s) => s.id);
  if (stIds.length) {
    const { data: lines, error: lErr } = await db
      .from('inventory_stocktake_lines')
      .select('stocktake_id, system_qty, counted_qty')
      .in('stocktake_id', stIds);
    if (lErr) console.error('[reports-pack] stocktake lines read failed:', lErr);
    for (const l of (lines ?? []) as { system_qty: number; counted_qty: number | null }[]) {
      if (l.counted_qty !== null && l.counted_qty !== l.system_qty) stocktakeDiff++;
    }
  }
  const releasePhotos = ((movesRes.data ?? []) as { request_id: string | null }[]).filter((m) => m.request_id != null).length;

  // ── 收件箱健康 page (reuses /api/inbox/health shape) ─────────────────────────
  // Locked slice = own mailbox ONLY; a locked account with no centre bound gets
  // an EMPTY board (fail-closed), never the national one.
  let mbs: Record<string, unknown>[] = [];
  if (!locked || centreId) {
    let mbQuery = db
      .from('inbox_mailboxes')
      .select('id, centre_id, centre:centres!centre_id ( name_cn, sort )');
    mbQuery = locked && centreId ? mbQuery.eq('centre_id', centreId) : mbQuery.eq('is_enabled', true);
    const { data, error: mbErr } = await mbQuery;
    if (mbErr) console.error('[reports-pack] mailboxes read failed (empty board):', mbErr);
    mbs = data ?? [];
  }
  const mailboxes = mbs as unknown as { id: string; centre_id: string; centre: { name_cn: string; sort: number } | { name_cn: string; sort: number }[] | null }[];
  const mbIds = mailboxes.map((m) => m.id);
  const [counts, owners, esc] = await Promise.all([
    countsByMailbox(db, mbIds),
    ownersByMailbox(db, mbIds),
    loadEscalation(db),
  ]);
  const nowMs = Date.now();
  const board = mailboxes
    .map((m) => {
      const c = counts.get(m.id) ?? { new_n: 0, in_progress_n: 0, crisis_n: 0, oldest_unhandled_iso: null };
      const cj = Array.isArray(m.centre) ? m.centre[0] : m.centre;
      return {
        centre_name: (cj?.name_cn as string) ?? '—',
        centre_sort: (cj?.sort as number) ?? 0,
        owners_label: (owners.get(m.id) ?? []).map((o) => o.name).join('、') || '未指派',
        new_n: c.new_n,
        oldest_unhandled_days: c.oldest_unhandled_iso ? ageDays(c.oldest_unhandled_iso, nowMs) : 0,
        crisis_n: c.crisis_n,
      };
    })
    .sort((a, b) => b.new_n - a.new_n || b.oldest_unhandled_days - a.oldest_unhandled_days || a.centre_sort - b.centre_sort)
    .map(({ centre_sort: _sort, ...rest }) => rest);

  let avgFirstResponseDays: number | null = null;
  const surfaced: { subject: string; age_days: number }[] = [];
  if (mbIds.length) {
    // 30d 平均首次回复 window anchors on the MYT calendar date, not the UTC one
    // (fix brief rule 4): midnight MYT thirty days before MYT-today.
    const since30Utc = new Date(`${ymdAddDays(mytToday(), -30)}T00:00:00+08:00`).toISOString();
    const { data: th, error: thErr } = await db
      .from('inbox_threads')
      .select('subject, status, created_at, first_response_at, last_message_at')
      .in('mailbox_id', mbIds);
    if (thErr) console.error('[reports-pack] inbox threads read failed:', thErr);
    let sum = 0;
    let n = 0;
    for (const t of (th ?? []) as { subject: string; status: string; created_at: string; first_response_at: string | null; last_message_at: string }[]) {
      if (t.created_at >= since30Utc && t.first_response_at) {
        sum += (new Date(t.first_response_at).getTime() - new Date(t.created_at).getTime()) / (24 * 60 * 60 * 1000);
        n++;
      }
      const age = ageDays(t.last_message_at, nowMs);
      if (overdueLevel(t.status, age, esc) === 'surface') surfaced.push({ subject: t.subject, age_days: age });
    }
    avgFirstResponseDays = n > 0 ? Math.round((sum / n) * 10) / 10 : null;
    surfaced.sort((a, b) => b.age_days - a.age_days);
  }

  return {
    month,
    months,
    windowDays,
    scope: { locked, centreId, centreName },
    pages: locked ? ['outreach', 'eventsInv', 'inbox'] : ['outreach', 'care', 'ops', 'eventsInv', 'inbox'],
    outreach: {
      newContacts,
      newContactsPrev: newPrev,
      newContactsDelta: delta(newContacts, newPrev, true),
      chanting,
      chantingPrev,
      chantingDelta: delta(chanting, chantingPrev, false),
      volunteersWindow,
      trend: { months: trendMonths.map((tm) => `${Number(tm.slice(5))}月`), newContacts: trendNew, chanting: trendChant },
      sources,
      funnel: MILESTONES.map((m) => ({ key: m.key, label: m.label, value: funnelCounts.get(m.key) ?? 0 })),
      events: eventRows,
      centres: centreRows,
    },
    care,
    ops,
    eventsInv: { capacity: capacityRows, lowStock, stocktakeDiff, releasePhotos },
    inbox: { board, avgFirstResponseDays, surfaceDays: esc.surface_hq_days, surfaced: surfaced.slice(0, 10) },
  };
}

// ── CSV flattening (quiet link in the UI) ─────────────────────────────────────
// Security audit M7: a leading = + - @ or tab/CR makes Excel execute the cell as a
// formula (=HYPERLINK exfiltration via attacker-reachable values like the public /m
// form's subject). Prefix a single quote so Excel renders it as text.
function csvEscape(v: string | number): string {
  let s = String(v);
  // Only strings can carry attacker text; a negative NUMBER must stay a number.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function packPageToCsv(pack: ReportsPack, page: string): string {
  const rows: (string | number)[][] = [];
  if (page === 'care' && pack.care) {
    rows.push(['指标', '数值']);
    rows.push(['对话量', pack.care.conversations], ['危机', pack.care.crisis], ['经聊天新结缘', pack.care.chatNewContacts]);
    rows.push([]);
    rows.push(['问题分类', '数量']);
    for (const c of pack.care.categories) rows.push([c.label, c.value]);
  } else if (page === 'ops' && pack.ops) {
    rows.push(['指标', '数值']);
    rows.push(
      ['活跃会员', pack.ops.activeMembers],
      ['收缴率%', Math.round(pack.ops.coverage.pct)],
      ['收入', pack.ops.income],
      ['支出', pack.ops.expenses],
      ['结余', pack.ops.surplus]
    );
    rows.push([]);
    rows.push(['月份', '收入', '支出']);
    pack.ops.sixMonth.months.forEach((m, i) => rows.push([m, pack.ops!.sixMonth.income[i], pack.ops!.sixMonth.expenses[i]]));
    rows.push([]);
    rows.push(['共修会', '已缴', '认捐', '收缴率%']);
    for (const c of pack.ops.centreCoverage) rows.push([c.name, c.paid, c.pledged, Math.round(c.pct)]);
  } else if (page === 'eventsInv') {
    rows.push(['活动', '报名', '名额']);
    for (const e of pack.eventsInv.capacity) rows.push([e.title, e.registrations, e.capacity]);
    rows.push([]);
    rows.push(['低库存品项', '当前', '警戒线']);
    for (const i of pack.eventsInv.lowStock) rows.push([i.name, i.qty, i.line]);
    rows.push([]);
    rows.push(['盘点差异', pack.eventsInv.stocktakeDiff], ['放行拍照', pack.eventsInv.releasePhotos]);
  } else if (page === 'inbox') {
    rows.push(['信箱', '负责人', '未处理', '最旧天数', '危机']);
    for (const b of pack.inbox.board) rows.push([b.centre_name, b.owners_label, b.new_n, b.oldest_unhandled_days, b.crisis_n]);
    rows.push([]);
    rows.push(['平均首次回复天数', pack.inbox.avgFirstResponseDays ?? '']);
  } else {
    // default: 渡人
    rows.push(['指标', '数值']);
    rows.push(
      ['本月新结缘', pack.outreach.newContacts],
      ['本月开始念经', pack.outreach.chanting],
      [`发心义工（近${pack.windowDays}天）`, pack.outreach.volunteersWindow]
    );
    rows.push([]);
    rows.push(['月份', '新结缘', '开始念经']);
    pack.outreach.trend.months.forEach((m, i) =>
      rows.push([m, pack.outreach.trend.newContacts[i], pack.outreach.trend.chanting[i]])
    );
    rows.push([]);
    rows.push(['来源', '人数']);
    for (const s of pack.outreach.sources) rows.push([s.label, s.value]);
    rows.push([]);
    rows.push(['阶段', '人数']);
    for (const f of pack.outreach.funnel) rows.push([f.label, f.value]);
    rows.push([]);
    rows.push(['活动', '月份', '报名', '新结缘', '开始念经', '转化%']);
    for (const e of pack.outreach.events) rows.push([e.title, e.month, e.registrations, e.newContacts, e.chanting, e.ratePct ?? '']);
    rows.push([]);
    rows.push(['共修会', '新结缘', '开始念经']);
    for (const c of pack.outreach.centres) rows.push([c.name, c.newContacts, c.chanting]);
  }
  // UTF-8 BOM so Excel opens the Chinese headers correctly.
  return '﻿' + rows.map((r) => r.map(csvEscape).join(',')).join('\n');
}
