import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, BarChart3, Download, FilterX, TrendingUp } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { PageScaffold } from '@/components/shell/PageScaffold';
import { Button } from '@/components/ds/button';
import { Input } from '@/components/ds/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ds/select';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/foundation/EmptyState';
import { LoadingState } from '@/components/foundation/LoadingState';
import { Panel, PanelBody, PanelHeader } from '@/components/foundation/Panel';
import { StatStrip } from '@/components/foundation/StatStrip';
import { StatusChip } from '@/components/foundation/StatusChip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errorMessage, loadOperationReferences } from '@/components/operations/data';
import { downloadCsv } from '@/lib/csv';
import { inReportPeriod, localDateKey, summarizeReport } from '@/lib/operation-logic';
import { DEAL_STATUS_LABELS, effectiveProbability, formatDealCurrency, stageProbabilities } from '@/lib/deal-logic';
import type { DealStatus } from '@/lib/deal-types';

export default function Reports() {
  const { orgId } = useOrg();
  return orgId ? (
    <ReportContent key={orgId} orgId={orgId} />
  ) : (
    <PageScaffold title="Relatórios">
      <EmptyState
        icon={BarChart3}
        title="Organização indisponível"
        description="Entre em uma organização para consultar os indicadores."
      />
    </PageScaffold>
  );
}
function ReportContent({ orgId }: { orgId: string }) {
  const [params, setParams] = useSearchParams();
  const [exportError, setExportError] = useState('');
  const query = useQuery({
    queryKey: ['crm', orgId, 'operation-references'],
    queryFn: () => loadOperationReferences(orgId),
  });
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const owner = params.get('owner') || 'all';
  const pipeline = params.get('pipeline') || 'all';
  const invalidRange = !!from && !!to && from > to;
  const scoped = (query.data?.deals ?? []).filter(
    (deal) =>
      !invalidRange &&
      (pipeline === 'all' || deal.pipeline_id === pipeline) &&
      (owner === 'all' || (owner === 'unassigned' ? !deal.owner_id : deal.owner_id === owner)),
  );
  // Ganhas e perdidas entram no período pela data de fechamento; as em aberto, pela de criação.
  const deals = scoped.filter((deal) => inReportPeriod(deal, from, to));
  const summary = summarizeReport(scoped, query.data?.stages ?? [], { from, to });
  const closedOn = (deal: (typeof deals)[number]) =>
    deal.status !== 'open' && deal.closed_at ? new Date(deal.closed_at).toLocaleDateString('pt-BR') : '';
  const ownerName = (id: string | null) =>
    query.data?.people.find((person) => person.id === id)?.name ??
    (id ? 'Responsável indisponível' : 'Sem responsável');
  const pipelineName = (id: string) =>
    query.data?.pipelines.find((item) => item.id === id)?.name ?? 'Pipeline indisponível';
  const update = (key: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value && value !== 'all') next.set(key, value);
      else next.delete(key);
      return next;
    });
  const exportReport = () => {
    setExportError('');
    try {
      const stageOf = (deal: (typeof deals)[number]) => query.data?.stages.find((stage) => stage.id === deal.stage_id);
      const probabilities = stageProbabilities(query.data?.stages ?? []);
      downloadCsv(`oportunidades-empreende-ia-${localDateKey()}.csv`, deals, [
        { header: 'Oportunidade', value: (deal) => deal.title },
        { header: 'Pipeline', value: (deal) => pipelineName(deal.pipeline_id) },
        { header: 'Etapa', value: (deal) => stageOf(deal)?.name ?? '' },
        { header: 'Responsável', value: (deal) => ownerName(deal.owner_id) },
        {
          header: 'Situação atual',
          value: (deal) => DEAL_STATUS_LABELS[deal.status as DealStatus] ?? deal.status,
        },
        { header: 'Valor BRL', value: (deal) => deal.value.toFixed(2).replace('.', ',') },
        { header: 'Probabilidade %', value: (deal) => effectiveProbability(deal, probabilities) },
        { header: 'Criada em', value: (deal) => new Date(deal.created_at).toLocaleString('pt-BR') },
        {
          header: 'Fechada em',
          value: (deal) =>
            deal.status !== 'open' && deal.closed_at ? new Date(deal.closed_at).toLocaleString('pt-BR') : '',
        },
        { header: 'Previsão de fechamento', value: (deal) => deal.close_date ?? '' },
        { header: 'Motivo de perda', value: (deal) => deal.lost_reason ?? '' },
      ]);
    } catch (error) {
      setExportError(errorMessage(error));
    }
  };
  return (
    <PageScaffold
      title="Relatórios"
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={exportReport}
          disabled={query.isPending || query.isError || !deals.length}
        >
          <Download className="mr-1.5 h-4 w-4" />
          <span className="hidden sm:inline">Exportar </span>CSV
        </Button>
      }
      toolbar={
        <div className="flex w-full flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="report-from" className="text-[10px]">
              Período de
            </Label>
            <Input
              id="report-from"
              type="date"
              value={from}
              onChange={(event) => update('from', event.target.value)}
              className="w-[145px]"
            />
          </div>
          <div>
            <Label htmlFor="report-to" className="text-[10px]">
              Até
            </Label>
            <Input
              id="report-to"
              type="date"
              value={to}
              onChange={(event) => update('to', event.target.value)}
              className="w-[145px]"
            />
          </div>
          <Select value={pipeline} onValueChange={(value) => update('pipeline', value)}>
            <SelectTrigger className="w-[175px]" aria-label="Filtrar pipeline">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos pipelines</SelectItem>
              {query.data?.pipelines.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={owner} onValueChange={(value) => update('owner', value)}>
            <SelectTrigger className="w-[175px]" aria-label="Filtrar responsável">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos responsáveis</SelectItem>
              <SelectItem value="unassigned">Sem responsável</SelectItem>
              {query.data?.people.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(from || to || owner !== 'all' || pipeline !== 'all') && (
            <Button variant="ghost" size="sm" onClick={() => setParams({})}>
              <FilterX className="mr-1.5 h-4 w-4" />
              Limpar
            </Button>
          )}
        </div>
      }
    >
      {query.isPending ? (
        <LoadingState label="Calculando indicadores…" />
      ) : query.isError ? (
        <EmptyState
          icon={AlertCircle}
          title="Não foi possível carregar os relatórios"
          description={errorMessage(query.error)}
          action={<Button onClick={() => void query.refetch()}>Tentar novamente</Button>}
        />
      ) : (
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold">Entenda o resultado das negociações.</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Resultado das oportunidades no período selecionado. Os valores comerciais não comprovam receita recebida.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Base de data: fechamento</span> para ganhas e perdidas, que
              entram no período pelo dia em que foram fechadas. As em aberto entram pela data de criação.
            </p>
          </div>
          {invalidRange && (
            <p role="alert" className="text-sm text-destructive">
              A data inicial deve ser anterior ou igual à data final.
            </p>
          )}
          {exportError && (
            <p role="alert" className="text-sm text-destructive">
              {exportError}
            </p>
          )}
          <StatStrip
            stats={[
              { label: 'Em aberto', value: summary.open, icon: BarChart3, hint: formatDealCurrency(summary.openValue) },
              { label: 'Ganhas', value: summary.won, hint: formatDealCurrency(summary.wonValue) },
              { label: 'Perdidas', value: summary.lost, hint: formatDealCurrency(summary.lostValue) },
              {
                label: 'Taxa de ganho',
                value:
                  summary.winRate === null
                    ? '—'
                    : `${summary.winRate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`,
                hint: 'Ganhas ÷ (ganhas + perdidas)',
              },
            ]}
          />
          <Panel>
            <PanelHeader title="Previsão ponderada" description="Somente oportunidades em aberto no recorte." />
            <PanelBody>
              <div className="flex items-center gap-3">
                <TrendingUp className="h-5 w-5 text-primary" />
                <p className="text-3xl font-semibold tabular-nums">{formatDealCurrency(summary.forecast)}</p>
              </div>
              <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
                Soma do valor de cada oportunidade × sua probabilidade. Quando a oportunidade não define uma
                probabilidade, usamos a da etapa. É uma estimativa comercial; consulte{' '}
                <Link className="underline underline-offset-4" to="/financeiro">
                  Financeiro
                </Link>{' '}
                para recebimentos registrados.
              </p>
            </PanelBody>
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <PanelHeader title="Distribuição por situação" description={`${deals.length} oportunidades no recorte`} />
              <PanelBody>
                <div className="space-y-5">
                  {(['open', 'won', 'lost'] as const).map((status) => (
                    <div key={status}>
                      <div className="mb-1.5 flex justify-between text-sm">
                        <span>{DEAL_STATUS_LABELS[status]}</span>
                        <span className="font-medium tabular-nums">{summary[status]}</span>
                      </div>
                      <div
                        className="h-2 rounded-full bg-muted"
                        role="img"
                        aria-label={`${DEAL_STATUS_LABELS[status]}: ${summary[status]} de ${deals.length}`}
                      >
                        <div
                          className={`h-full rounded-full ${status === 'won' ? 'bg-success' : status === 'lost' ? 'bg-destructive' : 'bg-primary'}`}
                          style={{ width: `${deals.length ? (summary[status] / deals.length) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader
                title="Valor aberto por pipeline"
                description="Negócios em negociação, agrupados por vínculo ao pipeline."
              />
              <PanelBody>
                {query.data?.pipelines
                  .filter((item) => pipeline === 'all' || item.id === pipeline)
                  .map((item) => {
                    const group = deals.filter((deal) => deal.pipeline_id === item.id && deal.status === 'open');
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 border-b border-border/60 py-3 first:pt-0 last:border-0"
                      >
                        <Link
                          className="min-w-0 truncate text-sm underline-offset-4 hover:underline"
                          to={`/pipeline?pipeline=${item.id}`}
                        >
                          {item.name} <span className="text-muted-foreground">({group.length})</span>
                        </Link>
                        <span className="text-sm font-semibold tabular-nums">
                          {formatDealCurrency(group.reduce((sum, deal) => sum + Math.round(deal.value * 100), 0) / 100)}
                        </span>
                      </div>
                    );
                  })}
              </PanelBody>
            </Panel>
          </div>
          {deals.length ? (
            <Panel>
              <PanelHeader
                title="Oportunidades do relatório"
                description="Abra um registro para conferir seus vínculos e seu histórico."
              />
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Oportunidade</TableHead>
                      <TableHead>Responsável</TableHead>
                      <TableHead>Pipeline</TableHead>
                      <TableHead>Situação</TableHead>
                      <TableHead>Fechada em</TableHead>
                      <TableHead className="text-right">Valor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deals.map((deal) => (
                      <TableRow key={deal.id}>
                        <TableCell>
                          <Link
                            to={`/pipeline?deal=${deal.id}`}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {deal.title}
                          </Link>
                        </TableCell>
                        <TableCell>{ownerName(deal.owner_id)}</TableCell>
                        <TableCell>{pipelineName(deal.pipeline_id)}</TableCell>
                        <TableCell>
                          <StatusChip
                            tone={deal.status === 'won' ? 'success' : deal.status === 'lost' ? 'danger' : 'neutral'}
                          >
                            {DEAL_STATUS_LABELS[deal.status as DealStatus] ?? deal.status}
                          </StatusChip>
                        </TableCell>
                        <TableCell className="tabular-nums">{closedOn(deal) || '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatDealCurrency(deal.value)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Panel>
          ) : (
            <EmptyState
              icon={BarChart3}
              title="Ainda não há oportunidades neste recorte"
              description="Ajuste os filtros ou registre oportunidades para acompanhar os resultados."
            />
          )}
        </div>
      )}
    </PageScaffold>
  );
}
