import { useQuery, type QueryClient } from '@tanstack/react-query';
import { crmDb } from '@/integrations/supabase/crm-client';
import { useOrg } from '@/hooks/useOrg';
import { exportFileName } from '@/lib/brand';
import {
  buildContactExportZip,
  contactExportBaseName,
  parseContactExportData,
  type ContactExportData,
} from '@/lib/contact-export';
import { invalidateCrmTables, type CrmTable } from '@/lib/crm-cache';
import type { ContactExportRow } from '@/lib/crm-import';
import { allCrmRows } from '@/lib/crm-pagination';
import { downloadBytes } from '@/lib/csv';
import { localDateKey } from '@/lib/dates';
import {
  organizationLegalBasisOf,
  parseAnonymizationCounts,
  parsePrivacySummary,
  type AnonymizationCounts,
  type LegalBasis,
  type PrivacyActionRow,
  type PrivacySummary,
} from '@/lib/privacy';
import {
  channelsMigrationMissing,
  PRIVACY_MIGRATION_MISSING,
  privacyMigrationMissing,
  rpcRefusalMessage,
} from '@/lib/rpc-errors';
import { readMemberRoles, withMemberStates } from '@/lib/team-members';

/**
 * Dados da privacidade (item 1.10; docs/arquitetura/1.10.md): as três RPCs, o registro de privacy_actions, o padrão da
 * base legal da empresa e a planilha de contatos. As falhas sobem como vieram do Supabase (code e message): a tela
 * mostra `rpcRefusalMessage` (as recusas P0001 do banco, em pt-BR) ou, com `privacyMigrationMissing`, a mensagem de
 * migração ausente (PRIVACY_MIGRATION_MISSING).
 */

/**
 * A mensagem de uma falha de privacidade na tela: o banco sem a migração (PRIVACY_MIGRATION_MISSING), o impasse e o
 * tempo-limite com a mensagem própria (nada foi alterado), as recusas do banco (P0001) como estão e, no resto,
 * `fallback`, sem texto técnico.
 */
export function privacyErrorMessage(error: unknown, fallback: string): string {
  if (privacyMigrationMissing(error)) return PRIVACY_MIGRATION_MISSING;
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === '40P01') return 'Outra gravação aconteceu ao mesmo tempo, e nada foi alterado. Tente de novo.';
  if (code === '57014') return 'A operação demorou demais, e nada foi alterado. Tente de novo.';
  return rpcRefusalMessage(error, fallback);
}

/** "Segurança" pagina os registros de 30 em 30, como a auditoria. */
export const PRIVACY_ACTIONS_PAGE_SIZE = 30;

/** Chaves das consultas; os nomes estão em CRM_QUERY_READS (src/lib/crm-cache.ts). */
export const privacyQueryKeys = {
  /** O último registro de um contato, na seção "Privacidade" da ficha. */
  lastAction: (orgId: string | null, contactId: string | null) => ['crm', orgId, 'privacy-actions', contactId] as const,
  /** Uma página de "Exportações e anonimizações", em "Segurança". */
  page: (orgId: string | null, page: number) => ['crm', orgId, 'privacy-actions-page', page] as const,
  /** O resumo do diálogo de anonimização. */
  summary: (orgId: string | null, contactId: string | null) => ['crm', orgId, 'privacy-summary', contactId] as const,
  /** O padrão da base legal da empresa (cadastro de contato, Configurações). */
  organization: (orgId: string | null) => ['crm', orgId, 'organization-privacy'] as const,
};

/** Tabelas que a anonimização altera, para `invalidateCrmTables`. */
export const ANONYMIZATION_WRITES: readonly CrmTable[] = [
  'contacts',
  'activities',
  'deals',
  'payments',
  'privacy_actions',
];
/** A exportação só grava o registro. */
export const EXPORT_WRITES: readonly CrmTable[] = ['privacy_actions'];

export const invalidateAfterAnonymization = (cache: QueryClient) => invalidateCrmTables(cache, ANONYMIZATION_WRITES);
export const invalidateAfterExport = (cache: QueryClient) => invalidateCrmTables(cache, EXPORT_WRITES);

/** `contact_privacy_summary`: a versão do contato (para p_version) e as contagens do que a anonimização fará. */
export async function fetchPrivacySummary(contactId: string): Promise<PrivacySummary> {
  const { data, error } = await crmDb.rpc('contact_privacy_summary', { p_contact_id: contactId });
  if (error) throw error;
  return parsePrivacySummary(data);
}

/**
 * `anonymize_contact` com a versão lida no resumo. Irreversível. A recusa por versão ("Este contato mudou desde o
 * resumo…") pede recarregar o resumo; as contagens devolvidas podem ser maiores que as do resumo, e o aviso de sucesso
 * usa as devolvidas.
 */
export async function anonymizeContact(contactId: string, version: string): Promise<AnonymizationCounts> {
  const { data, error } = await crmDb.rpc('anonymize_contact', { p_contact_id: contactId, p_version: version });
  if (error) throw error;
  return parseAnonymizationCounts(data);
}

/** Recusa de `anonymize_contact` quando o contato mudou desde o resumo (a tela recarrega o resumo e limpa a palavra). */
export const ANONYMIZATION_VERSION_CHANGED = 'Este contato mudou desde o resumo.';
export function anonymizationVersionChanged(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === 'P0001' && typeof message === 'string' && message.startsWith(ANONYMIZATION_VERSION_CHANGED);
}

/** `export_contact_data`: lê os dados do contato e registra a exportação, na mesma transação. */
export async function exportContactData(contactId: string): Promise<ContactExportData> {
  const { data, error } = await crmDb.rpc('export_contact_data', { p_contact_id: contactId });
  if (error) throw error;
  return parseContactExportData(data);
}

/**
 * "Exportar dados deste contato" de ponta a ponta: a RPC, o pacote .zip e o download com o nome da marca, sem o nome da
 * pessoa ("dados-contato-1a2b3c4d-acme-2026-10-13.zip"). Devolve o nome do arquivo e os dados lidos.
 */
export async function downloadContactExport(contactId: string, today = localDateKey()) {
  const data = await exportContactData(contactId);
  const filename = exportFileName(contactExportBaseName(contactId), 'zip', today);
  downloadBytes(filename, buildContactExportZip(data), 'application/zip');
  return { data, filename };
}

/** O último registro de privacidade de um contato (o mais recente), ou nulo. Só donos e administradores leem (RLS). */
export async function loadLastPrivacyAction(orgId: string, contactId: string): Promise<PrivacyActionRow | null> {
  const { data, error } = await crmDb
    .from('privacy_actions')
    .select('*')
    .eq('org_id', orgId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .order('id')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Linha de "Exportações e anonimizações": o registro, o contato atual (nulo se excluído) e quem fez. */
export interface PrivacyActionPageRow extends PrivacyActionRow {
  contact: {
    id: string;
    first_name: string;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    anonymized_at: string | null;
  } | null;
  /** `active` falso para quem saiu da equipe (item 1.2): a tabela mostra "(desativado)", como o carimbo da ficha. */
  author: { id: string; name: string; email: string; active?: boolean } | null;
}

/**
 * Uma página dos registros da organização, do mais recente para o mais antigo, com o total para a paginação. Quem fez
 * vem com a situação do papel (user_roles), lida só quando a página tem autor.
 */
export async function loadPrivacyActionsPage(
  orgId: string,
  page: number,
): Promise<{ rows: PrivacyActionPageRow[]; total: number }> {
  const from = page * PRIVACY_ACTIONS_PAGE_SIZE;
  const { data, error, count } = await crmDb
    .from('privacy_actions')
    .select(
      '*, contact:contacts!privacy_actions_contact_id_org_id_fkey(id,first_name,last_name,email,phone,anonymized_at), author:profiles!privacy_actions_performed_by_org_id_fkey(id,name,email)',
      { count: 'exact' },
    )
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .order('id')
    .range(from, from + PRIVACY_ACTIONS_PAGE_SIZE - 1);
  if (error) throw error;
  const rows = (data ?? []) as unknown as PrivacyActionPageRow[];
  const authors = rows.flatMap((row) => (row.author ? [row.author] : []));
  if (!authors.length) return { rows, total: count ?? 0 };
  const active = new Map(
    withMemberStates(authors, await readMemberRoles(orgId)).map((person) => [person.id, person.active]),
  );
  return {
    rows: rows.map((row) =>
      row.author ? { ...row, author: { ...row.author, active: active.get(row.author.id) } } : row,
    ),
    total: count ?? 0,
  };
}

/** O padrão da base legal da empresa; `available` falso num banco sem a migração (a tela esconde o campo). */
export interface OrganizationPrivacy {
  available: boolean;
  defaultLegalBasis: LegalBasis;
  defaultLegalBasisAt: string | null;
  defaultLegalBasisBy: string | null;
}

export async function loadOrganizationPrivacy(orgId: string): Promise<OrganizationPrivacy> {
  const { data, error } = await crmDb
    .from('organizations')
    .select('default_legal_basis,default_legal_basis_at,default_legal_basis_by')
    .eq('id', orgId)
    .maybeSingle();
  if (error) {
    if (privacyMigrationMissing(error))
      return {
        available: false,
        defaultLegalBasis: 'not_informed',
        defaultLegalBasisAt: null,
        defaultLegalBasisBy: null,
      };
    throw error;
  }
  return {
    available: true,
    defaultLegalBasis: organizationLegalBasisOf(data),
    defaultLegalBasisAt: data?.default_legal_basis_at ?? null,
    defaultLegalBasisBy: data?.default_legal_basis_by ?? null,
  };
}

/**
 * Linhas de "Exportar contatos": com a marca "Não contatar", a base legal e o registro dela (item 1.11: o consentimento
 * volta pela importação), sem os anonimizados. Num banco sem a migração (ou sem a dos canais, do 1.9), a leitura
 * recusada é refeita com as quatro colunas de antes; `privacy` diz qual conjunto de colunas usar (CONTACT_EXPORT_COLUMNS
 * ou CONTACT_EXPORT_BASIC_COLUMNS, de src/lib/crm-import.ts).
 */
export async function loadContactExportRows(orgId: string): Promise<{ rows: ContactExportRow[]; privacy: boolean }> {
  try {
    const rows = await allCrmRows((from, to) =>
      crmDb
        .from('contacts')
        .select('first_name,last_name,email,phone,do_not_contact,legal_basis,legal_basis_note')
        .eq('org_id', orgId)
        .is('anonymized_at', null)
        .order('id')
        .range(from, to),
    );
    return { rows, privacy: true };
  } catch (error) {
    if (!privacyMigrationMissing(error) && !channelsMigrationMissing(error)) throw error;
    const rows = await allCrmRows((from, to) =>
      crmDb.from('contacts').select('first_name,last_name,email,phone').eq('org_id', orgId).order('id').range(from, to),
    );
    return { rows, privacy: false };
  }
}

/** O último registro de privacidade do contato, para donos e administradores (`enabled`). */
export function useLastPrivacyAction(contactId: string | null, enabled = true) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: privacyQueryKeys.lastAction(orgId, contactId),
    enabled: enabled && !!orgId && !!contactId,
    queryFn: () => loadLastPrivacyAction(orgId!, contactId!),
    retry: false,
  });
}

/** O resumo do diálogo de anonimização, lido a cada abertura (sem cache antigo) e sem nova tentativa automática. */
export function usePrivacySummary(contactId: string | null, enabled = true) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: privacyQueryKeys.summary(orgId, contactId),
    enabled: enabled && !!orgId && !!contactId,
    queryFn: () => fetchPrivacySummary(contactId!),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/** Uma página de "Exportações e anonimizações", para donos e administradores (`enabled`). */
export function usePrivacyActionsPage(page: number, enabled = true) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: privacyQueryKeys.page(orgId, page),
    enabled: enabled && !!orgId,
    queryFn: () => loadPrivacyActionsPage(orgId!, page),
    retry: false,
  });
}

/** O padrão da base legal da empresa, para o cadastro de contato e Configurações. */
export function useOrganizationPrivacy(enabled = true) {
  const { orgId } = useOrg();
  return useQuery({
    queryKey: privacyQueryKeys.organization(orgId),
    enabled: enabled && !!orgId,
    queryFn: () => loadOrganizationPrivacy(orgId!),
  });
}
