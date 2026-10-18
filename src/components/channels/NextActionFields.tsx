import { useId } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ds/input';
import { Button } from '@/components/ds/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ds/select';
import { ACTIVITY_LABELS, APPOINTMENT_TYPES, localDateTime } from '@/lib/contact-model';
import { assignableMembers, memberLabel, type PersonLike } from '@/lib/team-members';
import { nextActionTitle, shortcutDue, type NextActionDraft } from './next-action';

interface Props {
  value: NextActionDraft;
  onChange: (value: NextActionDraft) => void;
  /** Obrigatória: em "Concluir e agendar a próxima" e em "Agendar a próxima" a caixa some e os campos ficam. */
  required: boolean;
  /** Nome do contato ou da empresa, para o título padrão. */
  name: string;
  members: readonly PersonLike[];
  disabled?: boolean;
  /**
   * Tipos que o banco recusa para o alvo (item 1.10: "Não contatar", de `refusedPlannedTypes`): ficam desabilitados no
   * seletor, com `disabledReason` ligado a ele.
   */
  disabledTypes?: ReadonlySet<string>;
  disabledReason?: string | null;
  /** Prefixo dos ids dos campos: dois formulários na mesma tela (o registro e "Combinar ação") não repetem ids. */
  idPrefix?: string;
  /** O título recebe o foco ao abrir, como em "Combinar ação". */
  autoFocus?: boolean;
}

const SHORTCUTS = [
  { label: 'Amanhã às 9h', days: 1 },
  { label: 'Em 2 dias', days: 2 },
  { label: 'Em 1 semana', days: 7 },
] as const;

/**
 * A próxima ação de um registro (item 1.9): tipo (padrão: o mesmo canal), título, prazo com atalhos, término para
 * reunião e visita e responsável (só pessoas ativas). Sem ela, a "Próxima ação" da ficha e da oportunidade fica vazia;
 * por isso a caixa vem marcada quando o contato não tem outra ação pendente com prazo. Também é o formulário de
 * "Combinar ação" na oportunidade (achado 12 da revisão do item 1.9). Com "Não contatar" (item 1.10), os tipos que o
 * banco recusa ficam desabilitados, com o motivo.
 */
export function NextActionFields({
  value,
  onChange,
  required,
  name,
  members,
  disabled = false,
  disabledTypes,
  disabledReason,
  idPrefix = 'interaction-next',
  autoFocus = false,
}: Props) {
  const reasonId = useId();
  const id = (field: string) => `${idPrefix}-${field}`;
  const showReason = !!disabledTypes?.size && !!disabledReason;
  const set = (patch: Partial<NextActionDraft>) => onChange({ ...value, ...patch });
  const appointment = APPOINTMENT_TYPES.includes(value.type) && value.type !== 'call';
  const changeDue = (due: string) => {
    const start = due ? new Date(due) : null;
    set({
      due,
      // O término acompanha o início, com 1 hora de duração, como no formulário da atividade.
      end:
        start && Number.isFinite(start.getTime())
          ? localDateTime(new Date(start.getTime() + 3_600_000).toISOString())
          : value.end,
    });
  };
  const shown = required || value.schedule;
  return (
    <fieldset className="space-y-3 rounded-lg border p-3" disabled={disabled}>
      <legend className="px-1 text-xs font-semibold">Próxima ação</legend>
      {!required && (
        <div className="eia-touch-row flex items-center gap-2">
          <Checkbox
            id={id('toggle')}
            checked={value.schedule}
            onCheckedChange={(checked) => set({ schedule: checked === true })}
          />
          <Label htmlFor={id('toggle')} className="flex-1 py-2">
            Agendar a próxima ação
          </Label>
        </div>
      )}
      {shown && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={id('type')}>Tipo</Label>
              <Select
                value={value.type}
                onValueChange={(type) =>
                  set({ type, ...(value.titleEdited ? {} : { title: nextActionTitle(type, name) }) })
                }
              >
                <SelectTrigger id={id('type')} aria-describedby={showReason ? reasonId : undefined}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ACTIVITY_LABELS)
                    .filter(([key]) => key !== 'note')
                    .map(([key, label]) => (
                      <SelectItem key={key} value={key} disabled={disabledTypes?.has(key) && key !== value.type}>
                        {label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={id('owner')}>Responsável *</Label>
              <Select
                value={value.userId || 'none'}
                onValueChange={(userId) => set({ userId: userId === 'none' ? '' : userId })}
              >
                <SelectTrigger id={id('owner')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Selecione</SelectItem>
                  {assignableMembers(members, value.userId).map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {memberLabel(member)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {showReason && (
            <p id={reasonId} className="text-xs text-muted-foreground">
              {disabledReason}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={id('title')}>O que precisa acontecer? *</Label>
            <Input
              id={id('title')}
              value={value.title}
              maxLength={200}
              autoFocus={autoFocus}
              onChange={(event) => set({ title: event.target.value, titleEdited: true })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id('due')}>{appointment ? 'Início *' : 'Prazo *'}</Label>
            <div className="flex flex-wrap gap-2">
              {SHORTCUTS.map((shortcut) => (
                <Button
                  key={shortcut.label}
                  type="button"
                  size="sm"
                  variant={value.due === shortcutDue(shortcut.days) ? 'default' : 'outline'}
                  className="eia-touch-target"
                  aria-pressed={value.due === shortcutDue(shortcut.days)}
                  onClick={() => changeDue(shortcutDue(shortcut.days))}
                >
                  {shortcut.label}
                </Button>
              ))}
            </div>
            <Input
              id={id('due')}
              type="datetime-local"
              value={value.due}
              onChange={(event) => changeDue(event.target.value)}
            />
          </div>
          {appointment && (
            <div className="space-y-1.5">
              <Label htmlFor={id('end')}>Término *</Label>
              <Input
                id={id('end')}
                type="datetime-local"
                value={value.end}
                onChange={(event) => set({ end: event.target.value })}
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">Horário local deste dispositivo.</p>
        </>
      )}
    </fieldset>
  );
}
