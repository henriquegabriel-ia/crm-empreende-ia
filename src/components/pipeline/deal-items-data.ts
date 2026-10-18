import { crmDb } from '@/integrations/supabase/crm-client';
import type { Json } from '@/integrations/supabase/commercial-types';
import type { DealItemPayload } from '@/lib/deal-logic';
import type { CatalogProduct, Deal, DealItem } from '@/lib/deal-types';
import { allRows } from '@/components/pipeline/data';

/**
 * Leitura e gravação dos itens da oportunidade (item 1.16; docs/arquitetura/1.16.md, seções 4.5 e 7). A API só lê
 * deal_items: a gravação passa por `save_deal`, que cria ou edita a oportunidade e grava os itens na mesma transação,
 * com a guarda de concorrência em updated_at (0.8) e a repetição segura da criação (o id gerado no navegador).
 */

/** Colunas lidas de deal_items, na ordem do editor. */
export const DEAL_ITEM_COLUMNS =
  'id,org_id,deal_id,product_id,position,name,quantity,unit,unit_price,discount_type,discount_value,billing,line_total,created_at,updated_at';
/** Colunas lidas do catálogo (products). */
export const PRODUCT_COLUMNS = 'id,org_id,name,code,kind,unit,price,billing,archived_at,created_at,updated_at';

/** Os itens de uma oportunidade, em ordem (consulta ['crm', orgId, 'deal-items', dealId, version]). */
export async function loadDealItems(orgId: string, dealId: string): Promise<DealItem[]> {
  const { data, error } = await crmDb
    .from('deal_items')
    .select(DEAL_ITEM_COLUMNS)
    .eq('org_id', orgId)
    .eq('deal_id', dealId)
    .order('position')
    .order('id');
  if (error) throw error;
  return (data ?? []) as unknown as DealItem[];
}

/**
 * Os itens de todas as oportunidades da organização, paginados como `allRows` (consulta ['crm', orgId,
 * 'all-deal-items']): a planilha "Itens das oportunidades" dos Relatórios lê só ao clicar e filtra pelo recorte.
 */
export async function loadAllDealItems(orgId: string): Promise<DealItem[]> {
  const rows = await allRows((from, to) =>
    crmDb
      .from('deal_items')
      .select(DEAL_ITEM_COLUMNS)
      .eq('org_id', orgId)
      .order('deal_id')
      .order('position')
      .order('id')
      .range(from, to),
  );
  return rows as unknown as DealItem[];
}

/**
 * O catálogo da organização, paginado, por nome (consulta ['crm', orgId, 'products']): ativos e arquivados. O editor de
 * itens oferece só os ativos para os itens novos e mostra "(arquivado)" no item que já usa um arquivado; a aba
 * "Catálogo" filtra por situação.
 */
export async function loadProducts(orgId: string): Promise<CatalogProduct[]> {
  const rows = await allRows((from, to) =>
    crmDb.from('products').select(PRODUCT_COLUMNS).eq('org_id', orgId).order('name').order('id').range(from, to),
  );
  return rows as unknown as CatalogProduct[];
}

/** Campos da oportunidade que `save_deal` aceita na criação (`create`) e na edição (`edit`). */
export const SAVE_DEAL_CREATE_FIELDS = [
  'title',
  'pipeline_id',
  'stage_id',
  'status',
  'currency',
  'value',
  'owner_id',
  'contact_id',
  'company_id',
  'close_date',
  'probability',
  'lost_reason',
] as const;
export const SAVE_DEAL_EDIT_FIELDS = [
  'title',
  'currency',
  'value',
  'owner_id',
  'contact_id',
  'company_id',
  'close_date',
  'probability',
  'lost_reason',
  'closed_at',
] as const;
export type SaveDealFields = Partial<
  Record<(typeof SAVE_DEAL_CREATE_FIELDS)[number] | (typeof SAVE_DEAL_EDIT_FIELDS)[number], string | number | null>
>;

export interface SaveDealRequest {
  /** Na criação, o id gerado no navegador ao abrir o formulário (guardado num useRef): a nova tentativa usa o mesmo. */
  dealId: string;
  /** `updated_at` lido; nulo (ou ausente) = criar. */
  version?: string | null;
  /** Campos do formulário; nulo = não mexe nos campos. Uma chave fora da lista é recusada pela RPC. */
  fields?: SaveDealFields | null;
  /** A lista completa de itens (`dealItemsPayload`); nulo = não mexe nos itens; [] = remove todos. */
  items?: DealItemPayload[] | null;
  /** Obrigatório (1 a 120) com item mensal; ignorado sem ele. */
  contractMonths?: number | null;
}

export interface SaveDealResult {
  deal: Deal;
  items: DealItem[];
  /** A criação já tinha sido gravada (resposta perdida): nada mudou agora. */
  replayed: boolean;
}

/**
 * Aviso da criação repetida (`replayed`): a primeira tentativa já tinha gravado a oportunidade, e o que a pessoa mudou
 * depois da falha não foi aplicado. A tela abre o detalhe para ela conferir.
 */
export const DEAL_CREATE_REPLAYED =
  'Esta oportunidade já tinha sido criada na tentativa anterior, e o que você mudou depois não foi gravado. Confira os dados no detalhe e edite se precisar.';

/** A resposta de `save_deal` tem a forma esperada, da mesma oportunidade? */
export function isSaveDealResult(value: unknown, dealId: string): value is SaveDealResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<Record<keyof SaveDealResult, unknown>>;
  const deal = result.deal as Partial<Deal> | null | undefined;
  return (
    !!deal &&
    typeof deal === 'object' &&
    deal.id === dealId &&
    typeof deal.updated_at === 'string' &&
    Array.isArray(result.items) &&
    typeof result.replayed === 'boolean'
  );
}

/**
 * Grava pela RPC `save_deal`. As recusas da RPC chegam como o erro do PostgREST (P0001 com a mensagem em pt-BR, 42501
 * sem permissão, PGRST202 num banco sem a migração): a tela usa `errorMessage` (Pipeline) e `catalogMigrationMissing`.
 */
export async function saveDealWithItems(request: SaveDealRequest): Promise<SaveDealResult> {
  const { data, error } = await crmDb.rpc('save_deal', {
    p_deal_id: request.dealId,
    ...(request.version ? { p_version: request.version } : {}),
    ...(request.fields ? { p_fields: request.fields as Json } : {}),
    ...(request.items ? { p_items: request.items as unknown as Json } : {}),
    ...(request.items && request.contractMonths ? { p_contract_months: request.contractMonths } : {}),
  });
  if (error) throw error;
  if (!isSaveDealResult(data, request.dealId))
    throw new Error('O servidor respondeu de um jeito inesperado. Atualize a página e confira a oportunidade.');
  return data;
}
