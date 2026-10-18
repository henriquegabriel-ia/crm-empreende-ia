import type { QueryClient } from '@tanstack/react-query';

/** Tabelas do schema public que as telas leem ou gravam. */
export type CrmTable =
  | 'activities'
  | 'audit_logs'
  | 'automation_logs'
  | 'automations'
  | 'companies'
  | 'contacts'
  | 'deal_stage_history'
  | 'deals'
  | 'email_templates'
  | 'integration_configs'
  | 'invitations'
  | 'organizations'
  | 'payments'
  | 'pipeline_stages'
  | 'pipelines'
  | 'portfolio_transfers'
  | 'privacy_actions'
  | 'profiles'
  | 'risk_rules'
  | 'user_roles';

/**
 * Invalidação por chave (item 0.10 do roteiro). Toda consulta do CRM usa a chave ['crm', orgId, <consulta>, ...], e
 * esta tabela diz quais tabelas cada <consulta> lê. Uma gravação invalida só as consultas que leem alguma tabela que
 * ela alterou, e não ['crm'] inteiro: concluir uma atividade recarrega o snapshot e as próximas ações do Pipeline, mas
 * não o papel da pessoa, as referências do Pipeline nem Configurações.
 *
 * Regra para quem cria uma consulta nova: acrescente o nome dela aqui com as tabelas que lê. Uma consulta fora desta
 * lista é invalidada por qualquer gravação, que é o comportamento seguro.
 */
export const CRM_QUERY_READS: Readonly<Record<string, readonly CrmTable[]>> = {
  // Os membros vêm com a situação do papel (user_roles), desde o item 1.2.
  snapshot: [
    'contacts',
    'companies',
    'deals',
    'activities',
    'profiles',
    'user_roles',
    'risk_rules',
    'pipelines',
    'pipeline_stages',
  ],
  // Lembretes do menu (item 1.12): as atividades pendentes da pessoa até o fim do dia.
  reminders: ['activities'],
  deals: ['deals'],
  'deal-actions': ['activities'],
  'deal-history': ['deal_stage_history'],
  'deal-links': ['activities', 'payments', 'automation_logs'],
  'pipeline-references': ['pipelines', 'pipeline_stages', 'profiles', 'user_roles', 'contacts', 'companies'],
  'operation-references': ['contacts', 'companies', 'deals', 'profiles', 'user_roles', 'pipelines', 'pipeline_stages'],
  payments: ['payments'],
  'linked-payments': ['payments'],
  automations: ['automations'],
  'automation-scopes': ['pipelines', 'pipeline_stages'],
  'automation-history': ['automation_logs'],
  'automation-errors': ['automation_logs'],
  templates: ['email_templates'],
  search: ['contacts', 'companies', 'deals', 'activities'],
  'onboarding-evidence': [
    'organizations',
    'profiles',
    'pipelines',
    'pipeline_stages',
    'contacts',
    'deals',
    'activities',
  ],
  permissions: ['user_roles'],
  // Nome da organização, para a variável {{organizacao}} dos modelos (item 1.9).
  'organization-name': ['organizations'],
  // Padrão da base legal dos contatos novos, com a data e o autor (item 1.10).
  'organization-privacy': ['organizations'],
  // Configurações; o nome de quem escolheu a base legal padrão vem de profiles, com a situação do papel (item 1.10).
  settings: ['organizations', 'pipelines', 'pipeline_stages', 'risk_rules', 'profiles', 'user_roles'],
  team: ['profiles', 'user_roles', 'invitations', 'portfolio_transfers'],
  // Prévia da carteira no diálogo de desativação (member_portfolio).
  'member-portfolio': ['deals', 'activities', 'contacts', 'companies', 'invitations'],
  audit: ['audit_logs'],
  // Item 1.10: o último registro de privacidade de um contato (a ficha), a página de "Segurança" (com o nome atual do
  // contato e quem fez, pelas FKs, com a situação do papel) e o resumo do diálogo de anonimização, contado sobre os
  // registros da pessoa.
  'privacy-actions': ['privacy_actions'],
  'privacy-actions-page': ['privacy_actions', 'contacts', 'profiles', 'user_roles'],
  'privacy-summary': ['contacts', 'activities', 'deals', 'payments'],
};

/**
 * O que o banco altera junto com a gravação, por gatilho ou FK (além de audit_logs, que audit_record_change preenche em
 * toda gravação das tabelas de negócio):
 * - deals: o histórico de etapas (record_deal_change) e as tarefas e registros das automações (run_deal_automations);
 * - activities e automations: excluir uma delas deixa o registro de automação sem o vínculo (ON DELETE SET NULL);
 * - contacts: excluir um contato deixa o registro de privacidade sem o vínculo (ON DELETE SET NULL, item 1.10);
 * - pipelines e pipeline_stages: excluir um funil remove as etapas, e o filtro das automações é limpo ou pausado.
 * A anonimização (anonymize_contact) e a exportação (export_contact_data) são RPCs: a tela invalida as tabelas que
 * elas alteram (contacts, activities, deals, payments e privacy_actions; na exportação, só privacy_actions).
 */
export const CRM_WRITE_SIDE_EFFECTS: Readonly<Partial<Record<CrmTable, readonly CrmTable[]>>> = {
  deals: ['deal_stage_history', 'activities', 'automation_logs'],
  contacts: ['privacy_actions'],
  activities: ['automation_logs'],
  automations: ['automation_logs'],
  pipelines: ['pipeline_stages', 'automations'],
  pipeline_stages: ['automations'],
};

/** Tabelas alteradas por uma gravação nas tabelas informadas, com os efeitos do banco. */
export function changedTables(written: readonly CrmTable[]): Set<CrmTable> {
  const changed = new Set<CrmTable>(['audit_logs']);
  for (const table of written) {
    changed.add(table);
    for (const effect of CRM_WRITE_SIDE_EFFECTS[table] ?? []) changed.add(effect);
  }
  return changed;
}

/** Verdadeiro se a consulta com esta chave precisa ser recarregada depois de gravar nas tabelas informadas. */
export function readsChangedData(
  queryKey: readonly unknown[],
  changed: ReadonlySet<CrmTable>,
  keep: readonly string[] = [],
) {
  if (queryKey[0] !== 'crm') return false;
  const name = typeof queryKey[2] === 'string' ? queryKey[2] : '';
  if (keep.includes(name)) return false;
  const reads = CRM_QUERY_READS[name];
  return !reads || reads.some((table) => changed.has(table));
}

/**
 * Invalida as consultas do CRM que leem as tabelas gravadas (e as alteradas pelo banco em consequência). `keep` lista
 * consultas que a própria tela já atualizou com a resposta do servidor, como as oportunidades do Pipeline depois de
 * `move_deal`. Telas que gravam em tabelas diferentes conforme a ação (Configurações, Equipe) continuam invalidando
 * ['crm'] inteiro.
 */
export function invalidateCrmTables(
  cache: QueryClient,
  written: readonly CrmTable[],
  { keep = [] }: { keep?: readonly string[] } = {},
) {
  const changed = changedTables(written);
  return cache.invalidateQueries({ predicate: ({ queryKey }) => readsChangedData(queryKey, changed, keep) });
}
