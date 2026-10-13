import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useEffect, useMemo, useRef } from 'react';
import { CSS } from '@dnd-kit/utilities';
import { ArrowRight, CalendarClock, Clock3, GripVertical, MoreHorizontal, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ds/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ds/dropdown-menu';
import { StatusChip } from '@/components/foundation/StatusChip';
import { cn } from '@/lib/utils';
import type { Deal, DealActivity, DealPerson, DealStage, DealStatus } from '@/lib/deal-types';
import { memberLabel } from '@/lib/team-members';
import { daysInStage, DEAL_STATUS_LABELS, formatDealCurrency } from '@/lib/deal-logic';

type CardProps = {
  deal: Deal;
  stages: DealStage[];
  owner?: DealPerson;
  nextAction?: DealActivity;
  canWrite: boolean;
  busy: boolean;
  first: boolean;
  onOpen: (deal: Deal) => void;
  onMove: (deal: Deal, stageId: string, status?: DealStatus) => void;
};

export function DealMoveMenu({
  deal,
  stages,
  canWrite,
  busy,
  first = false,
  onMove,
}: Pick<CardProps, 'deal' | 'stages' | 'canWrite' | 'busy' | 'onMove'> & { first?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          data-tour={first && canWrite ? 'pipeline-move' : undefined}
          aria-label={`Mover ou alterar situação de ${deal.title}`}
          disabled={!canWrite || busy}
          title={
            !canWrite
              ? 'Seu papel permite somente leitura.'
              : busy
                ? 'Salvando, aguarde a confirmação.'
                : 'Mover ou alterar situação'
          }
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] overflow-y-auto">
        <DropdownMenuLabel>Mover para etapa</DropdownMenuLabel>
        {stages.map((stage) => (
          <DropdownMenuItem
            key={stage.id}
            disabled={stage.id === deal.stage_id}
            onSelect={() => onMove(deal, stage.id)}
          >
            <ArrowRight className="mr-2 h-4 w-4" />
            {stage.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Situação da oportunidade</DropdownMenuLabel>
        {(['open', 'won', 'lost'] as const).map((status) => (
          <DropdownMenuItem
            key={status}
            disabled={deal.status === status}
            onSelect={() => onMove(deal, deal.stage_id, status)}
          >
            {status === 'open' ? 'Reabrir' : status === 'won' ? 'Marcar como ganha' : 'Marcar como perdida'}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DealCard({ deal, stages, owner, nextAction, canWrite, busy, first, onOpen, onMove }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
    disabled: !canWrite || busy,
    data: { deal },
  });
  const days = daysInStage(deal.stage_entered_at);
  const overdue = nextAction?.due_date && Date.parse(nextAction.due_date) < Date.now();
  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        'relative rounded-xl border border-border bg-card p-3 shadow-sm transition-shadow',
        isDragging && 'z-50 shadow-xl opacity-80',
        busy && 'opacity-70',
      )}
      aria-label={deal.title}
      aria-busy={busy || undefined}
    >
      <div className="mb-2 flex items-start gap-1">
        {canWrite && (
          <button
            {...listeners}
            {...attributes}
            type="button"
            disabled={busy}
            aria-label={`Arrastar ${deal.title}. Use o menu ao lado para mover por teclado.`}
            className="-ml-1 mt-0.5 touch-none rounded p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpen(deal)}
          data-tour={first ? 'pipeline-record' : undefined}
          data-deal-open={deal.id}
          className="min-w-0 flex-1 rounded py-1 text-left text-sm font-semibold leading-snug text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="line-clamp-2 break-words">{deal.title}</span>
        </button>
        <DealMoveMenu deal={deal} stages={stages} canWrite={canWrite} busy={busy} first={first} onMove={onMove} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold tabular-nums">{formatDealCurrency(deal.value, deal.currency)}</span>
        <StatusChip tone={deal.status === 'won' ? 'success' : deal.status === 'lost' ? 'danger' : 'neutral'}>
          {DEAL_STATUS_LABELS[deal.status]}
        </StatusChip>
      </div>
      <div className="mt-3 space-y-2 text-xs text-muted-foreground">
        <p className="flex items-center gap-2">
          <UserRound className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{memberLabel(owner, deal.owner_id)}</span>
        </p>
        <p className="flex items-center gap-2">
          <Clock3 className="h-3.5 w-3.5 shrink-0" />
          {days === null
            ? 'Tempo na etapa indisponível'
            : days === 0
              ? 'Entrou nesta etapa hoje'
              : `${days} ${days === 1 ? 'dia' : 'dias'} nesta etapa`}
        </p>
      </div>
      <div className="mt-3 border-t border-border/70 pt-3">
        {nextAction ? (
          <Link
            to={`/activities?activity=${encodeURIComponent(nextAction.id)}`}
            className="block rounded text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              className={cn(
                'flex items-center gap-1.5 font-medium',
                overdue ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              {overdue ? 'Ação vencida' : 'Próxima ação'}
              {nextAction.due_date ? ` · ${new Date(nextAction.due_date).toLocaleDateString('pt-BR')}` : ' · sem prazo'}
            </span>
            <span className="mt-1 block truncate text-foreground">{nextAction.title}</span>
          </Link>
        ) : (
          <p className="text-xs text-muted-foreground">Sem próxima ação combinada</p>
        )}
      </div>
    </article>
  );
}

function StageColumn({
  stage,
  deals,
  currency,
  children,
}: {
  stage: DealStage;
  deals: Deal[];
  currency: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const amount =
    deals
      .filter((deal) => deal.currency === currency)
      .reduce((total, deal) => total + Math.round(deal.value * 100), 0) / 100;
  return (
    <section
      ref={setNodeRef}
      aria-label={`Etapa ${stage.name}`}
      className={cn(
        'flex w-[min(280px,calc(100vw-48px))] min-w-[240px] shrink-0 flex-col rounded-xl border border-border/70 bg-muted/30',
        isOver && 'ring-2 ring-primary bg-primary/5',
      )}
    >
      <div data-tour="pipeline-stages" className="border-b border-border/70 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate text-sm font-semibold">{stage.name}</h2>
          <span
            className="rounded-md bg-background px-2 py-0.5 text-xs tabular-nums"
            aria-label={`${deals.length} oportunidades`}
          >
            {deals.length}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">{formatDealCurrency(amount, currency)}</p>
      </div>
      <div className="min-h-[180px] flex-1 space-y-3 p-2.5">
        {children}
        {!deals.length && (
          <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
            Nenhuma oportunidade nesta etapa.
          </p>
        )}
      </div>
    </section>
  );
}

const NO_MOVES: ReadonlySet<string> = new Set();

export function DealBoard({
  deals,
  stages,
  people,
  nextActions,
  currency,
  canWrite,
  movingIds = NO_MOVES,
  onOpen,
  onMove,
}: {
  deals: Deal[];
  stages: DealStage[];
  people: DealPerson[];
  nextActions: Map<string, DealActivity>;
  currency: string;
  canWrite: boolean;
  /** Oportunidades com movimentação em andamento: só elas ficam travadas (item 0.10), o resto do quadro segue livre. */
  movingIds?: ReadonlySet<string>;
  onOpen: CardProps['onOpen'];
  onMove: CardProps['onMove'];
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(KeyboardSensor),
  );
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  // Uma passada pelas oportunidades por etapa, em vez de um filtro da lista inteira para cada coluna.
  const byStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const deal of deals) {
      const column = map.get(deal.stage_id);
      if (column) column.push(deal);
      else map.set(deal.stage_id, [deal]);
    }
    return map;
  }, [deals]);
  // Aviso único para leitor de tela, sempre montado: uma região que já entra no DOM com o texto costuma não ser lida.
  const saving = useMemo(() => deals.filter((deal) => movingIds.has(deal.id)), [deals, movingIds]);
  const savingMessage =
    saving.length === 1
      ? `Salvando a movimentação de ${saving[0].title}`
      : saving.length > 1
        ? `Salvando a movimentação de ${saving.length} oportunidades`
        : '';
  // O cartão movido é montado de novo na coluna de destino, com o menu desabilitado enquanto salva: o foco cairia no
  // body, e quem navega por teclado perderia o lugar no quadro. Até a movimentação terminar, um foco perdido volta
  // para o título do cartão.
  const board = useRef<HTMLDivElement>(null);
  const refocus = useRef<string | null>(null);
  const move: CardProps['onMove'] = (deal, stageId, status) => {
    refocus.current = deal.id;
    onMove(deal, stageId, status);
  };
  useEffect(() => {
    const id = refocus.current;
    if (!id) return;
    if (!document.activeElement || document.activeElement === document.body) {
      const nodes = board.current?.querySelectorAll<HTMLElement>('[data-deal-open]') ?? [];
      Array.from(nodes)
        .find((node) => node.dataset.dealOpen === id)
        ?.focus();
    }
    if (!movingIds.has(id)) refocus.current = null;
  });
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || !canWrite || movingIds.has(String(active.id))) return;
    const deal = deals.find((item) => item.id === active.id);
    if (deal && deal.stage_id !== over.id) move(deal, String(over.id));
  };
  return (
    <DndContext
      sensors={sensors}
      onDragEnd={onDragEnd}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            'Use espaço para iniciar. Para selecionar uma etapa diretamente, use o menu Mover ao lado do título da oportunidade.',
        },
      }}
    >
      <p role="status" className="sr-only">
        {savingMessage}
      </p>
      <div
        ref={board}
        data-tour="pipeline-board"
        className="flex gap-3 overflow-x-auto pb-4"
        tabIndex={0}
        role="region"
        aria-label="Quadro de oportunidades. Role horizontalmente para ver as etapas."
      >
        {stages.map((stage) => {
          const items = byStage.get(stage.id) ?? [];
          return (
            <StageColumn key={stage.id} stage={stage} deals={items} currency={currency}>
              {items.map((deal) => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  stages={stages}
                  owner={deal.owner_id ? peopleById.get(deal.owner_id) : undefined}
                  nextAction={nextActions.get(deal.id)}
                  canWrite={canWrite}
                  busy={movingIds.has(deal.id)}
                  first={deal.id === deals[0]?.id}
                  onOpen={onOpen}
                  onMove={move}
                />
              ))}
            </StageColumn>
          );
        })}
      </div>
    </DndContext>
  );
}
