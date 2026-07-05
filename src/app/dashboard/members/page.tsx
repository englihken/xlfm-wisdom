// src/app/dashboard/members/page.tsx
// 会员 list — search + filters + server-paginated table. members:view to see;
// members:edit to reveal 新增会员. Empty state points to A5 import or 新增.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';

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
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
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
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-xl font-bold text-[#583A0F]">会员</h2>
          <span className="text-sm text-[#B89968]">Members · {total}</span>
        </div>
        {canEdit && (
          <Link
            href="/dashboard/members/new"
            className="px-4 py-1.5 text-sm text-white bg-[#D89938] rounded-full hover:bg-[#A87929] transition"
          >
            + 新增会员
          </Link>
        )}
      </div>

      {/* search + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="搜索 名字 / 电话…"
          className="text-sm px-3 py-2 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] placeholder:text-[#B89968] focus:outline-none focus:border-[#D89938] w-56"
        />
        <FilterSel value={centre} onChange={(x) => onFilter(() => setCentre(x))}
          options={[['', '全部中心'], ...meta.centres.map((c) => [c.id, c.name_cn] as [string, string])]} />
        <FilterSel value={team} onChange={(x) => onFilter(() => setTeam(x))}
          options={[['', '全部组别'], ...meta.teams.map((t) => [t.id, t.name_cn] as [string, string])]} />
        <FilterSel value={disciple} onChange={(x) => onFilter(() => setDisciple(x))}
          options={[['', '弟子(全部)'], ['true', '弟子:是'], ['false', '弟子:否']]} />
        <FilterSel value={fullVeg} onChange={(x) => onFilter(() => setFullVeg(x))}
          options={[['', '全素(全部)'], ['true', '全素:是'], ['false', '全素:否']]} />
        <FilterSel value={status} onChange={(x) => onFilter(() => setStatus(x))}
          options={[['active', '在册'], ['inactive', '已停用'], ['all', '全部状态']]} />
      </div>

      {/* table */}
      <div className="bg-[#FFFEF6] border border-[#EFE3BF] rounded-2xl overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-[#8B6F47]">加载中…</p>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-[#583A0F]">还没有会员</p>
            <p className="mt-1 text-xs text-[#8B6F47]">
              数据将通过导入（A5）批量导入，或点击「+ 新增会员」手动添加。
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-[#B89968] border-b border-[#EFE3BF]">
                  <Th>姓名 Name</Th><Th>中心 Centre</Th><Th>组别 Teams</Th><Th>弟子/全素</Th><Th>电话 Phone</Th><Th>状态</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-[#EFE3BF] last:border-b-0 hover:bg-[#FAEFD0]/40">
                    <td className="px-4 py-2.5">
                      <Link href={`/dashboard/members/${r.id}`} className="font-medium text-[#583A0F] hover:text-[#A87929]">
                        {r.name_cn || r.name_en || '（无名）'}
                      </Link>
                      {r.name_cn && r.name_en && <div className="text-xs text-[#8B6F47]">{r.name_en}</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.centre ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#FAEFD0] text-[#8A5A1E]" title={r.centre.name_cn}>
                          {r.centre.code}
                        </span>
                      ) : <span className="text-[#B89968]">–</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {r.teams.map((t, i) => (
                          <span key={i} className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${
                            t.role === 'lead' ? 'bg-[#F5E1B0] text-[#8A5A1E] font-medium' : 'bg-white border border-[#EFE3BF] text-[#8B6F47]'
                          }`}>
                            {t.name_cn}{t.role === 'lead' ? ' · 组长' : ''}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1">
                        {r.disciple === true && <Badge>弟子</Badge>}
                        {r.full_veg === true && <Badge>全素</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[#583A0F]">{r.phone || '–'}</td>
                    <td className="px-4 py-2.5">
                      {r.status === 'active'
                        ? <span className="text-[11px] text-[#8B6F47]">在册</span>
                        : <span className="text-[11px] text-red-700">已停用</span>}
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
        <div className="flex items-center justify-end gap-3 text-sm text-[#8B6F47]">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1 rounded-full border border-[#EFE3BF] hover:bg-[#FAEFD0] disabled:opacity-40"
          >‹</button>
          <span>第 {page} / {totalPages} 页 · 共 {total}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1 rounded-full border border-[#EFE3BF] hover:bg-[#FAEFD0] disabled:opacity-40"
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
      className="text-sm px-3 py-2 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] focus:outline-none focus:border-[#D89938]"
    >
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2 font-medium">{children}</th>;
}
function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-block px-2 py-0.5 rounded-full text-[11px] bg-[#FAEFD0] text-[#A87929]">{children}</span>;
}
