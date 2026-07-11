// src/components/assistant-message.tsx
// Shared rendering for assistant replies — Master Lu's wisdom answers. Used by
// both the public 智慧问答 (/qa) and the volunteer dashboard so the gold
// 师父开示 blockquote card, markdown styling, and source list render IDENTICALLY
// in both places. Keep this the single source of truth; do not fork the styling.

'use client';

import ReactMarkdown from 'react-markdown';
import type { ComponentPropsWithoutRef } from 'react';
import { useT } from '@/lib/i18n-react';

export type Source = {
  book: string;
  page_start?: number;
  page_end?: number;
  excerpt?: string;
  count: number;
};

// The gold 师父开示 quote card rendered for markdown blockquotes. A real
// component (not an inline arrow) so it can pull the localized label via useT()
// — react-markdown renders custom components, so hooks are valid here.
function QuoteCard(props: ComponentPropsWithoutRef<'blockquote'>) {
  const t = useT();
  return (
    <blockquote className="quote-card my-4 px-4 py-3 not-italic">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-sm">🪷</span>
        <span className="quote-card-label">{t('care.masterTeaching')}</span>
      </div>
      <div className="quote-card-body [&>p]:my-1 [&>p]:leading-[2]">{props.children}</div>
    </blockquote>
  );
}

// The exact ReactMarkdown component map — warm-palette markdown with the gold
// 师父开示 quote card for blockquotes.
export const assistantMarkdownComponents = {
  p: (props: ComponentPropsWithoutRef<'p'>) => <p className="my-2 leading-relaxed" {...props} />,
  h1: (props: ComponentPropsWithoutRef<'h1'>) => <h1 className="text-xl font-semibold my-3" {...props} />,
  h2: (props: ComponentPropsWithoutRef<'h2'>) => <h2 className="text-lg font-semibold my-3" {...props} />,
  h3: (props: ComponentPropsWithoutRef<'h3'>) => <h3 className="text-base font-semibold my-2" {...props} />,
  ul: (props: ComponentPropsWithoutRef<'ul'>) => <ul className="my-2 ml-5 list-disc" {...props} />,
  ol: (props: ComponentPropsWithoutRef<'ol'>) => <ol className="my-2 ml-5 list-decimal" {...props} />,
  li: (props: ComponentPropsWithoutRef<'li'>) => <li className="my-1" {...props} />,
  hr: () => <hr className="my-4 border-border" />,
  blockquote: QuoteCard,
  strong: (props: ComponentPropsWithoutRef<'strong'>) => <strong className="text-accent-deep font-semibold" {...props} />,
  code: (props: ComponentPropsWithoutRef<'code'>) => <code className="bg-accent/10 text-accent-deep px-1 py-0.5 rounded text-sm" {...props} />,
};

// Renders an assistant reply's markdown with the shared component map.
export function MasterMarkdown({ children }: { children: string }) {
  return <ReactMarkdown components={assistantMarkdownComponents}>{children}</ReactMarkdown>;
}

// Renders the reference list shown beneath an assistant reply. Returns null when
// there are no sources. `title` is passed in so each surface can localize it.
export function MessageSources({ sources, title }: { sources: Source[]; title: string }) {
  const t = useT();
  if (!sources || sources.length === 0) return null;
  return (
    <div className="mt-4 pt-3 border-t border-border animate-[fadeIn_0.5s_ease-in]">
      <div className="text-xs text-ink-muted mb-2">{title}</div>
      <div className="space-y-1">
        {sources.map((s, sidx) => {
          const pageInfo = s.page_start
            ? (s.page_start === s.page_end
                ? t('care.pageSingle', { page: s.page_start })
                : t('care.pageRange', { start: s.page_start, end: s.page_end ?? s.page_start }))
            : '';
          return (
            <div key={sidx} className="text-xs text-ink-muted flex items-center gap-1">
              <span>📖</span>
              <span className="font-medium">《{s.book}》</span>
              {pageInfo && <span className="text-ink-muted/70">· {pageInfo}</span>}
              {s.count > 1 && <span className="text-ink-faint text-[10px]">{t('care.segmentCount', { n: s.count })}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
