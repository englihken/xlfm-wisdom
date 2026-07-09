// src/components/outreach-quick-panel.tsx
// Compact 渡人 section embedded in the care inbox contact panel — record a milestone right where
// the conversation happens. Shows the current rung + big next-step buttons (a tap records it with
// today's date) + a 打开渡人卡 link into the workbench drawer. Rendered only when the viewer holds
// outreach:edit. Uses the same outreach APIs; does NOT touch the inbox otherwise.

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { deriveRung, milestoneMeta, milestoneLabel, nextMilestones } from '@/lib/outreach';

type Milestone = { milestone: string };

export function OutreachQuickPanel({ contactId }: { contactId: string }) {
  const [milestones, setMilestones] = useState<Milestone[] | null>(null);
  const [busy, setBusy] = useState('');
  const [flash, setFlash] = useState('');

  const load = useCallback(() => {
    fetch(`/api/dashboard/outreach/persons/${contactId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setMilestones(j?.milestones ?? []))
      .catch(() => setMilestones([]));
  }, [contactId]);
  useEffect(() => {
    load();
  }, [load]);

  const record = async (milestone: string) => {
    setBusy(milestone);
    setFlash('');
    try {
      const res = await fetch('/api/dashboard/outreach/milestones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contact_id: contactId, milestone }) });
      const j = await res.json().catch(() => ({}));
      if (res.status === 409) setFlash(j.error ?? '已记录过');
      else if (!res.ok) setFlash(j.error ?? '记录失败');
      else { setFlash(`已记录「${milestoneLabel(milestone)}」🙏`); load(); }
    } finally {
      setBusy('');
    }
  };

  if (milestones === null) return null;
  const rung = deriveRung(milestones);
  const next = nextMilestones(milestones.map((m) => m.milestone));

  return (
    <div className="border-t border-border pt-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink">🪷 渡人</span>
        <Link href={`/dashboard/outreach?contact=${contactId}`} className="text-[11px] text-accent-deep hover:underline">打开渡人卡 →</Link>
      </div>
      <p className="mt-1.5 text-xs text-ink-muted">
        当前：<span className="pill-gold inline-block px-2 py-0.5 rounded-full text-[11px]">{milestoneMeta(rung)?.emoji} {milestoneLabel(rung)}</span>
      </p>
      {next.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {next.slice(0, 3).map((m) => (
            <button key={m.key} disabled={busy === m.key} onClick={() => record(m.key)}
              className="px-2.5 py-1.5 rounded-lg text-xs border border-gold-border bg-surface text-ink hover:border-accent transition disabled:opacity-50">
              {busy === m.key ? '…' : `${m.emoji} ${m.label}`}
            </button>
          ))}
        </div>
      )}
      {flash && <p className="mt-1.5 text-[11px] text-accent-deep">{flash}</p>}
    </div>
  );
}
