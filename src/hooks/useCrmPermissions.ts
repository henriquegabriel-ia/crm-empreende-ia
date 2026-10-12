import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/hooks/useOrg';
import { crmDb } from '@/integrations/supabase/crm-client';
import { EDITOR_ROLES, MANAGER_ROLES, type CrmRole } from '@/lib/roles';

/** Presentation permissions mirror database policies; failures deny writes. */
export function useCrmPermissions() {
  const { user, loading: authLoading } = useAuth();
  const { orgId } = useOrg();
  const query = useQuery({
    queryKey: ['crm', orgId, 'permissions', user?.id],
    enabled: Boolean(user?.id && orgId),
    queryFn: async () => {
      const { data, error } = await crmDb
        .from('user_roles')
        .select('role')
        .eq('user_id', user!.id)
        .eq('org_id', orgId!);
      if (error) throw error;
      return data.map((entry) => String(entry.role));
    },
    staleTime: 30_000,
  });
  const roles = query.data ?? [];
  const has = (allowed: readonly CrmRole[]) => roles.some((role) => (allowed as readonly string[]).includes(role));
  return {
    canWrite: !query.isError && has(EDITOR_ROLES),
    canManage: !query.isError && has(MANAGER_ROLES),
    loading: authLoading || (Boolean(user?.id && orgId) && query.isPending),
    error: query.error,
    roles,
    /** Tenta ler o papel de novo, depois de uma falha. */
    refresh: () => void query.refetch(),
    /** Verdadeiro durante qualquer leitura do papel, inclusive a nova tentativa depois de uma falha. */
    refreshing: query.isFetching,
  };
}
