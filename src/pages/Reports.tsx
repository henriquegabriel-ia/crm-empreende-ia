import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, BarChart3, ChevronDown, Download, FilterX, TrendingUp } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { PageScaffold } from '@/components/shell/PageScaffold';
import { Button } from '@/components/ds/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ds/dropdown-menu';
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
import { exportFileName } from '@/lib/brand';
import { inReportPeriod, localDateKey, summarizeReport } from '@/lib/operation-logic';
import { winsByOwner } from '@/lib/report-wins';
import {
  DEAL_ITEM_BILLING_LABELS,
  DEAL_STATUS_LABELS,
  dealItemDiscountLabel,
  effectiveProbability,
  formatDealCurrency,
  formatQuantity,
  hasDealItems,
  PRODUCT_KIND_LABELS,
  stageProbabilities,
} from '@/lib/deal-logic';
import type { DealItem, DealStatus } from '@/lib/deal-types';
import { loadAllDealItems, loadProducts } from '@/components/pipeline/deal-items-data';
import { CATALOG_MIGRATION_MISSING, catalogMigrationMissing } from '@/lib/rpc-errors';
import { filterMembers, memberLabel } from '@/lib/team-members';
import { OwnerFilterValue } from '@/components/team/OwnerFilterValue';

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
  const [exportingItems, setExportingItems] = useState(false);
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
  // Ganhos por responsável (item 1.14): as ganhas do recorte (funil e responsável), no período pela data de fechamento.
  const wins = winsByOwner(scoped, query.data?.people ?? [], { from, to });
  const closedOn = (deal: (typeof deals)[number]) =>
    deal.status !== 'open' && deal.closed_at ? new Date(deal.closed_at).toLocaleDateString('pt-BR') : '';
  // "Nome (desativado)" para quem saiu da equipe (item 1.2), na tabela e no CSV.
  const ownerName = (id: string | null) =>
    memberLabel(
      query.data?.people.find((person) => person.id === id),
      id,
    );
  const pipelineName = (id: string) =>
    query.data?.pipelines.find((item) => item.id === id)?.name ?? 'Funil indisponível';
  const update = (key: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value && value !== 'all') next.set(key, value);
      else next.delete(key);
      return next;
    });
  const stageOf = (deal: (typeof deals)[number]) => query.data?.stages.find((stage) => stage.id === deal.stage_id);
  // Valores em reais no formato da planilha (vírgula decimal), vazios quando não há.
  const csvMoney = (value: number | null | undefined) =>
    value === null || value === undefined ? '' : Number(value).toFixed(2).replace('.', ',');
  // Item 1.16: a planilha dos itens só tem o que baixar quando alguma oportunidade do recorte tem itens.
  const dealsWithItems = deals.filter((deal) => hasDealItems(deal));
  const exportReport = () => {
    setExportError('');
    try {
      const probabilities = stageProbabilities(query.data?.stages ?? []);
      downloadCsv(exportFileName('oportunidades', 'csv', localDateKey()), deals, [
        { header: 'Oportunidade', value: (deal) => deal.title },
        { header: 'Funil', value: (deal) => pipelineName(deal.pipeline_id) },
        { header: 'Etapa', value: (deal) => stageOf(deal)?.name ?? '' },
        { header: 'Responsável', value: (deal) => ownerName(deal.owner_id) },
        {
          header: 'Situação atual',
          value: (deal) => DEAL_STATUS_LABELS[deal.status as DealStatus] ?? deal.status,
        },
        { header: 'Valor BRL', value: (deal) => deal.value.toFixed(2).replace('.', ',') },
        // Item 1.16: com itens, "Valor BRL" é o valor do contrato; as partes vêm ao lado, vazias sem itens.
        { header: 'Total único BRL', value: (deal) => (hasDealItems(deal) ? csvMoney(deal.one_time_value) : '') },
        { header: 'Mensalidade BRL', value: (deal) => (hasDealItems(deal) ? csvMoney(deal.monthly_value) : '') },
        { header: 'Meses do contrato', value: (deal) => (hasDealItems(deal) ? (deal.contract_months ?? '') : '') },
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
  /**
   * "Itens das oportunidades" (item 1.16; docs/arquitetura/1.16.md, seção 6.3): lê os itens da organização só ao clicar
   * (paginado) e escreve uma linha por item das oportunidades do recorte, com o tipo e o código do catálogo.
   */
  const exportItems = async () => {
    setExportError('');
    setExportingItems(true);
    try {
      const [items, products] = await Promise.all([loadAllDealItems(orgId), loadProducts(orgId)]);
      const byDeal = new Map(dealsWithItems.map((deal) => [deal.id, deal]));
      const productOf = new Map(products.map((product) => [product.id, product]));
      const rows = items
        .filter((item) => byDeal.has(item.deal_id))
        .sort((a, b) => {
          const order = dealsWithItems.indexOf(byDeal.get(a.deal_id)!) - dealsWithItems.indexOf(byDeal.get(b.deal_id)!);
          return order || a.position - b.position;
        });
      const dealOf = (item: DealItem) => byDeal.get(item.deal_id)!;
      downloadCsv(exportFileName('itens-oportunidades', 'csv', localDateKey()), rows, [
        { header: 'Oportunidade', value: (item) => dealOf(item).title },
        { header: 'Funil', value: (item) => pipelineName(dealOf(item).pipeline_id) },
        { header: 'Etapa', value: (item) => stageOf(dealOf(item))?.name ?? '' },
        { header: 'Responsável', value: (item) => ownerName(dealOf(item).owner_id) },
        {
          header: 'Situação atual',
          value: (item) => DEAL_STATUS_LABELS[dealOf(item).status as DealStatus] ?? dealOf(item).status,
        },
        { header: 'Fechada em', value: (item) => closedOn(dealOf(item)) },
        { header: 'Item', value: (item) => item.name },
        { header: 'Código', value: (item) => (item.product_id ? (productOf.get(item.product_id)?.code ?? '') : '') },
        {
          header: 'Tipo',
          value: (item) => {
            const product = item.product_id ? productOf.get(item.product_id) : undefined;
            return product ? PRODUCT_KIND_LABELS[product.kind] : item.product_id ? '' : 'Avulso';
          },
        },
        { header: 'Quantidade', value: (item) => formatQuantity(Number(item.quantity)) },
        { header: 'Unidade', value: (item) => item.unit ?? '' },
        { header: 'Preço unitário BRL', value: (item) => csvMoney(item.unit_price) },
        { header: 'Desconto', value: (item) => dealItemDiscountLabel(item) },
        { header: 'Cobrança', value: (item) => DEAL_ITEM_BILLING_LABELS[item.billing] },
        { header: 'Total da linha BRL', value: (item) => csvMoney(item.line_total) },
        { header: 'Meses do contrato', value: (item) => dealOf(item).contract_months ?? '' },
      ]);
    } catch (error) {
      setExportError(catalogMigrationMissing(error) ? CATALOG_MIGRATION_MISSING : errorMessage(error));
    } finally {
      setExportingItems(false);
    }
  };
  return (
    <PageScaffold
      title="Relatórios"
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              disabled={query.isPending || query.isError || !deals.length || exportingItems}
            >
              <Download className="mr-1.5 h-4 w-4" />
              <span className="hidden sm:inline">Exportar </span>CSV
              <ChevronDown className="ml-1 h-3.5 w-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onSelect={exportReport}>Oportunidades</DropdownMenuItem>
            <DropdownMenuItem disabled={!dealsWithItems.length} onSelect={() => void exportItems()}>
              <span>
                <span className="block">Itens das oportunidades</span>
                {!dealsWithItems.length && (
                  <span className="block text-xs text-muted-foreground">
                    Nenhuma oportunidade do recorte tem itens.
                  </span>
                )}
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
            <SelectTrigger className="w-[175px]" aria-label="Filtrar funil">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os funis</SelectItem>
              {query.data?.pipelines.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={owner} onValueChange={(value) => update('owner', value)}>
            {/* Largura para "Todos os responsáveis" inteiro; a marca "(desativado)" nunca é cortada (achado 6 do 1.2). */}
            <SelectTrigger className="w-[13.5rem]" aria-label="Filtrar responsável">
              <SelectValue>
                <OwnerFilterValue value={owner} people={query.data?.people ?? []} />
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os responsáveis</SelectItem>
              <SelectItem value="unassigned">Sem responsável</SelectItem>
              {filterMembers(query.data?.people ?? []).map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {memberLabel(person)}
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
              // Item 1.16: a recorrência ganha por mês, já contida no valor ganho; só quando alguma ganha tem mensalidade.
              // A dica do StatStrip é cortada numa linha: fica curta, e a explicação completa vem logo abaixo da faixa.
              ...(summary.wonMonthly > 0
                ? [
                    {
                      label: 'Mensalidades ganhas',
                      value: `${formatDealCurrency(summary.wonMonthly)}/mês`,
                      hint: 'Já incluídas no valor ganho',
                    },
                  ]
                : []),
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
          {summary.wonMonthly > 0 && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Mensalidades ganhas</span> é quanto as ganhas do período
              cobram por mês. O valor das ganhas já soma cada mensalidade × os meses do contrato: não some de novo.
            </p>
          )}
          <Panel>
            <PanelHeader title="Previsão ponderada" description="Somente oportunidades em aberto no recorte." />
            <PanelBody>
              <div className="flex items-center gap-3">
                <TrendingUp className="h-5 w-5 text-primary" />
                <p className="text-3xl font-semibold tabular-nums">{formatDealCurrency(summary.forecast)}</p>
              </div>
              <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
                Soma do valor de cada oportunidade × sua probabilidade. Numa oportunidade com itens, o valor é o do
                contrato: o total único mais a mensalidade × os meses. Quando a oportunidade não define uma
                probabilidade, usamos a da etapa. É uma estimativa comercial; consulte{' '}
                <Link className="underline underline-offset-4" to="/financeiro">
                  Financeiro
                </Link>{' '}
                para recebimentos registrados.
              </p>
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader
              title="Ganhos por responsável"
              description="Oportunidades ganhas no período, pela data de fechamento, no funil e no responsável escolhidos."
            />
            <PanelBody>
              {wins.length ? (
                <ul aria-label="Ganhos por responsável">
                  {wins.map((row) => (
                    <li
                      key={row.ownerId ?? 'sem-responsavel'}
                      className="flex items-center justify-between gap-3 border-b border-border/60 py-3 first:pt-0 last:border-0"
                    >
                      {/* Achado 3 da revisão do 1.14: "Nome (desativado) · 1 oportunidade", sem dois parênteses; o
                          leitor de tela ouve uma vírgula no lugar do ponto. */}
                      <span className="min-w-0 break-words text-sm">
                        {row.label}
                        <span aria-hidden> · </span>
                        <span className="sr-only">, </span>
                        <span className="text-muted-foreground">
                          {row.won.toLocaleString('pt-BR')} {row.won === 1 ? 'oportunidade' : 'oportunidades'}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-sm font-semibold tabular-nums">
                        {formatDealCurrency(row.value)}
                        {/* Item 1.16: a mensalidade dessas ganhas, contida no valor vezes os meses de cada contrato. */}
                        {row.monthly > 0 && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            inclui {formatDealCurrency(row.monthly)}/mês × os meses
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhuma oportunidade ganha neste recorte.</p>
              )}
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
                title="Valor aberto por funil"
                description="Negócios em negociação, agrupados pelo funil de cada um."
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
                      <TableHead>Funil</TableHead>
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
