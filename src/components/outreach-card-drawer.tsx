// src/components/outreach-card-drawer.tsx
// 渡人卡 — the right-side drawer for one 结缘人, shared by the workbench and (via a link) the
// inbox. Shows the milestone timeline (dates editable; deletable except first_contact), big
// friendly buttons for the next rungs, editable source/phone/centre, a member link picker, a
// 查看对话 link when a conversation exists, and a gray 旧记录 chip for a legacy care stage.
// 只记录善缘的成长 — no chasing, no scores. outreach:edit gates every mutation.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  MILESTONES,
  milestoneMeta,
  deriveRung,
  nextMilestones,
  SOURCES,
  LEGACY_STAGE_CHIP,
} from '@/lib/outreach';
import { useT } from '@/lib/i18n-react';
import { stageLabelT, sourceLabelT } from '@/lib/display-maps';

type Meta = { centres: { id: string; name_cn: string }[]; events: { id: string; code: string; title: string }[] };
type Contact = {
  id: string; display_name: string | null; phone: string | null; wa_id: string | null; stage: string | null;
  source_type: string | null; source_event_id: string | null; source_note: string | null; centre_id: string | null; member_id: string | null;
};
type Milestone = { id: string; milestone: string; happened_on: string; event_id: string | null; note: string | null };
type MemberLite = { id: string; name_cn: string; name_en: string | null; phone: string | null };
type Detail = {
  contact: Contact;
  milestones: Milestone[];
  member: MemberLite | null;
  sourceEvent: { id: string; code: string; title: string } | null;
  centre: { id: string; name_cn: string } | null;
  hasConversation: boolean;
};

const today = () => new Date().toISOString().slice(0, 10);
const inputCls = 'w-full text-sm px-3 py-2 border border-border-strong rounded-lg bg-surface text-ink focus:outline-none focus:border-accent';

export function OutreachCardDrawer({
  contactId, meta, canEdit, onClose, onChanged,
}: {
  contactId: string; meta: Meta; canEdit: boolean; onClose: () => void; onChanged?: () => void;
}) {
  const t = useT();
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState<string | null>(null); // milestone key whose add-form is open

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/dashboard/outreach/persons/${contactId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) setD(j);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [contactId]);
  useEffect(() => {
    load();
  }, [load]);

  const refresh = () => { load(); onChanged?.(); };

  const present = useMemo(() => (d?.milestones ?? []).map((m) => m.milestone), [d]);
  const rung = deriveRung(d?.milestones ?? []);
  const next = nextMilestones(present);

  const patchContact = async (patch: Record<string, unknown>) => {
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(`/api/dashboard/outreach/persons/${contactId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? t('duren.saveFailed'));
      else refresh();
    } finally {
      setBusy(false);
    }
  };

  const recordMilestone = async (milestone: string, happened_on: string, note: string, event_id: string | null) => {
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/dashboard/outreach/milestones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contact_id: contactId, milestone, happened_on, note: note || undefined, event_id: event_id || undefined }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setErr(j.error ?? t('duren.recordFailed'));
      else { setAdding(null); refresh(); }
    } finally {
      setBusy(false);
    }
  };

  const editMilestoneDate = async (id: string, happened_on: string) => {
    await fetch(`/api/dashboard/outreach/milestones/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ happened_on }) });
    refresh();
  };
  const deleteMilestone = async (id: string) => {
    if (!confirm(t('duren.confirmDeleteRecord'))) return;
    const res = await fetch(`/api/dashboard/outreach/milestones/${id}`, { method: 'DELETE' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) setErr(j.error ?? t('duren.deleteFailed'));
    else refresh();
  };

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="absolute right-0 top-0 bottom-0 w-[min(480px,96vw)] bg-surface border-l border-border overflow-y-auto p-5">
        <button onClick={onClose} className="float-right text-lg text-ink-faint hover:text-ink" aria-label={t('duren.close')}>✕</button>

        {loading || !d ? (
          <p className="text-sm text-ink-muted">{t('duren.loading')}</p>
        ) : (
          <>
            <h3 className="text-lg font-bold font-serif text-ink break-words">{d.contact.display_name || t('duren.anonymous')}</h3>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <span className="pill-gold inline-block px-2 py-0.5 rounded-full text-[11px]">{milestoneMeta(rung)?.emoji} {stageLabelT(t, rung)}</span>
              <span className="text-[11px] text-ink-faint">{t('duren.sourcePrefix', { source: sourceLabelT(t, d.contact.source_type) })}</span>
              {d.contact.stage && LEGACY_STAGE_CHIP.has(d.contact.stage) && (
                <span className="pill-muted inline-block px-2 py-0.5 rounded-full text-[11px]" title={t('duren.legacyStageTitle')}>{t('duren.legacyChip', { stage: d.contact.stage })}</span>
              )}
              {d.hasConversation && <Link href="/dashboard" className="text-[11px] text-accent-deep hover:underline">{t('duren.viewConversation')}</Link>}
            </div>
            {(d.contact.phone || d.contact.wa_id) && <p className="text-xs text-ink-muted mt-1">📞 {d.contact.phone || d.contact.wa_id}</p>}

            {err && <p className="text-sm text-[#B4402E] bg-[#FCEBEA] border border-[#B4402E]/20 rounded-lg px-3 py-2 mt-2">{err}</p>}

            {/* timeline */}
            <h4 className="text-sm font-semibold text-ink mt-4 mb-1.5">{t('duren.growthFootprints')}</h4>
            <div className="space-y-1.5">
              {MILESTONES.filter((m) => present.includes(m.key)).map((m) => {
                const row = d.milestones.find((x) => x.milestone === m.key)!;
                return (
                  <div key={row.id} className="border-b border-dashed border-border pb-1.5">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="w-28 shrink-0 text-ink">{m.emoji} {stageLabelT(t, m.key)}</span>
                      {canEdit ? (
                        <input type="date" defaultValue={row.happened_on} onChange={(e) => e.target.value && editMilestoneDate(row.id, e.target.value)} className="text-xs px-2 py-1 border border-border-strong rounded-lg bg-surface text-ink-muted" />
                      ) : (
                        <span className="text-xs text-ink-muted">{row.happened_on}</span>
                      )}
                      {canEdit && m.key !== 'first_contact' && (
                        <button onClick={() => deleteMilestone(row.id)} className="ml-auto text-[11px] text-ink-faint hover:text-[#B4402E]">{t('duren.delete')}</button>
                      )}
                    </div>
                    {row.note && <p className="mt-0.5 pl-1 text-[11px] text-ink-faint leading-snug">{row.note}</p>}
                  </div>
                );
              })}
            </div>

            {/* next milestones */}
            {canEdit && next.length > 0 && (
              <>
                <h4 className="text-sm font-semibold text-ink mt-4 mb-1.5">{t('duren.recordNextStep')}</h4>
                <div className="flex flex-wrap gap-2">
                  {next.map((m) => (
                    <button key={m.key} onClick={() => setAdding(adding === m.key ? null : m.key)} disabled={busy}
                      className={`px-3 py-2 rounded-xl text-sm border transition ${adding === m.key ? 'bg-accent text-white border-accent' : 'bg-surface text-ink border-gold-border hover:border-accent'}`}>
                      {m.emoji} {stageLabelT(t, m.key)}
                    </button>
                  ))}
                </div>
                {adding && <AddMilestoneForm milestone={adding} events={meta.events} busy={busy} onCancel={() => setAdding(null)} onSubmit={recordMilestone} />}
              </>
            )}

            {/* editable fields */}
            {canEdit && <EditFields d={d} meta={meta} busy={busy} onSave={patchContact} />}

            {/* member link */}
            {canEdit && <MemberLink d={d} busy={busy} onLink={(mid) => patchContact({ member_id: mid })} onUnlink={() => patchContact({ member_id: null })} />}
          </>
        )}
      </div>
    </div>
  );
}

function AddMilestoneForm({ milestone, events, busy, onCancel, onSubmit }: {
  milestone: string; events: { id: string; code: string; title: string }[]; busy: boolean;
  onCancel: () => void; onSubmit: (milestone: string, happened_on: string, note: string, event_id: string | null) => void;
}) {
  const t = useT();
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [eventId, setEventId] = useState('');
  return (
    <div className="mt-2 border border-border rounded-xl p-3 bg-surface-soft space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div><p className="text-[11px] text-ink-muted mb-1">{t('duren.date')}</p><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></div>
        {milestone === 'attended' && (
          <div><p className="text-[11px] text-ink-muted mb-1">{t('duren.eventOptional')}</p>
            <select value={eventId} onChange={(e) => setEventId(e.target.value)} className={inputCls}>
              <option value="">{t('duren.opt.none')}</option>
              {events.map((e) => <option key={e.id} value={e.id}>{e.code} {e.title}</option>)}
            </select>
          </div>
        )}
      </div>
      <div><p className="text-[11px] text-ink-muted mb-1">{t('duren.noteOptional')}</p><input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} /></div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs border border-border-strong rounded-lg bg-surface text-ink">{t('duren.cancel')}</button>
        <button disabled={busy} onClick={() => onSubmit(milestone, date, note, eventId || null)} className="px-4 py-1.5 text-xs btn-primary">{t('duren.recordMilestoneBtn', { label: stageLabelT(t, milestone) })}</button>
      </div>
    </div>
  );
}

function EditFields({ d, meta, busy, onSave }: { d: Detail; meta: Meta; busy: boolean; onSave: (patch: Record<string, unknown>) => void }) {
  const t = useT();
  const [phone, setPhone] = useState(d.contact.phone ?? '');
  const [sourceType, setSourceType] = useState(d.contact.source_type ?? '');
  const [sourceEvent, setSourceEvent] = useState(d.contact.source_event_id ?? '');
  const [sourceNote, setSourceNote] = useState(d.contact.source_note ?? '');
  const [centreId, setCentreId] = useState(d.contact.centre_id ?? '');

  return (
    <div className="mt-4 border-t border-border pt-3">
      <h4 className="text-sm font-semibold text-ink mb-1.5">{t('duren.profile')}</h4>
      <div className="space-y-2">
        <div><p className="text-[11px] text-ink-muted mb-1">{t('duren.field.phone')}</p><input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder={t('duren.field.phonePlaceholder')} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><p className="text-[11px] text-ink-muted mb-1">{t('duren.field.source')}</p>
            <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} className={inputCls}>
              <option value="">{t('duren.opt.unfilled')}</option>
              {SOURCES.map((s) => <option key={s.key} value={s.key}>{sourceLabelT(t, s.key)}</option>)}
            </select>
          </div>
          <div><p className="text-[11px] text-ink-muted mb-1">{t('duren.field.centre')}</p>
            <select value={centreId} onChange={(e) => setCentreId(e.target.value)} className={inputCls}>
              <option value="">{t('duren.opt.unspecified')}</option>
              {meta.centres.map((c) => <option key={c.id} value={c.id}>{c.name_cn}</option>)}
            </select>
          </div>
        </div>
        {sourceType === 'event' && (
          <div><p className="text-[11px] text-ink-muted mb-1">{t('duren.field.sourceEvent')}</p>
            <select value={sourceEvent} onChange={(e) => setSourceEvent(e.target.value)} className={inputCls}>
              <option value="">{t('duren.opt.none')}</option>
              {meta.events.map((e) => <option key={e.id} value={e.id}>{e.code} {e.title}</option>)}
            </select>
          </div>
        )}
        <div><p className="text-[11px] text-ink-muted mb-1">{t('duren.field.sourceNote')}</p><input value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} className={inputCls} /></div>
        <button disabled={busy} onClick={() => onSave({ phone: phone.trim() || null, source_type: sourceType || null, source_event_id: sourceType === 'event' ? sourceEvent || null : null, source_note: sourceNote.trim() || null, centre_id: centreId || null })}
          className="px-4 py-1.5 text-xs btn-primary">{t('duren.saveProfile')}</button>
      </div>
    </div>
  );
}

function MemberLink({ d, busy, onLink, onUnlink }: { d: Detail; busy: boolean; onLink: (memberId: string) => void; onUnlink: () => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<MemberLite[]>([]);
  useEffect(() => {
    const t = q.trim();
    if (!t) { setResults([]); return; }
    const h = setTimeout(() => {
      fetch(`/api/dashboard/outreach/member-search?q=${encodeURIComponent(t)}`).then((r) => (r.ok ? r.json() : null)).then((j) => setResults(j?.members ?? [])).catch(() => {});
    }, 250);
    return () => clearTimeout(h);
  }, [q]);

  return (
    <div className="mt-4 border-t border-border pt-3">
      <h4 className="text-sm font-semibold text-ink mb-1.5">{t('duren.memberProfile')}</h4>
      {d.member ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-ink">{t('duren.linkedPrefix')}<b>{d.member.name_cn}</b>{d.member.phone ? ` · ${d.member.phone}` : ''}</span>
          <button disabled={busy} onClick={onUnlink} className="text-[11px] text-ink-faint hover:text-[#B4402E]">{t('duren.unlink')}</button>
        </div>
      ) : (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('duren.memberSearchPlaceholder')} className={inputCls} />
          {results.length > 0 && (
            <div className="mt-1.5 border border-border-strong rounded-lg divide-y divide-border max-h-40 overflow-auto">
              {results.map((m) => (
                <button key={m.id} disabled={busy} onClick={() => onLink(m.id)} className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-accent/5">
                  {m.name_cn}{m.phone ? <span className="text-ink-faint"> · {m.phone}</span> : ''}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
