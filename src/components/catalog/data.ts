import { crmDb } from '@/integrations/supabase/crm-client';
import type { CatalogProduct, DealItemBilling } from '@/lib/deal-types';
import { isOfflineRequestError, OFFLINE_REQUEST_MESSAGE } from '@/lib/offline';
import { blockingTableLabel } from '@/lib/record-links';
import { CATALOG_MIGRATION_MISSING, catalogMigrationMissing } from '@/lib/rpc-errors';
import { PRODUCT_COLUMNS } from '@/components/pipeline/deal-items-data';
export { loadProducts, PRODUCT_COLUMNS } from '@/components/pipeline/deal-items-data';

/**
 * Gravação do catálogo (item 1.16; docs/arquitetura/1.16.md, seção 7.1). Só donos e administradores gravam (a RLS de
 * products confere de novo); todos da organização leem. Editar, arquivar e reativar gravam só a versão lida
 * (`.eq('updated_at', versão)`, item 0.8): sem linha, o item mudou ou saiu, e a tela mostra o conflito com o
 * preenchimento preservado. Excluir é só para o item nunca usado (a FK de deal_items recusa o usado: arquive).
 */

/** Campos do item do catálogo como o formulário e a importação os gravam (já aparados e validados). */
export interface ProductFields {
  name: string;
  code: string | null;
  kind: CatalogProduct['kind'];
  unit: string | null;
  price: number;
  billing: DealItemBilling;
}

/** Limites do banco (CHECK de products), repetidos para a tela explicar antes do pedido. */
export const PRODUCT_LIMITS = { name: 160, code: 40, unit: 20 } as const;

export const CATALOG_MESSAGES = {
  conflict:
    'Este item do catálogo mudou ou não está mais disponível. Seu preenchimento foi preservado; feche e reabra a edição para revisar os dados atuais.',
  duplicateCode: (code: string) => `Já existe um item com o código “${code}”.`,
  usedInDeals: 'Este item já foi usado em oportunidades. Arquive para tirá-lo das escolhas.',
  permission: 'Somente donos e administradores alteram o catálogo. Você pode consultá-lo.',
  missing: CATALOG_MIGRATION_MISSING,
} as const;

/** Cria um item; devolve o id. */
export async function createProduct(orgId: string, fields: ProductFields): Promise<string> {
  const { data, error } = await crmDb
    .from('products')
    .insert({ ...fields, org_id: orgId })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

/** Atualiza só a versão lida; `false` quando o item mudou ou saiu (conflito). */
async function updateVersion(
  orgId: string,
  id: string,
  version: string,
  changes: Partial<ProductFields> & { archived_at?: string | null },
): Promise<CatalogProduct | null> {
  const { data, error } = await crmDb
    .from('products')
    .update(changes)
    .eq('id', id)
    .eq('org_id', orgId)
    .eq('updated_at', version)
    .select(PRODUCT_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as CatalogProduct | null) ?? null;
}

/** Edita a versão lida do item; lança `CATALOG_MESSAGES.conflict` se ela mudou. */
export async function updateProduct(
  orgId: string,
  product: Pick<CatalogProduct, 'id' | 'updated_at'>,
  fields: ProductFields,
): Promise<CatalogProduct> {
  const saved = await updateVersion(orgId, product.id, product.updated_at, fields);
  if (!saved) throw new Error(CATALOG_MESSAGES.conflict);
  return saved;
}

/** Arquiva (`archived` verdadeiro) ou reativa a versão lida do item. */
export async function setProductArchived(
  orgId: string,
  product: Pick<CatalogProduct, 'id' | 'updated_at'>,
  archived: boolean,
): Promise<CatalogProduct> {
  const saved = await updateVersion(orgId, product.id, product.updated_at, {
    archived_at: archived ? new Date().toISOString() : null,
  });
  if (!saved) throw new Error(CATALOG_MESSAGES.conflict);
  return saved;
}

/** Exclui um item nunca usado; o usado é recusado pelo banco (23503, `CATALOG_MESSAGES.usedInDeals`). */
export async function deleteProduct(orgId: string, id: string): Promise<void> {
  const { data, error } = await crmDb.from('products').delete().eq('id', id).eq('org_id', orgId).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error(CATALOG_MESSAGES.conflict);
}

/** Uma linha da importação, com o id gerado na prévia (a nova tentativa reenvia o mesmo e nada duplica). */
export type ProductImportRow = ProductFields & { id: string };

/**
 * Grava um lote da importação (até 500): `upsert` pelo id da prévia, ignorando os já gravados (uma nova tentativa ou
 * "Continuar importação" não duplica). Devolve os ids gravados agora.
 */
export async function insertProductBatch(orgId: string, rows: readonly ProductImportRow[]): Promise<string[]> {
  if (!rows.length) return [];
  const { data, error } = await crmDb
    .from('products')
    .upsert(
      rows.map((row) => ({ ...row, org_id: orgId })),
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select('id');
  if (error) throw error;
  return (data ?? []).map((row) => row.id);
}

/** O código da recusa 23505 do índice do código ("Key (org_id, lower(btrim(code)))=(…, sku-1) already exists."). */
export function duplicateCodeOf(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const { code, message, details } = error as { code?: unknown; message?: unknown; details?: unknown };
  if (String(code ?? '') !== '23505') return null;
  const text = `${typeof message === 'string' ? message : ''} ${typeof details === 'string' ? details : ''}`;
  if (!text.includes('products_org_code') && !/lower\(btrim\(code\)\)/.test(text)) return null;
  return /\)=\([^,]+, (.*)\) already exists/.exec(text)?.[1] ?? '';
}

/**
 * Mensagem de uma falha do catálogo, em pt-BR. `code` é o código digitado (para o 23505, quando o banco não o
 * repete). Sem conexão, a mensagem de sempre; banco sem a migração, `CATALOG_MIGRATION_MISSING`.
 */
export function catalogErrorMessage(error: unknown, code?: string | null): string {
  if (isOfflineRequestError(error)) return OFFLINE_REQUEST_MESSAGE;
  if (catalogMigrationMissing(error)) return CATALOG_MESSAGES.missing;
  if (error instanceof Error && !('code' in error)) return error.message;
  if (!error || typeof error !== 'object') return 'Não foi possível concluir. Tente novamente.';
  const { code: errorCode, message } = error as { code?: unknown; message?: unknown };
  const sqlState = String(errorCode ?? '');
  const duplicate = duplicateCodeOf(error);
  if (duplicate !== null) return CATALOG_MESSAGES.duplicateCode((code ?? duplicate).trim() || duplicate);
  if (sqlState === '23503' && blockingTableLabel(error) === 'itens de oportunidade')
    return CATALOG_MESSAGES.usedInDeals;
  if (sqlState === '42501' || (typeof message === 'string' && /row-level security|permission denied/i.test(message)))
    return CATALOG_MESSAGES.permission;
  if (sqlState === '23514' || sqlState === '23502') return 'Confira os campos obrigatórios e os valores informados.';
  if (typeof message === 'string' && /network|fetch|connection/i.test(message))
    return 'Não foi possível conectar. Verifique sua conexão e tente novamente.';
  return typeof message === 'string' && message.trim() ? message : 'Não foi possível concluir. Tente novamente.';
}
