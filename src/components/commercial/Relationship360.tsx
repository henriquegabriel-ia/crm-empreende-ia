import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  CalendarPlus,
  Check,
  CircleHelp,
  FileText,
  Handshake,
  Pencil,
  Plus,
  Trash2,
  Undo2,
  UserRound,
} from 'lucide-react';
import { crmDb } from '@/integrations/supabase/crm-client';
import { useOrg } from '@/hooks/useOrg';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import { Button } from '@/components/ds/button';
import { Select, SelectTrigger, SelectContent, SelectValue, SelectItem } from '@/components/ds/select';
import { EmptyState } from '@/components/foundation/EmptyState';
import { ConfirmDialog } from '@/components/foundation/ConfirmDialog';
import { SidePanel } from '@/components/foundation/SidePanel';
import {
  ACTIVITY_LABELS,
  ACTIVITY_PLURAL_LABELS,
  CONTACT_STATUS_LABELS,
  OUTCOME_LABELS,
  contactName,
  displayDate,
  isChannelType,
  recordName,
  relatedData,
  relationshipError,
  relationshipIndex,
  safeWebsite,
  type Company,
  type Contact,
  type DirectoryKind,
  type RelationshipActivity,
  type RelationshipData,
} from '@/lib/contact-model';
import { linkSummary } from '@/lib/record-links';
import { memberLabel } from '@/lib/team-members';
import { formatPhoneBR } from '@/lib/phone';
import { byTimelineMoment, lastInteraction, timelineMoment } from '@/lib/interactions';
import { ChannelBar } from '@/components/channels/ChannelBar';
import { DoNotContactPanel } from '@/components/channels/DoNotContactPanel';
import { useInteractionPrompt } from '@/components/channels/interaction-context';
import { useActivityActions } from '@/components/workday/useActivityActions';
import { AnonymizedBanner } from '@/components/privacy/AnonymizedBanner';
import { ContactPrivacySection } from '@/components/privacy/ContactPrivacySection';
import { LegalBasisSummary } from '@/components/privacy/LegalBasisSummary';
import { isAnonymized, isFrozenActivity } from '@/lib/privacy';
import { ActivityEditor } from './ActivityEditor';
import { invalidateCrmTables } from '@/lib/crm-cache';
import { toast } from 'sonner';

/** Filtros por tipo da linha do tempo (item 1.9): os canais, os compromissos e as notas. */
const TIMELINE_TYPES = ['call', 'whatsapp', 'email', 'meeting', 'visit', 'note'] as const;
interface Props {
  kind: DirectoryKind;
  record?: Contact | Company;
  data: RelationshipData;
  onClose: () => void;
  onEdit: () => void;
}
export function Relationship360({ kind, record, data, onClose, onEdit }: Props) {
  const { orgId } = useOrg();
  const { canWrite, canManage } = useCrmPermissions();
  const cache = useQueryClient();
  const [activityEditor, setActivityEditor] = useState<{
    activity?: RelationshipActivity;
    initialType?: string;
  } | null>(null);
  const [timelineFilter, setTimelineFilter] = useState('all');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Concluir e reabrir usam a mesma gravação de Hoje, Agenda e Atividades, com a guarda de updated_at: se outra
  // pessoa mudou a atividade, a ficha mostra o conflito e recarrega, em vez de desfazer a mudança do colega.
  const activityActions = useActivityActions();
  const prompt = useInteractionPrompt();
  const busy = deleting ? 'delete' : activityActions.busy;
  const error = deleteError ?? activityActions.error;
  const related = useMemo(() => relatedData(kind, record?.id ?? '', data), [kind, record?.id, data]);
  // Índice do snapshot (item 0.10): nome do responsável de cada item da linha do tempo sem varrer a equipe, com a marca
  // "(desativado)" de quem saiu da equipe (item 1.2).
  const memberName = (id: string | null | undefined) =>
    memberLabel(id ? relationshipIndex(data).memberById.get(id) : undefined, id);
  const owner = data.members.find((m) => m.id === record?.owner_id);
  const visible = related.activities
    .filter(
      (a) =>
        timelineFilter === 'all' ||
        (timelineFilter === 'pending' && !a.completed_at && a.type !== 'note') ||
        (timelineFilter === 'completed' && !!a.completed_at && a.type !== 'note') ||
        a.type === timelineFilter,
    )
    // Pela data do fato: a interação registrada depois aparece quando aconteceu, como no "Último contato" (item 1.9).
    .sort(byTimelineMoment);
  // Recebimentos não estão no snapshot: a exclusão, só para quem administra, confere quantos estão vinculados ao
  // cadastro (só a contagem, como loadDealLinks).
  const linkedPayments = useQuery({
    queryKey: ['crm', orgId, 'linked-payments', kind, record?.id],
    enabled: !!orgId && !!record && canManage,
    queryFn: async () => {
      const { count, error: countError } = await crmDb
        .from('payments')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId!)
        .eq(kind === 'contacts' ? 'contact_id' : 'company_id', record!.id);
      if (countError) throw countError;
      // Sem a contagem, a ficha não pode afirmar que não há recebimentos vinculados.
      if (count === null) throw new Error('Não foi possível conferir os recebimentos vinculados. Tente novamente.');
      return count;
    },
  });
  const linkedPaymentCount = linkedPayments.data ?? 0;
  const linkedText = linkSummary([
    [kind === 'companies' ? related.contacts.length : 0, 'contato', 'contatos'],
    [related.deals.length, 'oportunidade', 'oportunidades'],
    [related.activities.length, 'atividade', 'atividades'],
    [linkedPaymentCount, 'recebimento', 'recebimentos'],
  ]);
  const linkedHistory = !!linkedText;
  const linksPending = linkedPayments.isPending || linkedPayments.isError;
  // O botão desabilitado aponta para o parágrafo que explica o bloqueio ou a conferência em andamento.
  const deleteStatusId = useId();
  const deleteStatus = linkedPayments.isError || linkedHistory || linkedPayments.isPending;
  async function toggleActivity(activity: RelationshipActivity) {
    if (busy) return;
    setDeleteError(null);
    await activityActions.toggle(activity);
  }
  async function remove() {
    if (!orgId || !record || !canManage || linkedHistory || linksPending || busy) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await crmDb.from(kind).delete().eq('org_id', orgId).eq('id', record.id).select('id').single();
      if (result.error) throw result.error;
      await invalidateCrmTables(cache, [kind]);
      toast.success('Cadastro excluído');
      onClose();
    } catch (cause) {
      setDeleteError(relationshipError(cause));
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }
  const contact = record && 'first_name' in record ? record : null;
  const company = record && 'name' in record ? record : null;
  const companyLink = contact?.company_id ? data.companies.find((c) => c.id === contact.company_id) : null;
  const website = safeWebsite(company?.website ?? null);
  // "Último contato" (item 1.9): a interação concluída mais recente, com o resultado, a data e quem fez.
  const last = lastInteraction(related.activities);
  // A marca de um contato não alcança o telefone da empresa: a ficha da empresa diz quantos contatos dela estão marcados.
  const markedContacts = company ? related.contacts.filter((c) => c.do_not_contact).length : 0;
  // Ficha marcada "Não contatar": os estados vazios não pedem um novo contato. A marca do contato tira ele da regra
  // "sem próxima ação" da fila de atenção; a da empresa vale só para o telefone dela.
  const marked = !!record?.do_not_contact;
  // Contato anonimizado (item 1.10): a ficha fica só para consulta. O banco recusa devolver dados pessoais a ele e ligar
  // registros novos, e as atividades dele não são editadas nem reabertas.
  const anonymized = !!contact && isAnonymized(contact);
  const index = relationshipIndex(data);
  // Com uma única oportunidade em aberto, ela é o contexto dos canais: {{oportunidade}} e o vínculo do registro.
  const openDeals = related.deals.filter((deal) => deal.status === 'open');
  const singleOpenDeal = openDeals.length === 1 ? openDeals[0] : null;
  return (
    <>
      <SidePanel
        open
        onOpenChange={(open) => {
          if (!open && !busy) onClose();
        }}
        title={record ? recordName(record) : 'Cadastro indisponível'}
        description="Relacionamento 360 · histórico e próximos passos"
        kicker={kind === 'contacts' ? 'Contato' : 'Empresa'}
        width="lg"
      >
        {!record ? (
          <EmptyState
            icon={CircleHelp}
            title="Cadastro não encontrado ou sem acesso"
            description="O link pode estar incorreto, o registro pode ter sido removido ou seu acesso pode ter mudado."
            action={
              <Button variant="outline" onClick={onClose}>
                Voltar à lista
              </Button>
            }
          />
        ) : (
          <div className="space-y-6">
            <section data-tour="360-summary" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm">
                  <UserRound className="h-4 w-4 text-muted-foreground" />
                  <span>{memberLabel(owner, record.owner_id)}</span>
                </div>
                {canWrite && !anonymized && (
                  <Button variant="outline" size="sm" onClick={onEdit}>
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    Editar cadastro
                  </Button>
                )}
              </div>
              {anonymized && contact ? (
                <AnonymizedBanner contact={contact} members={data.members} />
              ) : (
                <>
                  {/* Canais (item 1.9): WhatsApp, e-mail e telefone abrem o aplicativo da pessoa; o registro é oferecido. */}
                  <ChannelBar
                    contact={contact}
                    company={contact ? companyLink : company}
                    deal={singleOpenDeal}
                    members={data.members}
                    showPending
                    tour="360-channels"
                  />
                  <DoNotContactPanel
                    kind={kind}
                    record={record}
                    members={data.members}
                    markedContacts={markedContacts}
                  />
                </>
              )}
              <dl className="grid gap-3 rounded-xl border bg-muted/20 p-4 text-sm sm:grid-cols-2">
                {contact && (
                  <div>
                    <dt className="text-xs text-muted-foreground">E-mail</dt>
                    <dd className="mt-1 break-all">{contact.email || 'Não informado'}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs text-muted-foreground">Telefone</dt>
                  <dd className="mt-1">
                    {record.phone ? formatPhoneBR(record.phone) || record.phone : 'Não informado'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Último contato</dt>
                  <dd className="mt-1">
                    {last
                      ? [
                          ACTIVITY_LABELS[last.type] ?? 'Atividade',
                          last.outcome ? OUTCOME_LABELS[last.outcome] : null,
                          displayDate(last.completed_at),
                          memberName(last.user_id),
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : 'Nenhuma interação concluída'}
                  </dd>
                </div>
                {contact && (
                  <>
                    <div>
                      <dt className="text-xs text-muted-foreground">Empresa</dt>
                      <dd className="mt-1">
                        {companyLink ? (
                          <Link className="text-primary hover:underline" to={`/companies?company=${companyLink.id}`}>
                            {companyLink.name}
                          </Link>
                        ) : (
                          'Sem empresa'
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Relacionamento</dt>
                      <dd className="mt-1">
                        {CONTACT_STATUS_LABELS[contact.status ?? ''] ?? contact.status ?? 'Não informado'}
                      </dd>
                    </div>
                    {/* Base legal (item 1.10), para todos os papéis; sem a migração, a coluna não vem e a linha some. */}
                    {'legal_basis' in contact && (
                      <LegalBasisSummary contact={contact} members={data.members} canWrite={canWrite && !anonymized} />
                    )}
                  </>
                )}
                {company && (
                  <>
                    <div>
                      <dt className="text-xs text-muted-foreground">Segmento</dt>
                      <dd className="mt-1">{company.industry || 'Não informado'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Site</dt>
                      <dd className="mt-1 break-all">
                        {website ? (
                          <a href={website} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                            {company.website}
                          </a>
                        ) : (
                          'Não informado'
                        )}
                      </dd>
                    </div>
                  </>
                )}
                <div>
                  <dt className="text-xs text-muted-foreground">Criado em</dt>
                  <dd className="mt-1">{displayDate(record.created_at)}</dd>
                </div>
              </dl>
              {!canWrite && (
                <p className="text-xs text-muted-foreground">
                  Seu papel permite consultar o histórico. Donos, administradores e colaboradores atualizam o cadastro e
                  as atividades.
                </p>
              )}
            </section>
            <section data-tour="360-next-action" className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <CalendarClock className="h-4 w-4" />
                  Próxima ação
                </h2>
                {canWrite && !anonymized && (
                  <Button size="sm" variant="outline" onClick={() => setActivityEditor({})}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Criar ação
                  </Button>
                )}
              </div>
              {related.next ? (
                <>
                  <p className="text-sm font-medium">{related.next.title}</p>
                  <p
                    className={`mt-1 text-xs ${Date.parse(related.next.due_date!) < Date.now() ? 'text-destructive' : 'text-muted-foreground'}`}
                  >
                    {Date.parse(related.next.due_date!) < Date.now() ? 'Vencida · ' : ''}
                    {displayDate(related.next.due_date)} · {memberName(related.next.user_id)}
                  </p>
                  {isChannelType(related.next.type) && (related.next.contact_id || related.next.company_id) && (
                    <ChannelBar
                      className="mt-3"
                      only={related.next.type}
                      activity={related.next}
                      contact={related.next.contact_id ? index.contactById.get(related.next.contact_id) : null}
                      company={related.next.company_id ? index.companyById.get(related.next.company_id) : null}
                      members={data.members}
                    />
                  )}
                  {canWrite && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="eia-touch-target"
                        disabled={!!busy}
                        onClick={() => void toggleActivity(related.next!)}
                      >
                        <Check className="mr-1 h-3.5 w-3.5" />
                        {busy === related.next.id ? 'Salvando…' : 'Concluir'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="eia-touch-target"
                        disabled={!!busy}
                        onClick={() =>
                          prompt.openDialog({ mode: 'complete', activity: related.next!, requireNext: true })
                        }
                      >
                        <CalendarPlus className="mr-1 h-3.5 w-3.5" />
                        Concluir e agendar a próxima
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="eia-touch-target"
                        disabled={!!busy}
                        onClick={() => setActivityEditor({ activity: related.next! })}
                      >
                        Reagendar
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {anonymized
                    ? 'Sem próxima ação. O contato foi anonimizado, e o CRM não agenda ações com ele.'
                    : !marked
                      ? 'Sem próxima ação com prazo. Crie uma ação ou, ao concluir uma atividade, use “Concluir e agendar a próxima” para manter o relacionamento em movimento.'
                      : contact
                        ? 'Sem próxima ação com prazo. Este contato está marcado “Não contatar”: o CRM não agenda ligação, WhatsApp, e-mail, reunião nem visita com ele, e a fila de atenção não cobra uma próxima ação. Registre o que acontecer numa nota ou numa atividade com “Já aconteceu”.'
                        : 'Sem próxima ação com prazo. A empresa está marcada “Não contatar”: o CRM não agenda ligação nem WhatsApp para o telefone dela. Os contatos dela continuam liberados, a menos que tenham a própria marca.'}
                </p>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground">
                Atividade pendente com o menor prazo entre os vínculos desta ficha. Notas não contam como próxima ação.
              </p>
            </section>
            {error && (
              <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
                {error}
              </p>
            )}
            <section data-tour="360-timeline" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Histórico de relacionamento</h2>
                {canWrite && !anonymized && (
                  <Button variant="outline" size="sm" onClick={() => setActivityEditor({ initialType: 'note' })}>
                    <FileText className="mr-1 h-3.5 w-3.5" />
                    Registrar nota
                  </Button>
                )}
              </div>
              <Select value={timelineFilter} onValueChange={setTimelineFilter}>
                <SelectTrigger aria-label="Filtrar histórico" className="w-full sm:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todo o histórico</SelectItem>
                  <SelectItem value="pending">Ações pendentes</SelectItem>
                  <SelectItem value="completed">Ações concluídas</SelectItem>
                  {/* Por tipo (item 1.9): os canais, os compromissos e as notas. */}
                  {TIMELINE_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {ACTIVITY_PLURAL_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {visible.length ? (
                <ol className="divide-y rounded-xl border">
                  {visible.map((activity) => (
                    <li key={activity.id} id={`activity-${activity.id}`} className="space-y-2 p-4">
                      <div className="flex flex-wrap justify-between gap-2">
                        <span className="text-[11px] font-medium text-muted-foreground">
                          {ACTIVITY_LABELS[activity.type] ?? 'Atividade'} ·{' '}
                          {activity.type === 'note' ? 'Registrada' : activity.completed_at ? 'Concluída' : 'Pendente'}
                          {activity.completed_at && activity.outcome && OUTCOME_LABELS[activity.outcome]
                            ? ` · ${OUTCOME_LABELS[activity.outcome]}`
                            : ''}
                        </span>
                        <time dateTime={timelineMoment(activity)} className="text-[11px] text-muted-foreground">
                          {displayDate(timelineMoment(activity))}
                        </time>
                      </div>
                      <h3 className="text-sm font-medium">{activity.title}</h3>
                      {activity.body && (
                        <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{activity.body}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {activity.type !== 'note' && `${displayDate(activity.due_date)} · `}
                        {memberName(activity.user_id)}
                      </p>
                      {/* A atividade de um contato anonimizado (item 1.10) fica sem "Editar" e sem "Reabrir": o banco recusa. */}
                      {canWrite && !isFrozenActivity(activity, index.contactById) && (
                        <div className="flex flex-wrap gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!!busy}
                            onClick={() => setActivityEditor({ activity })}
                          >
                            <Pencil className="mr-1 h-3 w-3" />
                            Editar
                          </Button>
                          {activity.type !== 'note' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!!busy}
                              onClick={() => void toggleActivity(activity)}
                            >
                              {activity.completed_at ? (
                                <Undo2 className="mr-1 h-3 w-3" />
                              ) : (
                                <Check className="mr-1 h-3 w-3" />
                              )}
                              {busy === activity.id ? 'Salvando…' : activity.completed_at ? 'Reabrir' : 'Concluir'}
                            </Button>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState
                  icon={FileText}
                  title={related.activities.length ? 'Nenhuma atividade neste filtro' : 'O histórico começa aqui'}
                  description={
                    related.activities.length
                      ? 'Escolha outro filtro para ver as demais atividades.'
                      : !canWrite || anonymized
                        ? 'Ainda não há atividades neste relacionamento.'
                        : !marked
                          ? 'Use “WhatsApp”, “E-mail” ou “Ligar” e registre a conversa, ou crie uma nota ou o próximo passo.'
                          : contact
                            ? 'Este contato está marcado “Não contatar”. Use “Registrar nota” para guardar o que acontecer.'
                            : 'A empresa está marcada “Não contatar”: o telefone dela fica desligado. Use “Registrar nota” ou as fichas dos contatos liberados.'
                  }
                />
              )}
            </section>
            <section data-tour="360-deals" className="space-y-3">
              <h2 className="text-sm font-semibold">Oportunidades · {related.deals.length}</h2>
              {related.deals.length ? (
                <ul className="divide-y rounded-xl border">
                  {related.deals.map((deal) => (
                    <li key={deal.id}>
                      <Link
                        to={`/pipeline?deal=${deal.id}`}
                        className="flex items-center justify-between gap-3 p-4 hover:bg-muted/40"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{deal.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {({ open: 'Em aberto', won: 'Ganha', lost: 'Perdida' } as Record<string, string>)[
                              deal.status ?? ''
                            ] ??
                              deal.status ??
                              'Sem situação'}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm tabular-nums">
                          {deal.value === null
                            ? 'Sem valor'
                            : new Intl.NumberFormat('pt-BR', {
                                style: 'currency',
                                currency: /^[A-Z]{3}$/.test(deal.currency ?? '') ? deal.currency! : 'BRL',
                              }).format(deal.value)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={Handshake}
                  title="Nenhuma oportunidade vinculada"
                  description="Vincule uma oportunidade a este relacionamento no Pipeline."
                  action={
                    <Button asChild size="sm" variant="outline">
                      <Link to="/pipeline">Abrir o Pipeline</Link>
                    </Button>
                  }
                />
              )}
            </section>
            {kind === 'companies' && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold">Pessoas da empresa · {related.contacts.length}</h2>
                {related.contacts.length ? (
                  <ul className="divide-y rounded-xl border">
                    {related.contacts.map((c) => (
                      <li key={c.id}>
                        <Link
                          className="block p-3 text-sm text-primary hover:bg-muted/40"
                          to={`/contacts?contact=${c.id}`}
                        >
                          {contactName(c)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhum contato vinculado a esta empresa.</p>
                )}
              </section>
            )}
            {/* Privacidade (item 1.10): exportar e anonimizar, só para donos e administradores, num contato não anonimizado. */}
            {contact && <ContactPrivacySection contact={contact} members={data.members} />}
            {canManage && (
              <div className="border-t pt-4">
                <Button
                  variant="ghost"
                  className="text-destructive"
                  size="sm"
                  disabled={linkedHistory || linksPending || !!busy}
                  aria-describedby={deleteStatus ? deleteStatusId : undefined}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Excluir cadastro
                </Button>
                {linkedPayments.isError ? (
                  <p id={deleteStatusId} role="alert" className="mt-1 text-xs text-destructive">
                    Não foi possível conferir os recebimentos vinculados, e a exclusão fica indisponível.{' '}
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() => void linkedPayments.refetch()}
                    >
                      Conferir de novo
                    </Button>
                  </p>
                ) : linkedHistory ? (
                  <p id={deleteStatusId} className="mt-1 text-xs text-muted-foreground">
                    A exclusão está indisponível porque este cadastro tem vínculos: {linkedText}. Preserve este
                    histórico.
                    {linkedPaymentCount > 0 && (
                      <>
                        {' '}
                        Os recebimentos ficam em{' '}
                        <Link className="text-primary hover:underline" to="/financeiro">
                          Financeiro
                        </Link>
                        .
                      </>
                    )}
                  </p>
                ) : (
                  linkedPayments.isPending && (
                    <p id={deleteStatusId} role="status" className="mt-1 text-xs text-muted-foreground">
                      Conferindo os recebimentos vinculados…
                    </p>
                  )
                )}
              </div>
            )}
          </div>
        )}
      </SidePanel>
      {record && activityEditor && (
        <ActivityEditor
          key={activityEditor.activity?.id ?? activityEditor.initialType ?? 'new'}
          kind={kind}
          recordId={record.id}
          ownerId={record.owner_id}
          data={data}
          {...activityEditor}
          onClose={() => setActivityEditor(null)}
        />
      )}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Excluir este cadastro?"
        description="Esta ação remove permanentemente o cadastro. Você só pode excluir registros sem vínculos comerciais."
        confirmLabel="Excluir cadastro"
        onConfirm={remove}
        loading={busy === 'delete'}
      />
    </>
  );
}
