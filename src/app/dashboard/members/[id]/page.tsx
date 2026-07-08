// src/app/dashboard/members/[id]/page.tsx
// 会员 profile — header + read-only sections + teams panel (edit via dialog that
// PUTs the full desired set) + skills + notes + meta. 编辑 (members:edit) and
// 停用/启用 (status route). NO delete anywhere.

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { grantAllows } from '@/lib/access';

type Member = Record<string, unknown> & {
  id: string;
  name_cn: string | null;
  name_en: string | null;
  phone: string | null;
  status: string;
  disciple: boolean | null;
  full_veg: boolean | null;
  dob: string | null;
  member_type: string;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  centre: { id: string; code: string; name_cn: string; name_en: string } | null;
};
type Team = { team_id: string; role: string; is_current: boolean; name_cn: string; name_en: string | null };
type Detail = { member: Member; teams: { current: Team[]; past: Team[] }; skills: { skill: string; source: string | null }[] };
type MetaTeam = { id: string; name_cn: string; slug: string };

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a;
}
const s = (v: unknown): string => (v == null || v === '' ? '–' : String(v));
const tri = (v: unknown): string => (v === true ? '是' : v === false ? '否' : '未知');

export default function MemberProfilePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <ErpGate active="members" titleSuffix="资料">
      {(me) => <MemberProfile me={me} id={id} />}
    </ErpGate>
  );
}

function MemberProfile({ me, id }: { me: ErpMe; id: string }) {
  const canEdit = grantAllows(me.grants, 'members', 'edit');
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusBusy, setStatusBusy] = useState(false);
  const [teamsOpen, setTeamsOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard/members/${id}`);
      if (!res.ok) return;
      const json = (await res.json()) as Detail;
      setData(json);
    } catch {
      /* leave loading state */
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleStatus = async () => {
    if (!data || statusBusy) return;
    const next = data.member.status === 'active' ? 'inactive' : 'active';
    if (!window.confirm(next === 'inactive' ? '确定停用此会员？（不会删除，仅停用）' : '确定重新启用此会员？')) return;
    setStatusBusy(true);
    try {
      const res = await fetch(`/api/dashboard/members/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (res.ok) await load();
    } finally {
      setStatusBusy(false);
    }
  };

  if (loading) return <p className="max-w-4xl mx-auto px-4 py-10 text-sm text-ink-muted">加载中…</p>;
  if (!data) return <p className="max-w-4xl mx-auto px-4 py-10 text-sm text-ink-muted">无法加载该会员。</p>;

  const m = data.member;
  const age = ageFromDob(m.dob);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-2xl font-bold font-serif text-ink">{m.name_cn || m.name_en || '（无名）'}</h2>
            {m.disciple === true && <Badge>弟子</Badge>}
            {m.full_veg === true && <Badge>全素</Badge>}
            {m.status === 'active'
              ? <span className="pill-gold text-[11px] px-2 py-0.5 rounded-full">在册</span>
              : <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#FEF2F2] text-red-700">已停用</span>}
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {m.name_en && m.name_cn ? `${m.name_en} · ` : ''}
            {m.centre ? `${m.centre.name_cn} (${m.centre.code})` : '未指定中心'}
            {m.member_type === 'volunteer' ? ' · 义工' : ' · 信众'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <>
              <Link href={`/dashboard/members/${id}/edit`}
                className="btn-secondary px-4 py-1.5 text-sm transition">编辑</Link>
              <button onClick={toggleStatus} disabled={statusBusy}
                className={`px-4 py-1.5 text-sm rounded-full border transition disabled:opacity-50 ${
                  m.status === 'active' ? 'text-red-700 border-[#FCA5A5] hover:bg-[#FEF2F2]' : 'text-accent-deep border-border hover:bg-accent/5'
                }`}>
                {m.status === 'active' ? '停用' : '启用'}
              </button>
            </>
          )}
        </div>
      </div>

      <Card title="基本资料 Basic">
        <Dl items={[
          ['中文姓名', s(m.name_cn)], ['英文姓名', s(m.name_en)], ['性别', s(m.gender)],
          ['出生日期', m.dob ? `${s(m.dob)}${age != null ? ` (${age}岁)` : ''}` : '–'],
          ['电话', s(m.phone)], ['电邮', s(m.email)],
        ]} />
      </Card>

      <Card title="修行 Practice">
        <Dl items={[
          ['弟子', tri(m.disciple)], ['弟子编号', s(m.disciple_no)], ['拜师年份', s(m.baishi_year)],
          ['拜师地点', s(m.baishi_place)], ['开始修行', s(m.start_practice_year)],
          ['全素', tri(m.full_veg)], ['吃素年份', s(m.veg_since)],
        ]} />
      </Card>

      <Card title="后勤 Logistics">
        <Dl items={[
          ['衣服尺码', s(m.shirt_size)], ['打鼾', tri(m.snoring)],
          ['语言', Array.isArray(m.languages) ? (m.languages as string[]).join('、') || '–' : '–'],
        ]} />
      </Card>

      <Card title="生活 Life">
        <Dl items={[
          ['地址', s(m.address)], ['出生地', s(m.birthplace)], ['宗教', s(m.religion)],
          ['婚姻', s(m.marital_status)], ['职业', s(m.occupation)],
        ]} />
      </Card>

      <Card title="紧急联系 & 推荐人">
        <Dl items={[
          ['紧急联系人', s(m.emergency_contact_name)], ['紧急电话', s(m.emergency_contact_phone)],
          ['推荐人', s(m.referrer_name)], ['推荐人电话', s(m.referrer_phone)],
        ]} />
      </Card>

      {/* teams */}
      <Card title="组别 Teams" action={canEdit ? <button onClick={() => setTeamsOpen(true)} className="text-xs text-accent-deep hover:underline">编辑组别</button> : undefined}>
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {data.teams.current.length === 0 && <span className="text-sm text-ink-muted">暂无当前组别</span>}
            {data.teams.current.map((t) => (
              <span key={t.team_id} className={`inline-block px-2.5 py-1 rounded-full text-xs ${
                t.role === 'lead' ? 'pill-gold font-medium' : 'pill-muted'
              }`}>{t.name_cn}{t.role === 'lead' ? ' · 组长' : ''}</span>
            ))}
          </div>
          {data.teams.past.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="text-[11px] text-ink-faint mr-1">曾在：</span>
              {data.teams.past.map((t) => (
                <span key={t.team_id} className="pill-muted inline-block px-2 py-0.5 rounded-full text-[11px]">{t.name_cn}</span>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* skills */}
      {data.skills.length > 0 && (
        <Card title="专长 Skills">
          <div className="flex flex-wrap gap-1.5">
            {data.skills.map((sk, i) => (
              <span key={i} className="pill-gold inline-block px-2 py-0.5 rounded-full text-[11px]" title={sk.source ?? ''}>{sk.skill}</span>
            ))}
          </div>
        </Card>
      )}

      {m.notes && (
        <Card title="备注 Notes">
          <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{m.notes}</p>
        </Card>
      )}

      <div className="pt-2 text-xs text-ink-faint">
        创建于 {s(m.created_at)} · 最近更新 {s(m.updated_at)}
      </div>

      {teamsOpen && (
        <TeamsDialog
          memberId={id}
          current={data.teams.current}
          onClose={() => setTeamsOpen(false)}
          onSaved={() => { setTeamsOpen(false); load(); }}
        />
      )}
    </div>
  );
}

// ── teams edit dialog — PUTs the full desired set ────────────────────────────
function TeamsDialog({
  memberId, current, onClose, onSaved,
}: {
  memberId: string; current: Team[]; onClose: () => void; onSaved: () => void;
}) {
  const [teams, setTeams] = useState<MetaTeam[]>([]);
  const [sel, setSel] = useState<Record<string, { on: boolean; role: 'lead' | 'member' }>>(
    () => Object.fromEntries(current.map((t) => [t.team_id, { on: true, role: t.role === 'lead' ? 'lead' : 'member' }]))
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/dashboard/erp/meta')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (active && j) setTeams(j.teams ?? []); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const save = async () => {
    setSaving(true);
    const desired = Object.entries(sel)
      .filter(([, v]) => v.on)
      .map(([team_id, v]) => ({ team_id, role: v.role, is_current: true }));
    try {
      const res = await fetch(`/api/dashboard/members/${memberId}/teams`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(desired),
      });
      if (res.ok) onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-surface rounded-2xl w-full max-w-md max-h-[80vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold font-serif text-ink mb-3">编辑组别 Teams</h3>
        <div className="space-y-1.5">
          {teams.map((t) => {
            const cur = sel[t.id] ?? { on: false, role: 'member' as const };
            return (
              <div key={t.id} className="flex items-center gap-2">
                <label className="flex items-center gap-2 flex-1 text-sm text-ink">
                  <input type="checkbox" checked={cur.on}
                    onChange={(e) => setSel((p) => ({ ...p, [t.id]: { on: e.target.checked, role: cur.role } }))} />
                  {t.name_cn}
                </label>
                {cur.on && (
                  <select value={cur.role}
                    onChange={(e) => setSel((p) => ({ ...p, [t.id]: { on: true, role: e.target.value as 'lead' | 'member' } }))}
                    className="text-xs px-2 py-1 border border-border-strong rounded bg-surface text-ink">
                    <option value="member">组员</option>
                    <option value="lead">组长</option>
                  </select>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button onClick={save} disabled={saving}
            className="btn-primary px-4 py-1.5 text-sm disabled:opacity-50">
            {saving ? '保存中…' : '保存'}
          </button>
          <button onClick={onClose} disabled={saving}
            className="btn-secondary px-4 py-1.5 text-sm">取消</button>
        </div>
      </div>
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-border rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold font-serif text-ink">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
function Dl({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <dt className="text-xs text-ink-faint w-20 shrink-0 pt-0.5">{k}</dt>
          <dd className="text-sm text-ink break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
function Badge({ children }: { children: React.ReactNode }) {
  return <span className="pill-gold inline-block px-2 py-0.5 rounded-full text-[11px]">{children}</span>;
}
