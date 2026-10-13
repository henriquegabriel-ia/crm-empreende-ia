import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { backendConfigured } from '@/integrations/supabase/client';
import { crmDb } from '@/integrations/supabase/crm-client';

/** Fora do espaço ['crm', orgId, …]: na entrada ainda não há organização. */
export const INSTANCE_STATUS_KEY = ['instance-status'] as const;

// Banco ainda sem a migração do item 1.1: a função não existe, e não adianta tentar de novo.
const missingFunction = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error.code === 'PGRST202' || error.code === '42883');

async function readInstanceStatus(): Promise<boolean> {
  const { data, error } = await crmDb.rpc('instance_status').single();
  if (error) throw error;
  return data.has_organization;
}

/**
 * Se esta instância já tem empresa (public.instance_status, item 1.1), para a tela de entrada e a conta sem
 * organização escolherem entre "Criar empresa" e o pedido de convite.
 *
 * `hasOrganization` é null enquanto lê, quando a primeira leitura falha ou quando a função não existe. As duas falhas
 * são distintas: `unavailable` é o banco ainda sem a migração (a tela segue como antes do item, e não adianta tentar
 * de novo); `readFailed` é a leitura que falhou por rede ou erro do servidor, depois de uma nova tentativa (a tela não
 * pode supor que a instância está vazia). Nos dois casos, o banco continua barrando o que não pode. Uma releitura com
 * falha mantém o último valor lido. Relê ao voltar para a aba depois de 30 s (o padrão do app é não reler no foco),
 * porque a empresa pode ser criada por outra pessoa a qualquer momento. `refresh` relê na hora e devolve o valor novo,
 * para escolher a mensagem de uma recusa ou tentar de novo depois de uma falha; `rechecking` indica essa releitura.
 */
export function useInstanceStatus() {
  const query = useQuery({
    queryKey: INSTANCE_STATUS_KEY,
    enabled: backendConfigured,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: (failures, error) => failures < 1 && !missingFunction(error),
    queryFn: readInstanceStatus,
  });
  const { refetch } = query;
  const refresh = useCallback(async (): Promise<boolean | null> => {
    const result = await refetch();
    return result.data ?? null;
  }, [refetch]);
  const neverRead = query.isError && query.data === undefined;
  return {
    hasOrganization: query.data ?? null,
    checking: backendConfigured && query.isPending,
    unavailable: neverRead && missingFunction(query.error),
    readFailed: neverRead && !missingFunction(query.error),
    rechecking: query.isFetching,
    refresh,
  };
}
