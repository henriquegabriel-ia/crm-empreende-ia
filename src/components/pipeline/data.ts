import { crmDb as pipelineDb } from '@/integrations/supabase/crm-client';
export { crmDb as pipelineDb } from '@/integrations/supabase/crm-client';
import { blockingTableLabel, type DealLinkCounts } from '@/lib/record-links';
import { isOfflineRequestError, OFFLINE_REQUEST_MESSAGE } from '@/lib/offline';

type PageResponse<T> = { data: T[] | null; error: { message: string } | null };
export async function allRows<T>(page: (from: number, to: number) => PromiseLike<PageResponse<T>>): Promise<T[]> {
  const result: T[] = [];
  const size = 500;
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw error;
    result.push(...(data ?? []));
    if (!data || data.length < size) return result;
  }
}

export async function loadPipelineReferences(orgId: string) {
  const [pipelines, stages, people, contacts, companies] = await Promise.all([
    allRows((from, to) =>
      pipelineDb.from('pipelines').select('*').eq('org_id', orgId).order('name').order('id').range(from, to),
    ),
    allRows((from, to) =>
      pipelineDb.from('pipeline_stages').select('*').eq('org_id', orgId).order('order').order('id').range(from, to),
    ),
    allRows((from, to) =>
      pipelineDb.from('profiles').select('id,name').eq('org_id', orgId).order('name').order('id').range(from, to),
    ),
    allRows((from, to) =>
      pipelineDb
        .from('contacts')
        .select('id,first_name,last_name,company_id')
        .eq('org_id', orgId)
        .order('first_name')
        .order('id')
        .range(from, to),
    ),
    allRows((from, to) =>
      pipelineDb.from('companies').select('id,name').eq('org_id', orgId).order('name').order('id').range(from, to),
    ),
  ]);
  return {
    pipelines,
    stages,
    people: people.map((person) => ({ id: person.id, full_name: person.name })),
    contacts: contacts.map((contact) => ({
      id: contact.id,
      company_id: contact.company_id,
      full_name: [contact.first_name, contact.last_name].filter(Boolean).join(' '),
    })),
    companies,
  };
}

/**
 * Vínculos que a exclusão pela RPC delete_deal desfaz: atividades e recebimentos ficam sem a oportunidade, e os
 * registros de automação continuam no histórico, sem o vínculo. Só contagens, sem trazer as linhas.
 */
export async function loadDealLinks(orgId: string, dealId: string): Promise<DealLinkCounts> {
  const count = async (table: 'activities' | 'payments' | 'automation_logs') => {
    const { count, error } = await pipelineDb
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('deal_id', dealId);
    if (error) throw error;
    // Sem a contagem, o diálogo não pode afirmar que não há vínculos.
    if (count === null) throw new Error('Não foi possível conferir os vínculos da oportunidade. Tente novamente.');
    return count;
  };
  const [activities, payments, automation_logs] = await Promise.all([
    count('activities'),
    count('payments'),
    count('automation_logs'),
  ]);
  return { activities, payments, automation_logs };
}

export function errorMessage(error: unknown): string {
  // Sem conexão, a requisição nem sai: a mensagem diz que nada foi salvo, sem o prefixo que o PostgREST acrescenta.
  if (isOfflineRequestError(error)) return OFFLINE_REQUEST_MESSAGE;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    const code = 'code' in error ? String(error.code) : '';
    if (code === '23503') {
      const blocker = blockingTableLabel(error);
      return blocker
        ? `Este registro ainda está vinculado a ${blocker}. Revise esses vínculos antes desta alteração ou mantenha o registro encerrado, sem excluir.`
        : 'Existem registros vinculados que precisam ser revisados antes desta alteração. Confira os vínculos ou mantenha o registro encerrado, sem excluir.';
    }
    if (code === '23505') return 'Já existe um registro com esses dados. Revise o formulário.';
    if (code === '23514' || code === '23502') return 'Confira os campos obrigatórios e os valores informados.';
    if (/permission|policy|forbidden|denied/i.test(error.message))
      return 'Você não tem permissão para esta ação. Os dados preenchidos foram mantidos.';
    if (/network|fetch|connection/i.test(error.message))
      return 'Não foi possível conectar. Verifique sua conexão e tente novamente.';
    return error.message;
  }
  return 'Não foi possível concluir. Tente novamente.';
}
