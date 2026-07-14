// src/lib/inbox-scope.ts
// Server-side access + centre-scope wall for the 收件箱 (共修会事务信箱) routes.
// Mirrors outreach-scope.ts: the inbox routes run as service-role (bypassing RLS),
// so THIS resolver is the wall. Governance ruling (E2 brief §1):
//   - mailbox owners (inbox_mailbox_owners) get CONTENT access regardless of role;
//   - centre_head (inbox=edit, own_center) gets its own centre's mailbox as content;
//   - erp_admin/committee (inbox=summary) get HEALTH COUNTS ONLY — never content;
//   - admin (inbox=admin) sees every enabled mailbox but content on a non-owned
//     mailbox is a break-glass action (audited by the route, see §1.5);
//   - internal threads are visible to the SENDER centre too, not just the recipient.
// Cross-wall access returns a uniform 404 (never 403) — same convention as the
// E1b outreach wall — expressed by route-level predicates below, never thrown here.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccessLevel } from './access';
import type { Volunteer } from './supabase-server';

// Roles that are national for inbox scope purposes. centre_head is deliberately
// absent so it locks to its own centre. Owners are handled separately (by row).
const NATIONAL_ROLES = new Set(['admin', 'erp_admin', 'committee', 'volunteer']);

export type InboxLevel = 'admin' | 'summary' | 'edit' | 'owner-only' | 'none';

export type InboxAccess = {
  // Effective inbox capability, highest-wins across grant + ownership.
  level: InboxLevel;
  // Raw role_grants access for module='inbox' ('none' when ungranted).
  grant: AccessLevel;
  // own_center centre for a locked account (centre_head), else null.
  centreId: string | null;
  locked: boolean;
  // Mailboxes this user OWNS outright (content access, no break-glass).
  ownedMailboxIds: string[];
  // The mailbox id of the user's own centre when locked+edit (centre_head), else null.
  centreMailboxId: string | null;
};

// Resolve the caller's inbox access. `db` must be the service-role client.
// PERF: the volunteer row (scope/centre_id/role) is the one fetched once per request
// by getActiveVolunteer/requireModuleAccess — no volunteers re-read here. Pass
// `knownGrant` when the caller already loaded the role's grants (e.g. home/summary)
// to skip the role_grants read too; otherwise it is fetched IN PARALLEL with the
// ownership rows instead of serially.
export async function getInboxAccess(
  db: SupabaseClient,
  volunteer: Volunteer,
  knownGrant?: AccessLevel
): Promise<InboxAccess> {
  // 1+3. role_grants access level for inbox + owned mailboxes — independent reads,
  // one parallel round trip. Grant semantics unchanged: missing row → 'none'.
  const [grantRes, ownerRes] = await Promise.all([
    knownGrant !== undefined
      ? Promise.resolve(null)
      : db.from('role_grants').select('access').eq('role', volunteer.role).eq('module', 'inbox').maybeSingle(),
    db.from('inbox_mailbox_owners').select('mailbox_id').eq('volunteer_id', volunteer.id),
  ]);
  const grant = (knownGrant ?? ((grantRes?.data?.access as AccessLevel | undefined) ?? 'none')) as AccessLevel;
  const ownedMailboxIds = (ownerRes.data ?? []).map((r) => r.mailbox_id as string);

  // 2. centre scope (mirror outreach-scope): locked = own_center account
  const scope = volunteer.scope ?? 'own_center';
  const role = volunteer.role;
  const centreId = volunteer.centre_id ?? null;
  const national = scope === 'all_centers' || NATIONAL_ROLES.has(role);
  const locked = !national;

  // 4. own-centre mailbox id for a locked centre_head (edit)
  let centreMailboxId: string | null = null;
  if (locked && centreId) {
    const { data: mb } = await db
      .from('inbox_mailboxes')
      .select('id')
      .eq('centre_id', centreId)
      .maybeSingle();
    centreMailboxId = (mb?.id as string | undefined) ?? null;
  }

  // 5. effective level — highest capability wins
  let level: InboxLevel = 'none';
  if (grant === 'admin') level = 'admin';
  else if (grant === 'edit') level = 'edit';
  else if (grant === 'summary') level = 'summary';
  else if (ownedMailboxIds.length > 0) level = 'owner-only';
  // a summary/edit/admin user who also owns mailboxes keeps the higher grant level;
  // an owner with no grant is 'owner-only'. A summary user who owns a mailbox is a
  // real case (content via ownership) — bump so content endpoints let them in.
  if (grant === 'summary' && ownedMailboxIds.length > 0) level = 'edit';

  return { level, grant, centreId: locked ? centreId : null, locked, ownedMailboxIds, centreMailboxId };
}

// Mailboxes whose CONTENT this user may open WITHOUT break-glass:
// owned mailboxes ∪ (centre_head's own-centre mailbox). Admin's non-owned mailboxes
// are NOT here — those require the break-glass path.
export function contentMailboxIds(access: InboxAccess): string[] {
  const ids = new Set(access.ownedMailboxIds);
  if (access.level === 'edit' && access.centreMailboxId) ids.add(access.centreMailboxId);
  return [...ids];
}

// May this user open the CONTENT of a form/recipient-side thread in this mailbox
// without break-glass? (Internal sender-side visibility is handled separately.)
export function canOpenMailbox(access: InboxAccess, mailboxId: string): boolean {
  return contentMailboxIds(access).includes(mailboxId);
}

// Does this user have any content reach at all (owner/edit/admin)? summary/none do not.
export function hasContentAccess(access: InboxAccess): boolean {
  return access.level === 'admin' || access.level === 'edit' || access.level === 'owner-only';
}
