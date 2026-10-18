import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { Textarea } from '@/components/ds/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ds/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ds/select';
import { LoadingState } from '@/components/foundation/LoadingState';
import { crmDb } from '@/integrations/supabase/crm-client';
import type { CrmRow } from '@/integrations/supabase/commercial-types';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/hooks/useOrg';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import { useCrmSnapshot } from '@/hooks/useCrmSnapshot';
import {
  OUTCOME_LABELS,
  contactName,
  displayDate,
  isChannelType,
  localDateTime,
  nextAction,
  relatedData,
  relationshipError,
  relationshipIndex,
} from '@/lib/contact-model';
import { invalidateCrmTables } from '@/lib/crm-cache';
import {
  insertActivityBatch,
  interactionTitle,
  leftoverNextActionNotice,
  matchingPendingActivity,
  type InteractionChannel,
} from '@/lib/interactions';
import { refusedPlannedTypes } from '@/lib/privacy';
import { CHANNELS_MIGRATION_MISSING, channelsMigrationMissing } from '@/lib/rpc-errors';
import { defaultAssignee } from '@/lib/team-members';
import type { Json } from '@/integrations/supabase/commercial-types';
import type { TablesInsert } from '@/integrations/supabase/database.types';
import {
  newInteractionId,
  useInteractionPrompt,
  type ActivityRef,
  type InteractionRequest,
} from './interaction-context';
import { NextActionFields } from './NextActionFields';
import {
  dueSummary,
  initialNextAction,
  nextActionFields,
  nextActionProblem,
  type NextActionDraft,
} from './next-action';

type Activity = CrmRow<'activities'>;

const REGISTERED: Record<InteractionChannel, string> = {
  call: 'Ligação registrada',
  whatsapp: 'WhatsApp registrado',
  email: 'E-mail registrado',
};
const REGISTER_TITLE: Record<InteractionChannel, string> = {
  call: 'Registrar ligação',
  whatsapp: 'Registrar WhatsApp',
  email: 'Registrar e-mail',
};
/** Um registro pode ser feito até 5 minutos adiante (relógios fora de hora); depois disso é um plano, não um fato. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const CHANGED = 'Esta atividade mudou ou não está mais disponível';

/** A mensagem de uma falha do registro: as recusas do banco (P0001) como estão, o banco sem a migração e o resto. */
function interactionError(error: unknown) {
  if (channelsMigrationMissing(error)) return CHANNELS_MIGRATION_MISSING;
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  if (code === 'P0001' && typeof message === 'string' && message.trim()) return message;
  return relationshipError(error);
}

/**
 * O registro de uma interação (item 1.9; docs/arquitetura/1.9.md, seção 6.3), em três modos: register (interação
 * nova, um único POST em lote com a interação concluída e, se marcada, a próxima ação, com os ids gerados no
 * navegador), complete (complete_activity: conclui a atividade e cria a próxima ação na mesma transação) e schedule (só
 * a próxima ação, depois de um "Concluir" simples). Tudo vai para activities: a linha do tempo 360, "Concluídas hoje" e
 * a "Próxima ação" leem dali. Uma nova tentativa depois de uma resposta perdida não duplica.
 */
export function InteractionDialog({ request, onClose }: { request: InteractionRequest; onClose: () => void }) {
  const snapshot = useCrmSnapshot();
  if (!snapshot.data)
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar</DialogTitle>
            <DialogDescription>Carregando os dados do relacionamento.</DialogDescription>
          </DialogHeader>
          {snapshot.isError ? (
            <p role="alert" className="text-sm text-destructive">
              Não foi possível carregar os dados. Verifique a conexão e tente de novo.
            </p>
          ) : (
            <LoadingState label="Carregando…" />
          )}
        </DialogContent>
      </Dialog>
    );
  return <InteractionForm request={request} data={snapshot.data} onClose={onClose} />;
}

function InteractionForm({
  request,
  data,
  onClose,
}: {
  request: InteractionRequest;
  data: NonNullable<ReturnType<typeof useCrmSnapshot>['data']>;
  onClose: () => void;
}) {
  const { orgId } = useOrg();
  const { user } = useAuth();
  const { canWrite } = useCrmPermissions();
  const prompt = useInteractionPrompt();
  const cache = useQueryClient();
  const index = relationshipIndex(data);
  const { pending } = request;
  // A atividade que este registro conclui: a do pedido ou a de origem da pendência, como foi aberta (a versão lida).
  const [origin] = useState<ActivityRef | null>(
    () =>
      request.activity ??
      (pending?.activityId ? (data.activities.find((a) => a.id === pending.activityId) ?? null) : null),
  );
  const [mode, setMode] = useState(request.mode === 'register' || origin ? request.mode : 'register');
  const contactId = pending?.contactId ?? origin?.contact_id ?? null;
  const contact = contactId ? index.contactById.get(contactId) : undefined;
  const companyId = pending?.companyId ?? origin?.company_id ?? contact?.company_id ?? null;
  const company = companyId ? index.companyById.get(companyId) : undefined;
  const channel: InteractionChannel | null = pending?.channel ?? (isChannelType(origin?.type) ? origin.type : null);
  const name = contact ? contactName(contact) : (company?.name ?? 'Contato indisponível');
  // "Não contatar" (o contato, ou a empresa sem contato): o registro do que aconteceu continua, mas o diálogo não
  // propõe nem exige um novo contato. O banco recusa a ação de contato pendente para quem tem a marca (item 1.10): no
  // contato, ligação, WhatsApp, e-mail, reunião e visita; na empresa sem contato, ligação e WhatsApp. Esses tipos ficam
  // desabilitados na próxima ação.
  const marked = !!(contact ? contact.do_not_contact : company?.do_not_contact);
  const refusedTypes = refusedPlannedTypes({
    contact: contactId ? (contact ?? {}) : null,
    company: company ?? null,
  });
  const now = new Date();
  // A atividade planejada que o registro deveria concluir (exatamente uma até o fim do dia), para não duplicar.
  const suggestion =
    mode === 'register' && channel
      ? matchingPendingActivity(data.activities, { channel, contactId, companyId, dealId: pending?.dealId }, now)
      : { match: null, count: 0 };
  const [useSuggestion, setUseSuggestion] = useState(!!suggestion.match);
  const chosen = mode === 'register' && useSuggestion ? suggestion.match : mode === 'register' ? null : origin;
  // Depois de uma recusa por versão, a atividade é relida no snapshot recarregado: pendente, a nova tentativa vale para
  // a versão atual; concluída (por um colega, ou pela tentativa anterior cuja resposta se perdeu), nada mais é gravado
  // e "Registrar como nova" não aparece, porque duplicaria; inexistente, sobra registrar como nova. Uma atividade de
  // origem que já chega concluída cai no mesmo caso (em "Agendar a próxima", a atividade é a concluída, de propósito).
  const [stale, setStale] = useState<ActivityRef | null>(() =>
    request.mode !== 'schedule' && origin?.completed_at ? origin : null,
  );
  const reloaded = stale ? data.activities.find((a) => a.id === stale.id) : undefined;
  const conflict: 'changed' | 'done' | 'gone' | null = !stale
    ? null
    : !reloaded
      ? 'gone'
      : reloaded.completed_at
        ? 'done'
        : 'changed';
  const target = stale ? (conflict === 'changed' ? reloaded! : stale) : chosen;
  const completing = mode === 'complete' || (mode === 'register' && !!target);
  const kind: InteractionChannel | null = channel ?? null;
  const isCall = (completing ? target?.type : kind) === 'call';
  // Oportunidades em aberto do contato (ou da empresa): a da origem; senão a única; senão "Sem oportunidade".
  const openDeals = (
    contactId
      ? relatedData('contacts', contactId, data)
      : companyId
        ? relatedData('companies', companyId, data)
        : { deals: [] }
  ).deals.filter((deal) => deal.status === 'open');
  const [dealId, setDealId] = useState(
    () => pending?.dealId ?? origin?.deal_id ?? (openDeals.length === 1 ? openDeals[0].id : ''),
  );
  const deal = dealId ? index.dealById.get(dealId) : undefined;
  const [when, setWhen] = useState(() => localDateTime(pending?.openedAt ?? new Date().toISOString()));
  const [outcome, setOutcome] = useState(origin?.outcome ?? '');
  const [note, setNote] = useState('');
  // Sem outra ação pendente com prazo para o contato (e a oportunidade), a próxima ação vem marcada.
  const hasOtherNext = (() => {
    const others = (activities: Activity[]) =>
      activities.filter((a) => a.id !== origin?.id && a.id !== suggestion.match?.id);
    const ofContact = contactId ? nextAction(others(relatedData('contacts', contactId, data).activities)) : null;
    const ofDeal = dealId ? nextAction(others(data.activities.filter((a) => a.deal_id === dealId))) : null;
    return dealId ? !!ofContact && !!ofDeal : !!ofContact;
  })();
  // Com "Não contatar", "Concluir e agendar a próxima" vira um "Concluir" com a próxima ação opcional, desmarcada e do
  // tipo tarefa.
  const requireNext = !!request.requireNext && !marked;
  const required = mode === 'schedule' || requireNext;
  const [next, setNext] = useState<NextActionDraft>(() =>
    initialNextAction({
      schedule: required || (!hasOtherNext && !marked),
      type: marked
        ? 'task'
        : mode === 'schedule'
          ? (request.activity?.type ?? 'task')
          : (channel ?? origin?.type ?? 'task'),
      name,
      userId:
        defaultAssignee(deal?.owner_id ?? contact?.owner_id ?? company?.owner_id, data.members, user?.id ?? null) ?? '',
    }),
  );
  // Os ids nascem com a pendência (ou com o diálogo): a gravação repetida é reconhecida por eles.
  const [interactionId] = useState(() => pending?.id ?? newInteractionId());
  const [nextId] = useState(() => pending?.nextId ?? newInteractionId());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const errorId = useId();
  // A atividade de origem da pendência já está concluída: a pendência cumpriu o papel e sai de "Para registrar".
  const finishedPending = conflict === 'done' && pending && pending.activityId === stale?.id ? pending.key : null;
  const dismissed = useRef<string | null>(null);
  useEffect(() => {
    if (!finishedPending || dismissed.current === finishedPending) return;
    dismissed.current = finishedPending;
    prompt.dismiss(finishedPending);
  }, [finishedPending, prompt]);

  const title =
    mode === 'schedule'
      ? 'Agendar a próxima'
      : requireNext
        ? 'Concluir e agendar a próxima'
        : mode === 'complete'
          ? `Concluir “${origin?.title ?? 'atividade'}”`
          : channel
            ? REGISTER_TITLE[channel]
            : 'Registrar';

  // O que a releitura mostrou depois da recusa (ou na abertura, com a atividade de origem já concluída).
  const conflictText =
    conflict === 'changed' && reloaded!.updated_at !== stale!.updated_at
      ? 'Os dados atuais da atividade foram carregados: confira e use “Concluir” de novo.'
      : conflict === 'done'
        ? 'Esta atividade já foi concluída. Confira o histórico antes de registrar de novo; para guardar a anotação, copie-a antes de fechar.'
        : conflict === 'gone'
          ? 'Esta atividade não está mais disponível.'
          : '';
  const blocked = conflict === 'done' || conflict === 'gone';

  function problem(): string | null {
    if (mode === 'register' && !target) {
      const at = when ? new Date(when).getTime() : NaN;
      if (!Number.isFinite(at)) return 'Informe quando a conversa aconteceu.';
      if (at > Date.now() + FUTURE_TOLERANCE_MS) return 'O registro é do que já aconteceu: use um horário até agora.';
    }
    if (mode !== 'schedule' && isCall && !outcome) return 'Escolha o resultado da ligação.';
    if (required || next.schedule) return nextActionProblem(next);
    return null;
  }

  /**
   * Grava as linhas novas sem duplicar: depois de uma resposta perdida, a chave repetida (23505) faz gravar só as linhas
   * que faltam (achado 4 da revisão do item 1.9, `insertActivityBatch`). `extraIds` é a próxima ação que a pessoa
   * desmarcou depois da tentativa anterior: se ela já tinha sido gravada, volta para o aviso de sucesso.
   */
  async function writeNewRows(rows: TablesInsert<'activities'>[], extraIds: string[] = []) {
    const { leftovers } = await insertActivityBatch(
      {
        insert: (batch) => crmDb.from('activities').insert(batch).select('id'),
        existing: (ids) => crmDb.from('activities').select('id,title').eq('org_id', orgId!).in('id', ids),
      },
      rows,
      extraIds,
    );
    return leftovers;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!orgId || !user || !canWrite || saving || blocked) return;
    const found = problem();
    if (found) {
      setError(found);
      return;
    }
    setSaving(true);
    setError('');
    const scheduled = required || next.schedule;
    const links = {
      contact_id: contactId,
      company_id: contact?.company_id ?? companyId,
      deal_id: dealId || null,
    };
    let leftover: { id: string; title: string } | undefined;
    try {
      if (mode === 'schedule') {
        const done = request.activity!;
        await writeNewRows([
          {
            id: nextId,
            org_id: orgId,
            ...nextActionFields(next),
            body: null,
            completed_at: null,
            contact_id: done.contact_id,
            company_id: done.company_id,
            deal_id: done.deal_id,
          },
        ]);
      } else if (completing && target) {
        const result = await crmDb.rpc('complete_activity', {
          p_activity_id: target.id,
          p_version: target.updated_at,
          p_outcome: target.type === 'call' ? outcome || null : null,
          p_note: note.trim() || null,
          p_next: scheduled
            ? ({
                id: nextId,
                ...nextActionFields(next),
                // Na sugestão de uma interação, os vínculos escolhidos no diálogo; na conclusão, os da atividade.
                ...(mode === 'register' ? links : {}),
              } as Json)
            : null,
        });
        if (result.error) throw result.error;
      } else {
        const at = new Date(when).toISOString();
        const interaction: TablesInsert<'activities'> = {
          id: interactionId,
          org_id: orgId,
          type: channel!,
          title: interactionTitle(channel!, name, pending ? prompt.subjectOf(pending.key) : null),
          body: note.trim() || null,
          due_date: at,
          end_date: null,
          completed_at: at,
          outcome: channel === 'call' ? outcome : null,
          user_id: user.id,
          ...links,
        };
        // As duas linhas com as mesmas chaves, todas explícitas: no lote, a coluna que falta numa linha e existe na outra
        // seria gravada como nula, e não com o padrão.
        const rows: TablesInsert<'activities'>[] = [interaction];
        if (scheduled)
          rows.push({
            id: nextId,
            org_id: orgId,
            ...nextActionFields(next),
            body: null,
            completed_at: null,
            outcome: null,
            ...links,
          });
        [leftover] = await writeNewRows(rows, scheduled ? [] : [nextId]);
      }
      if (pending) prompt.dismiss(pending.key);
      await invalidateCrmTables(cache, ['activities']);
      const message =
        mode === 'schedule' ? 'Próxima ação agendada' : completing ? 'Atividade concluída' : REGISTERED[channel!];
      toast.success(
        message,
        scheduled
          ? { description: `Próxima ação: ${dueSummary(new Date(next.due).toISOString())}` }
          : leftover
            ? { description: leftoverNextActionNotice(leftover.title) }
            : undefined,
      );
      onClose();
    } catch (cause) {
      const text = interactionError(cause);
      setError(text);
      if (text.startsWith(CHANGED) && completing && target) {
        // Guarda a versão recusada; o snapshot recarregado diz o que aconteceu com a atividade (acima).
        setStale(target);
        await invalidateCrmTables(cache, ['activities']);
      }
    } finally {
      setSaving(false);
    }
  }

  const registerAsNew = () => {
    setMode('register');
    setUseSuggestion(false);
    setStale(null);
    setError('');
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent
        className="max-h-[92dvh] overflow-y-auto sm:max-w-lg"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {mode === 'schedule'
              ? `Defina o próximo passo com ${name}.`
              : `${name}. O registro entra no histórico e conta como trabalho feito no dia.`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4" noValidate>
          {mode === 'register' && suggestion.match && (
            <fieldset className="space-y-2 rounded-lg border p-3">
              <legend className="px-1 text-xs font-semibold">Atividade pendente</legend>
              <RadioGroup
                value={useSuggestion ? 'complete' : 'new'}
                onValueChange={(value) => {
                  setUseSuggestion(value === 'complete');
                  setStale(null);
                }}
              >
                <div className="eia-touch-row flex items-center gap-2">
                  <RadioGroupItem id="interaction-suggested" value="complete" />
                  <Label htmlFor="interaction-suggested" className="flex-1 py-2 font-normal leading-snug">
                    Concluir “{suggestion.match.title}” ({displayDate(suggestion.match.due_date)})
                  </Label>
                </div>
                <div className="eia-touch-row flex items-center gap-2">
                  <RadioGroupItem id="interaction-new" value="new" />
                  <Label htmlFor="interaction-new" className="flex-1 py-2 font-normal">
                    Registrar como nova
                  </Label>
                </div>
              </RadioGroup>
            </fieldset>
          )}
          {mode === 'register' && suggestion.count > 1 && channel && (
            <p className="text-xs text-muted-foreground">
              Há {suggestion.count} {channel === 'call' ? 'ligações' : 'atividades deste canal'} pendentes{' '}
              {contactId ? 'para este contato' : 'para esta empresa'} até o fim do dia; conclua a certa pela lista.
            </p>
          )}
          {mode === 'register' && !target && (
            <div className="space-y-1.5">
              <Label htmlFor="interaction-when">Quando *</Label>
              <Input
                id="interaction-when"
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            </div>
          )}
          {mode !== 'schedule' && isCall && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Resultado *</legend>
              <RadioGroup value={outcome} onValueChange={setOutcome} className="flex flex-wrap gap-x-5 gap-y-0">
                {Object.entries(OUTCOME_LABELS).map(([key, label]) => (
                  <div key={key} className="eia-touch-row flex min-h-11 items-center gap-2">
                    <RadioGroupItem id={`interaction-outcome-${key}`} value={key} />
                    <Label htmlFor={`interaction-outcome-${key}`} className="py-2 pr-1 font-normal">
                      {label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>
          )}
          {mode === 'register' && !target && (
            <div className="space-y-1.5">
              <Label htmlFor="interaction-deal">Oportunidade</Label>
              <Select value={dealId || 'none'} onValueChange={(value) => setDealId(value === 'none' ? '' : value)}>
                <SelectTrigger id="interaction-deal">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem oportunidade</SelectItem>
                  {deal && !openDeals.some((item) => item.id === deal.id) && (
                    <SelectItem value={deal.id}>{deal.title}</SelectItem>
                  )}
                  {openDeals.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {mode !== 'schedule' && (
            <div className="space-y-1.5">
              <Label htmlFor="interaction-note">Anotação</Label>
              <Textarea
                id="interaction-note"
                rows={3}
                maxLength={10000}
                value={note}
                placeholder="O que foi combinado, objeções, próximos passos"
                onChange={(e) => setNote(e.target.value)}
              />
              {completing && (
                <p className="text-xs text-muted-foreground">A anotação vai para o fim dos detalhes da atividade.</p>
              )}
            </div>
          )}
          <NextActionFields
            value={next}
            onChange={setNext}
            required={required}
            name={name}
            members={data.members}
            disabled={saving}
            disabledTypes={refusedTypes}
            disabledReason={
              refusedTypes.size
                ? contactId
                  ? 'Ligação, WhatsApp, e-mail, reunião e visita ficam indisponíveis: este contato está marcado como “Não contatar”.'
                  : 'Ligação e WhatsApp ficam indisponíveis: esta empresa está marcada como “Não contatar”.'
                : null
            }
          />
          {marked && (
            <p role="status" className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
              {contact
                ? mode === 'schedule'
                  ? 'Este contato está marcado como “Não contatar”: a próxima ação só pode ser uma tarefa interna, como preparar um documento.'
                  : 'Este contato está marcado como “Não contatar”. Registre o que aconteceu; a próxima ação, se houver, só pode ser uma tarefa interna.'
                : mode === 'schedule'
                  ? 'Esta empresa está marcada como “Não contatar”: a próxima ação não pode ser ligação nem WhatsApp para o telefone dela.'
                  : 'Esta empresa está marcada como “Não contatar”. Registre o que aconteceu; a próxima ação não pode ser ligação nem WhatsApp para o telefone dela.'}
            </p>
          )}
          {(error || conflictText) && (
            <div
              id={errorId}
              role="alert"
              className="space-y-2 rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
            >
              {error && <p>{error}</p>}
              {conflictText && <p>{conflictText}</p>}
              {conflict === 'gone' && channel && (
                <Button type="button" size="sm" variant="outline" className="eia-touch-target" onClick={registerAsNew}>
                  Registrar como nova
                </Button>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" className="eia-touch-target" disabled={saving} onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              className="eia-touch-target"
              disabled={saving || !canWrite || blocked}
              aria-describedby={error || conflictText ? errorId : undefined}
            >
              {saving ? 'Salvando…' : mode === 'schedule' ? 'Agendar' : completing ? 'Concluir' : 'Registrar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
