// src/app/r/[token]/meal-grid.tsx
// The public per-day-per-meal picker — extracted from the register wizard so the
// status page's self-edit (v2) renders the EXACT same grid. Pure controlled
// component: offered cells come in, the selected key-set round-trips out.

'use client';

import { useMemo } from 'react';
import { mealSlotKey } from '@/lib/events';
import { useT } from '@/lib/i18n-react';
import { MEAL_COLS, mealColLabel, weekdayCn } from '@/lib/events-display';

const dateLabel = (d: string) => `${d.slice(5).replace('-', '月')}日 ${weekdayCn(d)}`;

export function MealGrid({ slots, value, onChange }: {
  slots: { slot_date: string; meal: string }[];
  value: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const t = useT();
  const mealDates = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const s of slots) {
      if (!map.has(s.slot_date)) map.set(s.slot_date, new Set());
      map.get(s.slot_date)!.add(s.meal);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [slots]);

  const toggle = (key: string) => {
    const n = new Set(value);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    onChange(n);
  };
  const selectDay = (date: string, offered: Set<string>) => {
    const n = new Set(value);
    for (const m of offered) n.add(mealSlotKey(date, m));
    onChange(n);
  };
  const selectAll = () => {
    const n = new Set<string>();
    for (const [d, o] of mealDates) for (const m of o) n.add(mealSlotKey(d, m));
    onChange(n);
  };

  if (mealDates.length === 0) return <p className="text-sm text-ink-muted">{t('reg.noMealsYet')}</p>;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-ink-muted">{t('reg.mealsSelected', { n: value.size })}</span>
        <div className="flex gap-2 text-xs">
          <button onClick={selectAll} className="text-accent">{t('reg.selectAll')}</button>
          <button onClick={() => onChange(new Set())} className="text-ink-muted">{t('reg.clear')}</button>
        </div>
      </div>
      <div className="space-y-1.5">
        {mealDates.map(([date, offered]) => (
          <div key={date} className="flex items-center gap-2">
            <button onClick={() => selectDay(date, offered)} className="w-24 shrink-0 text-left text-xs text-ink-muted hover:text-accent">{dateLabel(date)}</button>
            <div className="flex gap-1.5 flex-1">
              {MEAL_COLS.map(({ meal }) => {
                const isOffered = offered.has(meal);
                const key = mealSlotKey(date, meal);
                const on = value.has(key);
                if (!isOffered) return <span key={meal} className="flex-1 text-center py-1.5 text-ink-faint text-sm">—</span>;
                return (
                  <button key={meal} onClick={() => toggle(key)}
                    className={`flex-1 rounded-lg py-1.5 text-sm border transition ${on ? 'bg-accent text-white border-accent' : 'bg-surface text-ink border-border'}`}>
                    {mealColLabel(meal, t)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
