// src/components/member-form.tsx
// Shared create/edit form for a member profile (used by /dashboard/members/new and
// /dashboard/members/[id]/edit). Warm palette, bilingual labels, sectioned like the
// paper profile. Fetches /api/dashboard/erp/meta for the centre dropdown. On submit
// it POSTs (create) or PATCHes (edit); a 409 duplicate-phone surfaces a link to the
// existing member.

'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useT, useLocale } from '@/lib/i18n-react';
import type { TFunc } from '@/lib/i18n';
import {
  LANGUAGES, MARITAL_STATUSES, RELIGIONS, BIRTHPLACES, joinBirthplace,
} from '@/lib/member-vocab';

type Tri = 'unknown' | 'yes' | 'no';

// Build [code, localized-label] option pairs for a vocab group.
const opts = (t: TFunc, group: string, codes: readonly string[]): [string, string][] =>
  codes.map((c) => [c, t(`members.opt.${group}.${c}`)]);

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
  languages: string[];       // vocab codes
  address: string;
  birthplace: string;        // birthplace state/country CODE
  birthplace_city: string;   // optional free-text city detail (stored as code:city)
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
  veg_since: '', shirt_size: '', snoring: 'unknown', languages: [], address: '',
  // religion DEFAULTS to buddhism for new records (they've joined the org).
  birthplace: '', birthplace_city: '', religion: 'buddhism', marital_status: '', occupation: '',
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
    languages: v.languages,
    address: v.address,
    birthplace: joinBirthplace(v.birthplace, v.birthplace_city),
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
  const t = useT();
  const [v, setV] = useState<MemberFormValues>(initial ?? EMPTY_MEMBER);
  // Always-latest snapshot of the form values. submit() reads THIS, not the (possibly stale)
  // render closure — and Save's onPointerDown blurs the focused field first, which commits any
  // in-flight IME/keyboard composition into state before we read it. Together these ensure a
  // just-typed name is never lost to a mid-composition tap or an unflushed keystroke.
  const vRef = useRef(v);
  vRef.current = v;
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
    const cur = vRef.current; // latest values (incl. a composition just committed on pointer-down)
    if (!cur.name_cn.trim() && !cur.name_en.trim()) {
      setError(t('members.form.nameRequired'));
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
        body: JSON.stringify(toBody(cur)),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 409) {
        setDup(json?.existing ?? null);
        setError(t('members.form.phoneExists'));
        return;
      }
      if (!res.ok) {
        setError(json?.error ?? t('common.saveFailed'));
        return;
      }
      const id = mode === 'create' ? json.member.id : memberId;
      router.push(`/dashboard/members/${id}`);
    } catch {
      setError(t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <Section title={t('members.section.basic')} en="Basic">
        <Grid>
          <Text label={t('members.ff.nameCn')} value={v.name_cn} onChange={(x) => set('name_cn', x)} />
          <Text label={t('members.ff.nameEn')} value={v.name_en} onChange={(x) => set('name_en', x)} />
          <Sel label={t('members.ff.gender')} value={v.gender} onChange={(x) => set('gender', x as MemberFormValues['gender'])}
            options={[['', '–'], ['M', t('members.ff.genderM')], ['F', t('members.ff.genderF')]]} />
          <Text label={t('members.ff.dob')} type="date" value={v.dob} onChange={(x) => set('dob', x)} />
          <Text label={t('members.ff.phone')} value={v.phone} onChange={(x) => set('phone', x)} placeholder="60123456789" />
          <Text label={t('members.ff.email')} value={v.email} onChange={(x) => set('email', x)} />
        </Grid>
      </Section>

      <Section title={t('members.section.belonging')} en="Belonging">
        <Grid>
          <Sel label={t('members.ff.centre')} value={v.gyt_centre_id} onChange={(x) => set('gyt_centre_id', x)}
            options={[['', t('members.ff.centreUnspecified')], ...centres.map((c) => [c.id, `${c.name_cn} ${c.name_en}`] as [string, string])]} />
          <Sel label={t('members.ff.type')} value={v.member_type} onChange={(x) => set('member_type', x as MemberFormValues['member_type'])}
            options={[['member', t('members.typeMember')], ['volunteer', t('members.typeVolunteer')]]} />
        </Grid>
      </Section>

      <Section title={t('members.section.practice')} en="Practice">
        <Grid>
          <TriSel label={t('members.ff.disciple')} value={v.disciple} onChange={(x) => set('disciple', x)} />
          <Text label={t('members.ff.discipleNo')} value={v.disciple_no} onChange={(x) => set('disciple_no', x)} />
          <Text label={t('members.ff.baishiYear')} value={v.baishi_year} onChange={(x) => set('baishi_year', x)} />
          <Text label={t('members.ff.baishiPlace')} value={v.baishi_place} onChange={(x) => set('baishi_place', x)} />
          <Text label={t('members.ff.startPractice')} value={v.start_practice_year} onChange={(x) => set('start_practice_year', x)} />
          <TriSel label={t('members.ff.fullVeg')} value={v.full_veg} onChange={(x) => set('full_veg', x)} />
          <Text label={t('members.ff.vegSince')} value={v.veg_since} onChange={(x) => set('veg_since', x)} />
        </Grid>
      </Section>

      <Section title={t('members.section.logistics')} en="Logistics">
        <Grid>
          <Sel label={t('members.ff.shirtSize')} value={v.shirt_size} onChange={(x) => set('shirt_size', x)}
            options={[['', '–'], ...SHIRT_SIZES.map((s) => [s, s] as [string, string])]} />
          <TriSel label={t('members.ff.snoring')} value={v.snoring} onChange={(x) => set('snoring', x)} />
        </Grid>
        <div className="mt-4">
          <MultiChip label={t('members.ff.languages')} value={v.languages} onChange={(x) => set('languages', x)}
            options={opts(t, 'lang', LANGUAGES)} />
        </div>
      </Section>

      <Section title={t('members.section.life')} en="Life">
        <Grid>
          <Text label={t('members.ff.address')} value={v.address} onChange={(x) => set('address', x)} />
          <LegacySel label={t('members.ff.birthplace')} value={v.birthplace} onChange={(x) => set('birthplace', x)}
            options={opts(t, 'bp', BIRTHPLACES)} legacyLabel={t('members.opt.legacy')} />
          <Text label={t('members.ff.birthplaceCity')} value={v.birthplace_city} onChange={(x) => set('birthplace_city', x)}
            placeholder={t('members.ff.birthplaceCityPlaceholder')} />
          <LegacySel label={t('members.ff.religion')} value={v.religion} onChange={(x) => set('religion', x)}
            options={opts(t, 'religion', RELIGIONS)} legacyLabel={t('members.opt.legacy')} />
          <LegacySel label={t('members.ff.marital')} value={v.marital_status} onChange={(x) => set('marital_status', x)}
            options={opts(t, 'marital', MARITAL_STATUSES)} legacyLabel={t('members.opt.legacy')} />
          <Text label={t('members.ff.occupation')} value={v.occupation} onChange={(x) => set('occupation', x)} />
        </Grid>
      </Section>

      <Section title={t('members.section.emergency')} en="Emergency">
        <Grid>
          <Text label={t('members.ff.name')} value={v.emergency_contact_name} onChange={(x) => set('emergency_contact_name', x)} />
          <Text label={t('members.ff.phone')} value={v.emergency_contact_phone} onChange={(x) => set('emergency_contact_phone', x)} />
        </Grid>
      </Section>

      <Section title={t('members.section.referrer')} en="Referrer">
        <Grid>
          <Text label={t('members.ff.name')} value={v.referrer_name} onChange={(x) => set('referrer_name', x)} />
          <Text label={t('members.ff.phone')} value={v.referrer_phone} onChange={(x) => set('referrer_phone', x)} />
        </Grid>
      </Section>

      <Section title={t('members.section.notes')} en="Notes">
        <textarea
          value={v.notes}
          onChange={(e) => set('notes', e.target.value)}
          rows={3}
          className="w-full text-sm p-2.5 border border-border-strong rounded-lg bg-surface text-ink leading-relaxed resize-y focus:outline-none focus:border-accent"
        />
      </Section>

      {error && (
        <div className="text-sm text-red-600">
          {error}
          {dup && (
            <>
              {' — '}
              <Link href={`/dashboard/members/${dup.id}`} className="underline text-accent-deep">
                {t('members.form.viewExisting', { name: dup.name })}
              </Link>
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          // Commit any in-flight IME composition (blur the focused field) BEFORE the click's
          // submit runs, so a name typed-but-not-yet-committed isn't dropped by the tap.
          onPointerDown={() => { (document.activeElement as HTMLElement | null)?.blur?.(); }}
          onClick={submit}
          disabled={saving}
          className="btn-primary px-5 py-2 text-sm transition disabled:opacity-50"
        >
          {saving ? t('members.saving') : mode === 'create' ? t('members.createMember') : t('members.saveChanges')}
        </button>
        <button
          onClick={() => router.back()}
          disabled={saving}
          className="btn-secondary px-5 py-2 text-sm transition disabled:opacity-50"
        >
          {t('members.cancel')}
        </button>
      </div>
    </div>
  );
}

// ── little form primitives (warm palette) ────────────────────────────────────
function Section({ title, en, children }: { title: string; en: string; children: ReactNode }) {
  // `en` is a permanent English gloss (a reading aid) shown only in the Chinese UI;
  // in en/id the translated `title` already reads in that language, so the gloss is hidden.
  const locale = useLocale();
  return (
    <section className="bg-surface border border-border rounded-2xl p-5">
      <h2 className="text-base font-semibold font-serif text-ink mb-3">
        {title}{locale === 'zh' && <span className="text-xs font-normal text-ink-faint"> {en}</span>}
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
      <span className="u-label block mb-1">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm p-2.5 border border-border-strong rounded-lg bg-surface text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent"
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
      <span className="u-label block mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm p-2.5 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent"
      >
        {options.map(([val, lbl]) => (
          <option key={val} value={val}>{lbl}</option>
        ))}
      </select>
    </label>
  );
}
// A single-select that GRACEFULLY renders a stored legacy (non-code) value: if `value`
// is non-empty and not among the known option codes, it is shown as a distinct
// "(legacy)" option so the dropdown never silently drops it. Saving picks a real code.
function LegacySel({
  label, value, onChange, options, legacyLabel,
}: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][]; legacyLabel: string;
}) {
  const known = options.some(([c]) => c === value);
  const all: [string, string][] = [['', '–'], ...options];
  if (value && !known) all.push([value, `${value}${legacyLabel}`]);
  return <Sel label={label} value={value} onChange={onChange} options={all} />;
}

// Multi-select as a wrapped set of toggle chips (checkbox semantics). value is the
// selected code[]; a stored legacy code not in `options` still renders as a checked chip.
function MultiChip({
  label, value, onChange, options,
}: {
  label: string; value: string[]; onChange: (v: string[]) => void; options: [string, string][];
}) {
  const toggle = (code: string) => {
    onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);
  };
  const legacy = value.filter((c) => !options.some(([oc]) => oc === c));
  const all: [string, string][] = [...options, ...legacy.map((c) => [c, c] as [string, string])];
  return (
    <div>
      <span className="u-label block mb-1.5">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {all.map(([code, lbl]) => {
          const on = value.includes(code);
          return (
            <button type="button" key={code} onClick={() => toggle(code)}
              className={`px-2.5 py-1 rounded-full text-xs border transition ${
                on ? 'bg-accent text-white border-accent' : 'bg-surface text-ink border-border-strong hover:bg-accent/5'
              }`}>
              {lbl}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TriSel({ label, value, onChange }: { label: string; value: Tri; onChange: (v: Tri) => void }) {
  const t = useT();
  return (
    <Sel
      label={label}
      value={value}
      onChange={(x) => onChange(x as Tri)}
      options={[['unknown', t('members.unknown')], ['yes', t('members.yes')], ['no', t('members.no')]]}
    />
  );
}
