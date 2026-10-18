import { useId, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { crmDb } from '@/integrations/supabase/crm-client';
import { useOrg } from '@/hooks/useOrg';
import { useAuth } from '@/contexts/AuthContext';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { Textarea } from '@/components/ds/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ds/dialog';
import { Select, SelectTrigger, SelectContent, SelectValue, SelectItem } from '@/components/ds/select';
import {
  ACTIVITY_LABELS,
  APPOINTMENT_TYPES,
  OUTCOME_LABELS,
  contactName,
  localDateTime,
  relationshipError,
  relationshipIndex,
  type RelationshipData,
} from '@/lib/contact-model';
import { CHANNELS_MIGRATION_MISSING, channelsMigrationMissing } from '@/lib/rpc-errors';
import { rescheduledEnd, type Activity } from '@/lib/activity-logic';
import { invalidateCrmTables } from '@/lib/crm-cache';
import { assignableMembers, defaultAssignee, memberLabel } from '@/lib/team-members';
import { linkableContacts, refusedPlannedTypes } from '@/lib/privacy';
import { toast } from 'sonner';
export interface ActivityDefaults {
  title?: string;
  body?: string;
  type?: string;
  contact_id?: string | null;
  company_id?: string | null;
  deal_id?: string | null;
  user_id?: string | null;
  due_date?: string | null;
}
/** Um registro do que já aconteceu pode ser feito até 5 minutos adiante (relógios fora de hora), como no item 1.9. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
/** O que a tela diz quando a marca "Não contatar" trava "Já aconteceu" (item 1.10). */
const LOCKED_HAPPENED = {
  contact:
    'Este contato está marcado como “Não contatar”: o CRM não agenda ligação, WhatsApp, e-mail, reunião nem visita com ele. Registre aqui o que já aconteceu, ou escolha Tarefa.',
  company:
    'Esta empresa está marcada como “Não contatar”: o CRM não agenda ligação nem WhatsApp para o telefone dela. Registre aqui o que já aconteceu, ou escolha Tarefa.',
} as const;
/**
 * O aviso na edição de uma atividade cujo alvo tem "Não contatar" (item 1.10), pelo que o banco recusa
 * (refuse_do_not_contact_action): a ação pendente que já existia continua, e trocar o tipo por outra ação de contato é
 * recusado (na empresa sem contato, só ligação e WhatsApp); a concluída pode ser corrigida, e reabrir é recusado.
 */
function editWarning(target: 'contact' | 'company', completed: boolean) {
  const who =
    target === 'contact'
      ? 'Este contato está marcado como “Não contatar”.'
      : 'Esta empresa está marcada como “Não contatar”.';
  if (completed) return `${who} Corrigir este registro continua possível, e reabrir é recusado.`;
  return target === 'contact'
    ? `${who} A ação já agendada continua, e trocar o tipo por outra ação de contato (ligação, WhatsApp, e-mail, reunião ou visita) é recusado.`
    : `${who} A ação já agendada continua, e trocar o tipo por ligação ou WhatsApp é recusado.`;
}
interface Props {
  data: RelationshipData;
  activity?: Activity;
  defaults?: ActivityDefaults;
  onClose: () => void;
  onSaved?: (id: string) => void;
}
export function ActivityDialog({ data, activity: initialActivity, defaults = {}, onClose, onSaved }: Props) {
  const { orgId } = useOrg();
  const { user } = useAuth();
  const { canWrite } = useCrmPermissions();
  const cache = useQueryClient();
  // The form and its version must stay together when a background query refreshes.
  const [activity] = useState(initialActivity);
  const [type, setType] = useState(activity?.type ?? defaults.type ?? 'task'),
    [title, setTitle] = useState(activity?.title ?? defaults.title ?? ''),
    [body, setBody] = useState(activity?.body ?? defaults.body ?? '');
  // O início e o término com que o formulário abre. Uma ação nova que já nasce com "Já aconteceu" travada (item 1.10:
  // um tipo de contato para quem tem "Não contatar") abre com a hora atual, e o compromisso, com 1 hora de duração.
  const [opening] = useState(() => {
    const due = activity?.due_date ?? defaults.due_date ?? null;
    const lookup = relationshipIndex(data);
    const locked =
      !activity &&
      !due &&
      refusedPlannedTypes({
        contact: defaults.contact_id ? (lookup.contactById.get(defaults.contact_id) ?? {}) : null,
        company: defaults.company_id ? (lookup.companyById.get(defaults.company_id) ?? {}) : null,
      }).has(defaults.type ?? 'task');
    const start = due ?? (locked ? new Date().toISOString() : null);
    const appointmentType = APPOINTMENT_TYPES.includes(activity?.type ?? defaults.type ?? '');
    return {
      date: localDateTime(start),
      end: localDateTime(
        activity?.end_date ??
          (appointmentType && start ? rescheduledEnd({ due_date: null, end_date: null }, start) : null),
      ),
    };
  });
  const [date, setDate] = useState(opening.date);
  const [end, setEnd] = useState(opening.end);
  // Uma atividade nova não cai num responsável desativado (item 1.2): sem o padrão ativo, vai para quem está usando.
  const [owner, setOwner] = useState(
    activity ? (activity.user_id ?? '') : (defaultAssignee(defaults.user_id, data.members, user?.id ?? null) ?? ''),
  );
  const [contact, setContact] = useState(activity?.contact_id ?? defaults.contact_id ?? ''),
    [company, setCompany] = useState(activity?.company_id ?? defaults.company_id ?? ''),
    [deal, setDeal] = useState(activity?.deal_id ?? defaults.deal_id ?? '');
  const [saving, setSaving] = useState(false),
    [error, setError] = useState<string | null>(null);
  // Resultado de uma ligação já concluída, para corrigir em "Editar" (item 1.9). Só vai na gravação quando a pessoa o
  // muda: um banco sem a migração dos canais (a linha lida não tem a coluna) continua aceitando as demais edições.
  const [outcome, setOutcome] = useState(activity?.outcome ?? '');
  const appointment = APPOINTMENT_TYPES.includes(type);
  const editsOutcome = !!activity?.completed_at && activity.type !== 'note' && type === 'call';
  const outcomeChanged = editsOutcome && (outcome || null) !== (activity?.outcome ?? null);
  // Aviso de "Não contatar" num canal (WhatsApp, e-mail ou ligação): não bloqueia, porque registrar uma ligação recebida
  // ou uma conversa que já aconteceu continua possível.
  const index = relationshipIndex(data);
  const markedContact = contact ? index.contactById.get(contact)?.do_not_contact : false;
  const markedCompany = !contact && company ? index.companyById.get(company)?.do_not_contact : false;
  // "Já aconteceu" (item 1.10): na criação de qualquer tipo que não é nota, a atividade nasce concluída na hora
  // informada. Para quem tem "Não contatar", o banco recusa a ação de contato pendente: os tipos recusados só são
  // criados com "Já aconteceu", que vem marcada e travada, com o motivo ligado à caixa.
  const [happenedChoice, setHappenedChoice] = useState(false);
  const refused = refusedPlannedTypes({
    contact: contact ? (index.contactById.get(contact) ?? {}) : null,
    company: company ? (index.companyById.get(company) ?? {}) : null,
  });
  const lockedHappened = !activity && refused.has(type);
  const happened = !activity && type !== 'note' && (happenedChoice || lockedHappened);
  const happenedHintId = useId();
  function changeStart(value: string) {
    if (appointment && value && Number.isFinite(new Date(value).getTime()))
      setEnd(
        localDateTime(
          rescheduledEnd(
            {
              due_date: date ? new Date(date).toISOString() : null,
              end_date: end ? new Date(end).toISOString() : null,
            },
            new Date(value).toISOString(),
          ),
        ),
      );
    setDate(value);
  }
  /** "Já aconteceu" sem data: a hora atual e, no compromisso, o término 1 hora depois, como ao trocar o início. */
  function fillNow(nextType: string) {
    if (date) return;
    const now = new Date().toISOString();
    setDate(localDateTime(now));
    if (APPOINTMENT_TYPES.includes(nextType) && !end)
      setEnd(localDateTime(rescheduledEnd({ due_date: null, end_date: null }, now)));
  }
  /** Com "Já aconteceu" travada pela marca, o campo da data já vem com a hora atual. */
  function fillHappenedDate(nextType: string, nextContact: string, nextCompany: string) {
    if (activity || date) return;
    const blocked = refusedPlannedTypes({
      contact: nextContact ? (index.contactById.get(nextContact) ?? {}) : null,
      company: nextCompany ? (index.companyById.get(nextCompany) ?? {}) : null,
    });
    if (blocked.has(nextType)) fillNow(nextType);
  }
  function changeType(value: string) {
    fillHappenedDate(value, contact, company);
    setType(value);
    if (APPOINTMENT_TYPES.includes(value) && date && !end)
      setEnd(localDateTime(rescheduledEnd({ due_date: null, end_date: null }, new Date(date).toISOString())));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!orgId || !user || !canWrite || saving) return;
    if (!title.trim()) {
      setError('Informe um título para esta atividade.');
      return;
    }
    if (happened) {
      const at = date ? new Date(date).getTime() : NaN;
      if (!Number.isFinite(at)) {
        setError('Informe quando aconteceu.');
        return;
      }
      if (at > Date.now() + FUTURE_TOLERANCE_MS) {
        setError('“Já aconteceu” é o registro do que passou: use um horário até agora.');
        return;
      }
    }
    if (
      (type !== 'note' && date && !Number.isFinite(new Date(date).getTime())) ||
      (appointment &&
        (!date ||
          !end ||
          !Number.isFinite(new Date(end).getTime()) ||
          new Date(end).getTime() <= new Date(date).getTime()))
    ) {
      setError('Informe um início válido e um término posterior ao início para o compromisso.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        org_id: orgId,
        title: title.trim(),
        body: body.trim() || null,
        type,
        user_id: owner || null,
        due_date: type === 'note' || !date ? null : new Date(date).toISOString(),
        end_date: appointment && end ? new Date(end).toISOString() : null,
        ...(!activity
          ? {
              completed_at: type === 'note' ? new Date().toISOString() : happened ? new Date(date).toISOString() : null,
            }
          : type === 'note' && activity.type !== 'note'
            ? { completed_at: new Date().toISOString() }
            : type !== 'note' && activity.type === 'note'
              ? { completed_at: null }
              : {}),
        contact_id: contact || null,
        company_id: company || null,
        deal_id: deal || null,
        ...(outcomeChanged || (happened && type === 'call' && outcome) ? { outcome: outcome || null } : {}),
      };
      const result = activity
        ? await crmDb
            .from('activities')
            .update(payload)
            .eq('org_id', orgId)
            .eq('id', activity.id)
            .eq('updated_at', activity.updated_at)
            .select('id')
            .maybeSingle()
        : await crmDb
            .from('activities')
            .insert({ ...payload, created_by: user.id })
            .select('id')
            .single();
      if (result.error) throw result.error;
      if (!result.data) {
        setError(
          'Esta atividade mudou ou não está mais disponível. Seu preenchimento foi preservado; copie suas alterações e reabra a atividade para revisar os dados atuais.',
        );
        await invalidateCrmTables(cache, ['activities']);
        return;
      }
      await invalidateCrmTables(cache, ['activities']);
      toast.success(
        activity
          ? 'Atividade atualizada'
          : type === 'note'
            ? 'Nota registrada'
            : happened
              ? 'Atividade registrada como concluída'
              : 'Atividade criada',
      );
      if (onSaved) onSaved(result.data.id);
      else onClose();
    } catch (cause) {
      setError(channelsMigrationMissing(cause) ? CHANNELS_MIGRATION_MISSING : relationshipError(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {activity ? 'Editar atividade' : type === 'note' ? 'Registrar nota' : 'Nova atividade'}
          </DialogTitle>
          <DialogDescription>
            Uma atividade pode se conectar a pessoas, empresas e oportunidades. Campos com * são obrigatórios.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="workday-activity-type">Tipo</Label>
            <Select value={type} onValueChange={changeType}>
              <SelectTrigger id="workday-activity-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ACTIVITY_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="workday-activity-title">Título *</Label>
            <Input
              id="workday-activity-title"
              autoFocus
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={type === 'note' ? 'Ex.: Contexto da conversa' : 'Ex.: Retornar sobre a proposta'}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="workday-activity-body">Detalhes</Label>
            <Textarea
              id="workday-activity-body"
              rows={3}
              maxLength={10000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
          {!activity && type !== 'note' && (
            <div className="space-y-1">
              <div className="eia-touch-row flex items-center gap-2">
                <Checkbox
                  id="workday-activity-happened"
                  checked={happened}
                  disabled={lockedHappened}
                  aria-describedby={happenedHintId}
                  onCheckedChange={(checked) => {
                    setHappenedChoice(checked === true);
                    if (checked === true) fillNow(type);
                  }}
                />
                <Label htmlFor="workday-activity-happened" className="flex-1 py-2 font-normal">
                  Já aconteceu
                </Label>
              </div>
              <p id={happenedHintId} className="text-xs text-muted-foreground">
                {lockedHappened
                  ? contact
                    ? LOCKED_HAPPENED.contact
                    : LOCKED_HAPPENED.company
                  : 'Registra a atividade já concluída, na hora em que aconteceu, como uma ligação recebida.'}
              </p>
            </div>
          )}
          {type !== 'note' && (
            <div className="space-y-2">
              <div className={appointment ? 'grid gap-3 sm:grid-cols-2' : ''}>
                <div className="space-y-1.5">
                  <Label htmlFor="workday-activity-date">
                    {happened ? 'Quando aconteceu *' : appointment ? 'Início *' : 'Prazo'}
                  </Label>
                  <Input
                    id="workday-activity-date"
                    type="datetime-local"
                    required={appointment || happened}
                    value={date}
                    onChange={(e) => changeStart(e.target.value)}
                  />
                </div>
                {appointment && (
                  <div className="space-y-1.5">
                    <Label htmlFor="workday-activity-end">Término *</Label>
                    <Input
                      id="workday-activity-end"
                      type="datetime-local"
                      required
                      value={end}
                      onChange={(e) => setEnd(e.target.value)}
                    />
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Horário local deste dispositivo.
                {!appointment &&
                  !happened &&
                  ' Sem prazo, a atividade aparece em “Sem data” e não conta como próxima ação.'}
                {appointment && date && end && new Date(end) > new Date(date)
                  ? ` Duração: ${Math.round((new Date(end).getTime() - new Date(date).getTime()) / 60000)} min.`
                  : ''}
              </p>
            </div>
          )}
          {(editsOutcome || (happened && type === 'call')) && (
            <div className="space-y-1.5">
              <Label htmlFor="workday-activity-outcome">Resultado</Label>
              <Select value={outcome || 'none'} onValueChange={(v) => setOutcome(v === 'none' ? '' : v)}>
                <SelectTrigger id="workday-activity-outcome">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem resultado</SelectItem>
                  {Object.entries(OUTCOME_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="workday-activity-owner">Responsável</Label>
            <Select value={owner || 'none'} onValueChange={(v) => setOwner(v === 'none' ? '' : v)}>
              <SelectTrigger id="workday-activity-owner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem responsável</SelectItem>
                {assignableMembers(data.members, activity?.user_id).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {memberLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <fieldset className="space-y-3 rounded-lg border p-3">
            <legend className="px-1 text-xs font-semibold">Vínculos</legend>
            <div className="space-y-1.5">
              <Label htmlFor="workday-activity-contact">Contato</Label>
              <Select
                value={contact || 'none'}
                onValueChange={(v) => {
                  fillHappenedDate(type, v === 'none' ? '' : v, company);
                  setContact(v === 'none' ? '' : v);
                }}
              >
                <SelectTrigger id="workday-activity-contact">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem contato</SelectItem>
                  {/* O contato anonimizado (item 1.10) não recebe vínculo novo; numa edição, o atual continua. */}
                  {linkableContacts(data.contacts, activity?.contact_id).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {contactName(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="workday-activity-company">Empresa</Label>
              <Select
                value={company || 'none'}
                onValueChange={(v) => {
                  fillHappenedDate(type, contact, v === 'none' ? '' : v);
                  setCompany(v === 'none' ? '' : v);
                }}
              >
                <SelectTrigger id="workday-activity-company">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem empresa</SelectItem>
                  {data.companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="workday-activity-deal">Oportunidade</Label>
              <Select value={deal || 'none'} onValueChange={(v) => setDeal(v === 'none' ? '' : v)}>
                <SelectTrigger id="workday-activity-deal">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem oportunidade</SelectItem>
                  {data.deals.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </fieldset>
          {activity && refused.has(type) && (
            <p role="status" className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
              {editWarning(markedContact ? 'contact' : 'company', !!activity.completed_at)}
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
          {!canWrite && <p className="text-xs text-muted-foreground">Seu papel permite somente consulta.</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving || !canWrite}>
              {saving ? 'Salvando…' : 'Salvar atividade'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
