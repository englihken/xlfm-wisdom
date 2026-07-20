// src/lib/event-payments.ts
// Shared vocabulary + money helpers for 活动收款 (event payment collection, Phase 1).
// Pure module — no IO, safe for client components and server routes alike.
//
// THE MONEY RULE. Three columns hold money in three different units:
//   registrations.paid_amount / fee_total   numeric RM (2dp)
//   event_cash_closes.*_cents               bigint CENTS
//   finance_transactions.amount             numeric RM (2dp)
// Every crossing goes through toCents / fromCents below and nothing else. All
// summation happens in cents; RM only ever appears at the two edges (what the DB
// stores for a registration, and what the ledger stores for a posting).
//
// THE TWO WALLS (分会对人，总会对钱):
//   • branch  — a locked finance user may only touch registrations belonging to
//     THEIR centre (member.gyt_centre_id). Registrations with no member have no
//     centre and belong to the HQ bucket.
//   • HQ      — 对账 / 日结 / 入账 are HQ-only. `isHqFinance` is the gate.

import type { FinanceScope } from './finance';
import { resolveStay } from './stay';

// ── money ────────────────────────────────────────────────────────────────────
// Round HALF-UP at the cent, once, at the boundary. Every downstream sum is
// integer arithmetic, so a total can never drift from the rows that made it.
export function toCents(rm: unknown): number {
  const n = Number(rm);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}
export function sumCents(values: Iterable<unknown>): number {
  let c = 0;
  for (const v of values) c += toCents(v);
  return c;
}

// MYT calendar date of a timestamptz — the desk's day, not UTC's. A close taken
// at 9pm MYT must bucket into that day, which UTC still calls yesterday.
export function mytDateOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}

// ── payment status vocabulary ────────────────────────────────────────────────
export const PAYMENT_STATUSES = ['unpaid', 'proof_submitted', 'verified', 'waived', 'reconciled'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_METHODS = ['transfer', 'cash'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// Money has arrived and been acknowledged — a fee assignment must not disturb it.
export const SETTLED_STATUSES: readonly string[] = ['proof_submitted', 'verified', 'reconciled'];
// Terminal: HQ has matched it against the bank statement. Nothing reopens it here.
export const RECONCILED: PaymentStatus = 'reconciled';

export function isSettled(status: string | null | undefined): boolean {
  return SETTLED_STATUSES.includes(status ?? '');
}

// ── walls ────────────────────────────────────────────────────────────────────
// HQ finance = an unlocked finance scope (admin / erp_admin / finance_director,
// or an explicit all_centers grant). 分会财政 is always locked to one centre.
export function isHqFinance(scope: FinanceScope): boolean {
  return !scope.locked;
}

// The centre that owns a registration for collection purposes. A registration
// with no member (public newcomer) has no centre and is HQ's to chase.
export function owningCentreId(memberCentreId: string | null | undefined): string | null {
  return memberCentreId ?? null;
}

// May this finance caller act on a registration owned by `regCentreId`?
// HQ: always. Branch: only their own centre — and never the HQ (null) bucket.
export function mayActOnRegistration(scope: FinanceScope, regCentreId: string | null): boolean {
  if (isHqFinance(scope)) return true;
  if (!scope.centreId) return false; // fail closed
  return regCentreId === scope.centreId;
}

// ── room grouping for 费用分配 ────────────────────────────────────────────────
// Pricing keys on ROOM TYPE, because that is what encodes occupancy (Twin/King =
// 2 pax, Dorm 4 = 4, Dorm 8 = 8, EB = extra bed). Per-ROOM occupancy is NOT in
// the data: `room_assign` holds block codes (R1…R18, ~28–48 people each), not
// individual room numbers, so it cannot tell us who shares with whom. It is
// surfaced as a secondary label only.
export const UNASSIGNED_ROOM_TYPE = '__none';

// Nominal occupancy per room type — display only, so the admin can see what they
// are pricing. Never used as a divisor; the admin enters the per-person amount.
export const ROOM_TYPE_PAX: Record<string, number> = {
  Twin: 2,
  King: 2,
  'Dorm 4': 4,
  'Dorm 8': 8,
};

export type RoomGroupKey = string;

// The group a registration prices into: its resolved room type, or the
// UNASSIGNED bucket when it needs accommodation but has no type recorded yet.
// Returns null when the person needs no accommodation at all — they are not
// priced by this screen.
export function roomGroupOf(selections: unknown): RoomGroupKey | null {
  const stay = resolveStay(selections);
  const type = stay.room_type;
  if (type) return type;
  // needs_accommodation true but no type → still owes something, price it in the
  // 未指定 bucket rather than silently dropping the person from the screen.
  if (stay.needs_accommodation === true) return UNASSIGNED_ROOM_TYPE;
  return null;
}

// ── the assigned breakdown line ──────────────────────────────────────────────
// One line per registration, replacing any previous assigned line for the same
// item. qty is always 1: the amount IS that person's total for the item.
export function assignedLine(item: string, label: string, amountRm: number) {
  const cents = toCents(amountRm);
  return { item, label, amount: fromCents(cents), qty: 1, subtotal: fromCents(cents), assigned: true as const };
}

// A cash close's reference string on the ledger posting — stable and greppable,
// so a treasurer can tie a finance_transactions row back to the close it came from.
export function closeReference(eventCode: string, closeDate: string): string {
  return `${eventCode}/${closeDate}`;
}
