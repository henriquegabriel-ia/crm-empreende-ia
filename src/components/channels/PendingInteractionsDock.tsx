import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ds/button';
import { useCrmSnapshot } from '@/hooks/useCrmSnapshot';
import { contactName, relationshipIndex } from '@/lib/contact-model';
import { interactionTitle, type PendingInteraction } from '@/lib/interactions';
import { ANONYMIZED_CONTACT_NAME, isAnonymized } from '@/lib/privacy';
import { useInteractionPrompt } from './interaction-context';
import { useOtherDialogOpen } from './useOtherDialogOpen';

const time = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
/** A variável CSS que a área de trabalho usa para não ficar coberta pela faixa (eia-components.css). */
const DOCK_RESERVE = '--eia-dock-reserve';
/** Folga entre o fim do conteúdo e o topo da faixa. */
const DOCK_GAP_PX = 8;

/**
 * "Para registrar" no rodapé (item 1.9): as interações abertas pelos canais que ainda não foram registradas, quando
 * nenhum diálogo está aberto (um painel modal deixa o resto da tela inerte, e por isso cada painel mostra as suas
 * dentro dele). No celular, em largura total acima da navegação inferior; no desktop, centralizada embaixo, longe dos
 * avisos (que ficam no canto inferior direito).
 */
export function PendingInteractionsDock() {
  const prompt = useInteractionPrompt();
  const dialogOpen = useOtherDialogOpen();
  const snapshot = useCrmSnapshot();
  const [expanded, setExpanded] = useState(false);
  const region = useRef<HTMLElement>(null);
  const visible = !dialogOpen && prompt.pending.length > 0;
  // A faixa é fixa: a área de trabalho reserva a altura dela (do topo da faixa ao fim da tela), medida a cada mudança
  // de tamanho, para o fim de Hoje, das listas e do Pipeline continuar alcançável. Com um diálogo aberto a reserva
  // fica (a tela de trás não pula); sem pendências, a faixa sai e a reserva também.
  useLayoutEffect(() => {
    const element = region.current;
    if (!visible || !element) return;
    const root = document.documentElement;
    const measure = () => {
      const reserve = Math.ceil(window.innerHeight - element.getBoundingClientRect().top + DOCK_GAP_PX);
      if (Number.isFinite(reserve)) root.style.setProperty(DOCK_RESERVE, `${Math.max(0, reserve)}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [visible, expanded]);
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty(DOCK_RESERVE);
    },
    [],
  );
  if (!visible) return null;
  const index = snapshot.data ? relationshipIndex(snapshot.data) : null;
  // O nome vem do snapshot na hora de mostrar: o armazenamento guarda só ids.
  const nameOf = (item: PendingInteraction) => {
    if (!index) return null;
    const contact = item.contactId ? index.contactById.get(item.contactId) : undefined;
    if (contact) return contactName(contact);
    const company = !item.contactId && item.companyId ? index.companyById.get(item.companyId) : undefined;
    return company?.name ?? null;
  };
  const items = expanded ? prompt.pending : prompt.pending.slice(0, 1);
  return (
    <section
      ref={region}
      role="region"
      aria-label="Para registrar"
      className="eia-overlay fixed inset-x-3 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] z-40 rounded-2xl border border-border bg-background/95 p-3 shadow-lg md:inset-x-auto md:bottom-6 md:left-1/2 md:w-[30rem] md:-translate-x-1/2"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold">Para registrar</h2>
        {prompt.pending.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            className="eia-touch-target"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Ver só a mais recente' : `Ver todas (${prompt.pending.length})`}
          </Button>
        )}
      </div>
      <ul className="max-h-[40dvh] space-y-2 overflow-y-auto">
        {items.map((item) => {
          // Contato anonimizado depois de aberto o canal (item 1.10): nada mais é registrado com ele, e a linha fica só com
          // "Agora não", como o contato indisponível.
          const anonymized = !!index && !!item.contactId && isAnonymized(index.contactById.get(item.contactId));
          const name = anonymized ? null : nameOf(item);
          const available = !anonymized && (!!name || !index);
          return (
            <li key={item.key} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 flex-1 basis-44 break-words text-sm">
                {anonymized
                  ? ANONYMIZED_CONTACT_NAME
                  : name
                    ? interactionTitle(item.channel, name)
                    : index
                      ? 'Contato indisponível'
                      : 'Carregando…'}{' '}
                · <time dateTime={item.openedAt}>{time(item.openedAt)}</time>
              </span>
              <span className="flex shrink-0 gap-1">
                {available && (
                  <Button
                    size="sm"
                    className="eia-touch-target"
                    disabled={!index}
                    onClick={() =>
                      prompt.openDialog({ mode: item.activityId ? 'complete' : 'register', pending: item })
                    }
                  >
                    Registrar
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="eia-touch-target" onClick={() => prompt.dismiss(item.key)}>
                  Agora não
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
