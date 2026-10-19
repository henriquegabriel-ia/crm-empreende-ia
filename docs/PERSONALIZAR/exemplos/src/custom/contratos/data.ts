// Exemplo de docs/PERSONALIZAR/TELA.md: as consultas e a gravação dos contratos, com o cliente da base (crmDb) e o
// tipo gerado por npm run gen:types depois da migração 20261101091000_custom_contratos.sql. A RLS da tabela decide
// quem lê e quem grava; a tela só esconde o que o papel não faz.
import { crmDb } from '@/integrations/supabase/crm-client';
import type { Database } from '@/integrations/supabase/database.types';
import { allRows } from '@/components/pipeline/data';

type ContratosTable = Database['public']['Tables']['custom_contratos'];
/** Uma linha de public.custom_contratos, como o tipo gerado a descreve. */
export type Contrato = ContratosTable['Row'];
/** O que o diálogo "Novo contrato" grava (org_id vem da conta; id, datas de registro e updated_at, do banco). */
export type NovoContrato = Pick<ContratosTable['Insert'], 'deal_id' | 'numero' | 'assinado_em'>;
/** Uma oportunidade para escolher no diálogo. */
export interface OportunidadeOpcao {
  id: string;
  title: string;
}

const CONTRATO_COLUMNS = 'id,org_id,deal_id,numero,assinado_em,created_at,updated_at';

/** Os contratos da organização, os assinados mais recentes primeiro (consulta ['crm', orgId, 'custom_contratos']). */
export async function loadContratos(orgId: string): Promise<Contrato[]> {
  return allRows((from, to) =>
    crmDb
      .from('custom_contratos')
      .select(CONTRATO_COLUMNS)
      .eq('org_id', orgId)
      .order('assinado_em', { ascending: false, nullsFirst: false })
      .order('numero')
      .range(from, to),
  );
}

/** As oportunidades da organização, por título, para o diálogo e para mostrar o título na lista. */
export async function loadOportunidades(orgId: string): Promise<OportunidadeOpcao[]> {
  return allRows((from, to) =>
    crmDb.from('deals').select('id,title').eq('org_id', orgId).order('title').order('id').range(from, to),
  );
}

/** Grava um contrato novo. A recusa do banco (RLS, FK composta, um gancho) sobe como está, para a tela mostrar. */
export async function createContrato(orgId: string, contrato: NovoContrato): Promise<void> {
  const { error } = await crmDb.from('custom_contratos').insert({ ...contrato, org_id: orgId });
  if (error) throw error;
}
