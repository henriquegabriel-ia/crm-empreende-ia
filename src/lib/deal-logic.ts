import type { Deal, DealActivity, DealDraft, DealFilters, DealStage, DealStatus } from '@/lib/deal-types';
import { localDateKey } from '@/lib/dates';
import { formatBRL, formatBRLInput, parseBRL } from '@/lib/money';

export const DEAL_STATUS_LABELS: Record<DealStatus, string> = { open: 'Em aberto', won: 'Ganha', lost: 'Perdida' };

/** Valor digitado no padrão brasileiro (D7): "1.500,00", "1.500" e "12.5" são aceitos. Regras em `parseBRL`. */
export function parseDealValue(value: string): number | null {
  return parseBRL(value);
}

/** Probabilidade de cada etapa por ID, para não procurar a etapa a cada oportunidade. */
export function stageProbabilities(stages: Pick<DealStage, 'id' | 'win_probability'>[]): Map<string, number> {
  return new Map(stages.map((stage) => [stage.id, Number(stage.win_probability)]));
}

/**
 * Probabilidade efetiva (D8): a da oportunidade quando definida; sem ela (NULL), a da etapa atual.
 * O banco grava 100 na ganha, 0 na perdida e volta a NULL ao reabrir.
 */
export function effectiveProbability(
  deal: Pick<Deal, 'probability' | 'stage_id'>,
  probabilities: ReadonlyMap<string, number>,
): number {
  const value = Number(deal.probability ?? probabilities.get(deal.stage_id) ?? 0);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

export function formatProbability(value: number): string {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

/** "60% (da etapa)" quando a oportunidade herda; "35%" quando o valor é da oportunidade. */
export function probabilityLabel(
  deal: Pick<Deal, 'probability' | 'stage_id'>,
  probabilities: ReadonlyMap<string, number>,
): string {
  const text = formatProbability(effectiveProbability(deal, probabilities));
  return deal.probability === null || deal.probability === undefined ? `${text} (da etapa)` : text;
}

/** Valor gravado: campo vazio na oportunidade aberta = NULL (herda da etapa). */
export function probabilityForSave(draft: Pick<DealDraft, 'probability' | 'status'>): number | null {
  if (draft.status === 'won') return 100;
  if (draft.status === 'lost') return 0;
  return draft.probability.trim() ? Number(draft.probability) : null;
}

function isDateKey(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

function formatDateKey(value: string): string {
  return value.split('-').reverse().join('/');
}

/** Dia do fechamento no fuso do navegador, como o formulário e o período dos Relatórios o leem. */
export function closedDateKey(deal: Pick<Deal, 'closed_at'>): string {
  return deal.closed_at ? localDateKey(new Date(deal.closed_at)) : '';
}

/**
 * Primeiro milissegundo que não é anterior ao instante gravado. O PostgreSQL guarda microssegundos
 * ("2026-08-10T18:00:00.123456+00:00") e `Date.parse` os descarta; sem arredondar para cima, a data
 * ficaria até 999 µs antes da criação e o banco a recusaria.
 */
function ceilToMillisecond(timestamp: string): number {
  const time = Date.parse(timestamp);
  return /\.\d{3}\d*[1-9]/.test(timestamp) ? time + 1 : time;
}

/**
 * Converte o dia escolhido no formulário em `closed_at`. Sem troca de dia, devolve `undefined` e o horário
 * gravado fica intacto. Um dia novo vale ao meio-dia local, limitado entre a criação e agora, para cair no
 * mesmo dia nos Relatórios e respeitar as regras do banco (nunca antes da criação, nunca no futuro).
 */
export function closedAtForDraft(
  deal: Pick<Deal, 'status' | 'closed_at' | 'created_at'>,
  day: string,
  now = new Date(),
): string | undefined {
  if (deal.status === 'open' || !isDateKey(day) || day === closedDateKey(deal)) return undefined;
  const [year, month, date] = day.split('-').map(Number);
  const noon = new Date(year, month - 1, date, 12).getTime();
  const time = Math.max(ceilToMillisecond(deal.created_at), Math.min(noon, now.getTime()));
  return new Date(time).toISOString();
}

export function validateDealDraft(
  draft: DealDraft,
  stages: DealStage[],
  deal?: Pick<Deal, 'status' | 'created_at'>,
  today = localDateKey(),
): Partial<Record<keyof DealDraft, string>> {
  const errors: Partial<Record<keyof DealDraft, string>> = {};
  if (!draft.title.trim()) errors.title = 'Dê um nome à oportunidade.';
  else if (draft.title.trim().length > 180) errors.title = 'Use até 180 caracteres.';
  if (!draft.pipeline_id) errors.pipeline_id = 'Selecione um pipeline.';
  if (!stages.some((stage) => stage.id === draft.stage_id && stage.pipeline_id === draft.pipeline_id))
    errors.stage_id = 'Escolha uma etapa deste pipeline.';
  if (parseDealValue(draft.value) === null)
    errors.value = 'Informe um valor positivo ou zero, como 1.500,00, com até duas casas decimais.';
  if (!/^[A-Z]{3}$/.test(draft.currency)) errors.currency = 'Selecione uma moeda válida.';
  const probability = Number(draft.probability);
  if (draft.probability.trim() && (!Number.isFinite(probability) || probability < 0 || probability > 100))
    errors.probability = 'Use de 0 a 100%, ou deixe em branco para usar a probabilidade da etapa.';
  if (draft.close_date && !isDateKey(draft.close_date)) errors.close_date = 'Informe uma data válida.';
  if (deal && deal.status !== 'open') {
    const created = localDateKey(new Date(deal.created_at));
    if (!draft.closed_at) errors.closed_at = 'Informe a data de fechamento.';
    else if (!isDateKey(draft.closed_at)) errors.closed_at = 'Informe uma data válida.';
    else if (draft.closed_at > today) errors.closed_at = 'A data de fechamento não pode estar no futuro.';
    else if (draft.closed_at < created)
      errors.closed_at = `A data de fechamento não pode ser anterior à criação (${formatDateKey(created)}).`;
  }
  if (draft.status === 'won' && !draft.owner_id) errors.owner_id = 'Defina o responsável antes de marcar como ganha.';
  if (draft.status === 'lost' && !draft.lost_reason.trim())
    errors.lost_reason = 'Informe por que a oportunidade foi perdida.';
  return errors;
}

export function validateDealMove(
  deal: Deal,
  stage: DealStage | undefined,
  status: DealStatus,
  lostReason = '',
): string | null {
  if (!stage || stage.pipeline_id !== deal.pipeline_id || stage.org_id !== deal.org_id)
    return 'A etapa não pertence ao pipeline desta oportunidade.';
  if (!['open', 'won', 'lost'].includes(status)) return 'Situação inválida.';
  if (status === 'won' && !deal.owner_id) return 'Defina um responsável em Editar antes de marcar como ganha.';
  if (status === 'lost' && !lostReason.trim()) return 'Informe o motivo da perda.';
  return null;
}

export function filterDeals(deals: Deal[], filters: DealFilters): Deal[] {
  const search = filters.search
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return deals.filter((deal) => {
    if (deal.pipeline_id !== filters.pipelineId) return false;
    if (filters.status !== 'all' && deal.status !== filters.status) return false;
    if (
      filters.ownerId === 'unassigned'
        ? deal.owner_id !== null
        : filters.ownerId !== 'all' && deal.owner_id !== filters.ownerId
    )
      return false;
    return (
      !search ||
      deal.title
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .includes(search)
    );
  });
}

export function summarizeDeals(deals: Deal[], currency: string, stages: DealStage[] = []) {
  const probabilities = stageProbabilities(stages);
  const matching = deals.filter((deal) => deal.currency === currency);
  const open = matching.filter((deal) => deal.status === 'open');
  const sum = (items: Deal[], weighted = false) =>
    Math.round(
      items.reduce(
        (total, deal) =>
          total +
          Math.round((Number(deal.value) || 0) * 100) *
            (weighted ? effectiveProbability(deal, probabilities) / 100 : 1),
        0,
      ),
    ) / 100;
  return {
    count: deals.length,
    openCount: deals.filter((deal) => deal.status === 'open').length,
    openValue: sum(open),
    weightedValue: sum(open, true),
    wonValue: sum(matching.filter((deal) => deal.status === 'won')),
    foreignCurrencyCount: deals.length - matching.length,
  };
}

export function daysInStage(enteredAt: string, now = new Date()): number | null {
  const timestamp = Date.parse(enteredAt);
  return Number.isFinite(timestamp) ? Math.max(0, Math.floor((now.getTime() - timestamp) / 86400000)) : null;
}

export function nextDealActions(activities: DealActivity[]): Map<string, DealActivity> {
  const result = new Map<string, DealActivity>();
  for (const activity of activities) {
    if (!activity.deal_id || activity.completed_at || activity.type === 'note' || !activity.due_date) continue;
    const due = Date.parse(activity.due_date);
    if (!Number.isFinite(due)) continue;
    const current = result.get(activity.deal_id);
    const currentDue = current ? Date.parse(current.due_date!) : Infinity;
    if (!current || due < currentDue || (due === currentDue && activity.id.localeCompare(current.id) < 0))
      result.set(activity.deal_id, activity);
  }
  return result;
}

export function formatDealCurrency(value: number, currency = 'BRL'): string {
  if (currency === 'BRL') return formatBRL(value);
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ${currency}`;
  }
}

export function dealDraft(deal?: Deal, pipelineId = '', stage?: DealStage, currency = 'BRL'): DealDraft {
  return {
    title: deal?.title ?? '',
    pipeline_id: deal?.pipeline_id ?? pipelineId,
    stage_id: deal?.stage_id ?? stage?.id ?? '',
    value: formatBRLInput(deal?.value ?? 0),
    currency: deal?.currency ?? currency,
    contact_id: deal?.contact_id ?? '',
    company_id: deal?.company_id ?? '',
    owner_id: deal?.owner_id ?? '',
    close_date: deal?.close_date ?? '',
    probability: deal?.probability === null || deal?.probability === undefined ? '' : String(deal.probability),
    status: deal?.status ?? 'open',
    lost_reason: deal?.lost_reason ?? '',
    closed_at: deal ? closedDateKey(deal) : '',
  };
}
