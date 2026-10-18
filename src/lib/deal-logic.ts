import type {
  CatalogProduct,
  Deal,
  DealActivity,
  DealDraft,
  DealFilters,
  DealItem,
  DealItemBilling,
  DealItemDraft,
  DealStage,
  DealStatus,
} from '@/lib/deal-types';
import { localDateKey } from '@/lib/dates';
import {
  centsNumber,
  DEAL_ITEM_MESSAGES,
  dealItemTotals,
  decimalText,
  lineAmounts,
  MAX_CONTRACT_CENTS,
  MAX_CONTRACT_MONTHS,
  MAX_DEAL_ITEMS,
  MAX_DISCOUNT_BASIS_POINTS,
  MAX_LINE_CENTS,
  MAX_QUANTITY_MILLI,
  MAX_UNIT_PRICE_CENTS,
  MIN_CONTRACT_MONTHS,
  unitsOf,
  type DealItemDiscount,
  type DealLineAmounts,
} from '@/lib/deal-item-math';
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

/**
 * Erros do formulário da oportunidade. Com itens (`hasItems`, item 1.16), o valor vem do editor de itens e não é
 * conferido aqui: o campo "Valor" dá lugar ao "Valor do contrato", só leitura.
 */
export function validateDealDraft(
  draft: DealDraft,
  stages: DealStage[],
  deal?: Pick<Deal, 'status' | 'created_at'>,
  today = localDateKey(),
  { hasItems = false }: { hasItems?: boolean } = {},
): Partial<Record<keyof DealDraft, string>> {
  const errors: Partial<Record<keyof DealDraft, string>> = {};
  if (!draft.title.trim()) errors.title = 'Dê um nome à oportunidade.';
  else if (draft.title.trim().length > 180) errors.title = 'Use até 180 caracteres.';
  if (!draft.pipeline_id) errors.pipeline_id = 'Selecione um funil.';
  if (!stages.some((stage) => stage.id === draft.stage_id && stage.pipeline_id === draft.pipeline_id))
    errors.stage_id = 'Escolha uma etapa deste funil.';
  if (!hasItems && parseDealValue(draft.value) === null)
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
    return 'A etapa não pertence ao funil desta oportunidade.';
  if (!['open', 'won', 'lost'].includes(status)) return 'Situação inválida.';
  if (status === 'won' && !deal.owner_id) return 'Defina um responsável em Editar antes de marcar como ganha.';
  if (status === 'lost' && !lostReason.trim()) return 'Informe o motivo da perda.';
  return null;
}

/**
 * Como a oportunidade fica logo depois de move_deal, para a atualização otimista do kanban (item 0.10), seguindo
 * private.validate_deal_change (item 0.6): ganha = 100 e perdida = 0; reabrir herda a probabilidade da etapa (NULL);
 * o motivo só fica na perdida; o fechamento é agora ao encerrar e some ao reabrir; a entrada na etapa é renovada
 * quando a etapa muda. A versão (updated_at) continua a lida até a resposta do banco, que substitui esta linha.
 */
export function optimisticDealMove(
  deal: Deal,
  stageId: string,
  status: DealStatus,
  lostReason: string | null,
  now = new Date(),
): Deal {
  const at = now.toISOString();
  const statusChanged = status !== deal.status;
  return {
    ...deal,
    stage_id: stageId,
    status,
    lost_reason: status === 'lost' ? (lostReason ?? deal.lost_reason) : null,
    probability: status === 'won' ? 100 : status === 'lost' ? 0 : statusChanged ? null : deal.probability,
    closed_at: status === 'open' ? null : statusChanged ? at : deal.closed_at,
    stage_entered_at: stageId !== deal.stage_id ? at : deal.stage_entered_at,
  };
}

/** A resposta de move_deal (to_jsonb da linha gravada) tem a forma de uma oportunidade desta mesma linha? */
export function isMovedDeal(value: unknown, dealId: string): value is Deal {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<Record<keyof Deal, unknown>>;
  return (
    row.id === dealId &&
    typeof row.stage_id === 'string' &&
    typeof row.pipeline_id === 'string' &&
    (row.status === 'open' || row.status === 'won' || row.status === 'lost') &&
    typeof row.updated_at === 'string' &&
    typeof row.value === 'number'
  );
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

// ---------------------------------------------------------------------------------------------------------------
// Item 1.16: itens da oportunidade (docs/arquitetura/1.16.md, seção 5). A conta, em inteiros, fica em
// deal-item-math.ts (sem dependências, compartilhado com a fixture do E2E); aqui ficam a leitura do que a pessoa digita,
// os erros por campo (nas mesmas palavras da RPC save_deal), o pedido da RPC e os textos de tela.

const QUANTITY_GROUPED = '[1-9]\\d{0,2}(?:\\.\\d{3})+';
const QUANTITY_COMMA = new RegExp(`^(\\d+|${QUANTITY_GROUPED}),(\\d{1,3})$`);
const QUANTITY_THOUSANDS = new RegExp(`^${QUANTITY_GROUPED}$`);
const QUANTITY_DOT = /^(\d+)\.(\d{1,2})$/;
const PLAIN_DIGITS = /^\d+$/;

/**
 * Quantidade no padrão brasileiro (D7), em milésimos: com vírgula, a vírgula é decimal, com até 3 casas ("0,125",
 * "1.500,5"), e os pontos são milhar; sem vírgula, "1.500" é milhar e um único ponto com 1 ou 2 casas é decimal
 * ("1.5" = 1,5), como em `parseBRL`. Recusa (nulo) vazio, zero, negativo, notação científica, mais de 3 casas e acima
 * de 999.999.999,999.
 */
export function parseQuantity(text: string): bigint | null {
  if (typeof text !== 'string') return null;
  const value = text.trim();
  let integer: string;
  let decimals = '';
  const comma = value.match(QUANTITY_COMMA);
  const dot = value.match(QUANTITY_DOT);
  if (comma) {
    integer = comma[1].replace(/\./g, '');
    decimals = comma[2];
  } else if (QUANTITY_THOUSANDS.test(value)) integer = value.replace(/\./g, '');
  else if (dot) {
    integer = dot[1];
    decimals = dot[2];
  } else if (PLAIN_DIGITS.test(value)) integer = value;
  else return null;
  const milli = BigInt(integer + decimals.padEnd(3, '0'));
  return milli > 0n && milli <= MAX_QUANTITY_MILLI ? milli : null;
}

const PERCENT_TEXT = /^(\d{1,3})(?:[.,](\d{1,2}))?$/;

/** Desconto em %: "10", "12,5" ou "12,50" (também com ponto), maior que 0 e até 100, em centésimos de ponto. */
export function parseDiscountPercent(text: string): bigint | null {
  if (typeof text !== 'string') return null;
  const match = text.trim().replace(/\s*%$/, '').match(PERCENT_TEXT);
  if (!match) return null;
  const basisPoints = BigInt(match[1] + (match[2] ?? '').padEnd(2, '0'));
  return basisPoints > 0n && basisPoints <= MAX_DISCOUNT_BASIS_POINTS ? basisPoints : null;
}

/** Valor em reais (D7, `parseBRL`) em centavos inteiros; nulo quando `parseBRL` recusa. */
export function parseMoneyCents(text: string): bigint | null {
  const value = parseBRL(text);
  // parseBRL aceita até 2 casas: o erro de ponto flutuante de value × 100 fica muito abaixo de meio centavo.
  return value === null ? null : BigInt(Math.round(value * 100));
}

/** Meses do contrato: inteiro de 1 a 120; nulo fora disso. */
export function parseContractMonths(text: string | number | null | undefined): number | null {
  const value = typeof text === 'number' ? String(text) : (text ?? '').trim();
  if (!PLAIN_DIGITS.test(value)) return null;
  const months = Number(value);
  return months >= MIN_CONTRACT_MONTHS && months <= MAX_CONTRACT_MONTHS ? months : null;
}

const QUANTITY_FORMAT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });

/** Quantidade gravada para exibição e para o campo: 1.5 → "1,5"; 1500 → "1.500". */
export function formatQuantity(quantity: number): string {
  return QUANTITY_FORMAT.format(quantity);
}

const PERCENT_FORMAT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

/** "Única" ou "Mensal". */
export const DEAL_ITEM_BILLING_LABELS: Record<DealItemBilling, string> = { one_time: 'Única', monthly: 'Mensal' };
/** "Produto" ou "Serviço"; o item avulso é "Avulso". */
export const PRODUCT_KIND_LABELS: Record<CatalogProduct['kind'], string> = { product: 'Produto', service: 'Serviço' };

const newItemId = () => crypto.randomUUID();

/**
 * Rascunho de um item do editor: de um item gravado (para editar), de um item do catálogo (nome, unidade, preço e
 * cobrança copiados, editáveis) ou vazio (item avulso). O id do item gravado é mantido; o novo vem do navegador.
 */
export function dealItemDraft(
  item?: DealItem | null,
  product?: CatalogProduct | null,
  id: string = item?.id ?? newItemId(),
): DealItemDraft {
  if (item)
    return {
      id,
      product_id: item.product_id,
      name: item.name,
      quantity: formatQuantity(Number(item.quantity)),
      unit: item.unit ?? '',
      unit_price: formatBRLInput(Number(item.unit_price)),
      discount_type: item.discount_type ?? 'none',
      discount_value:
        item.discount_type === 'percent'
          ? PERCENT_FORMAT.format(Number(item.discount_value))
          : item.discount_type === 'amount'
            ? formatBRLInput(Number(item.discount_value))
            : '',
      billing: item.billing,
    };
  return {
    id,
    product_id: product?.id ?? null,
    name: product?.name ?? '',
    quantity: '1',
    unit: product?.unit ?? '',
    unit_price: product ? formatBRLInput(Number(product.price)) : '',
    discount_type: 'none',
    discount_value: '',
    billing: product?.billing ?? 'one_time',
  };
}

/** Campos do editor que recebem erro. */
export type DealItemField = 'product_id' | 'name' | 'quantity' | 'unit' | 'unit_price' | 'discount_value' | 'billing';

/** Uma linha calculada: os valores em centavos (`number`) para a tela. */
export interface DealItemLine {
  id: string;
  billing: DealItemBilling;
  grossCents: number;
  discountCents: number;
  totalCents: number;
}

export interface DealItemsComputation {
  /** Uma linha por rascunho, na ordem; nula quando o rascunho tem erro nos campos da conta. */
  lines: (DealItemLine | null)[];
  /** Erros por id do item e campo. */
  errors: Record<string, Partial<Record<DealItemField, string>>>;
  /** Erro da lista inteira (mais de 100 itens). */
  listError: string | null;
  /** Há ao menos um item mensal: os meses passam a ser obrigatórios. */
  hasMonthly: boolean;
  months: number | null;
  monthsError: string | null;
  /** Erro do contrato acima do limite. */
  contractError: string | null;
  oneTimeCents: number;
  monthlyCents: number;
  contractCents: number;
  /** Nenhum erro: a lista pode ir para a RPC. */
  valid: boolean;
}

export interface DealItemsContext {
  /** O catálogo lido pelo editor (ativos e os arquivados citados pelos itens). */
  products?: readonly CatalogProduct[];
  /** Os itens gravados da oportunidade: o item que já tinha um produto arquivado continua com ele. */
  saved?: readonly DealItem[];
}

function draftDiscount(
  draft: DealItemDraft,
  grossCents: bigint | null,
): { discount: DealItemDiscount; error?: string } {
  if (draft.discount_type === 'none' || !draft.discount_value.trim()) return { discount: null };
  if (draft.discount_type === 'percent') {
    const basisPoints = parseDiscountPercent(draft.discount_value);
    return basisPoints === null
      ? { discount: null, error: DEAL_ITEM_MESSAGES.discountPercent }
      : { discount: { type: 'percent', basisPoints } };
  }
  const cents = parseMoneyCents(draft.discount_value);
  if (cents === null || (grossCents !== null && cents > grossCents))
    return { discount: null, error: DEAL_ITEM_MESSAGES.discountAmount };
  // "Desconto 0" vira sem desconto, como na RPC.
  return { discount: cents === 0n ? null : { type: 'amount', cents } };
}

/**
 * Totais e erros do editor de itens, a cada mudança. Os erros usam as mesmas palavras da RPC; os totais somam só as
 * linhas sem erro (a tela não grava com erro). Meses: obrigatórios (1 a 120) com item mensal; sem item mensal, ignorados.
 */
export function computeDealItems(
  drafts: readonly DealItemDraft[],
  monthsText: string | number | null | undefined,
  { products = [], saved = [] }: DealItemsContext = {},
): DealItemsComputation {
  const productsById = new Map(products.map((product) => [product.id, product]));
  const savedById = new Map(saved.map((item) => [item.id, item]));
  const errors: DealItemsComputation['errors'] = {};
  const lines: (DealItemLine | null)[] = [];
  const valid: { billing: DealItemBilling; totalCents: bigint }[] = [];
  for (const draft of drafts) {
    const fieldErrors: Partial<Record<DealItemField, string>> = {};
    const name = draft.name.replace(/\s+/g, ' ').trim();
    if (!name) fieldErrors.name = DEAL_ITEM_MESSAGES.name;
    else if (name.length > 160) fieldErrors.name = DEAL_ITEM_MESSAGES.nameTooLong;
    if (draft.unit.trim().length > 20) fieldErrors.unit = DEAL_ITEM_MESSAGES.unitTooLong;
    const quantityMilli = parseQuantity(draft.quantity);
    if (quantityMilli === null) fieldErrors.quantity = DEAL_ITEM_MESSAGES.quantity;
    const unitPriceCents = parseMoneyCents(draft.unit_price);
    if (unitPriceCents === null) fieldErrors.unit_price = DEAL_ITEM_MESSAGES.unitPrice;
    else if (unitPriceCents > MAX_UNIT_PRICE_CENTS) fieldErrors.unit_price = DEAL_ITEM_MESSAGES.unitPriceTooLarge;
    let grossCents: bigint | null = null;
    if (quantityMilli !== null && unitPriceCents !== null) {
      grossCents = lineAmounts({ quantityMilli, unitPriceCents, discount: null }).grossCents;
      if (grossCents > MAX_LINE_CENTS) {
        fieldErrors.unit_price = DEAL_ITEM_MESSAGES.lineTooLarge;
        grossCents = null;
      }
    }
    const { discount, error: discountError } = draftDiscount(draft, grossCents);
    if (discountError) fieldErrors.discount_value = discountError;
    if (draft.billing !== 'one_time' && draft.billing !== 'monthly') fieldErrors.billing = DEAL_ITEM_MESSAGES.billing;
    if (draft.product_id) {
      const product = productsById.get(draft.product_id);
      const previous = savedById.get(draft.id);
      if (!product && products.length) fieldErrors.product_id = DEAL_ITEM_MESSAGES.productMissing;
      else if (product?.archived_at && previous?.product_id !== draft.product_id)
        fieldErrors.product_id = DEAL_ITEM_MESSAGES.archived(product.name);
    }
    if (Object.keys(fieldErrors).length) errors[draft.id] = fieldErrors;
    if (grossCents === null || discountError || quantityMilli === null || unitPriceCents === null) {
      lines.push(null);
      continue;
    }
    const amounts: DealLineAmounts = lineAmounts({ quantityMilli, unitPriceCents, discount });
    lines.push({
      id: draft.id,
      billing: draft.billing,
      grossCents: centsNumber(amounts.grossCents),
      discountCents: centsNumber(amounts.discountCents),
      totalCents: centsNumber(amounts.totalCents),
    });
    valid.push({ billing: draft.billing, totalCents: amounts.totalCents });
  }
  const hasMonthly = drafts.some((draft) => draft.billing === 'monthly');
  const months = hasMonthly ? parseContractMonths(monthsText) : null;
  const monthsError = hasMonthly && months === null ? DEAL_ITEM_MESSAGES.months : null;
  const totals = dealItemTotals(valid, months);
  const contractError = totals.contractCents > MAX_CONTRACT_CENTS ? DEAL_ITEM_MESSAGES.contractTooLarge : null;
  const listError = drafts.length > MAX_DEAL_ITEMS ? DEAL_ITEM_MESSAGES.tooMany : null;
  return {
    lines,
    errors,
    listError,
    hasMonthly,
    months,
    monthsError,
    contractError,
    oneTimeCents: centsNumber(totals.oneTimeCents),
    monthlyCents: centsNumber(totals.monthlyCents),
    contractCents: contractError ? 0 : centsNumber(totals.contractCents),
    valid: !Object.keys(errors).length && !listError && !monthsError && !contractError,
  };
}

/** Erro dos meses do contrato, ou nulo (sem item mensal, os meses não importam). */
export function contractMonthsError(
  drafts: readonly DealItemDraft[],
  monthsText: string | number | null | undefined,
): string | null {
  return drafts.some((draft) => draft.billing === 'monthly') && parseContractMonths(monthsText) === null
    ? DEAL_ITEM_MESSAGES.months
    : null;
}

/** Um item da lista enviada a `save_deal`: os valores decimais como texto, para a RPC conferir as casas. */
export interface DealItemPayload {
  id: string;
  product_id: string | null;
  position: number;
  name: string;
  quantity: string;
  unit: string | null;
  unit_price: string;
  discount_type: 'percent' | 'amount' | null;
  discount_value: string | null;
  billing: DealItemBilling;
}

/**
 * A lista de itens para `save_deal`, na ordem do editor (a posição é o índice), com os textos decimais: "1.500"
 * (quantidade, 3 casas), "1500.00" (preço e desconto em R$) e "12.50" (desconto em %). "Desconto 0" vira sem desconto.
 * Chame depois de `computeDealItems(...).valid`: um rascunho com erro lança exceção.
 */
export function dealItemsPayload(drafts: readonly DealItemDraft[]): DealItemPayload[] {
  return drafts.map((draft, position) => {
    const quantityMilli = parseQuantity(draft.quantity);
    const unitPriceCents = parseMoneyCents(draft.unit_price);
    if (quantityMilli === null) throw new Error(DEAL_ITEM_MESSAGES.quantity);
    if (unitPriceCents === null) throw new Error(DEAL_ITEM_MESSAGES.unitPrice);
    const { discount, error } = draftDiscount(
      draft,
      lineAmounts({ quantityMilli, unitPriceCents, discount: null }).grossCents,
    );
    if (error) throw new Error(error);
    return {
      id: draft.id,
      product_id: draft.product_id,
      position,
      name: draft.name.replace(/\s+/g, ' ').trim(),
      quantity: decimalText(quantityMilli, 3),
      unit: draft.unit.trim() || null,
      unit_price: decimalText(unitPriceCents, 2),
      discount_type: discount?.type ?? null,
      discount_value:
        discount === null
          ? null
          : discount.type === 'percent'
            ? decimalText(discount.basisPoints, 2)
            : decimalText(discount.cents, 2),
      billing: draft.billing,
    };
  });
}

/** Chave de comparação de um item: o mesmo id, produto, nome, quantidade, unidade, preço, desconto e cobrança. */
function itemKey(item: DealItemPayload) {
  return JSON.stringify([
    item.id,
    item.product_id,
    item.name,
    item.quantity,
    item.unit,
    item.unit_price,
    item.discount_type,
    item.discount_value,
    item.billing,
  ]);
}

/** O item gravado no formato do pedido, para comparar com o rascunho. */
function savedPayload(item: DealItem, position: number): DealItemPayload {
  const quantity = unitsOf(item.quantity, 3);
  const price = unitsOf(item.unit_price, 2);
  const discount = unitsOf(item.discount_value, 2);
  return {
    id: item.id,
    product_id: item.product_id,
    position,
    name: item.name,
    quantity: quantity === null ? String(item.quantity) : decimalText(quantity, 3),
    unit: item.unit,
    unit_price: price === null ? String(item.unit_price) : decimalText(price, 2),
    discount_type: item.discount_type,
    discount_value: item.discount_type && discount !== null ? decimalText(discount, 2) : null,
    billing: item.billing,
  };
}

/**
 * Os itens foram mexidos? Regra do formulário (C6): com itens mexidos, grava por `save_deal`; sem, pelo caminho de
 * sempre. Compara a lista (ordem, ids e valores) e, com item mensal, os meses. Um rascunho com erro conta como mexido.
 */
export function dealItemsChanged(
  saved: readonly DealItem[],
  savedMonths: number | null | undefined,
  drafts: readonly DealItemDraft[],
  monthsText: string | number | null | undefined,
): boolean {
  if (saved.length !== drafts.length) return true;
  let payload: DealItemPayload[];
  try {
    payload = dealItemsPayload(drafts);
  } catch {
    return true;
  }
  const ordered = [...saved].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  if (ordered.some((item, index) => itemKey(savedPayload(item, index)) !== itemKey(payload[index]))) return true;
  const hasMonthly = drafts.some((draft) => draft.billing === 'monthly');
  return hasMonthly && parseContractMonths(monthsText) !== (savedMonths ?? null);
}

/** A oportunidade tem itens (o valor é o do contrato)? Sem a coluna (banco sem a migração), não. */
export function hasDealItems(deal: Pick<Deal, 'item_count'> | null | undefined): boolean {
  return Number(deal?.item_count ?? 0) > 0;
}

/**
 * O detalhamento do valor de uma oportunidade com itens: "R$ 1.500,00 único + R$ 2.000,00/mês × 12 meses", ou só uma
 * das partes. Nulo sem itens.
 */
export function dealValueBreakdown(
  deal: Pick<Deal, 'item_count' | 'one_time_value' | 'monthly_value' | 'contract_months'>,
): string | null {
  if (!hasDealItems(deal)) return null;
  const oneTime = Number(deal.one_time_value ?? 0);
  const monthly = Number(deal.monthly_value ?? 0);
  const months = deal.contract_months ?? null;
  const parts: string[] = [];
  if (oneTime > 0 || months === null) parts.push(`${formatBRL(oneTime)} único`);
  if (months !== null) parts.push(`${formatBRL(monthly)}/mês × ${months} ${months === 1 ? 'mês' : 'meses'}`);
  return parts.join(' + ');
}

/**
 * O total da linha em texto, com o bruto e o desconto quando houver: "2 × R$ 500,00 − 10% = R$ 900,00"; sem
 * desconto, "2 × R$ 500,00 = R$ 1.000,00". Nulo quando a linha tem erro.
 */
export function dealItemLineSummary(draft: DealItemDraft, line: DealItemLine | null): string | null {
  if (!line) return null;
  const quantity = parseQuantity(draft.quantity);
  const price = parseMoneyCents(draft.unit_price);
  if (quantity === null || price === null) return null;
  const base = `${formatQuantity(Number(quantity) / 1000)} × ${formatBRL(Number(price) / 100)}`;
  const total = formatBRL(line.totalCents / 100);
  if (!line.discountCents) return `${base} = ${total}`;
  const discount =
    draft.discount_type === 'percent'
      ? `${PERCENT_FORMAT.format(Number(parseDiscountPercent(draft.discount_value) ?? 0n) / 100)}%`
      : formatBRL(line.discountCents / 100);
  return `${base} − ${discount} = ${total}`;
}

/** O desconto de um item gravado em texto: "10%", "R$ 50,00" ou vazio. */
export function dealItemDiscountLabel(item: Pick<DealItem, 'discount_type' | 'discount_value'>): string {
  if (item.discount_type === 'percent') return `${PERCENT_FORMAT.format(Number(item.discount_value))}%`;
  if (item.discount_type === 'amount') return formatBRL(Number(item.discount_value));
  return '';
}
