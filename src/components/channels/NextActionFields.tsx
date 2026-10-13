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
}

const SHORTCUTS = [
  { label: 'Amanhã às 9h', days: 1 },
  { label: 'Em 2 dias', days: 2 },
  { label: 'Em 1 semana', days: 7 },
] as const;

/**
 * A próxima ação de um registro (item 1.9): tipo (padrão: o mesmo canal), título, prazo com atalhos, término para
 * reunião e visita e responsável (só pessoas ativas). Sem ela, a "Próxima ação" da ficha e da oportunidade fica vazia;
 * por isso a caixa vem marcada quando o contato não tem outra ação pendente com prazo.
 */
export function NextActionFields({ value, onChange, required, name, members, disabled = false }: Props) {
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
        <div className="flex items-center gap-2">
          <Checkbox
            id="interaction-next-toggle"
            checked={value.schedule}
            onCheckedChange={(checked) => set({ schedule: checked === true })}
          />
          <Label htmlFor="interaction-next-toggle">Agendar a próxima ação</Label>
        </div>
      )}
      {shown && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="interaction-next-type">Tipo</Label>
              <Select
                value={value.type}
                onValueChange={(type) =>
                  set({ type, ...(value.titleEdited ? {} : { title: nextActionTitle(type, name) }) })
                }
              >
                <SelectTrigger id="interaction-next-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ACTIVITY_LABELS)
                    .filter(([key]) => key !== 'note')
                    .map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="interaction-next-owner">Responsável *</Label>
              <Select
                value={value.userId || 'none'}
                onValueChange={(userId) => set({ userId: userId === 'none' ? '' : userId })}
              >
                <SelectTrigger id="interaction-next-owner">
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
          <div className="space-y-1.5">
            <Label htmlFor="interaction-next-title">O que precisa acontecer? *</Label>
            <Input
              id="interaction-next-title"
              value={value.title}
              maxLength={200}
              onChange={(event) => set({ title: event.target.value, titleEdited: true })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="interaction-next-due">{appointment ? 'Início *' : 'Prazo *'}</Label>
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
              id="interaction-next-due"
              type="datetime-local"
              value={value.due}
              onChange={(event) => changeDue(event.target.value)}
            />
          </div>
          {appointment && (
            <div className="space-y-1.5">
              <Label htmlFor="interaction-next-end">Término *</Label>
              <Input
                id="interaction-next-end"
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
