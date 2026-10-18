import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/hooks/useOrg';
import { crmDb } from '@/integrations/supabase/crm-client';
import { EDITOR_ROLES, MANAGER_ROLES, TEAM_VIEWER_ROLES, type CrmRole } from '@/lib/roles';
import { isMissingColumn } from '@/lib/team-members';

interface RoleEntry {
  role: string;
  deactivatedAt: string | null;
}

/** Resultado de "Verificar de novo" na tela "Seu acesso foi encerrado". */
export type AccessCheck = 'active' | 'ended' | 'failed';

/** Com o CRM aberto, a leitura do papel vale por 30 s; o AppLayout a refaz ao voltar para a aba e a cada 60 s. */
const ACCESS_STALE_MS = 30_000;
const ACCESS_WATCH_INTERVAL_MS = 60_000;

/**
 * Presentation permissions mirror database policies; failures deny writes.
 * Desde o item 1.2, só o papel ativo conta (private.current_org exige papel ativo), e a conta desativada lê o próprio
 * papel com a data da desativação: `accessEnded` diz que a leitura terminou e não há papel ativo, e o AppLayout troca o
 * CRM pela tela "Seu acesso foi encerrado". Uma falha de leitura nunca encerra o acesso (o CRM segue em modo
 * conservador, e a RLS protege); depois de encerrado, uma nova falha também não o reabre. Num banco sem a migração, o
 * papel é lido sem a data e conta como ativo. `watchAccess` (só o AppLayout) relê o papel ao voltar para a aba, com os
 * dados com mais de 30 s, e a cada 60 s enquanto a aba está visível.
 * Só a falha sem nenhuma leitura bem-sucedida antes nega gravações e aparece em `error`. Uma releitura que falha
 * (a de 60 s, por exemplo) mantém os papéis da última leitura: sem isso, um colaborador ativo cairia em modo leitura
 * por até 60 s, e os formulários abertos, montados só com `canWrite`, sumiriam com o que a pessoa digitou.
 */
export function useCrmPermissions({ watchAccess = false }: { watchAccess?: boolean } = {}) {
  const { user, loading: authLoading } = useAuth();
  const { orgId } = useOrg();
  const query = useQuery({
    queryKey: ['crm', orgId, 'permissions', user?.id],
    enabled: Boolean(user?.id && orgId),
    queryFn: async (): Promise<RoleEntry[]> => {
      const read = (columns: string) =>
        crmDb.from('user_roles').select(columns).eq('user_id', user!.id).eq('org_id', orgId!);
      let { data, error } = await read('role,deactivated_at');
      if (error && isMissingColumn(error)) ({ data, error } = await read('role'));
      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map((entry) => ({
        role: String(entry.role),
        deactivatedAt: typeof entry.deactivated_at === 'string' ? entry.deactivated_at : null,
      }));
    },
    staleTime: ACCESS_STALE_MS,
    ...(watchAccess ? { refetchOnWindowFocus: true, refetchInterval: ACCESS_WATCH_INTERVAL_MS } : {}),
  });
  const entries = query.data ?? [];
  const roles = entries.filter((entry) => !entry.deactivatedAt).map((entry) => entry.role);
  const has = (allowed: readonly CrmRole[]) => roles.some((role) => (allowed as readonly string[]).includes(role));
  // A leitura falhou e não há papel lido antes (a releitura que falha guarda os dados da última leitura). Sem papel
  // lido, `has` é falso: a falha nega gravações sem precisar de outra condição.
  const loadFailed = query.isError && query.data === undefined;
  return {
    canWrite: has(EDITOR_ROLES),
    canManage: has(MANAGER_ROLES),
    /**
     * Escolhe uma pessoa da equipe nos filtros de responsável de Hoje, Atividades, Tarefas e Agenda (item 1.14). Sem
     * papel lido (carregando ou com a leitura falha), só os recortes de antes.
     */
    canViewTeam: has(TEAM_VIEWER_ROLES),
    loading: authLoading || (Boolean(user?.id && orgId) && query.isPending),
    /** Falha da leitura do papel, só quando nenhuma leitura deu certo antes. */
    error: loadFailed ? query.error : null,
    /** Papéis ativos da conta na organização. */
    roles,
    /** Há um papel ativo. */
    active: roles.length > 0,
    /** Data da desativação, quando a conta foi desativada (nula para quem nunca teve papel). */
    deactivatedAt: entries.find((entry) => entry.deactivatedAt)?.deactivatedAt ?? null,
    /** A leitura do papel terminou e não há papel ativo: a conta foi desativada ou não tem papel na organização. */
    accessEnded: query.data !== undefined && roles.length === 0,
    /** Tenta ler o papel de novo, depois de uma falha. */
    refresh: () => void query.refetch(),
    /** Verdadeiro durante qualquer leitura do papel, inclusive a nova tentativa depois de uma falha. */
    refreshing: query.isFetching,
    /**
     * Relê o papel e diz o resultado, para "Verificar de novo": ativo (o AppLayout abre o CRM), ainda encerrado ou
     * falha da leitura (que não reabre nada).
     */
    recheck: async (): Promise<AccessCheck> => {
      const result = await query.refetch();
      if (result.isError) return 'failed';
      return (result.data ?? []).some((entry) => !entry.deactivatedAt) ? 'active' : 'ended';
    },
  };
}
