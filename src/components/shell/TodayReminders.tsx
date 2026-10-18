import { AlertTriangle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { reminderCount, type ReminderState } from '@/lib/activity-logic';

/**
 * Lembretes no menu (item 1.12; docs/arquitetura/1.12.md e DESIGN.md): o número de atividades vencidas e das que vencem
 * até o fim do dia, ao lado de "Hoje". Os números são só visuais (`aria-hidden`): o nome do link leva o rótulo inteiro
 * (`todayNavLabel`, em src/lib/activity-logic.ts), e a distinção entre vencidas e próximas não depende só da cor (ícone
 * no menu expandido; preenchido ou contornado no menu recolhido e no celular). Quando a leitura falha sem nenhuma
 * leitura anterior, um "?" neutro, tracejado, toma o lugar do número, e o nome do link diz que não foi possível
 * conferir os lembretes (revisão do item 1.12): a falta do número não passa por "nenhuma pendência".
 */

/** O "?" neutro da leitura que falhou: tracejado e no tom secundário, sem a cor de erro nem a do dia. */
const UNAVAILABLE = 'border border-dashed border-muted-foreground/60 bg-background text-muted-foreground';

/**
 * Menu expandido do desktop: até duas pílulas à direita de "Hoje". Vencidas, preenchidas no tom de erro e com o
 * triângulo de alerta; até o fim do dia, contornadas e com o relógio.
 */
export function ReminderPills({ reminders }: { reminders: ReminderState }) {
  if (reminders === 'unavailable')
    return (
      <span aria-hidden data-reminders="pills" className="ml-auto flex shrink-0 items-center gap-1">
        <span
          data-reminder="unavailable"
          className={cn(
            'inline-flex h-5 items-center rounded-full px-1.5 text-xs font-semibold leading-none',
            UNAVAILABLE,
          )}
        >
          ?
        </span>
      </span>
    );
  if (!reminders?.total) return null;
  return (
    <span aria-hidden data-reminders="pills" className="ml-auto flex shrink-0 items-center gap-1">
      {reminders.overdue > 0 && (
        <span
          data-reminder="overdue"
          className="inline-flex h-5 items-center gap-0.5 rounded-full bg-destructive px-1.5 text-xs font-semibold leading-none text-destructive-foreground"
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {reminderCount(reminders.overdue)}
        </span>
      )}
      {reminders.upcoming > 0 && (
        <span
          data-reminder="upcoming"
          className="inline-flex h-5 items-center gap-0.5 rounded-full border border-border bg-background px-1.5 text-xs font-semibold leading-none text-foreground"
        >
          <Clock className="h-3 w-3 shrink-0" />
          {reminderCount(reminders.upcoming)}
        </span>
      )}
    </span>
  );
}

/**
 * Menu recolhido do desktop e navegação do celular: um selo com o total (as atividades de "Próximos passos do dia" em
 * "Minha rotina"). Com alguma vencida, preenchido no tom de erro; só com as do dia, contornado.
 *
 * `placement` diz onde o selo mora. No menu recolhido (`rail`), ele fica no canto de cima, à direita, do link de 40 px,
 * acima do ícone: um número largo ("99+") cresce para a esquerda, por cima do link, e não cobre o desenho do ícone; o
 * menu reserva 12 px acima do primeiro link para o selo e o anel não serem cortados (revisão do item 1.12). No celular
 * (`mobile`), no canto do ícone, crescendo para a direita.
 */
export function ReminderCornerBadge({
  reminders,
  placement = 'rail',
}: {
  reminders: ReminderState;
  placement?: 'rail' | 'mobile';
}) {
  const counts = reminders === 'unavailable' ? null : reminders;
  if (reminders !== 'unavailable' && !counts?.total) return null;
  const late = (counts?.overdue ?? 0) > 0;
  return (
    <span
      aria-hidden
      data-reminders="corner"
      data-reminder={counts ? (late ? 'overdue' : 'upcoming') : 'unavailable'}
      className={cn(
        'pointer-events-none absolute flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-xs font-semibold leading-none',
        placement === 'rail' ? '-right-2 -top-2.5' : '-top-2 left-3',
        !counts
          ? UNAVAILABLE
          : late
            ? 'bg-destructive text-destructive-foreground ring-2 ring-background'
            : 'border-[1.5px] border-primary bg-background text-primary',
      )}
    >
      {counts ? reminderCount(counts.total) : '?'}
    </span>
  );
}
