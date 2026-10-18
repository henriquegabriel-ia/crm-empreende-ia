/** Papéis de user_roles (CHECK em commercial_foundation.sql), na ordem de exibição. */
export const CRM_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type CrmRole = (typeof CRM_ROLES)[number];

/** Gravam registros comerciais: o mesmo critério de private.can_write no banco. */
export const EDITOR_ROLES: readonly CrmRole[] = ['owner', 'admin', 'member'];
/** Gerenciam equipe e configurações: o mesmo critério de private.can_manage no banco. */
export const MANAGER_ROLES: readonly CrmRole[] = ['owner', 'admin'];
/**
 * Veem o trabalho de outras pessoas: o recorte de uma pessoa da equipe em Hoje, Atividades, Tarefas e Agenda (item
 * 1.14). Hoje, todos os papéis, porque a carteira é visível para toda a equipe: a D11 tem "todos veem tudo" como padrão,
 * e a política tenant_read de cada tabela comercial vale para a organização inteira (qualquer papel já escolhe "Toda a
 * organização"). A visibilidade por responsável (2A.6) muda este grupo junto com as políticas.
 */
export const TEAM_VIEWER_ROLES: readonly CrmRole[] = CRM_ROLES;

export const CRM_ROLE_LABELS: Record<CrmRole, string> = {
  owner: 'Dono',
  admin: 'Administrador',
  member: 'Colaborador',
  viewer: 'Somente leitura',
};

/**
 * O que cada papel faz, nas mesmas palavras da Ajuda ("O que cada papel pode fazer?", em faq-content.ts): a Equipe as
 * mostra em cada pessoa e nos diálogos de papel e de reativação.
 */
export const ROLE_DESCRIPTIONS: Record<CrmRole, string> = {
  owner:
    'Faz tudo o que o administrador faz e também convida donos, altera o papel de outros donos e desativa ou reativa donos.',
  admin:
    'Convida pessoas, altera papéis, desativa e reativa pessoas (menos donos), configura o CRM e as automações, exporta dados e exclui registros.',
  member:
    'Cria e edita contatos, empresas, oportunidades, atividades, lançamentos e modelos e importa contatos. Não exclui registros nem altera configurações.',
  viewer: 'Consulta os registros. Não cria nem altera dados ou configurações.',
};

const ROLE_GROUPS: Record<CrmRole, string> = {
  owner: 'donos',
  admin: 'administradores',
  member: 'colaboradores',
  viewer: 'pessoas com acesso somente leitura',
};

export function isCrmRole(value: unknown): value is CrmRole {
  return typeof value === 'string' && (CRM_ROLES as readonly string[]).includes(value);
}

/** "donos e administradores", "donos, administradores e colaboradores". */
export function roleGroupList(roles: readonly CrmRole[]): string {
  const groups = CRM_ROLES.filter((role) => roles.includes(role)).map((role) => ROLE_GROUPS[role]);
  return groups.length > 1 ? `${groups.slice(0, -1).join(', ')} e ${groups[groups.length - 1]}` : (groups[0] ?? '');
}

/**
 * Quem concede qual papel: o mesmo critério de private.role_change_allowed no banco (item 1.2). O dono mexe em tudo; o
 * administrador não mexe em dono nem concede o papel de Dono. `from` é o papel atual (nulo num convite novo) e `to`, o
 * papel concedido. Com o papel do autor em `actor` e o papel de um convite em `to`, diz se o convite continua valendo.
 */
export function roleChangeAllowed(actor: string | null | undefined, from: string | null | undefined, to: string) {
  return actor === 'owner' || (actor === 'admin' && from !== 'owner' && to !== 'owner');
}
