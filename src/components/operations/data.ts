import { crmDb } from '@/integrations/supabase/crm-client';
import { allRows } from '@/components/pipeline/data';
import { isMissingColumn, readMemberRoles, withMemberStates } from '@/lib/team-members';
export { allRows, errorMessage } from '@/components/pipeline/data';

type ContactOption = {
  id: string;
  first_name: string;
  last_name: string | null;
  company_id: string | null;
  anonymized_at?: string | null;
};
/**
 * Contatos dos formulários do Financeiro e dos Relatórios, com a anonimização (item 1.10), para o seletor deixar de
 * fora o anonimizado; num banco sem a migração, sem a coluna.
 */
async function loadContactOptions(orgId: string): Promise<ContactOption[]> {
  const read = (columns: string) =>
    allRows((from, to) => crmDb.from('contacts').select(columns).eq('org_id', orgId).order('id').range(from, to));
  try {
    return (await read('id,first_name,last_name,company_id,anonymized_at')) as unknown as ContactOption[];
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    return (await read('id,first_name,last_name,company_id')) as unknown as ContactOption[];
  }
}

export async function loadOperationReferences(orgId: string) {
  const [contacts, companies, deals, profiles, memberRoles, pipelines, stages] = await Promise.all([
    loadContactOptions(orgId),
    allRows((from, to) => crmDb.from('companies').select('id,name').eq('org_id', orgId).order('id').range(from, to)),
    allRows((from, to) => crmDb.from('deals').select('*').eq('org_id', orgId).order('id').range(from, to)),
    allRows((from, to) => crmDb.from('profiles').select('id,name').eq('org_id', orgId).order('id').range(from, to)),
    // Situação de cada pessoa (item 1.2), para Relatórios marcar "(desativado)" e ordenar o filtro.
    readMemberRoles(orgId, (columns) =>
      allRows((from, to) => crmDb.from('user_roles').select(columns).eq('org_id', orgId).order('id').range(from, to)),
    ),
    allRows((from, to) => crmDb.from('pipelines').select('*').eq('org_id', orgId).order('id').range(from, to)),
    allRows((from, to) => crmDb.from('pipeline_stages').select('*').eq('org_id', orgId).order('id').range(from, to)),
  ]);
  return { contacts, companies, deals, people: withMemberStates(profiles, memberRoles), pipelines, stages };
}
export type OperationReferences = Awaited<ReturnType<typeof loadOperationReferences>>;

/** Funis e etapas para o filtro do gatilho "mudou de etapa" das automações, na ordem de exibição. */
export async function loadPipelineScopes(orgId: string) {
  const [pipelines, stages] = await Promise.all([
    allRows((from, to) =>
      crmDb.from('pipelines').select('id,name').eq('org_id', orgId).order('name').order('id').range(from, to),
    ),
    allRows((from, to) =>
      crmDb
        .from('pipeline_stages')
        .select('id,name,pipeline_id,order')
        .eq('org_id', orgId)
        .order('order')
        .order('id')
        .range(from, to),
    ),
  ]);
  return { pipelines, stages };
}
export type PipelineScopes = Awaited<ReturnType<typeof loadPipelineScopes>>;
