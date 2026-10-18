import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  CircleCheck,
  Plus,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/hooks/useOrg';
import { useCrmSnapshot } from '@/hooks/useCrmSnapshot';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import { useRetryFailedReminders } from '@/hooks/useActivityReminders';
import { Button } from '@/components/ds/button';
import { PageScaffold } from '@/components/shell/PageScaffold';
import { OwnerFilterSelect } from '@/components/team/OwnerFilterSelect';
import { EmptyState } from '@/components/foundation/EmptyState';
import { StatStrip } from '@/components/foundation/StatStrip';
import { ActivityDialog } from '@/components/workday/ActivityDialog';
import { ActivityDetail } from '@/components/workday/ActivityDetail';
import { ActivityList } from '@/components/workday/ActivityList';
import { useLocalClock } from '@/components/workday/useLocalClock';
import { WorkdayState } from '@/components/workday/WorkdayState';
import { useScreenReady } from '@/hooks/useScreenReady';
import { activitySummary, attentionQueue, ownActivities, type Activity } from '@/lib/activity-logic';
import { ownerFilterPeople, readOwnerFilter } from '@/lib/owner-filter';
import { isActiveMember, memberLabel } from '@/lib/team-members';

/** Recortes de Hoje: a própria rotina (o padrão) e a da organização; abaixo deles, as pessoas da equipe (item 1.14). */
const TODAY_SCOPES = [
  { value: 'mine', label: 'Minha rotina' },
  { value: 'all', label: 'Toda a organização' },
] as const;

export default function Dashboard() {
  const { user, profile, loading: authLoading } = useAuth();
  const { orgId } = useOrg();
  const permissions = useCrmPermissions();
  const snapshot = useCrmSnapshot();
  const data = snapshot.data;
  const now = useLocalClock();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Activity | null>(null);
  const [creating, setCreating] = useState(false);
  const [attentionLimit, setAttentionLimit] = useState(10);
  const [activityLimit, setActivityLimit] = useState(10);
  const selectedId = params.get('activity');
  // Recorte da rotina (item 1.14): "Minha rotina", "Toda a organização" ou uma pessoa da equipe, para quem vê a equipe
  // (hoje, todos os papéis). Desativados entram marcados, para ver a carteira que ficou com quem saiu.
  const owner = readOwnerFilter(params.get('owner'), {
    scopes: ['mine', 'all'],
    fallback: 'mine',
    userId: user?.id,
    members: data?.members ?? [],
    canViewTeam: permissions.canViewTeam,
  });
  const people = permissions.canViewTeam ? ownerFilterPeople(data?.members ?? [], user?.id) : [];
  const personName = owner.person ? memberLabel(owner.person) : null;
  // Quem foi desativado passou as atividades pendentes a quem recebeu a carteira (D9): "Ver atividades" abre "Todas",
  // com o histórico dela, em vez de uma lista de pendentes quase sempre vazia (revisão do item 1.14).
  const leftTeam = !!owner.person && !isActiveMember(owner.person);
  const audience = owner.scope === 'all' ? 'all' : 'mine';
  // De quem são as atividades do recorte. A atividade nova (`defaults.user_id` do ActivityDialog) começa com essa pessoa,
  // para aparecer na rotina que está na tela; com quem foi desativado, ou em "Toda a organização", defaultAssignee usa
  // a conta (revisão do item 1.14).
  const ownerId = owner.ownerId;
  // "Minha rotina" usa o mesmo recorte (ownActivities) e o mesmo resumo dos lembretes do menu (item 1.12): o número ao
  // lado de "Hoje" é o de "Próximos passos do dia" aqui. O recorte de outra pessoa usa o mesmo cálculo com o id dela;
  // o número do menu continua sendo o da conta que usa o CRM.
  const summary = useMemo(
    () =>
      activitySummary(
        audience === 'all' ? (data?.activities ?? []) : ownActivities(data?.activities ?? [], ownerId),
        now,
      ),
    [data?.activities, audience, ownerId, now],
  );
  // O recorte entra na própria fila: o agrupamento de contatos sem próxima ação conta só os da pessoa, e nenhuma busca
  // linear por item (o antigo filtro fazia um find para cada item da fila).
  const attention = useMemo(
    () => (data ? attentionQueue(data, now, { audience, userId: ownerId, ownerLabel: personName ?? undefined }) : []),
    [data, audience, ownerId, personName, now],
  );
  // Hoje leu a rotina: as leituras do número do menu que falharam são refeitas, para o "?" não ficar ao lado das
  // atividades já carregadas (achado 6 da revisão do 1.12).
  const retryReminders = useRetryFailedReminders();
  const snapshotReadAt = snapshot.isSuccess ? snapshot.dataUpdatedAt : 0;
  useEffect(() => {
    if (snapshotReadAt) retryReminders();
  }, [snapshotReadAt, retryReminders]);
  const loading = authLoading || permissions.loading || (!!orgId && snapshot.isPending),
    ready = !loading && !!orgId && !snapshot.isError && !!data;
  useScreenReady('dashboard', ready);
  const open = (a: Activity) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('activity', a.id);
      return next;
    });
  return (
    <div className="h-full" data-product-tour="dashboard">
      <PageScaffold
        title="Hoje"
        actions={
          permissions.canWrite && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="mr-1 h-4 w-4" />
              <span className="hidden sm:inline">Nova atividade</span>
              <span className="sr-only sm:hidden">Nova atividade</span>
            </Button>
          )
        }
      >
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(
                  new Date(),
                )}
              </p>
              <h2 className="mt-1 text-xl font-semibold">
                {profile?.name?.split(' ')[0]
                  ? `${profile.name.split(' ')[0]}, vamos ao próximo passo.`
                  : 'Vamos ao próximo passo.'}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Prazos, retornos e relacionamentos que precisam de atenção.
              </p>
              {personName && <p className="mt-1 text-sm font-medium">Você está vendo a rotina de {personName}.</p>}
            </div>
            <OwnerFilterSelect
              className="w-full sm:w-64"
              ariaLabel="Recorte da rotina"
              value={owner.value}
              scopes={TODAY_SCOPES}
              people={people}
              onValueChange={(value) =>
                setParams(
                  (previous) => {
                    const next = new URLSearchParams(previous);
                    next.set('owner', value);
                    return next;
                  },
                  { replace: true },
                )
              }
            />
          </div>
          <WorkdayState
            loading={loading}
            orgId={orgId}
            error={snapshot.isError}
            retry={() => {
              void snapshot.refetch();
              retryReminders();
            }}
          />
          {ready && (
            <>
              <section data-tour="today-summary">
                <StatStrip
                  className="[&>div]:grid-cols-2 [&_.eia-stat]:px-3 [&_.eia-stat]:py-3 [&_.eia-stat-label]:whitespace-normal [&_.eia-stat-label]:overflow-visible [&_.eia-stat>p]:hidden sm:[&_.eia-stat]:px-5 sm:[&_.eia-stat]:py-5 sm:[&_.eia-stat>p]:block"
                  stats={[
                    {
                      label: 'Para hoje',
                      value: summary.today.length,
                      icon: CalendarClock,
                      hint: 'Pendentes com prazo no dia local',
                    },
                    {
                      label: 'Vencidas',
                      value: summary.overdue.length,
                      icon: AlertTriangle,
                      hint: 'Prazo anterior ao horário atual',
                    },
                    {
                      label: 'Sem prazo',
                      value: summary.unscheduled.length,
                      icon: CalendarCheck,
                      hint: 'Pendentes aguardando uma data',
                    },
                    {
                      label: 'Concluídas hoje',
                      value: summary.completedToday.length,
                      icon: CheckCircle2,
                      hint: 'Conclusão registrada no dia local',
                    },
                  ]}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Uma atividade de hoje já vencida aparece nos dois indicadores. As listas abaixo exibem cada registro
                  uma vez. Notas ficam no histórico.
                </p>
              </section>
              <section data-tour="today-activities" className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold">Próximos passos do dia</h2>
                    <p className="text-xs text-muted-foreground">
                      Pendentes vencidas e com prazo até o fim de hoje, ordenadas pelo prazo.
                      {/* O número do menu é sempre o da conta que usa o CRM (item 1.12), também quando o recorte mostra
                      outra pessoa ou a organização (item 1.14). */}
                      {owner.scope === 'mine'
                        ? ' O número ao lado de “Hoje”, no menu, conta as mesmas.'
                        : ' O número ao lado de “Hoje”, no menu, continua contando só as suas.'}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" asChild>
                    <Link to={`/activities?owner=${owner.value}&status=${leftTeam ? 'all' : 'pending'}`}>
                      Ver atividades
                      <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
                {summary.dayQueue.length ? (
                  <>
                    <ActivityList
                      data={data}
                      activities={summary.dayQueue.slice(0, activityLimit)}
                      onOpen={open}
                      onEdit={setEditing}
                      tourPrefix="today"
                    />
                    {summary.dayQueue.length > activityLimit && (
                      <Button variant="outline" size="sm" onClick={() => setActivityLimit((limit) => limit + 20)}>
                        Mostrar mais ({summary.dayQueue.length - activityLimit})
                      </Button>
                    )}
                  </>
                ) : (
                  <EmptyState
                    icon={CircleCheck}
                    title="Sem pendências com prazo até hoje"
                    description={
                      owner.scope === 'mine'
                        ? 'Consulte a rotina da organização ou defina seu próximo passo.'
                        : personName
                          ? `${personName} não tem atividades pendentes com prazo até hoje. Consulte também os itens sem prazo.`
                          : 'As próximas atividades com data estão além de hoje. Consulte também os itens sem prazo.'
                    }
                    action={
                      permissions.canWrite ? (
                        <Button variant="outline" onClick={() => setCreating(true)}>
                          Definir próximo passo
                        </Button>
                      ) : undefined
                    }
                  />
                )}
                {summary.unscheduled.length > 0 && (
                  <Link
                    className="inline-block text-sm text-primary hover:underline"
                    to={`/activities?date=no-date&status=pending&owner=${owner.value}`}
                  >
                    {summary.unscheduled.length} atividade(s) sem prazo para organizar
                  </Link>
                )}
              </section>
              <section data-tour="today-attention" className="space-y-3">
                <div>
                  <h2 className="text-base font-semibold">Fila de atenção · {attention.length}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Critérios ativos da organização. Prioridade 1 vem primeiro; cada ficha reúne todos os motivos.
                  </p>
                </div>
                {attention.length ? (
                  <>
                    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                      {attention.slice(0, attentionLimit).map((item) => (
                        <li key={item.key} className="p-4" data-attention-group={item.group ? 'contacts' : undefined}>
                          <div className="flex items-start justify-between gap-3">
                            <Link to={item.path} className="text-sm font-semibold text-primary hover:underline">
                              {item.title}
                            </Link>
                            <span
                              className={`shrink-0 rounded-md px-2 py-1 text-[11px] ${item.priority === 1 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}
                            >
                              Prioridade {item.priority}
                            </span>
                          </div>
                          <ul className="mt-2 space-y-1.5">
                            {item.reasons.map((reason) => (
                              <li key={reason.ruleId} className="text-xs text-muted-foreground">
                                <span className="font-semibold">{reason.label}: </span>
                                {reason.explanation}
                              </li>
                            ))}
                          </ul>
                          <Link
                            className="mt-3 inline-flex items-center text-xs font-medium text-primary hover:underline"
                            to={item.path}
                          >
                            {item.group?.reason === 'deactivated-owner'
                              ? 'Ver na Equipe'
                              : item.group
                                ? 'Ver contatos sem próxima ação'
                                : 'Abrir ficha e resolver'}
                            <ArrowUpRight className="ml-1 h-3 w-3" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {attention.length > attentionLimit && (
                      <Button variant="outline" size="sm" onClick={() => setAttentionLimit((limit) => limit + 20)}>
                        Mostrar mais ({attention.length - attentionLimit})
                      </Button>
                    )}
                  </>
                ) : (
                  <EmptyState
                    icon={CircleCheck}
                    title={
                      data.riskRules.some((rule) => rule.enabled)
                        ? 'Nenhum item atende aos critérios ativos'
                        : 'Nenhum critério de atenção ativo'
                    }
                    description={
                      data.riskRules.some((rule) => rule.enabled)
                        ? 'A fila considera o recorte escolhido e as regras configuradas pela organização.'
                        : 'Donos e administradores ligam os critérios em Configurações, na aba Fila de atenção.'
                    }
                  />
                )}
              </section>
            </>
          )}
        </div>
      </PageScaffold>
      {ready && selectedId && (
        <ActivityDetail
          key={selectedId}
          data={data}
          activity={data.activities.find((a) => a.id === selectedId)}
          onClose={() =>
            setParams(
              (previous) => {
                const next = new URLSearchParams(previous);
                next.delete('activity');
                return next;
              },
              { replace: true },
            )
          }
          onEdit={setEditing}
        />
      )}
      {ready && (creating || editing) && permissions.canWrite && (
        <ActivityDialog
          key={editing?.id ?? 'new'}
          data={data}
          activity={editing ?? undefined}
          defaults={{ user_id: owner.ownerId }}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
