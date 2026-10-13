import { crmDb } from '@/integrations/supabase/crm-client';
import { allRows } from '@/components/pipeline/data';
import { readMemberRoles, withMemberStates } from '@/lib/team-members';
export { allRows, errorMessage } from '@/components/pipeline/data';

export async function loadOperationReferences(orgId: string) {
  const [contacts, companies, deals, profiles, memberRoles, pipelines, stages] = await Promise.all([
    allRows((from, to) =>
      crmDb
        .from('contacts')
        .select('id,first_name,last_name,company_id')
        .eq('org_id', orgId)
        .order('id')
        .range(from, to),
    ),
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
