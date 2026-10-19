// Exemplo de docs/PERSONALIZAR/TELA.md: as consultas da tela "Contratos" no TanStack Query, com a chave
// ['crm', orgId, ...] das consultas da base (useProducts, useCrmPermissions).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrg } from '@/hooks/useOrg';
import { createContrato, loadContratos, loadOportunidades, type NovoContrato } from './data';

export function useContratos() {
  const { orgId } = useOrg();
  const queryClient = useQueryClient();
  const contratos = useQuery({
    queryKey: ['crm', orgId, 'custom_contratos'],
    queryFn: () => loadContratos(orgId!),
    enabled: !!orgId,
  });
  const oportunidades = useQuery({
    queryKey: ['crm', orgId, 'custom_contratos', 'deals'],
    queryFn: () => loadOportunidades(orgId!),
    enabled: !!orgId,
  });
  const criar = useMutation({
    mutationFn: (contrato: NovoContrato) => createContrato(orgId!, contrato),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['crm', orgId, 'custom_contratos'] }),
  });
  return { contratos, oportunidades, criar };
}
