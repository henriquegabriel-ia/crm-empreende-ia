import { crmDb } from '@/integrations/supabase/crm-client';
import { readCrmPages } from '@/hooks/useCrmSnapshot';
import type {
  CompanyPayload,
  ContactImportContext,
  ContactPayload,
  ExistingImportContact,
  ImportColumns,
} from '@/lib/contact-import';
import { isMissingColumn, loadTeamMembers } from '@/lib/team-members';

/**
 * Dados da importação de planilha (item 1.11; docs/arquitetura/1.11.md, seções 4 e 5): o que a prévia confere (os
 * contatos cadastrados, as empresas, a equipe e as colunas que o banco tem) e a gravação dos lotes. Sem RPC nova: a
 * gravação continua pela API de tabelas, como no 0.5, e as regras ficam nos gatilhos do banco. As falhas sobem como
 * vieram do Supabase (code e message), para a tela escolher a mensagem.
 */

const exactCount = (withCount: boolean) => (withCount ? ({ count: 'exact' } as const) : undefined);

/**
 * Os contatos cadastrados, só com o que a conferência de repetidos usa (o leitor do snapshot do 0.10). Com a coluna do
 * 1.9, também a marca "Não contatar": uma repetida que pede a marca avisa quando o contato cadastrado não a tem.
 */
export function loadExistingContacts(orgId: string, withDoNotContact = false) {
  const columns = withDoNotContact ? 'id,email,phone,do_not_contact' : 'id,email,phone';
  return readCrmPages<ExistingImportContact>((from, to, count) =>
    crmDb.from('contacts').select(columns, exactCount(count)).eq('org_id', orgId).order('id').range(from, to),
  );
}

/** As empresas cadastradas, com a data de criação: com nomes repetidos, a importação liga à mais antiga. */
export function loadExistingCompanies(orgId: string) {
  return readCrmPages<{ id: string; name: string; created_at: string }>((from, to, count) =>
    crmDb
      .from('companies')
      .select('id,name,created_at', exactCount(count))
      .eq('org_id', orgId)
      .order('id')
      .range(from, to),
  );
}

/**
 * As colunas que o banco tem: `do_not_contact` (migração do 1.9) e `legal_basis` com `legal_basis_note` (1.10). Uma
 * coluna ausente (42703, ou PGRST204 no cache do PostgREST) deixa as colunas da planilha de fora, com o aviso da prévia;
 * outra falha sobe, como a conferência de repetidos.
 */
export async function probeImportColumns(orgId: string): Promise<ImportColumns> {
  const probe = async (columns: string) => {
    const { error } = await crmDb.from('contacts').select(columns).eq('org_id', orgId).limit(1);
    if (!error) return true;
    if (isMissingColumn(error)) return false;
    throw error;
  };
  const [doNotContact, legalBasis] = await Promise.all([
    probe('id,do_not_contact'),
    probe('id,legal_basis,legal_basis_note'),
  ]);
  return { doNotContact, legalBasis };
}

/** Tudo o que a análise precisa, lido em paralelo (os contatos, depois da sondagem das colunas). */
export async function loadImportContext(orgId: string): Promise<ContactImportContext> {
  const probed = probeImportColumns(orgId);
  const [existingContacts, companies, members, columns] = await Promise.all([
    probed.then((found) => loadExistingContacts(orgId, found.doNotContact)),
    loadExistingCompanies(orgId),
    loadTeamMembers(orgId),
    probed,
  ]);
  return { orgId, existingContacts, companies, members, columns };
}

/**
 * Um lote de empresas novas. `ignoreDuplicates` no id: a nova tentativa de um lote que entrou sem a resposta chegar
 * não duplica nada (o conflito ignorado é só o do id, gerado nesta importação). Devolve os ids inseridos agora.
 */
export async function writeCompanyBatch(batch: readonly CompanyPayload[]): Promise<string[]> {
  const { data, error } = await crmDb
    .from('companies')
    .upsert([...batch], { onConflict: 'id', ignoreDuplicates: true })
    .select('id');
  if (error) throw error;
  return (data ?? []).map((row) => row.id);
}

/**
 * Um lote de contatos, numa instrução só (entra inteiro ou não entra). Todas as linhas levam as mesmas chaves: a
 * biblioteca manda a união das chaves, e uma chave ausente numa linha viraria NULL, e não o padrão da coluna
 * (`do_not_contact` é NOT NULL). Um id ausente da resposta já estava gravado por uma tentativa anterior.
 */
export async function writeContactBatch(batch: readonly ContactPayload[]): Promise<string[]> {
  const { data, error } = await crmDb
    .from('contacts')
    .upsert([...batch], { onConflict: 'id', ignoreDuplicates: true })
    .select('id');
  if (error) throw error;
  return (data ?? []).map((row) => row.id);
}
