// src/components/assistant-message.tsx
// Shared rendering for assistant replies — Master Lu's wisdom answers. Used by
// both the public 智慧问答 (/qa) and the volunteer dashboard so the gold
// 师父开示 blockquote card, markdown styling, and source list render IDENTICALLY
// in both places. Keep this the single source of truth; do not fork the styling.

import ReactMarkdown from 'react-markdown';
import type { ComponentPropsWithoutRef } from 'react';

export type Source = {
  book: string;
  page_start?: number;
  page_end?: number;
  excerpt?: string;
  count: number;
};

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
  hr: () => <hr className="my-4 border-amber-200/60" />,
  blockquote: (props: ComponentPropsWithoutRef<'blockquote'>) => (
    <blockquote className="quote-card my-4 px-4 py-3 not-italic">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-sm">🪷</span>
        <span className="quote-card-label">师父开示</span>
      </div>
      <div className="quote-card-body [&>p]:my-1 [&>p]:leading-[2]">{props.children}</div>
    </blockquote>
  ),
  strong: (props: ComponentPropsWithoutRef<'strong'>) => <strong className="text-amber-900 font-semibold" {...props} />,
  code: (props: ComponentPropsWithoutRef<'code'>) => <code className="bg-amber-100/50 px-1 py-0.5 rounded text-sm" {...props} />,
};

// Renders an assistant reply's markdown with the shared component map.
export function MasterMarkdown({ children }: { children: string }) {
  return <ReactMarkdown components={assistantMarkdownComponents}>{children}</ReactMarkdown>;
}

// Renders the reference list shown beneath an assistant reply. Returns null when
// there are no sources. `title` is passed in so each surface can localize it.
export function MessageSources({ sources, title }: { sources: Source[]; title: string }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="mt-4 pt-3 border-t border-border animate-[fadeIn_0.5s_ease-in]">
      <div className="text-xs text-ink-muted mb-2">{title}</div>
      <div className="space-y-1">
        {sources.map((s, sidx) => {
          const pageInfo = s.page_start
            ? (s.page_start === s.page_end
                ? `第 ${s.page_start} 页`
                : `第 ${s.page_start}-${s.page_end} 页`)
            : '';
          return (
            <div key={sidx} className="text-xs text-ink-muted flex items-center gap-1">
              <span>📖</span>
              <span className="font-medium">《{s.book}》</span>
              {pageInfo && <span className="text-ink-muted/70">· {pageInfo}</span>}
              {s.count > 1 && <span className="text-ink-faint text-[10px]">({s.count}段)</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
