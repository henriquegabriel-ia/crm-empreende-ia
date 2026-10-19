import { crmDb as pipelineDb } from '@/integrations/supabase/crm-client';
export { crmDb as pipelineDb } from '@/integrations/supabase/crm-client';
import { blockingTableLabel, type DealLinkCounts } from '@/lib/record-links';
import { isOfflineRequestError, OFFLINE_REQUEST_MESSAGE } from '@/lib/offline';
import { isMissingColumn, readMemberRoles, withMemberStates } from '@/lib/team-members';
import { DEAL_ITEM_MESSAGES } from '@/lib/deal-item-math';

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

// Canais do item 1.9 no painel da oportunidade: telefone, e-mail, responsável e a marca "Não contatar".
const MARK_COLUMNS = 'do_not_contact,do_not_contact_at,do_not_contact_by,do_not_contact_reason';
// Item 1.10: o contato anonimizado sai do seletor de contato da oportunidade (o banco recusa o vínculo novo).
const PRIVACY_COLUMNS = 'anonymized_at';
const CONTACT_COLUMNS = 'id,first_name,last_name,company_id,email,phone,owner_id';
const COMPANY_COLUMNS = 'id,name,phone,owner_id';
export type ContactReference = {
  id: string;
  first_name: string;
  last_name: string | null;
  company_id: string | null;
  email: string | null;
  phone: string | null;
  owner_id: string | null;
  do_not_contact?: boolean;
  do_not_contact_at?: string | null;
  do_not_contact_by?: string | null;
  do_not_contact_reason?: string | null;
  anonymized_at?: string | null;
};

export type CompanyReference = {
  id: string;
  name: string;
  phone: string | null;
  owner_id: string | null;
  do_not_contact?: boolean;
  do_not_contact_at?: string | null;
  do_not_contact_by?: string | null;
  do_not_contact_reason?: string | null;
};

/**
 * Lê as colunas com a marca "Não contatar" (e, nos contatos, a anonimização do item 1.10); num banco ainda sem a
 * migração (coluna ausente), lê sem elas, uma de cada vez: a marca conta como falsa e ninguém como anonimizado, e o
 * Pipeline continua abrindo, como o snapshot com `select('*')`.
 */
async function readWithMark<T>(
  columns: string,
  read: (columns: string) => Promise<unknown[]>,
  privacy = false,
): Promise<T[]> {
  const attempts = [
    ...(privacy ? [`${columns},${MARK_COLUMNS},${PRIVACY_COLUMNS}`] : []),
    `${columns},${MARK_COLUMNS}`,
    columns,
  ];
  for (const [position, attempt] of attempts.entries()) {
    try {
      return (await read(attempt)) as T[];
    } catch (error) {
      if (!isMissingColumn(error) || position === attempts.length - 1) throw error;
    }
  }
  return [];
}

export async function loadPipelineReferences(orgId: string) {
  const [pipelines, stages, people, memberRoles, contacts, companies] = await Promise.all([
    allRows((from, to) =>
      pipelineDb.from('pipelines').select('*').eq('org_id', orgId).order('name').order('id').range(from, to),
    ),
    allRows((from, to) =>
      pipelineDb.from('pipeline_stages').select('*').eq('org_id', orgId).order('order').order('id').range(from, to),
    ),
    allRows((from, to) =>
      pipelineDb.from('profiles').select('id,name').eq('org_id', orgId).order('name').order('id').range(from, to),
    ),
    // Situação de cada pessoa (item 1.2): desativados saem dos seletores e ficam marcados nos cartões e no filtro.
    readMemberRoles(orgId, (columns) =>
      allRows((from, to) =>
        pipelineDb.from('user_roles').select(columns).eq('org_id', orgId).order('id').range(from, to),
      ),
    ),
    // Telefone, e-mail, responsável e a marca "Não contatar" servem aos canais do painel (item 1.9).
    readWithMark<ContactReference>(
      CONTACT_COLUMNS,
      (columns) =>
        allRows((from, to) =>
          pipelineDb
            .from('contacts')
            .select(columns)
            .eq('org_id', orgId)
            .order('first_name')
            .order('id')
            .range(from, to),
        ),
      true,
    ),
    readWithMark<CompanyReference>(COMPANY_COLUMNS, (columns) =>
      allRows((from, to) =>
        pipelineDb.from('companies').select(columns).eq('org_id', orgId).order('name').order('id').range(from, to),
      ),
    ),
  ]);
  return {
    pipelines,
    stages,
    people: withMemberStates(people, memberRoles).map((person) => ({
      id: person.id,
      full_name: person.name,
      active: person.active,
    })),
    contacts: contacts.map((contact) => ({
      ...contact,
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
    // Recusas explicadas pelo banco (P0001) vão como estão, antes das regras por palavra abaixo: a mensagem de uma regra
    // própria da empresa (os ganchos private.custom_* do item 1.13) pode citar "permissão" ou "conexão" e não pode virar
    // a mensagem genérica.
    if (code === 'P0001' && error.message.trim()) return error.message;
    // Item 1.16: o item do catálogo escolhido foi excluído entre abrir o editor e salvar.
    if (
      code === '23503' &&
      error.message.includes('deal_items_product_id_org_id_fkey') &&
      /insert or update/.test(error.message)
    )
      return DEAL_ITEM_MESSAGES.productMissing;
    if (code === '23503') {
      const blocker = blockingTableLabel(error);
      return blocker
        ? `Este registro ainda está vinculado a ${blocker}. Revise esses vínculos antes desta alteração ou mantenha o registro encerrado, sem excluir.`
        : 'Existem registros vinculados que precisam ser revisados antes desta alteração. Confira os vínculos ou mantenha o registro encerrado, sem excluir.';
    }
    if (code === '23505') return 'Já existe um registro com esses dados. Revise o formulário.';
    // Item 1.16: o valor de uma oportunidade com itens só muda pelos itens (o CHECK deals_value_from_items recusa um
    // formulário antigo ou um cliente que tente mudá-lo direto).
    if (code === '23514' && error.message.includes('deals_value_from_items')) return DEAL_ITEM_MESSAGES.valueFromItems;
    if (code === '23514' || code === '23502') return 'Confira os campos obrigatórios e os valores informados.';
    // 42501 cobre também as recusas das funções do banco, como delete_deal, cujo texto ("Somente administradores…")
    // esquece os donos: a tela mostra a mensagem própria, como relationshipError.
    if (code === '42501' || /permission|policy|forbidden|denied/i.test(error.message))
      return 'Seu papel não permite esta ação. Peça a um dono ou administrador para revisar seu acesso. Os dados preenchidos foram mantidos.';
    if (/network|fetch|connection/i.test(error.message))
      return 'Não foi possível conectar. Verifique sua conexão e tente novamente.';
    return error.message;
  }
  return 'Não foi possível concluir. Tente novamente.';
}
