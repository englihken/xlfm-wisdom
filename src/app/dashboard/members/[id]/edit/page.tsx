// src/app/dashboard/members/[id]/edit/page.tsx
// 编辑会员 — loads the member, maps it into MemberForm values, renders the shared
// form in edit mode (PATCH). members:edit required.

'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ErpGate, type ErpMe } from '@/components/erp-gate';
import { MemberForm, EMPTY_MEMBER, type MemberFormValues } from '@/components/member-form';
import { grantAllows } from '@/lib/access';

const str = (v: unknown): string => (v == null ? '' : String(v));
const triFrom = (v: unknown): MemberFormValues['disciple'] => (v === true ? 'yes' : v === false ? 'no' : 'unknown');

function toForm(m: Record<string, unknown>): MemberFormValues {
  return {
    ...EMPTY_MEMBER,
    name_cn: str(m.name_cn),
    name_en: str(m.name_en),
    gender: m.gender === 'M' || m.gender === 'F' ? m.gender : '',
    dob: str(m.dob),
    phone: str(m.phone),
    email: str(m.email),
    gyt_centre_id: str(m.gyt_centre_id),
    member_type: m.member_type === 'volunteer' ? 'volunteer' : 'member',
    disciple: triFrom(m.disciple),
    disciple_no: str(m.disciple_no),
    baishi_year: str(m.baishi_year),
    baishi_place: str(m.baishi_place),
    start_practice_year: str(m.start_practice_year),
    full_veg: triFrom(m.full_veg),
    veg_since: str(m.veg_since),
    shirt_size: str(m.shirt_size),
    snoring: triFrom(m.snoring),
    languages: Array.isArray(m.languages) ? (m.languages as string[]).join(', ') : '',
    address: str(m.address),
    birthplace: str(m.birthplace),
    religion: str(m.religion),
    marital_status: str(m.marital_status),
    occupation: str(m.occupation),
    emergency_contact_name: str(m.emergency_contact_name),
    emergency_contact_phone: str(m.emergency_contact_phone),
    referrer_name: str(m.referrer_name),
    referrer_phone: str(m.referrer_phone),
    notes: str(m.notes),
  };
}

export default function EditMemberPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <ErpGate active="members" titleSuffix="编辑">
      {(me) => <EditBody me={me} id={id} />}
    </ErpGate>
  );
}

function EditBody({ me, id }: { me: ErpMe; id: string }) {
  const canEdit = grantAllows(me.grants, 'members', 'edit');
  const [initial, setInitial] = useState<MemberFormValues | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch(`/api/dashboard/members/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (active && j) setInitial(toForm(j.member));
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  if (!canEdit) return <p className="max-w-3xl mx-auto px-4 py-10 text-sm text-[#8B6F47]">您没有编辑会员的权限。</p>;
  if (loading) return <p className="max-w-3xl mx-auto px-4 py-10 text-sm text-[#8B6F47]">加载中…</p>;
  if (!initial) return <p className="max-w-3xl mx-auto px-4 py-10 text-sm text-[#8B6F47]">无法加载该会员。</p>;

  return <MemberForm mode="edit" memberId={id} initial={initial} />;
}
