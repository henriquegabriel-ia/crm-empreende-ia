import React from 'react';
import { cn } from '@/lib/utils';
import { BrandGlyph } from '@/components/brand/Wordmark';
import { TopbarActions } from './TopbarActions';

interface PageScaffoldProps {
  /** Título da página — vive no topbar, nunca como h2 gigante no corpo */
  title: React.ReactNode;
  /** Chip/contagem ao lado do título (ex.: <StatusChip>128 ativos</StatusChip>) */
  meta?: React.ReactNode;
  /** Ações à direita do topbar (CTAs da página) */
  actions?: React.ReactNode;
  /** Linha de filtros/busca abaixo do topbar — flat, sem card */
  toolbar?: React.ReactNode;
  /** Conteúdo full-bleed sem padding/scroll próprio (Kanban, Agenda) */
  flush?: boolean;
  contentClassName?: string;
  children: React.ReactNode;
}

/**
 * Esqueleto padrão de página: topbar h-14 com título+ações da página+cluster
 * global (busca ⌘K, criação rápida, IA, notificações), toolbar opcional de
 * filtros e área de conteúdo. Substitui o antigo page header de template.
 */
export const PageScaffold: React.FC<PageScaffoldProps> = ({
  title,
  meta,
  actions,
  toolbar,
  flush = false,
  contentClassName,
  children,
}) => (
  <div className="eia-page flex h-full min-h-0 flex-col">
    <header className="eia-page-header flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background/90 px-4 backdrop-blur-sm md:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <BrandGlyph className="h-7 w-7 shrink-0 md:hidden" />
        <h1 className="eia-page-title truncate text-[15px] font-semibold tracking-tight text-foreground">{title}</h1>
        {meta && <div className="hidden shrink-0 items-center gap-2 sm:flex">{meta}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actions && (
          <>
            <div className="flex items-center gap-2">{actions}</div>
            <div aria-hidden className="mx-1 hidden h-5 w-px bg-border sm:block" />
          </>
        )}
        <TopbarActions />
      </div>
    </header>

    {toolbar && (
      <div className="eia-toolbar flex shrink-0 items-center gap-3 overflow-x-auto border-b border-border/60 bg-background px-4 py-2.5 md:px-5">
        {toolbar}
      </div>
    )}

    <div
      className={cn(
        'min-h-0 flex-1',
        flush ? 'overflow-hidden' : 'overflow-y-auto px-4 py-5 md:px-6 md:py-6',
        contentClassName
      )}
    >
      {children}
    </div>
  </div>
);

export default PageScaffold;
