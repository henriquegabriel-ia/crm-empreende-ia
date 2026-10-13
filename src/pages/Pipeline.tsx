import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowUpRight,
  BriefcaseBusiness,
  FilterX,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageScaffold } from '@/components/shell/PageScaffold';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { Textarea } from '@/components/ds/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ds/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ds/dialog';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/foundation/EmptyState';
import { LoadingState } from '@/components/foundation/LoadingState';
import { StatStrip } from '@/components/foundation/StatStrip';
import { StatusChip } from '@/components/foundation/StatusChip';
import { SidePanel } from '@/components/foundation/SidePanel';
import { useOrg } from '@/hooks/useOrg';
import { useAuth } from '@/contexts/AuthContext';
import { useCreateFromUrl } from '@/hooks/useCreateFromUrl';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import type { Deal, DealDraft, DealStatus } from '@/lib/deal-types';
import {
  DEAL_STATUS_LABELS,
  closedAtForDraft,
  filterDeals,
  formatDealCurrency,
  nextDealActions,
  parseDealValue,
  probabilityForSave,
  summarizeDeals,
  validateDealMove,
} from '@/lib/deal-logic';
import { DealBoard } from '@/components/pipeline/DealBoard';
import { DealDeleteDialog } from '@/components/pipeline/DealDeleteDialog';
import { DealDetail } from '@/components/pipeline/DealDetail';
import { DealForm } from '@/components/pipeline/DealForm';
import { allRows, errorMessage, loadPipelineReferences, pipelineDb } from '@/components/pipeline/data';
import { dealsQueryKey, useDealMoves } from '@/components/pipeline/useDealMoves';
import { invalidateCrmTables, type CrmTable } from '@/lib/crm-cache';
import { linkSummary, type DealLinkCounts } from '@/lib/record-links';
import { TEAM_DATA_REFRESH } from '@/lib/team-data';
import { filterMembers, memberLabel } from '@/lib/team-members';
import { OwnerFilterValue } from '@/components/team/OwnerFilterValue';

export default function Pipeline() {
  const { orgId } = useOrg();
  return (
    <div className="h-full min-h-0" data-product-tour="pipeline">
      {orgId ? (
        <PipelineContent key={orgId} orgId={orgId} />
      ) : (
        <PageScaffold title="Pipeline">
          <EmptyState
            icon={BriefcaseBusiness}
            title="Organização indisponível"
            description="Entre em uma organização para consultar as oportunidades."
          />
        </PageScaffold>
      )}
    </div>
  );
}

function PipelineContent({ orgId }: { orgId: string }) {
  const { user } = useAuth();
  const { canWrite, canManage, loading: permissionsLoading, error: permissionsError } = useCrmPermissions();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Deal | null>(null);
  // Oportunidade criada no formulário aberto por ?create=1: vira ?deal= quando o formulário fecha.
  const created = useRef<{ id: string; status: DealStatus } | null>(null);
  // Trava por oportunidade (item 0.10): mover uma não bloqueia as outras nem o resto do quadro.
  const { moving, move: moveDeal } = useDealMoves(orgId);
  const [lossSaving, setLossSaving] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [deleteDeal, setDeleteDeal] = useState<Deal | null>(null);
  const [loss, setLoss] = useState<{ deal: Deal; stageId: string; reason: string; error: string } | null>(null);
  const references = useQuery({
    queryKey: ['crm', orgId, 'pipeline-references'],
    queryFn: () => loadPipelineReferences(orgId),
  });
  const dealQuery = useQuery({
    queryKey: dealsQueryKey(orgId),
    queryFn: () =>
      allRows((from, to) =>
        pipelineDb
          .from('deals')
          .select('*')
          .eq('org_id', orgId)
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to)
          .returns<Deal[]>(),
      ),
    // O quadro mostra o que os colegas moveram quando a pessoa volta para a aba.
    ...TEAM_DATA_REFRESH,
  });
  const actions = useQuery({
    queryKey: ['crm', orgId, 'deal-actions'],
    queryFn: () =>
      allRows((from, to) =>
        pipelineDb
          .from('activities')
          .select(
            'id,org_id,deal_id,title,type,due_date,end_date,completed_at,user_id,contact_id,company_id,updated_at',
          )
          .eq('org_id', orgId)
          // Todo tipo que não é nota conta como próxima ação (item 1.9: WhatsApp e visita também).
          .neq('type', 'note')
          .not('deal_id', 'is', null)
          .is('completed_at', null)
          .order('id')
          .range(from, to),
      ),
    ...TEAM_DATA_REFRESH,
  });
  const refs = references.data;
  const pipelines = refs?.pipelines ?? [];
  const pipelineId =
    params.get('pipeline') || pipelines.find((pipeline) => pipeline.is_default)?.id || pipelines[0]?.id || '';
  const pipeline = pipelines.find((item) => item.id === pipelineId);
  const stages = useMemo(
    () => (refs?.stages ?? []).filter((stage) => stage.pipeline_id === pipelineId).sort((a, b) => a.order - b.order),
    [refs?.stages, pipelineId],
  );
  const ownerId = params.get('owner') || 'all';
  const status = ['open', 'won', 'lost', 'all'].includes(params.get('status') ?? '') ? params.get('status')! : 'open';
  const search = params.get('q') || '';
  const allDeals = useMemo(() => dealQuery.data ?? [], [dealQuery.data]);
  const deals = useMemo(
    () => filterDeals(allDeals, { pipelineId, ownerId, status, search }),
    [allDeals, pipelineId, ownerId, status, search],
  );
  const summary = summarizeDeals(deals, pipeline?.currency ?? 'BRL', stages);
  const nextActions = useMemo(() => nextDealActions(actions.data ?? []), [actions.data]);
  const selectedId = params.get('deal');
  const selected = allDeals.find((deal) => deal.id === selectedId);
  const activeFilters = ownerId !== 'all' || status !== 'open' || !!search;
  const isLoading = references.isPending || dealQuery.isPending || actions.isPending || permissionsLoading;
  const loadError = references.error || dealQuery.error || actions.error;
  // A criação abre pela URL (?create=1), como ?action=new em Contatos e Tarefas, e não por um efeito que consome o
  // parâmetro: o RouteTransition monta a tela escondida antes de mostrá-la, e essa instância consumiria o pedido.
  const createRequested = params.get('create') === '1';
  const canCreate = canWrite && !!pipeline && stages.length > 0;
  // Sem funil com etapas não há onde criar a oportunidade, e só donos e administradores configuram funis.
  const missingStagesHint = canManage
    ? 'Crie um funil com etapas em Configurações, na aba Funis, para criar oportunidades.'
    : 'Ainda não há funil com etapas. Donos e administradores os criam em Configurações, na aba Funis.';
  const createOpen = useCreateFromUrl(createRequested, createRequested && !isLoading && canCreate);
  const form: 'create' | Deal | null = editing ?? (createOpen ? 'create' : null);
  const selectedPipeline = pipelines.find(
    (item) => item.id === (typeof form === 'object' && form ? form.pipeline_id : pipelineId),
  );
  useEffect(() => {
    // Falha ao ler o papel não é "somente leitura": o pedido fica na URL, e o formulário abre quando a leitura voltar.
    if (!createRequested || isLoading || loadError || permissionsError || canCreate || createOpen) return;
    toast.error(canWrite ? missingStagesHint : 'Seu papel permite somente leitura.');
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete('create');
        return next;
      },
      { replace: true },
    );
  }, [
    createRequested,
    isLoading,
    loadError,
    permissionsError,
    canCreate,
    createOpen,
    canWrite,
    missingStagesHint,
    setParams,
  ]);

  const updateParams = (changes: Record<string, string | null>, replace = false) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace },
    );
  const clearFilters = () => updateParams({ owner: null, status: null, q: null });
  const openDeal = (deal: Deal) => updateParams({ deal: deal.id });
  const closeDeal = () => updateParams({ deal: null });
  const openCreate = () => updateParams({ create: '1' });
  // Fecha o formulário. Depois de criar, troca ?create=1 por ?deal= numa única navegação: o setParams do React Router
  // parte dos parâmetros da renderização, então duas chamadas seguidas perderiam a primeira.
  const closeForm = () => {
    if (editing) {
      setEditing(null);
      return;
    }
    const deal = created.current;
    created.current = null;
    updateParams({ create: null, ...(deal ? { deal: deal.id, status: deal.status } : {}) }, true);
  };
  // Invalidação por chave (src/lib/crm-cache.ts): cada gravação recarrega só o que lê as tabelas alteradas.
  const refresh = (tables: readonly CrmTable[]) => invalidateCrmTables(queryClient, tables);
  // "Atualizar" e "Tentar novamente" recarregam as consultas desta tela.
  const reload = () =>
    Promise.all(
      ['pipeline-references', 'deals', 'deal-actions'].map((name) =>
        queryClient.invalidateQueries({ queryKey: ['crm', orgId, name] }),
      ),
    );
  const requireWrite = () => {
    if (!canWrite) throw new Error('Você não tem permissão para editar oportunidades.');
  };

  const saveDeal = async (draft: DealDraft) => {
    requireWrite();
    // Só um dia de fechamento alterado é enviado; o banco preenche, valida e anula closed_at.
    const closedAt = typeof form === 'object' && form ? closedAtForDraft(form, draft.closed_at) : undefined;
    const fields = {
      title: draft.title.trim(),
      value: parseDealValue(draft.value)!,
      currency: draft.currency,
      owner_id: draft.owner_id || null,
      contact_id: draft.contact_id || null,
      company_id: draft.company_id || null,
      close_date: draft.close_date || null,
      probability: probabilityForSave(draft),
      lost_reason: draft.status === 'lost' ? draft.lost_reason.trim() : null,
      ...(closedAt ? { closed_at: closedAt } : {}),
    };
    if (typeof form === 'object' && form) {
      const { data, error } = await pipelineDb
        .from('deals')
        .update(fields)
        .eq('id', form.id)
        .eq('org_id', orgId)
        .eq('updated_at', form.updated_at)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data)
        throw new Error(
          'A oportunidade mudou ou está indisponível. Feche a edição, atualize o quadro e tente novamente. Seus campos continuam aqui.',
        );
      toast.success('Oportunidade atualizada.');
    } else {
      const { data, error } = await pipelineDb
        .from('deals')
        .insert({
          ...fields,
          org_id: orgId,
          pipeline_id: draft.pipeline_id,
          stage_id: draft.stage_id,
          status: draft.status,
        })
        .select('id')
        .single();
      if (error) throw error;
      created.current = { id: data.id, status: draft.status };
      toast.success('Oportunidade criada. Combine a próxima ação no detalhe.');
    }
    await refresh(['deals']);
  };

  const performMove = async (
    deal: Deal,
    stageId: string,
    newStatus: DealStatus = deal.status,
    reason = deal.lost_reason ?? '',
  ) => {
    requireWrite();
    const validation = validateDealMove(
      deal,
      refs?.stages.find((stage) => stage.id === stageId),
      newStatus,
      reason,
    );
    if (validation) throw new Error(validation);
    // Etapa trocada na hora no quadro; a resposta de move_deal substitui a linha, e uma falha a devolve.
    return moveDeal({ deal, stageId, status: newStatus, lostReason: newStatus === 'lost' ? reason : null });
  };

  const move = async (deal: Deal, stageId: string, newStatus: DealStatus = deal.status) => {
    if (moving.has(deal.id) || !canWrite) return;
    if (newStatus === 'lost' && deal.status !== 'lost') {
      setLoss({ deal, stageId, reason: '', error: '' });
      return;
    }
    setOperationError('');
    try {
      if (!(await performMove(deal, stageId, newStatus))) return;
      toast.success(
        newStatus !== deal.status
          ? `Oportunidade ${DEAL_STATUS_LABELS[newStatus].toLowerCase()}.`
          : 'Etapa atualizada.',
      );
    } catch (error) {
      setOperationError(errorMessage(error));
      toast.error(errorMessage(error));
    }
  };

  const lossBusy = lossSaving || (!!loss && moving.has(loss.deal.id));
  const confirmLoss = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!loss || lossBusy) return;
    setLossSaving(true);
    try {
      if (!(await performMove(loss.deal, loss.stageId, 'lost', loss.reason))) return;
      setLoss(null);
      toast.success('Perda registrada com o motivo.');
    } catch (error) {
      setLoss((current) => current && { ...current, error: errorMessage(error) });
    } finally {
      setLossSaving(false);
    }
  };

  // A exclusão é feita pela RPC delete_deal no DealDeleteDialog, que mostra os vínculos antes de confirmar.
  const dealDeleted = async (deal: Deal, counts: DealLinkCounts) => {
    if (selectedId === deal.id) closeDeal();
    setDeleteDeal(null);
    setOperationError('');
    // delete_deal tira a oportunidade e desvincula atividades, recebimentos e registros de automação.
    await refresh(['deals', 'activities', 'payments', 'automation_logs']);
    const unlinked = linkSummary([
      [counts.activities, 'atividade', 'atividades'],
      [counts.payments, 'recebimento', 'recebimentos'],
    ]);
    toast.success(
      unlinked
        ? `Oportunidade excluída. ${unlinked} ${counts.activities + counts.payments === 1 ? 'ficou' : 'ficaram'} sem o vínculo.`
        : 'Oportunidade excluída.',
    );
  };

  const createAction = async (draft: { title: string; due_date: string; user_id: string; type: string }) => {
    requireWrite();
    if (!selected) throw new Error('Oportunidade indisponível.');
    const start = new Date(draft.due_date);
    const { error } = await pipelineDb.from('activities').insert({
      org_id: orgId,
      deal_id: selected.id,
      contact_id: selected.contact_id,
      company_id: selected.company_id,
      title: draft.title.trim(),
      type: draft.type || 'task',
      due_date: start.toISOString(),
      // Reunião e visita são compromissos: 1 hora de duração, ajustável em "Editar" na atividade.
      end_date: ['meeting', 'visit'].includes(draft.type) ? new Date(start.getTime() + 3_600_000).toISOString() : null,
      user_id: draft.user_id,
      created_by: user?.id,
    });
    if (error) throw error;
    await refresh(['activities']);
    toast.success('Próxima ação combinada. Ela também está em Hoje e Atividades.');
  };

  return (
    <PageScaffold
      title="Pipeline"
      meta={<StatusChip>{deals.length} oportunidades</StatusChip>}
      actions={
        canWrite && (
          <Button
            size="sm"
            data-tour="pipeline-create"
            disabled={!pipeline || !stages.length || isLoading}
            title={!stages.length ? missingStagesHint : undefined}
            onClick={openCreate}
          >
            <Plus className="h-4 w-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Nova oportunidade</span>
            <span className="sr-only sm:hidden">Nova oportunidade</span>
          </Button>
        )
      }
      toolbar={
        <div className="flex w-full flex-wrap items-center gap-2">
          <Select
            value={pipelineId}
            onValueChange={(value) => updateParams({ pipeline: value })}
            disabled={!pipelines.length}
          >
            <SelectTrigger
              className="w-full sm:w-[205px]"
              data-tour={pipelines.length ? 'pipeline-selector' : undefined}
              aria-label="Funil selecionado"
            >
              <SelectValue placeholder="Selecione um funil" />
            </SelectTrigger>
            <SelectContent>
              {pipelines.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative min-w-[150px] flex-1 sm:max-w-[260px]">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Buscar oportunidade por nome"
              value={search}
              onChange={(event) => updateParams({ q: event.target.value }, true)}
              placeholder="Buscar oportunidade"
              className="pl-9"
            />
          </div>
          <Select value={ownerId} onValueChange={(value) => updateParams({ owner: value === 'all' ? null : value })}>
            {/* Largura para "Todos os responsáveis" inteiro; a marca "(desativado)" nunca é cortada (achado 6 do 1.2). */}
            <SelectTrigger className="w-[13.5rem]" aria-label="Filtrar responsável">
              <SelectValue>
                <OwnerFilterValue value={ownerId} people={refs?.people ?? []} />
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os responsáveis</SelectItem>
              <SelectItem value="unassigned">Sem responsável</SelectItem>
              {/* Ativos e, depois, quem foi desativado, marcado: o histórico continua filtrável (item 1.2). */}
              {filterMembers(refs?.people ?? []).map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {memberLabel(person)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(value) => updateParams({ status: value === 'open' ? null : value })}>
            <SelectTrigger className="w-[11.5rem]" aria-label="Filtrar situação">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as situações</SelectItem>
              {Object.entries(DEAL_STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {activeFilters && (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              <FilterX className="mr-1.5 h-4 w-4" />
              Limpar filtros
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void reload()}
            disabled={isLoading}
            aria-label="Atualizar o Pipeline"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      {isLoading ? (
        <LoadingState label="Carregando oportunidades…" />
      ) : loadError ? (
        <EmptyState
          icon={AlertCircle}
          title="Não foi possível carregar o Pipeline"
          description={errorMessage(loadError)}
          action={<Button onClick={() => void reload()}>Tentar novamente</Button>}
        />
      ) : !pipeline ? (
        // A tela se chama Pipeline e mostra um funil por vez; funis e etapas ficam em Configurações, na aba Funis, e só
        // donos e administradores os editam, então o texto muda com o papel.
        <EmptyState
          icon={BriefcaseBusiness}
          title={pipelines.length ? 'Funil indisponível' : 'Seu primeiro funil começa aqui'}
          description={
            pipelines.length
              ? 'O funil do link não existe ou você não tem acesso.'
              : canManage
                ? 'Crie um funil com as etapas comerciais em Configurações, na aba Funis, para organizar suas oportunidades.'
                : 'Ainda não há funil. Donos e administradores criam funis e etapas em Configurações, na aba Funis.'
          }
          action={
            pipelines.length ? (
              <Button onClick={() => updateParams({ pipeline: null })}>Ver funil padrão</Button>
            ) : canManage ? (
              <Button asChild>
                <Link to="/settings?tab=pipelines">
                  <Settings2 className="mr-2 h-4 w-4" />
                  Configurar funis
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : !stages.length ? (
        <EmptyState
          icon={BriefcaseBusiness}
          title="Este funil ainda não tem etapas"
          description={
            canManage
              ? 'Adicione etapas em Configurações, na aba Funis, para começar a criar oportunidades.'
              : 'Donos e administradores adicionam etapas em Configurações, na aba Funis. Depois disso, as oportunidades podem ser criadas aqui.'
          }
          action={
            canManage && (
              <Button asChild>
                <Link to="/settings?tab=pipelines">Configurar etapas</Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Cada conversa, um próximo passo.</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Acompanhe o valor, o responsável e o tempo de cada oportunidade nas etapas de {pipeline.name}.
            </p>
          </div>
          {!canWrite && (
            <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              Acesso de leitura. Seu papel permite consultar o Pipeline; para editar, peça acesso a um dono ou
              administrador.
            </p>
          )}
          {operationError && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {operationError}
            </div>
          )}
          <div data-tour="pipeline-summary">
            <StatStrip
              stats={[
                {
                  label: 'Em aberto no filtro',
                  value: summary.openCount,
                  icon: BriefcaseBusiness,
                  hint: 'Oportunidades ainda em negociação',
                },
                {
                  label: 'Valor em aberto',
                  value: formatDealCurrency(summary.openValue, pipeline.currency),
                  icon: TrendingUp,
                  hint: `Somente valores em ${pipeline.currency}`,
                },
                {
                  label: 'Previsão ponderada',
                  value: formatDealCurrency(summary.weightedValue, pipeline.currency),
                  hint: 'Em aberto × probabilidade; não é receita',
                },
                {
                  label: 'Valor ganho no filtro',
                  value: formatDealCurrency(summary.wonValue, pipeline.currency),
                  icon: ArrowUpRight,
                  hint: 'Negócios ganhos; não comprova recebimento',
                },
              ]}
            />
          </div>
          {summary.foreignCurrencyCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {summary.foreignCurrencyCount} oportunidades usam outra moeda e não entram nos totais em{' '}
              {pipeline.currency}.
            </p>
          )}
          {!deals.length && (
            <EmptyState
              icon={Search}
              title={activeFilters ? 'Nenhuma oportunidade com esses filtros' : 'Pronto para a primeira oportunidade'}
              description={
                activeFilters
                  ? 'Experimente outro responsável, situação ou termo de busca.'
                  : 'Registre uma negociação, defina o responsável e combine a próxima ação.'
              }
              action={
                activeFilters ? (
                  <Button variant="outline" onClick={clearFilters}>
                    Limpar filtros
                  </Button>
                ) : canWrite ? (
                  <Button onClick={openCreate}>Criar oportunidade</Button>
                ) : undefined
              }
              className="py-6"
            />
          )}
          <DealBoard
            deals={deals}
            stages={stages}
            people={refs?.people ?? []}
            nextActions={nextActions}
            currency={pipeline.currency}
            canWrite={canWrite}
            movingIds={moving}
            onOpen={openDeal}
            onMove={(deal, stage, state) => void move(deal, stage, state)}
          />
          <p className="text-xs text-muted-foreground">
            {canWrite
              ? 'Arraste pela alça ou use o menu de cada oportunidade para mover. A situação de ganho ou perda é definida separadamente da etapa.'
              : 'Abra uma oportunidade para consultar seus vínculos, ações e movimentações.'}
          </p>
        </div>
      )}
      {selectedId &&
        !isLoading &&
        !loadError &&
        !form &&
        (selected ? (
          <DealDetail
            key={selected.id}
            deal={selected}
            stages={refs?.stages ?? []}
            people={refs?.people ?? []}
            contacts={refs?.contacts ?? []}
            companies={refs?.companies ?? []}
            activities={(actions.data ?? []).filter((activity) => activity.deal_id === selected.id)}
            canWrite={canWrite}
            canManage={canManage}
            busy={moving.has(selected.id)}
            onClose={closeDeal}
            onEdit={() => setEditing(selected)}
            onDelete={() => setDeleteDeal(selected)}
            onMove={(deal, stage, state) => void move(deal, stage, state)}
            onCreateAction={createAction}
          />
        ) : (
          <SidePanel
            open
            title="Oportunidade indisponível"
            description="O registro foi removido ou você não tem acesso nesta organização."
            onOpenChange={(open) => !open && closeDeal()}
          >
            <Button variant="outline" onClick={closeDeal}>
              Voltar ao Pipeline
            </Button>
          </SidePanel>
        ))}
      {form && selectedPipeline && (
        <DealForm
          key={form === 'create' ? 'new' : form.id}
          deal={form === 'create' ? undefined : form}
          pipeline={selectedPipeline}
          stages={(refs?.stages ?? []).filter((stage) => stage.pipeline_id === selectedPipeline.id)}
          people={refs?.people ?? []}
          contacts={refs?.contacts ?? []}
          companies={refs?.companies ?? []}
          onSave={saveDeal}
          onClose={closeForm}
        />
      )}
      {deleteDeal && canManage && (
        <DealDeleteDialog
          key={deleteDeal.id}
          orgId={orgId}
          deal={deleteDeal}
          onClose={() => setDeleteDeal(null)}
          onDeleted={dealDeleted}
        />
      )}
      <Dialog open={!!loss} onOpenChange={(open) => !open && !lossBusy && setLoss(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar perda</DialogTitle>
            <DialogDescription>
              Conte por que “{loss?.deal.title}” não avançou. O motivo ajuda a melhorar as próximas negociações.
            </DialogDescription>
          </DialogHeader>
          <form id="deal-loss-form" onSubmit={confirmLoss} className="space-y-3">
            <Label htmlFor="deal-loss-reason">Motivo da perda *</Label>
            <Textarea
              id="deal-loss-reason"
              value={loss?.reason ?? ''}
              onChange={(event) =>
                setLoss((current) => current && { ...current, reason: event.target.value, error: '' })
              }
              maxLength={2000}
              autoFocus
              disabled={lossBusy}
            />
            {loss?.error && (
              <p role="alert" className="text-sm text-destructive">
                {loss.error}
              </p>
            )}
          </form>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLoss(null)} disabled={lossBusy}>
              Cancelar
            </Button>
            <Button type="submit" form="deal-loss-form" disabled={lossBusy}>
              {lossBusy ? 'Salvando…' : 'Registrar perda'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageScaffold>
  );
}
