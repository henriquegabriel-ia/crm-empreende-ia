import { useQuery } from '@tanstack/react-query';
import { useOrg } from '@/hooks/useOrg';
import { loadProducts } from '@/components/pipeline/deal-items-data';
import { catalogMigrationMissing } from '@/lib/rpc-errors';
import type { CatalogProduct } from '@/lib/deal-types';

/** Itens do catálogo que o seletor do editor oferece a um item novo: só os ativos, por nome. */
export function activeProducts(products: readonly CatalogProduct[]): CatalogProduct[] {
  return products.filter((product) => !product.archived_at);
}

/**
 * O catálogo da organização (item 1.16), ativos e arquivados, na chave ['crm', orgId, 'products']: a aba "Catálogo" de
 * Configurações e o editor de itens leem a mesma consulta. `missing` é verdadeiro num banco sem a migração do catálogo
 * (a tela mostra CATALOG_MIGRATION_MISSING e esconde os itens).
 */
export function useProducts({ enabled = true }: { enabled?: boolean } = {}) {
  const { orgId } = useOrg();
  const query = useQuery({
    queryKey: ['crm', orgId, 'products'],
    queryFn: () => loadProducts(orgId!),
    enabled: enabled && !!orgId,
    retry: (failures, error) => !catalogMigrationMissing(error) && failures < 2,
  });
  return { ...query, products: query.data ?? [], missing: catalogMigrationMissing(query.error) };
}
