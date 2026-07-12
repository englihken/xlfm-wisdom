// src/app/dashboard/members/page.tsx
// 会员 list — search + filters + server-paginated table. members:view to see;
// members:edit to reveal 新增会员. Empty state points to A5 import or 新增.

'use client';

import { PAGE_WIDE } from '@/lib/layout';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';
import { useT } from '@/lib/i18n-react';

type Row = {
  id: string;
  name_cn: string | null;
  name_en: string | null;
  phone: string | null;
  disciple: boolean | null;
  full_veg: boolean | null;
  member_type: string;
  status: string;
  centre: { code: string; name_cn: string } | null;
  teams: { name_cn: string; role: string }[];
};
type Meta = { centres: { id: string; code: string; name_cn: string; name_en: string }[]; teams: { id: string; name_cn: string; slug: string }[] };

export default function MembersPage() {
  return (
    <ErpGate active="members">
      {(me) => <MembersList me={me} />}
    </ErpGate>
  );
}

function MembersList({ me }: { me: ErpMe }) {
  const t = useT();
  const canEdit = grantAllows(me.grants, 'members', 'edit');

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [centre, setCentre] = useState('');
  const [team, setTeam] = useState('');
  const [disciple, setDisciple] = useState('');
  const [fullVeg, setFullVeg] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);

  const [meta, setMeta] = useState<Meta>({ centres: [], teams: [] });
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Debounce the search box into `search` (and reset to page 1).
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Load dropdown reference data once.
  useEffect(() => {
    let active = true;
    fetch('/api/dashboard/erp/meta')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active && j) setMeta(j);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Load the page whenever a filter/page changes.
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ page: String(page), limit: '25', status });
    if (search) params.set('search', search);
    if (centre) params.set('centre', centre);
    if (team) params.set('team', team);
    if (disciple) params.set('disciple', disciple);
    if (fullVeg) params.set('full_veg', fullVeg);
    fetch(`/api/dashboard/members?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!active || !j) return;
        setRows(j.members ?? []);
        setTotal(j.total ?? 0);
        setTotalPages(j.totalPages ?? 1);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [search, centre, team, disciple, fullVeg, status, page]);

  const onFilter = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <div className={`${PAGE_WIDE} space-y-5`}>
      {/* header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xl font-bold font-serif text-ink">{t('members.title')}</h2>
          <span className="text-sm text-ink-faint">{t('members.subtitle', { n: total })}</span>
        </div>
        {canEdit && (
          <Link
            href="/dashboard/members/new"
            className="btn-primary px-4 py-1.5 text-sm transition"
          >
            {t('members.addMember')}
          </Link>
        )}
      </div>

      {/* search + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t('members.searchPlaceholder')}
          className="text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent w-56"
        />
        <FilterSel value={centre} onChange={(x) => onFilter(() => setCentre(x))}
          options={[['', t('members.filter.allCentres')], ...meta.centres.map((c) => [c.id, c.name_cn] as [string, string])]} />
        <FilterSel value={team} onChange={(x) => onFilter(() => setTeam(x))}
          options={[['', t('members.filter.allTeams')], ...meta.teams.map((tm) => [tm.id, tm.name_cn] as [string, string])]} />
        <FilterSel value={disciple} onChange={(x) => onFilter(() => setDisciple(x))}
          options={[['', t('members.filter.discipleAll')], ['true', t('members.filter.discipleYes')], ['false', t('members.filter.discipleNo')]]} />
        <FilterSel value={fullVeg} onChange={(x) => onFilter(() => setFullVeg(x))}
          options={[['', t('members.filter.vegAll')], ['true', t('members.filter.vegYes')], ['false', t('members.filter.vegNo')]]} />
        <FilterSel value={status} onChange={(x) => onFilter(() => setStatus(x))}
          options={[['active', t('members.statusActive')], ['inactive', t('members.statusInactive')], ['all', t('members.filter.statusAll')]]} />
      </div>

      {/* table */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-ink-muted">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-2xl mb-1">🪷</p>
            <p className="text-sm text-ink">{t('members.empty.title')}</p>
            <p className="mt-1 text-xs text-ink-muted">
              {t('members.empty.hint')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-ink-faint border-b border-border">
                  <Th>{t('members.col.name')}</Th><Th>{t('members.col.centre')}</Th><Th>{t('members.col.teams')}</Th><Th>{t('members.col.discipleVeg')}</Th><Th>{t('members.col.phone')}</Th><Th>{t('members.col.status')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border last:border-b-0 hover:bg-accent/5">
                    <td className="px-4 py-2.5">
                      <Link href={`/dashboard/members/${r.id}`} className="font-medium text-ink hover:text-accent-deep">
                        {r.name_cn || r.name_en || t('members.noName')}
                      </Link>
                      {r.name_cn && r.name_en && <div className="text-xs text-ink-muted">{r.name_en}</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.centre ? (
                        <span className="pill-gold inline-block px-2 py-0.5 rounded-full text-[11px]" title={r.centre.name_cn}>
                          {r.centre.code}
                        </span>
                      ) : <span className="text-ink-faint">–</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {r.teams.map((tm, i) => (
                          <span key={i} className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${
                            tm.role === 'lead' ? 'pill-gold font-medium' : 'pill-muted'
                          }`}>
                            {tm.name_cn}{tm.role === 'lead' ? t('members.leadSuffix') : ''}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1">
                        {r.disciple === true && <Badge>{t('members.disciple')}</Badge>}
                        {r.full_veg === true && <Badge>{t('members.fullVeg')}</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-ink">{r.phone || '–'}</td>
                    <td className="px-4 py-2.5">
                      {r.status === 'active'
                        ? <span className="text-[11px] text-ink-muted">{t('members.statusActive')}</span>
                        : <span className="text-[11px] text-red-700">{t('members.statusInactive')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* pagination */}
      {!loading && rows.length > 0 && (
        <div className="flex items-center justify-end gap-3 text-sm text-ink-muted">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1 rounded-full border border-border hover:bg-accent/5 disabled:opacity-40"
          >‹</button>
          <span>{t('members.pageInfo', { page, totalPages, total })}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1 rounded-full border border-border hover:bg-accent/5 disabled:opacity-40"
          >›</button>
        </div>
      )}
    </div>
  );
}

function FilterSel({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent"
    >
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2 font-medium">{children}</th>;
}
function Badge({ children }: { children: React.ReactNode }) {
  return <span className="pill-gold inline-block px-2 py-0.5 rounded-full text-[11px]">{children}</span>;
}
