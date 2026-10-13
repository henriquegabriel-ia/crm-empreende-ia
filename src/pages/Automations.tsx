import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, CalendarClock, History, Pause, Play, Plus, Trash2, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import { crmDb } from '@/integrations/supabase/crm-client';
import { useOrg } from '@/hooks/useOrg';
import { useAuth } from '@/contexts/AuthContext';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import { PageScaffold } from '@/components/shell/PageScaffold';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ds/select';
import { EmptyState } from '@/components/foundation/EmptyState';
import { LoadingState } from '@/components/foundation/LoadingState';
import { Panel, PanelBody } from '@/components/foundation/Panel';
import { StatusChip } from '@/components/foundation/StatusChip';
import { SidePanel } from '@/components/foundation/SidePanel';
import { invalidateCrmTables } from '@/lib/crm-cache';
import { ConfirmDialog } from '@/components/foundation/ConfirmDialog';
import { AutomationForm, type AutomationDraft } from '@/components/operations/AutomationForm';
import { allRows, errorMessage, loadPipelineScopes } from '@/components/operations/data';
import {
  AUTOMATION_LOG_COLUMNS,
  AUTOMATION_TRIGGER_LABELS,
  automationDueLabel,
  automationFields,
  automationScopeLabel,
  normalizeSearch,
  type Automation,
} from '@/lib/operation-logic';

export default function Automations() {
  const { orgId } = useOrg();
  return (
    <div className="h-full" data-product-tour="automations">
      {orgId ? (
        <AutomationsContent key={orgId} orgId={orgId} />
      ) : (
        <PageScaffold title="Automações">
          <EmptyState
            icon={Workflow}
            title="Organização indisponível"
            description="Entre em uma organização para consultar as automações."
          />
        </PageScaffold>
      )}
    </div>
  );
}
function AutomationsContent({ orgId }: { orgId: string }) {
  const { user } = useAuth();
  const { canManage, loading: permissionsLoading } = useCrmPermissions();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [form, setForm] = useState<Automation | 'create' | null>(null);
  const [selected, setSelected] = useState<Automation | null>(null);
  const [activate, setActivate] = useState<Automation | null>(null);
  const [remove, setRemove] = useState<Automation | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const query = useQuery({
    queryKey: ['crm', orgId, 'automations'],
    queryFn: () =>
      allRows((from, to) =>
        crmDb
          .from('automations')
          .select('*')
          .eq('org_id', orgId)
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      ),
  });
  const scopes = useQuery({
    queryKey: ['crm', orgId, 'automation-scopes'],
    queryFn: () => loadPipelineScopes(orgId),
  });
  const history = useQuery({
    queryKey: ['crm', orgId, 'automation-history', selected?.id],
    enabled: !!selected,
    queryFn: () =>
      allRows((from, to) =>
        crmDb
          .from('automation_logs')
          .select(AUTOMATION_LOG_COLUMNS)
          .eq('org_id', orgId)
          .eq('automation_id', selected!.id)
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      ),
  });
  const failureDetails = useQuery({
    queryKey: ['crm', orgId, 'automation-errors', selected?.id],
    enabled: !!selected && canManage,
    queryFn: async () => {
      const { data, error } = await crmDb.rpc('automation_log_errors', { p_automation_id: selected!.id });
      if (error) throw error;
      return new Map((data ?? []).map((row) => [row.id, row.error_detail]));
    },
  });
  const filtered = (query.data ?? []).filter(
    (automation) =>
      normalizeSearch(automation.name).includes(normalizeSearch(search)) &&
      (status === 'all' || automation.is_active === (status === 'active')),
  );
  const scopeOptions = scopes.data;
  const scopeLabel = (automation: Automation) => (scopeOptions ? automationScopeLabel(automation, scopeOptions) : null);
  const refresh = () => invalidateCrmTables(queryClient, ['automations']);
  const save = async (draft: AutomationDraft) => {
    if (!canManage) throw new Error('Somente donos e administradores podem configurar automações.');
    const fields = automationFields(draft);
    if (form && form !== 'create') {
      // Editar não muda a situação: uma automação ativa continua ativa para os próximos eventos.
      const { data, error } = await crmDb
        .from('automations')
        .update(fields)
        .eq('org_id', orgId)
        .eq('id', form.id)
        .eq('updated_at', form.updated_at)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('A automação mudou ou está indisponível. Atualize a lista e tente novamente.');
      await refresh();
      toast.success(
        form.is_active
          ? 'Automação atualizada. Ela continua ativa para novos eventos.'
          : 'Automação atualizada. Ela continua pausada até a ativação.',
      );
    } else {
      const { error } = await crmDb
        .from('automations')
        .insert({ ...fields, is_active: false, org_id: orgId, created_by: user?.id });
      if (error) throw error;
      await refresh();
      toast.success('Automação salva e pausada. Revise para ativar.');
    }
  };
  const toggle = async (automation: Automation, active: boolean) => {
    if (!canManage || busy) return;
    setBusy(true);
    setActionError('');
    try {
      const { data, error } = await crmDb
        .from('automations')
        .update({ is_active: active })
        .eq('id', automation.id)
        .eq('org_id', orgId)
        .eq('updated_at', automation.updated_at)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('A automação mudou. Atualize a lista para revisar a configuração atual.');
      setActivate(null);
      await refresh();
      toast.success(
        active ? 'Automação ativa para novos eventos.' : 'Automação pausada. As tarefas já criadas foram mantidas.',
      );
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const removeAutomation = async (automation: Automation) => {
    if (!canManage || busy) return;
    setBusy(true);
    setActionError('');
    try {
      const { data, error } = await crmDb
        .from('automations')
        .delete()
        .eq('id', automation.id)
        .eq('org_id', orgId)
        .eq('updated_at', automation.updated_at)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data)
        throw new Error('A automação mudou ou já foi excluída. Atualize a lista para revisar a configuração atual.');
      setRemove(null);
      if (selected?.id === automation.id) setSelected(null);
      await refresh();
      toast.success('Automação excluída. As tarefas já criadas e o histórico de execuções foram mantidos.');
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const loading = query.isPending || permissionsLoading || scopes.isPending;
  const loadError = query.error ?? scopes.error;
  return (
    <PageScaffold
      title="Automações"
      actions={
        canManage && (
          <Button size="sm" data-tour="automations-create" onClick={() => setForm('create')} disabled={loading}>
            <Plus className="h-4 w-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Nova automação</span>
            <span className="sr-only sm:hidden">Nova automação</span>
          </Button>
        )
      }
      toolbar={
        <div className="flex w-full flex-wrap gap-2">
          <Input
            className="max-w-sm"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar automação"
            aria-label="Buscar automação"
          />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-[11.5rem]" aria-label="Filtrar situação">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as situações</SelectItem>
              <SelectItem value="active">Ativas</SelectItem>
              <SelectItem value="paused">Pausadas</SelectItem>
            </SelectContent>
          </Select>
        </div>
      }
    >
      {loading ? (
        <LoadingState label="Carregando automações…" />
      ) : loadError ? (
        <EmptyState
          icon={AlertCircle}
          title="Não foi possível carregar as automações"
          description={errorMessage(loadError)}
          action={
            <Button
              onClick={() => {
                if (query.isError) void query.refetch();
                if (scopes.isError) void scopes.refetch();
              }}
            >
              Tentar novamente
            </Button>
          }
        />
      ) : (
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold">O próximo passo pode começar sozinho.</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Eventos de oportunidades criam tarefas vinculadas, com prazo e responsável. Cada execução fica registrada.
              Pausar interrompe novos disparos; tarefas já criadas permanecem disponíveis.
            </p>
          </div>
          {!canManage && (
            <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
              Você pode consultar as rotinas e suas execuções. A configuração e a ativação são feitas por donos e
              administradores.
            </p>
          )}
          {actionError && !activate && !remove && (
            <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
              {actionError}
              <Button variant="ghost" size="sm" onClick={() => void refresh()}>
                Atualizar lista
              </Button>
            </p>
          )}
          <div data-tour="automations-list" className="grid gap-4 lg:grid-cols-2">
            {filtered.map((automation, index) => {
              const scope = scopeLabel(automation);
              return (
                <Panel key={automation.id}>
                  <PanelBody className="space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold">{automation.name}</h3>
                        <StatusChip className="mt-2" tone={automation.is_active ? 'success' : 'neutral'}>
                          {automation.is_active ? 'Ativa' : 'Pausada'}
                        </StatusChip>
                      </div>
                      <Workflow className="h-5 w-5 shrink-0 text-primary" />
                    </div>
                    <div
                      data-tour={index === 0 ? 'automations-trigger' : undefined}
                      className="space-y-2 rounded-lg bg-muted/30 p-3 text-sm"
                    >
                      <p className="font-medium">{AUTOMATION_TRIGGER_LABELS[automation.trigger_type]}</p>
                      {scope && <p className="text-xs text-muted-foreground">{scope}</p>}
                      <p className="flex items-start gap-2 text-muted-foreground">
                        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>Criar tarefa: {automation.task_title}</span>
                      </p>
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CalendarClock className="h-3.5 w-3.5" />
                        Prazo: {automationDueLabel(automation.due_days)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setSelected(automation)}>
                        <History className="mr-1.5 h-4 w-4" />
                        Execuções
                      </Button>
                      {canManage && (
                        <>
                          <Button variant="outline" size="sm" disabled={busy} onClick={() => setForm(automation)}>
                            Editar
                          </Button>
                          <Button
                            data-tour={index === 0 ? 'automations-status' : undefined}
                            variant={automation.is_active ? 'outline' : 'default'}
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              setActionError('');
                              if (automation.is_active) void toggle(automation, false);
                              else setActivate(automation);
                            }}
                          >
                            {automation.is_active ? (
                              <Pause className="mr-1.5 h-4 w-4" />
                            ) : (
                              <Play className="mr-1.5 h-4 w-4" />
                            )}
                            {automation.is_active ? 'Pausar' : 'Revisar e ativar'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            disabled={busy}
                            aria-label={`Excluir ${automation.name}`}
                            onClick={() => {
                              setActionError('');
                              setRemove(automation);
                            }}
                          >
                            <Trash2 className="mr-1.5 h-4 w-4" />
                            Excluir
                          </Button>
                        </>
                      )}
                    </div>
                  </PanelBody>
                </Panel>
              );
            })}
          </div>
          {!filtered.length && (
            <EmptyState
              icon={Workflow}
              title={search || status !== 'all' ? 'Nenhuma automação com esses filtros' : 'Crie sua primeira rotina'}
              description="Escolha o evento, a tarefa e o prazo. A rotina só começa depois da revisão e ativação."
              action={canManage && <Button onClick={() => setForm('create')}>Nova automação</Button>}
            />
          )}
        </div>
      )}
      {form && (
        <AutomationForm
          key={form === 'create' ? 'new' : form.id}
          automation={form === 'create' ? undefined : form}
          scopes={scopeOptions}
          onClose={() => setForm(null)}
          onSave={save}
        />
      )}
      <ConfirmDialog
        open={!!activate}
        onOpenChange={(open) => !open && setActivate(null)}
        title="Ativar esta automação?"
        tone="default"
        confirmLabel="Ativar para novos eventos"
        loading={busy}
        onConfirm={() => activate && toggle(activate, true)}
        description={
          activate && (
            <span className="space-y-3">
              <span className="block">
                <strong>{activate.name}</strong> será aplicada a novos eventos em toda a organização.
              </span>
              <span className="block">
                Quando: {AUTOMATION_TRIGGER_LABELS[activate.trigger_type]}.
                {scopeLabel(activate) && (
                  <>
                    <br />
                    Filtro: {scopeLabel(activate)}.
                  </>
                )}
                <br />
                Criar tarefa: “{activate.task_title}”.
                <br />
                Prazo: {automationDueLabel(activate.due_days)}.
                <br />
                Responsável: o mesmo da oportunidade; sem responsável se ela não tiver um.
              </span>
              <span className="block">A ativação não processa eventos anteriores.</span>
              {actionError && (
                <span role="alert" className="block text-destructive">
                  {actionError}
                </span>
              )}
            </span>
          )
        }
      />
      <ConfirmDialog
        open={!!remove}
        onOpenChange={(open) => !open && !busy && setRemove(null)}
        title="Excluir esta automação?"
        confirmLabel="Excluir automação"
        loading={busy}
        onConfirm={() => remove && removeAutomation(remove)}
        description={
          remove && (
            <span className="space-y-3">
              <span className="block">
                <strong>{remove.name}</strong> deixa de criar tarefas. As tarefas que ela já criou continuam na rotina,
                e o histórico de execuções fica guardado no banco com o nome dela, mas deixa de aparecer nesta tela.
              </span>
              <span className="block">
                Para só interromper os disparos e manter o histórico visível aqui, use Pausar.
              </span>
              {actionError && (
                <span role="alert" className="block text-destructive">
                  {actionError}
                </span>
              )}
            </span>
          )
        }
      />
      <SidePanel
        open={!!selected}
        title={selected?.name ?? 'Execuções'}
        description="Histórico real das tarefas criadas por esta automação."
        onOpenChange={(open) => !open && setSelected(null)}
      >
        {history.isPending ? (
          <LoadingState label="Carregando execuções…" />
        ) : history.isError ? (
          <EmptyState
            icon={AlertCircle}
            title="Histórico indisponível"
            description={errorMessage(history.error)}
            action={<Button onClick={() => void history.refetch()}>Tentar novamente</Button>}
          />
        ) : history.data?.length ? (
          <ol className="space-y-4">
            {history.data.map((log) => {
              const detail = failureDetails.data?.get(log.id);
              return (
                <li key={log.id} className="rounded-xl border border-border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <StatusChip tone={log.status === 'success' ? 'success' : 'danger'}>
                      {log.status === 'success' ? 'Tarefa criada' : 'Falha'}
                    </StatusChip>
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleString('pt-BR')}
                    </span>
                  </div>
                  {log.error_message && <p className="mt-2 text-sm text-destructive">{log.error_message}</p>}
                  {canManage && log.status === 'failed' && (detail || failureDetails.isError) && (
                    <p className="mt-2 break-words rounded-md bg-muted/40 p-2 font-mono text-xs text-muted-foreground">
                      {detail
                        ? `Detalhe técnico (só donos e administradores veem): ${detail}`
                        : 'Não foi possível carregar o detalhe técnico desta falha.'}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-4 text-xs">
                    {log.deal_id ? (
                      <Link className="underline underline-offset-4" to={`/pipeline?deal=${log.deal_id}`}>
                        Abrir oportunidade
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Oportunidade excluída</span>
                    )}
                    {log.activity_id ? (
                      <Link className="underline underline-offset-4" to={`/activities?activity=${log.activity_id}`}>
                        Abrir tarefa
                      </Link>
                    ) : (
                      log.status === 'success' && <span className="text-muted-foreground">Tarefa excluída</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState
            icon={History}
            title="Nenhuma execução registrada"
            description="As execuções aparecem após um novo evento compatível, enquanto a automação estiver ativa."
          />
        )}
      </SidePanel>
    </PageScaffold>
  );
}
