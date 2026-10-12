import { useEffect, useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Plus, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { crmDb } from '@/integrations/supabase/crm-client';
import type { CrmRow } from '@/integrations/supabase/commercial-types';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import { allCrmRows } from '@/lib/crm-pagination';
import { isOfflineRequestError, OFFLINE_REQUEST_MESSAGE } from '@/lib/offline';
import { PageScaffold } from '@/components/shell/PageScaffold';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ds/dialog';

const tabs = [
  ['profile', 'Meu perfil'],
  ['organization', 'Organização'],
  ['pipelines', 'Funis'],
  ['attention', 'Fila de atenção'],
  ['preferences', 'Preferências'],
];
const selectClass = 'h-11 w-full rounded-xl border border-input bg-background px-3 text-sm';
const SAVE_FAILED = 'Não foi possível salvar. Seu preenchimento foi preservado; revise os dados e tente novamente.';
const PIPELINE_CONFLICT =
  'Este funil mudou ou não está mais disponível. Seu preenchimento foi preservado; feche e reabra a edição para revisar os dados atuais.';
const STAGE_CONFLICT =
  'Esta etapa mudou ou não está mais disponível. Seu preenchimento foi preservado; feche e reabra a edição para revisar os dados atuais.';
const RULE_CONFLICT =
  'Esta regra mudou ou não está mais disponível. Suas escolhas continuam no formulário; carregue a versão atual para revisar antes de salvar de novo.';
interface SaveOptions<T> {
  onSuccess?: (data: T) => void;
  /** Mensagem quando a gravação condicionada a updated_at não encontra a versão lida. */
  conflict?: string;
}
/** Grava e recarrega Configurações, com a mensagem de erro ou de conflito na tela. */
type SaveSettings = <T>(
  operation: () => PromiseLike<{ data: T | null; error: unknown }>,
  success: string,
  options?: SaveOptions<T>,
) => Promise<void>;
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = tabs.some(([id]) => id === params.get('tab')) ? params.get('tab')! : 'profile';
  const { profile, refreshProfile } = useAuth();
  const { canManage } = useCrmPermissions();
  const probabilityHintId = useId();
  const orgId = profile?.org_id;
  const qc = useQueryClient();
  const { theme, setTheme, density, setDensity } = useTheme();
  const [name, setName] = useState(profile?.name ?? '');
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const [orgName, setOrgName] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [editing, setEditing] = useState<{
    kind: 'pipeline' | 'stage';
    id?: string;
    /** Versão aberta para edição: a gravação só vale se o registro ainda estiver nela. */
    updatedAt?: string;
    name: string;
    probability: number;
    order: number;
  } | null>(null);
  const query = useQuery({
    queryKey: ['crm', orgId, 'settings'],
    enabled: !!orgId,
    queryFn: async () => {
      const [org, pipelines, stages, rules] = await Promise.all([
        crmDb.from('organizations').select('*').eq('id', orgId!).single(),
        allCrmRows((from, to) =>
          crmDb.from('pipelines').select('*').eq('org_id', orgId!).order('created_at').order('id').range(from, to),
        ),
        allCrmRows((from, to) =>
          crmDb.from('pipeline_stages').select('*').eq('org_id', orgId!).order('order').order('id').range(from, to),
        ),
        crmDb.from('risk_rules').select('*').eq('org_id', orgId!).order('priority'),
      ]);
      for (const result of [org, rules]) if (result.error) throw result.error;
      return { org: org.data!, pipelines, stages, rules: rules.data! };
    },
  });
  useEffect(() => {
    setName(profile?.name ?? '');
  }, [profile?.name]);
  useEffect(() => {
    if (query.data) {
      setOrgName(query.data.org.name);
      setPipelineId((current) =>
        query.data.pipelines.some((p) => p.id === current) ? current : (query.data.pipelines[0]?.id ?? ''),
      );
    }
  }, [query.data]);
  /**
   * Funis, etapas e regras só gravam a versão lida (.eq('updated_at', …) com maybeSingle). Sem linha devolvida,
   * outra pessoa alterou ou excluiu o registro: nada é sobrescrito, a tela mostra `conflict` e recarrega os dados.
   */
  const save: SaveSettings = async (operation, success, { onSuccess, conflict } = {}) => {
    setSaving(true);
    setError('');
    try {
      const result = await operation();
      if (result.error) throw result.error;
      if (result.data === null) {
        setError(conflict ?? SAVE_FAILED);
        await qc.invalidateQueries({ queryKey: ['crm'] });
        return;
      }
      onSuccess?.(result.data);
      await qc.invalidateQueries({ queryKey: ['crm'] });
      toast.success(success);
    } catch (failure) {
      setError(
        isOfflineRequestError(failure) ? `${OFFLINE_REQUEST_MESSAGE} Seu preenchimento foi preservado.` : SAVE_FAILED,
      );
    } finally {
      setSaving(false);
    }
  };
  async function saveEditor(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || !orgId || !canManage) return;
    if (editing.kind === 'pipeline')
      await save(
        () =>
          editing.id
            ? crmDb
                .from('pipelines')
                .update({ name: editing.name.trim() })
                .eq('id', editing.id)
                .eq('org_id', orgId)
                .eq('updated_at', editing.updatedAt!)
                .select('id')
                .maybeSingle()
            : crmDb.from('pipelines').insert({ org_id: orgId, name: editing.name.trim() }).select('id').single(),
        'Funil salvo',
        { onSuccess: () => setEditing(null), conflict: PIPELINE_CONFLICT },
      );
    else
      await save(
        () =>
          editing.id
            ? crmDb
                .from('pipeline_stages')
                .update({ name: editing.name.trim(), win_probability: editing.probability, order: editing.order })
                .eq('id', editing.id)
                .eq('org_id', orgId)
                .eq('updated_at', editing.updatedAt!)
                .select('id')
                .maybeSingle()
            : crmDb
                .from('pipeline_stages')
                .insert({
                  org_id: orgId,
                  pipeline_id: pipelineId,
                  name: editing.name.trim(),
                  win_probability: editing.probability,
                  order: editing.order,
                })
                .select('id')
                .single(),
        'Etapa salva',
        { onSuccess: () => setEditing(null), conflict: STAGE_CONFLICT },
      );
  }
  return (
    <PageScaffold
      title="Configurações"
      toolbar={
        <nav className="flex gap-2" aria-label="Configurações">
          {tabs.map(([id, label]) => (
            <Button
              key={id}
              size="sm"
              variant={tab === id ? 'default' : 'ghost'}
              onClick={() => setParams({ tab: id })}
              aria-current={tab === id ? 'page' : undefined}
            >
              {label}
            </Button>
          ))}
        </nav>
      }
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <p className="text-sm text-muted-foreground">
          Adapte o CRM ao seu processo comercial e às preferências da equipe.
        </p>
        {error && (
          <p role="alert" className="rounded-xl border border-destructive p-4 text-sm">
            {error}
          </p>
        )}
        {!canManage && ['organization', 'pipelines', 'attention'].includes(tab) && (
          <p className="rounded-xl bg-muted p-4 text-sm">
            Somente administradores podem alterar estas configurações. Você pode consultá-las.
          </p>
        )}
        {tab === 'profile' && (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void save(
                () => crmDb.from('profiles').update({ name: name.trim() }).eq('id', profile!.id).select('id').single(),
                'Perfil atualizado',
                { onSuccess: () => void refreshProfile() },
              );
            }}
          >
            <Field label="Seu nome">
              <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} />
            </Field>
            <Field label="E-mail da conta">
              <Input value={profile?.email ?? ''} disabled />
            </Field>
            <Button disabled={saving}>{saving ? 'Salvando…' : 'Salvar perfil'}</Button>
          </form>
        )}
        {['organization', 'pipelines', 'attention'].includes(tab) && query.isPending && (
          <p role="status">Carregando configurações…</p>
        )}
        {['organization', 'pipelines', 'attention'].includes(tab) && query.isError && (
          <div role="alert">
            <p>Não foi possível carregar as configurações.</p>
            <Button onClick={() => void query.refetch()}>Tentar novamente</Button>
          </div>
        )}
        {tab === 'organization' && query.data && (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void save(
                () =>
                  crmDb.from('organizations').update({ name: orgName.trim() }).eq('id', orgId!).select('id').single(),
                'Organização atualizada',
              );
            }}
          >
            <Field label="Nome da organização">
              <Input
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                required
                minLength={2}
                maxLength={160}
                disabled={!canManage}
              />
            </Field>
            <p className="text-sm text-muted-foreground">
              Contatos e empresas atendem qualquer segmento. Seus funis definem como a equipe acompanha cada
              oportunidade.
            </p>
            {canManage && <Button disabled={saving}>{saving ? 'Salvando…' : 'Salvar organização'}</Button>}
          </form>
        )}
        {tab === 'pipelines' && query.data && (
          <section className="space-y-5">
            <div className="flex flex-wrap gap-3">
              <select
                aria-label="Funil"
                className={selectClass + ' flex-1'}
                value={pipelineId}
                onChange={(e) => setPipelineId(e.target.value)}
              >
                {query.data.pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {canManage && (
                <Button onClick={() => setEditing({ kind: 'pipeline', name: '', probability: 0, order: 0 })}>
                  <Plus className="h-4 w-4" />
                  Novo funil
                </Button>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Renomear etapas preserva os vínculos das oportunidades. Probabilidades são estimativas configuradas pela
              equipe e entram na previsão ponderada. Oportunidades sem probabilidade própria acompanham a da etapa,
              então alterar a probabilidade de uma etapa muda a previsão delas na hora.
            </p>
            {pipelineId && canManage && (
              <Button
                variant="outline"
                onClick={() => {
                  const pipeline = query.data!.pipelines.find((p) => p.id === pipelineId)!;
                  setEditing({
                    kind: 'pipeline',
                    id: pipeline.id,
                    updatedAt: pipeline.updated_at,
                    name: pipeline.name,
                    probability: 0,
                    order: 0,
                  });
                }}
              >
                Renomear funil
              </Button>
            )}
            <ol className="space-y-3">
              {query.data.stages
                .filter((s) => s.pipeline_id === pipelineId)
                .map((stage) => (
                  <li
                    key={stage.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4"
                  >
                    <div>
                      <p className="font-medium">{stage.name}</p>
                      <p className="text-sm text-muted-foreground">
                        Ordem {stage.order + 1} · probabilidade {stage.win_probability}%
                      </p>
                    </div>
                    {canManage && (
                      <Button
                        variant="ghost"
                        aria-label={'Editar ' + stage.name}
                        onClick={() =>
                          setEditing({
                            kind: 'stage',
                            id: stage.id,
                            updatedAt: stage.updated_at,
                            name: stage.name,
                            probability: stage.win_probability,
                            order: stage.order,
                          })
                        }
                      >
                        <Settings2 className="h-4 w-4" />
                        Editar
                      </Button>
                    )}
                  </li>
                ))}
            </ol>
            {pipelineId && canManage && (
              <Button
                variant="outline"
                onClick={() =>
                  setEditing({
                    kind: 'stage',
                    name: '',
                    probability: 0,
                    order:
                      Math.max(
                        -1,
                        ...query.data!.stages.filter((s) => s.pipeline_id === pipelineId).map((s) => s.order),
                      ) + 1,
                  })
                }
              >
                <Plus className="h-4 w-4" />
                Adicionar etapa
              </Button>
            )}
          </section>
        )}
        {tab === 'attention' && query.data && (
          <section className="space-y-4">
            <p className="text-sm text-muted-foreground">
              A fila Hoje apresenta o motivo de cada pendência. Prioridade 1 aparece antes de 2 e 3. O limite de dias
              considera a última atualização da oportunidade e de suas atividades vinculadas.
            </p>
            {query.data.rules.map((rule) => (
              <RuleEditor key={rule.id} rule={rule} canManage={canManage} save={save} />
            ))}
          </section>
        )}
        {tab === 'preferences' && (
          <section className="space-y-5">
            <Field label="Tema">
              <select className={selectClass} value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)}>
                <option value="dark">Escuro</option>
                <option value="light">Claro</option>
                <option value="system">Seguir dispositivo</option>
              </select>
            </Field>
            <Field label="Densidade">
              <select
                className={selectClass}
                value={density}
                onChange={(e) => setDensity(e.target.value as typeof density)}
              >
                <option value="normal">Padrão</option>
                <option value="comfortable">Confortável</option>
                <option value="compact">Compacta</option>
              </select>
            </Field>
            <div className="rounded-2xl border border-border p-5">
              <h2 className="font-semibold">Configuração e orientação</h2>
              <p className="my-2 text-sm text-muted-foreground">
                O checklist acompanha registros reais. Tours e preferências de orientação ficam na Central de Ajuda.
              </p>
              <Button
                variant="outline"
                onClick={() => window.dispatchEvent(new Event('empreende-crm:open-onboarding'))}
              >
                Configurar meu CRM
              </Button>
            </div>
          </section>
        )}
      </div>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !saving) {
            setEditing(null);
            setError('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.kind === 'stage' ? 'Configurar etapa' : 'Configurar funil'}</DialogTitle>
            <DialogDescription>
              Esses nomes podem refletir qualquer processo comercial da organização.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <form onSubmit={saveEditor} className="space-y-4">
              <Field label="Nome">
                <Input
                  autoFocus
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  required
                  maxLength={100}
                />
              </Field>
              {editing.kind === 'stage' && (
                <>
                  <div className="space-y-2">
                    <Field label="Probabilidade de ganho (%)">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        value={editing.probability}
                        onChange={(e) => setEditing({ ...editing, probability: Number(e.target.value) })}
                        aria-describedby={probabilityHintId}
                        required
                      />
                    </Field>
                    <p id={probabilityHintId} className="text-xs text-muted-foreground">
                      Oportunidades sem probabilidade própria acompanham a da etapa, então alterar este valor muda a
                      previsão delas na hora.
                    </p>
                  </div>
                  <Field label="Ordem de exibição (começa em 1)">
                    <Input
                      type="number"
                      min={1}
                      value={editing.order + 1}
                      onChange={(e) => setEditing({ ...editing, order: Number(e.target.value) - 1 })}
                      required
                    />
                  </Field>
                </>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </PageScaffold>
  );
}
type RiskRule = CrmRow<'risk_rules'>;
const ruleDraft = (rule: RiskRule) => ({ enabled: rule.enabled, priority: rule.priority, days: rule.threshold_days });
function RuleEditor({ rule, canManage, save }: { rule: RiskRule; canManage: boolean; save: SaveSettings }) {
  // Versão em que o formulário se baseia. A guarda de concorrência compara com ela, e não com a recarregada em
  // segundo plano: assim, escolhas feitas sobre uma versão antiga não sobrescrevem a de um colega.
  const [base, setBase] = useState(rule),
    [draft, setDraft] = useState(() => ruleDraft(rule)),
    [busy, setBusy] = useState(false);
  const dirty =
    draft.enabled !== base.enabled || draft.priority !== base.priority || draft.days !== base.threshold_days;
  const outdated = rule.updated_at !== base.updated_at;
  useEffect(() => {
    // Sem mudanças locais, o formulário acompanha a versão atual.
    if (outdated && !dirty) {
      setBase(rule);
      setDraft(ruleDraft(rule));
    }
  }, [outdated, dirty, rule]);
  const change = (fields: Partial<ReturnType<typeof ruleDraft>>) => setDraft((current) => ({ ...current, ...fields }));
  return (
    <form
      className="space-y-3 rounded-2xl border border-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        void save(
          () =>
            crmDb
              .from('risk_rules')
              .update({ enabled: draft.enabled, priority: draft.priority, threshold_days: draft.days })
              .eq('id', base.id)
              .eq('org_id', base.org_id)
              .eq('updated_at', base.updated_at)
              .select('*')
              .maybeSingle(),
          'Regra atualizada',
          {
            onSuccess: (saved) => {
              setBase(saved);
              setDraft(ruleDraft(saved));
            },
            conflict: RULE_CONFLICT,
          },
        ).finally(() => setBusy(false));
      }}
    >
      <h3 className="font-semibold">{rule.name}</h3>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => change({ enabled: e.target.checked })}
          disabled={!canManage || busy}
        />
        Regra ativa
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Prioridade">
          <select
            className={selectClass}
            value={draft.priority}
            onChange={(e) => change({ priority: Number(e.target.value) })}
            disabled={!canManage || busy}
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        {rule.type === 'stale_deal' && (
          <Field label="Dias sem atualização">
            <Input
              type="number"
              min={1}
              max={365}
              value={draft.days}
              onChange={(e) => change({ days: Number(e.target.value) })}
              disabled={!canManage || busy}
              required
            />
          </Field>
        )}
      </div>
      {canManage && outdated && dirty && !busy && (
        <div role="status" className="space-y-2 rounded-xl bg-muted p-3 text-sm">
          <p>Outra pessoa alterou esta regra depois que você começou a editar. Suas escolhas ainda não foram salvas.</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setBase(rule);
              setDraft(ruleDraft(rule));
            }}
          >
            Carregar versão atual
          </Button>
        </div>
      )}
      {canManage && (
        <Button size="sm" variant="outline" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar regra'}
        </Button>
      )}
    </form>
  );
}
