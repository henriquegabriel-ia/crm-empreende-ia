import { useCallback, useMemo, useRef } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/hooks/useOrg';
import { useCrmPermissions } from '@/hooks/useCrmPermissions';
import { readCrmPages } from '@/hooks/useCrmSnapshot';
import { crmDb } from '@/integrations/supabase/crm-client';
import { useLocalClock } from '@/components/workday/useLocalClock';
import {
  activityReminders,
  dateKey,
  localDayBounds,
  parseLocalDay,
  type ReminderActivity,
  type ReminderState,
} from '@/lib/activity-logic';
import { TEAM_DATA_REFRESH } from '@/lib/team-data';

/** As colunas que os lembretes leem: só o que `activityReminders` usa, sem título, texto nem vínculos. */
export const REMINDER_COLUMNS = 'id,type,due_date,completed_at,user_id';

const exactCount = (withCount: boolean) => (withCount ? ({ count: 'exact' } as const) : undefined);

/**
 * Lembretes do menu (item 1.12; docs/arquitetura/1.12.md): as atividades vencidas e as que vencem até o fim do dia, da
 * pessoa que usa o CRM, para o número ao lado de "Hoje" no menu do desktop e no do celular.
 *
 * A regra é a de Hoje em "Minha rotina" (`activityReminders`, sobre o mesmo `activitySummary`). A leitura é leve: o
 * shell não carrega o snapshot de Hoje, que lê contatos, empresas, oportunidades e atividades inteiros e pesaria em
 * telas que não o usam (Pipeline, Financeiro, Configurações). O pedido traz só as cinco colunas das atividades
 * pendentes da pessoa, que não são nota, com prazo antes do fim do dia local, pelo índice `activities_owner_pending`
 * (org_id, user_id, due_date, das pendentes), em páginas pelo leitor do snapshot. O filtro do banco só estreita as
 * linhas: a contagem e a separação entre vencidas e próximas são do navegador, recalculadas a cada minuto e ao voltar
 * para a aba (`useLocalClock`), sem reler. O dia entra na chave: na virada do dia, a leitura é refeita com o novo fim
 * do dia.
 *
 * Cache: a chave ['crm', orgId, 'reminders', …] lê `activities` (CRM_QUERY_READS), então concluir, criar, reagendar ou
 * excluir uma atividade recarrega o número; ao voltar para a aba, a leitura com mais de 30 s é refeita, como o snapshot
 * de Hoje (TEAM_DATA_REFRESH, item 0.8). A leitura espera o papel ativo: a conta desativada (item 1.2) não pede nada,
 * nem no instante antes de a tela "Seu acesso foi encerrado" substituir o CRM, e a RLS só deixa ler a própria
 * organização. Nulo enquanto a primeira leitura não chega.
 *
 * Falha (revisão do item 1.12): sem nenhuma leitura na tela, `'unavailable'`, e o menu mostra um "?" neutro, em vez de
 * ficar sem número como quem não tem pendência; com uma leitura anterior, o número dela continua (o TanStack Query
 * mantém os dados quando a releitura falha). A leitura é tentada de novo como as outras do CRM: três vezes, ao voltar
 * para a aba e a cada gravação de atividades. A leitura do papel que falha sem nenhuma anterior (sem conexão desde a
 * entrada, por exemplo) também dá o "?" (achado 2 da revisão do 1.12, corrigido no item 1.14): sem papel lido, os
 * lembretes não são pedidos, e o menu ficaria sem número enquanto Hoje mostra as pendências, até a releitura do papel
 * do AppLayout, a cada 60 s, dar certo.
 */
export function useActivityReminders(): ReminderState {
  const { orgId } = useOrg();
  const { user, loading } = useAuth();
  const { active, error: roleError } = useCrmPermissions();
  const now = useLocalClock();
  const day = dateKey(now);
  const userId = user?.id ?? null;
  const query = useQuery({
    queryKey: ['crm', orgId, 'reminders', userId, day],
    enabled: !!orgId && !!userId && !loading && active,
    queryFn: () => {
      const end = new Date(localDayBounds(parseLocalDay(day) ?? new Date()).end).toISOString();
      return readCrmPages<ReminderActivity>((from, to, count) =>
        crmDb
          .from('activities')
          .select(REMINDER_COLUMNS, exactCount(count))
          .eq('org_id', orgId!)
          .eq('user_id', userId!)
          .is('completed_at', null)
          .neq('type', 'note')
          .lt('due_date', end)
          .order('id')
          .range(from, to),
      );
    },
    // Na virada do dia, o número da leitura anterior fica na tela até a nova chegar, em vez de sumir; nunca o de outra
    // conta ou organização.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === orgId && previousQuery?.queryKey[3] === userId
        ? keepPreviousData(previous)
        : undefined,
    ...TEAM_DATA_REFRESH,
  });
  const rows = query.data;
  // O papel não foi lido (falha sem nenhuma leitura anterior): os lembretes nem foram pedidos.
  const failed = query.isError || (!active && !!roleError);
  return useMemo(
    () => (rows ? activityReminders(rows, now, userId) : failed ? 'unavailable' : null),
    [rows, failed, now, userId],
  );
}

/**
 * Refaz as leituras do número do menu que falharam: a dos lembretes e, quando nenhuma leitura do papel deu certo, a do
 * papel, sem a qual os lembretes nem são pedidos. Hoje chama ao ler a rotina com sucesso e no "Tentar novamente"
 * (achado 6 da revisão do 1.12, corrigido no item 1.14): sem isso, o "?" do menu continuava ao lado de uma rotina já
 * carregada, até a pessoa trocar de aba ou gravar uma atividade (com o Wi-Fi conectado e sem internet, o navegador não
 * avisa a volta da conexão). Uma leitura que deu certo não é refeita.
 */
export function useRetryFailedReminders() {
  const cache = useQueryClient();
  const { orgId } = useOrg();
  const { error, refresh } = useCrmPermissions();
  // A função devolvida não muda a cada renderização (o papel relido entra pela referência), para Hoje a chamar só
  // quando a rotina chega.
  const role = useRef({ error, refresh });
  role.current = { error, refresh };
  return useCallback(() => {
    if (role.current.error) role.current.refresh();
    void cache.refetchQueries({
      queryKey: ['crm', orgId, 'reminders'],
      predicate: (query) => query.state.status === 'error',
    });
  }, [cache, orgId]);
}
