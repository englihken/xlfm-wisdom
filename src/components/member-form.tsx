// src/components/member-form.tsx
// Shared create/edit form for a member profile (used by /dashboard/members/new and
// /dashboard/members/[id]/edit). Warm palette, bilingual labels, sectioned like the
// paper profile. Fetches /api/dashboard/erp/meta for the centre dropdown. On submit
// it POSTs (create) or PATCHes (edit); a 409 duplicate-phone surfaces a link to the
// existing member.

'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Tri = 'unknown' | 'yes' | 'no';

export type MemberFormValues = {
  name_cn: string;
  name_en: string;
  gender: '' | 'M' | 'F';
  dob: string;
  phone: string;
  email: string;
  gyt_centre_id: string;
  member_type: 'member' | 'volunteer';
  disciple: Tri;
  disciple_no: string;
  baishi_year: string;
  baishi_place: string;
  start_practice_year: string;
  full_veg: Tri;
  veg_since: string;
  shirt_size: string;
  snoring: Tri;
  languages: string;
  address: string;
  birthplace: string;
  religion: string;
  marital_status: string;
  occupation: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  referrer_name: string;
  referrer_phone: string;
  notes: string;
};

export const EMPTY_MEMBER: MemberFormValues = {
  name_cn: '', name_en: '', gender: '', dob: '', phone: '', email: '',
  gyt_centre_id: '', member_type: 'member', disciple: 'unknown', disciple_no: '',
  baishi_year: '', baishi_place: '', start_practice_year: '', full_veg: 'unknown',
  veg_since: '', shirt_size: '', snoring: 'unknown', languages: '', address: '',
  birthplace: '', religion: '', marital_status: '', occupation: '',
  emergency_contact_name: '', emergency_contact_phone: '', referrer_name: '',
  referrer_phone: '', notes: '',
};

const SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];
const triToApi = (t: Tri): boolean | null => (t === 'yes' ? true : t === 'no' ? false : null);

type Centre = { id: string; code: string; name_cn: string; name_en: string };

function toBody(v: MemberFormValues): Record<string, unknown> {
  return {
    name_cn: v.name_cn,
    name_en: v.name_en,
    gender: v.gender,
    dob: v.dob,
    phone: v.phone,
    email: v.email,
    gyt_centre_id: v.gyt_centre_id,
    member_type: v.member_type,
    disciple: triToApi(v.disciple),
    disciple_no: v.disciple_no,
    baishi_year: v.baishi_year,
    baishi_place: v.baishi_place,
    start_practice_year: v.start_practice_year,
    full_veg: triToApi(v.full_veg),
    veg_since: v.veg_since,
    shirt_size: v.shirt_size,
    snoring: triToApi(v.snoring),
    languages: v.languages.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    address: v.address,
    birthplace: v.birthplace,
    religion: v.religion,
    marital_status: v.marital_status,
    occupation: v.occupation,
    emergency_contact_name: v.emergency_contact_name,
    emergency_contact_phone: v.emergency_contact_phone,
    referrer_name: v.referrer_name,
    referrer_phone: v.referrer_phone,
    notes: v.notes,
  };
}

export function MemberForm({
  mode,
  memberId,
  initial,
}: {
  mode: 'create' | 'edit';
  memberId?: string;
  initial?: MemberFormValues;
}) {
  const router = useRouter();
  const [v, setV] = useState<MemberFormValues>(initial ?? EMPTY_MEMBER);
  const [centres, setCentres] = useState<Centre[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dup, setDup] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/dashboard/erp/meta')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active && j) setCentres(j.centres ?? []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const set = <K extends keyof MemberFormValues>(k: K, val: MemberFormValues[K]) =>
    setV((prev) => ({ ...prev, [k]: val }));

  const submit = async () => {
    if (saving) return;
    if (!v.name_cn.trim() && !v.name_en.trim()) {
      setError('请至少填写中文或英文姓名');
      return;
    }
    setSaving(true);
    setError(null);
    setDup(null);
    try {
      const url = mode === 'create' ? '/api/dashboard/members' : `/api/dashboard/members/${memberId}`;
      const res = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toBody(v)),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 409) {
        setDup(json?.existing ?? null);
        setError('该电话号码已存在');
        return;
      }
      if (!res.ok) {
        setError(json?.error ?? '保存失败，请重试');
        return;
      }
      const id = mode === 'create' ? json.member.id : memberId;
      router.push(`/dashboard/members/${id}`);
    } catch {
      setError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <Section title="基本资料" en="Basic">
        <Grid>
          <Text label="中文姓名" value={v.name_cn} onChange={(x) => set('name_cn', x)} />
          <Text label="英文姓名 / Name (EN)" value={v.name_en} onChange={(x) => set('name_en', x)} />
          <Sel label="性别 / Gender" value={v.gender} onChange={(x) => set('gender', x as MemberFormValues['gender'])}
            options={[['', '–'], ['M', '男 M'], ['F', '女 F']]} />
          <Text label="出生日期 / DOB" type="date" value={v.dob} onChange={(x) => set('dob', x)} />
          <Text label="电话 / Phone" value={v.phone} onChange={(x) => set('phone', x)} placeholder="60123456789" />
          <Text label="电邮 / Email" value={v.email} onChange={(x) => set('email', x)} />
        </Grid>
      </Section>

      <Section title="归属" en="Belonging">
        <Grid>
          <Sel label="中心 / Centre" value={v.gyt_centre_id} onChange={(x) => set('gyt_centre_id', x)}
            options={[['', '未指定'], ...centres.map((c) => [c.id, `${c.name_cn} ${c.name_en}`] as [string, string])]} />
          <Sel label="类型 / Type" value={v.member_type} onChange={(x) => set('member_type', x as MemberFormValues['member_type'])}
            options={[['member', '信众'], ['volunteer', '义工']]} />
        </Grid>
      </Section>

      <Section title="修行" en="Practice">
        <Grid>
          <TriSel label="弟子 / Disciple" value={v.disciple} onChange={(x) => set('disciple', x)} />
          <Text label="弟子编号" value={v.disciple_no} onChange={(x) => set('disciple_no', x)} />
          <Text label="拜师年份" value={v.baishi_year} onChange={(x) => set('baishi_year', x)} />
          <Text label="拜师地点" value={v.baishi_place} onChange={(x) => set('baishi_place', x)} />
          <Text label="开始修行年份" value={v.start_practice_year} onChange={(x) => set('start_practice_year', x)} />
          <TriSel label="全素 / Full veg" value={v.full_veg} onChange={(x) => set('full_veg', x)} />
          <Text label="吃素年份 / Veg since" value={v.veg_since} onChange={(x) => set('veg_since', x)} />
        </Grid>
      </Section>

      <Section title="后勤" en="Logistics">
        <Grid>
          <Sel label="衣服尺码 / Shirt" value={v.shirt_size} onChange={(x) => set('shirt_size', x)}
            options={[['', '–'], ...SHIRT_SIZES.map((s) => [s, s] as [string, string])]} />
          <TriSel label="打鼾 / Snoring" value={v.snoring} onChange={(x) => set('snoring', x)} />
          <Text label="语言（逗号分隔）" value={v.languages} onChange={(x) => set('languages', x)} placeholder="华语, English, BM" />
        </Grid>
      </Section>

      <Section title="生活" en="Life">
        <Grid>
          <Text label="地址 / Address" value={v.address} onChange={(x) => set('address', x)} />
          <Text label="出生地 / Birthplace" value={v.birthplace} onChange={(x) => set('birthplace', x)} />
          <Text label="宗教 / Religion" value={v.religion} onChange={(x) => set('religion', x)} />
          <Text label="婚姻 / Marital" value={v.marital_status} onChange={(x) => set('marital_status', x)} />
          <Text label="职业 / Occupation" value={v.occupation} onChange={(x) => set('occupation', x)} />
        </Grid>
      </Section>

      <Section title="紧急联系" en="Emergency">
        <Grid>
          <Text label="姓名 / Name" value={v.emergency_contact_name} onChange={(x) => set('emergency_contact_name', x)} />
          <Text label="电话 / Phone" value={v.emergency_contact_phone} onChange={(x) => set('emergency_contact_phone', x)} />
        </Grid>
      </Section>

      <Section title="推荐人" en="Referrer">
        <Grid>
          <Text label="姓名 / Name" value={v.referrer_name} onChange={(x) => set('referrer_name', x)} />
          <Text label="电话 / Phone" value={v.referrer_phone} onChange={(x) => set('referrer_phone', x)} />
        </Grid>
      </Section>

      <Section title="备注" en="Notes">
        <textarea
          value={v.notes}
          onChange={(e) => set('notes', e.target.value)}
          rows={3}
          className="w-full text-sm p-2.5 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] leading-relaxed resize-y focus:outline-none focus:border-[#D89938]"
        />
      </Section>

      {error && (
        <div className="text-sm text-red-600">
          {error}
          {dup && (
            <>
              {' — '}
              <Link href={`/dashboard/members/${dup.id}`} className="underline text-[#A87929]">
                查看已有会员：{dup.name}
              </Link>
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={submit}
          disabled={saving}
          className="px-5 py-2 text-sm text-white bg-[#D89938] rounded-full hover:bg-[#A87929] transition disabled:opacity-50"
        >
          {saving ? '保存中…' : mode === 'create' ? '创建会员' : '保存修改'}
        </button>
        <button
          onClick={() => router.back()}
          disabled={saving}
          className="px-5 py-2 text-sm text-[#583A0F] border border-[#EFE3BF] rounded-full hover:bg-[#FAEFD0] transition disabled:opacity-50"
        >
          取消
        </button>
      </div>
    </div>
  );
}

// ── little form primitives (warm palette) ────────────────────────────────────
function Section({ title, en, children }: { title: string; en: string; children: ReactNode }) {
  return (
    <section className="bg-[#FFFEF6] border border-[#EFE3BF] rounded-2xl p-5">
      <h2 className="text-base font-semibold text-[#583A0F] mb-3">
        {title} <span className="text-xs font-normal text-[#B89968]">{en}</span>
      </h2>
      {children}
    </section>
  );
}
function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}
function Text({
  label, value, onChange, type = 'text', placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-[#B89968] mb-1">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm p-2.5 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] placeholder:text-[#B89968] focus:outline-none focus:border-[#D89938]"
      />
    </label>
  );
}
function Sel({
  label, value, onChange, options,
}: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-[#B89968] mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm p-2.5 border border-[#EFE3BF] rounded-lg bg-white text-[#583A0F] focus:outline-none focus:border-[#D89938]"
      >
        {options.map(([val, lbl]) => (
          <option key={val} value={val}>{lbl}</option>
        ))}
      </select>
    </label>
  );
}
function TriSel({ label, value, onChange }: { label: string; value: Tri; onChange: (v: Tri) => void }) {
  return (
    <Sel
      label={label}
      value={value}
      onChange={(x) => onChange(x as Tri)}
      options={[['unknown', '未知'], ['yes', '是'], ['no', '否']]}
    />
  );
}
