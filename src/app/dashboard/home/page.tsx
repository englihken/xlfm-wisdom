// src/app/dashboard/home/page.tsx
// The platform hub — a "My Day" (今日概览页), NOT a module launcher (the rail is the
// launcher now, so there is deliberately no grid of module tiles). Renders ONLY for
// multi-door accounts; single-door accounts are bounced into their module. View-only
// glue — no mutations. Every block is strictly grant-gated: a block appears only when
// its data is present in the response, which the server returns only for held grants
// (an absent grant means the block is never rendered — never greyed).

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient, signOutEverywhere } from '@/lib/supabase-browser';
import { PasswordChangeGate } from '@/components/password-change-gate';
import { DashboardNav } from '@/components/dashboard-nav';
import { TopBar } from '@/components/top-bar';
import { visibleModules, grantAllows, type Grants } from '@/lib/access';
import { useT } from '@/lib/i18n-react';
import type { TFunc } from '@/lib/i18n';

type Me = {
  email: string;
  displayName: string | null;
  role: 'admin' | 'volunteer' | 'erp_admin' | 'committee' | 'centre_head';
  grants: Grants;
};
// The summary API returns STABLE KEYS (+params) for every label — the page renders
// them with t() so the whole cockpit re-translates instantly on a locale switch.
type L10n = { key: string; params?: Record<string, string | number> };
type Tile = { key: string; labelKey: string; value: number; sub?: L10n; href: string };
type InboxCard =
  | { mode: 'health'; health: { mailbox_id: string; centre_name: string; new_n: number; oldest_unhandled_days: number; owners_label: string | null }[]; surfaced: { id: string; subject: string; age_days: number }[] }
  | { mode: 'owner'; threads: { id: string; subject: string; sender_name: string | null; age_days: number; centre_name: string }[] }
  | null;
type HomeData = {
  tiles: Tile[];
  crisis: { allowed: boolean; count: number } | null;
  inboxCard: InboxCard;
  myTasks: {
    id: string; kind: string; href: string; chipKey: string; sub: L10n;
    label?: string; careName?: string | null; careCategory?: string | null;
  }[];
  outreachMonth: { new_contacts: number; started_chanting: number } | null;
  recentMembers: { id: string; name: string | null; centreCode: string | null; updatedAt: string }[] | null;
  recentAudit: { id: number; actor: string | null; actionKey: string | null; actionRaw: string; ref: string; at: string }[] | null;
};

function todayMYT(): string {
  return new Date().toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
}
function relTime(iso: string, t: TFunc): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return t('home.rel.justNow');
  if (m < 60) return t('home.rel.minutesAgo', { m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('home.rel.hoursAgo', { h });
  const d = Math.floor(h / 24);
  if (d < 30) return t('home.rel.daysAgo', { d });
  return new Date(iso).toLocaleDateString('zh-CN', { timeZone: 'Asia/Kuala_Lumpur', month: '2-digit', day: '2-digit' });
}

export default function HubPage() {
  const t = useT();
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [gate, setGate] = useState<'checking' | 'ok'>('checking');
  const [data, setData] = useState<HomeData | null>(null);

  const forceSignOut = useCallback(async () => {
    await signOutEverywhere();
    router.replace('/dashboard/login');
  }, [router]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(({ data: authData, error }) => {
      if (error || !authData.user) {
        router.replace('/dashboard/login');
        return;
      }
      setChecking(false);
    });
  }, [router]);

  useEffect(() => {
    if (checking) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/dashboard/me');
        if (!active) return;
        if (res.status === 401) {
          router.replace('/dashboard/login');
          return;
        }
        if (res.status === 403) {
          await forceSignOut();
          return;
        }
        if (!res.ok) return;
        const json = await res.json();
        if (!active) return;
        const grants: Grants = json.grants ?? {};
        const mods = visibleModules({ role: json.role, grants });
        // The hub never renders for single-door accounts — bounce into the module.
        if (mods.length <= 1) {
          // Single-door bounce: send the caller straight into their one module.
          const DOOR_HREF: Record<string, string> = {
            inbox: '/dashboard',
            mail: '/dashboard/inbox',
            outreach: '/dashboard/outreach',
            members: '/dashboard/members',
            events: '/dashboard/events',
            inventory: '/dashboard/inventory',
            finance: '/dashboard/finance',
            reports: '/dashboard/reports',
            settings: '/dashboard/settings',
          };
          router.replace(DOOR_HREF[mods[0]] ?? '/dashboard');
          return;
        }
        setMe({ email: json.email, displayName: json.displayName ?? null, role: json.role, grants });
        if (json.mustChangePassword) setMustChangePassword(true);
        setGate('ok');
      } catch {
        /* neutral loader covers a failure */
      }
    })();
    return () => {
      active = false;
    };
  }, [checking, router, forceSignOut]);

  useEffect(() => {
    if (gate !== 'ok') return;
    let active = true;
    fetch('/api/home/summary')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active && j) setData(j as HomeData);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [gate]);

  const handleLogout = async () => {
    await forceSignOut();
    router.refresh();
  };

  if (checking || gate === 'checking') {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <p className="text-sm text-ink-muted">{t('cockpit.loading')}</p>
      </div>
    );
  }
  if (mustChangePassword) {
    return <PasswordChangeGate onDone={() => setMustChangePassword(false)} />;
  }
  if (!me) return null;

  const tiles = data?.tiles ?? [];
  const crisis = data?.crisis;
  const inboxCard = data?.inboxCard;

  return (
    <div className="min-h-screen flex flex-col bg-bg md:ml-[72px]">
      {/* TOP BAR — platform brand only (hub has no module title) */}
      <TopBar userLabel={me.displayName || me.email} onLogout={handleLogout} />

      <DashboardNav role={me.role} active="home" grants={me.grants} />

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-6">
          {/* 1. greeting */}
          <div>
            <h2 className="font-serif text-2xl font-bold text-ink">{t('cockpit.greeting', { name: me.displayName || t('cockpit.defaultName') })}</h2>
            <p className="mt-1 text-sm text-ink-muted">{todayMYT()}</p>
          </div>

          {/* 2. 今日概览 tiles */}
          {tiles.length > 0 && (
            <div>
              <p className="u-label mb-2">{t('cockpit.todayOverview')}</p>
              <div className="flex flex-wrap gap-3">
                {tiles.slice(0, 4).map((tile) => (
                  <Link key={tile.key} href={tile.href}>
                    <Stat label={t(tile.labelKey)} value={tile.value} sub={tile.sub ? t(tile.sub.key, tile.sub.params) : undefined} accent={tile.value > 0 && tile.key === 'inbox'} />
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* 3. crisis strip */}
          {crisis?.allowed && crisis.count > 0 && (
            <Link href="/dashboard/inbox" className="block rounded-xl px-4 py-3 bg-[#FCEBEA] border border-[#E5C4BF] text-[#B4402E] text-sm font-medium hover:bg-[#FBDEDA]">
              {t('cockpit.crisis', { count: crisis.count })}
            </Link>
          )}

          {/* 4. two columns: 收件箱 + 我的事项 */}
          <div className="grid gap-6 md:grid-cols-2">
            {inboxCard && (
              <Card title={t('cockpit.card.inbox')} en="Mail">
                {inboxCard.mode === 'health' ? (
                  <div className="space-y-3">
                    {inboxCard.health.length === 0 ? (
                      <p className="text-sm text-ink-muted">{t('cockpit.inbox.noMailboxes')}</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead><tr className="text-left text-[11px] text-ink-faint border-b border-border"><th className="py-1 font-normal">{t('cockpit.inbox.colMailbox')}</th><th className="py-1 font-normal">{t('cockpit.inbox.colUnhandled')}</th><th className="py-1 font-normal">{t('cockpit.inbox.colOldest')}</th><th className="py-1 font-normal">{t('cockpit.inbox.colOwners')}</th></tr></thead>
                        <tbody>
                          {inboxCard.health.map((h) => (
                            <tr key={h.mailbox_id} className="border-b border-border last:border-b-0">
                              <td className="py-1.5 text-ink">{h.centre_name}</td>
                              <td className="py-1.5 text-ink">{h.new_n}</td>
                              <td className="py-1.5 text-ink-muted">{t('cockpit.days', { n: h.oldest_unhandled_days })}</td>
                              <td className="py-1.5 text-ink-faint truncate max-w-[90px]">{h.owners_label ?? t('common.unassigned')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {inboxCard.surfaced.length > 0 && (
                      <div className="pt-2 border-t border-border">
                        <p className="text-[11px] text-[#B4402E] mb-1">{t('cockpit.inbox.overEscalation')}</p>
                        <ul className="space-y-0.5">
                          {inboxCard.surfaced.map((s) => <li key={s.id} className="text-[12px] text-ink-muted truncate">· {s.subject} — {t('cockpit.days', { n: s.age_days })}</li>)}
                        </ul>
                      </div>
                    )}
                    <Link href="/dashboard/inbox" className="inline-block text-xs text-accent-deep hover:underline">{t('cockpit.openInbox')}</Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {inboxCard.threads.length === 0 ? (
                      <p className="text-sm text-ink-muted">{t('cockpit.inbox.noThreads')}</p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {inboxCard.threads.map((th) => (
                          <li key={th.id}>
                            <Link href={`/dashboard/inbox?thread=${th.id}`} className="block py-2 hover:bg-accent/5 -mx-2 px-2 rounded-lg">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm text-ink truncate">{th.subject}</span>
                                <span className="shrink-0 text-[11px] text-[#B4402E]">{t('cockpit.days', { n: th.age_days })}</span>
                              </div>
                              <p className="text-[12px] text-ink-faint truncate">{th.sender_name ?? t('cockpit.anonymous')} · {th.centre_name}</p>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                    <Link href="/dashboard/inbox" className="inline-block text-xs text-accent-deep hover:underline">{t('cockpit.openInbox')}</Link>
                  </div>
                )}
              </Card>
            )}

            <Card title={t('cockpit.card.myTasks')} en="My tasks">
              {!data?.myTasks || data.myTasks.length === 0 ? (
                <p className="text-sm text-ink-muted">{t('cockpit.tasks.empty')}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.myTasks.map((task) => {
                    // care tasks compose name·category client-side so the anonymous
                    // fallback localizes; other kinds carry a raw data label.
                    const label =
                      task.kind === 'care'
                        ? `${task.careName ?? t('home.task.anonVisitor')}${task.careCategory ? ` · ${task.careCategory}` : ''}`
                        : task.label;
                    return (
                      <li key={`${task.kind}-${task.id}`}>
                        <Link href={task.href} className="block py-2.5 hover:bg-accent/5 -mx-2 px-2 rounded-lg transition">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm text-ink truncate">{label}</span>
                            <span className="shrink-0 pill-gold inline-block px-2 py-0.5 rounded-full text-[10px]">{t(task.chipKey)}</span>
                          </div>
                          <p className="text-[12px] text-ink-faint truncate">{t(task.sub.key, task.sub.params)}</p>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          {/* 5. row: 渡人本月 · 最近会员动态 · 系统动态(admin) */}
          <div className="grid gap-6 md:grid-cols-3">
            {data?.outreachMonth && (
              <Card title={t('cockpit.card.outreachMonth')} en="Outreach">
                <div className="flex gap-4">
                  <div><div className="text-2xl font-bold text-ink">{data.outreachMonth.new_contacts}</div><div className="text-[11px] text-ink-faint">{t('cockpit.outreach.newContacts')}</div></div>
                  <div><div className="text-2xl font-bold text-ink">{data.outreachMonth.started_chanting}</div><div className="text-[11px] text-ink-faint">{t('cockpit.outreach.startedChanting')}</div></div>
                </div>
                <Link href="/dashboard/outreach" className="mt-2 inline-block text-xs text-accent-deep hover:underline">{t('cockpit.outreach.go')}</Link>
              </Card>
            )}

            {data?.recentMembers && (
              <Card title={t('cockpit.card.recentMembers')} en="Members">
                {data.recentMembers.length === 0 ? (
                  <p className="text-sm text-ink-muted">{t('cockpit.members.empty')}</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {data.recentMembers.map((m) => (
                      <li key={m.id}>
                        <Link href={`/dashboard/members/${m.id}`} className="flex items-center justify-between gap-2 py-2 hover:bg-accent/5 -mx-2 px-2 rounded-lg transition">
                          <span className="font-medium text-ink truncate">{m.name ?? t('home.member.unnamed')}</span>
                          <span className="shrink-0 text-xs text-ink-faint">{relTime(m.updatedAt, t)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}

            {data?.recentAudit && (
              <Card title={t('cockpit.card.activity')} en="Activity">
                {data.recentAudit.length === 0 ? (
                  <p className="text-sm text-ink-muted">{t('cockpit.activity.empty')}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {data.recentAudit.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-3 text-[13px]">
                        <span className="text-ink truncate">
                          {`${a.actor ?? t('home.audit.system')} ${a.actionKey ? t(a.actionKey) : a.actionRaw}${a.ref}`}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-faint">{relTime(a.at, t)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
          </div>

          {/* quick actions */}
          <div className="flex flex-wrap gap-2">
            {grantAllows(me.grants, 'care', 'view') && <QuickLink href="/dashboard" label={t('cockpit.quick.wisdom')} />}
            {grantAllows(me.grants, 'inbox', 'summary') && <QuickLink href="/dashboard/inbox" label={t('cockpit.quick.inbox')} />}
            {grantAllows(me.grants, 'outreach', 'view') && <QuickLink href="/dashboard/outreach" label={t('cockpit.quick.outreachList')} />}
            {grantAllows(me.grants, 'members', 'view') && <QuickLink href="/dashboard/members" label={t('cockpit.quick.members')} />}
          </div>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: number; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl px-4 py-3 min-w-[120px] border transition hover:border-accent ${accent ? 'bg-accent/10 border-gold-border' : 'bg-surface-soft border-border'}`}>
      <div className={`text-3xl font-bold ${accent ? 'text-accent-deep' : 'text-ink'}`}>{value}</div>
      <div className="text-xs text-ink-muted mt-0.5">{label}</div>
      {sub && <div className="text-[10.5px] text-ink-faint mt-0.5">{sub}</div>}
    </div>
  );
}
function Card({ title, en, children }: { title: string; en: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-border rounded-2xl p-5">
      <h3 className="text-base font-semibold text-ink mb-3">
        {title} <span className="text-xs font-normal text-ink-faint">{en}</span>
      </h3>
      {children}
    </section>
  );
}
function QuickLink({ href, label, primary }: { href: string; label: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={`px-4 py-2 text-sm ${primary ? 'btn-primary' : 'btn-secondary'}`}
    >
      {label}
    </Link>
  );
}
