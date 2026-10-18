import { useQuery } from '@tanstack/react-query';
import { useOrg } from '@/hooks/useOrg';
import { loadDealItems } from '@/components/pipeline/deal-items-data';
import { catalogMigrationMissing } from '@/lib/rpc-errors';

interface UseDealItemsOptions {
  enabled?: boolean;
  /**
   * `updated_at` da oportunidade lida. Entra na chave: toda gravação dos itens (save_deal) renova a versão da
   * oportunidade, e uma versão nova lê os itens de novo. Assim o editor nunca monta os rascunhos com itens de uma versão
   * anterior à que vai na guarda de concorrência (0.8), e o painel não mostra linhas que somam outro valor.
   */
  version?: string | null;
}

/**
 * Os itens de uma oportunidade (item 1.16), na chave ['crm', orgId, 'deal-items', dealId, version], lidos ao abrir a
 * edição ou o painel. Sem `dealId` (criação) ou com `enabled` falso (oportunidade sem itens), não lê. `missing` é
 * verdadeiro num banco sem a migração do catálogo.
 */
export function useDealItems(dealId: string | null | undefined, { enabled = true, version }: UseDealItemsOptions = {}) {
  const { orgId } = useOrg();
  const query = useQuery({
    queryKey: ['crm', orgId, 'deal-items', dealId, version ?? null],
    queryFn: () => loadDealItems(orgId!, dealId!),
    enabled: enabled && !!orgId && !!dealId,
    retry: (failures, error) => !catalogMigrationMissing(error) && failures < 2,
  });
  return { ...query, items: query.data ?? [], missing: catalogMigrationMissing(query.error) };
}
