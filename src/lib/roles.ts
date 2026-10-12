/** Papéis de user_roles (CHECK em commercial_foundation.sql), na ordem de exibição. */
export const CRM_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type CrmRole = (typeof CRM_ROLES)[number];

/** Gravam registros comerciais: o mesmo critério de private.can_write no banco. */
export const EDITOR_ROLES: readonly CrmRole[] = ['owner', 'admin', 'member'];
/** Gerenciam equipe e configurações: o mesmo critério de private.can_manage no banco. */
export const MANAGER_ROLES: readonly CrmRole[] = ['owner', 'admin'];

export const CRM_ROLE_LABELS: Record<CrmRole, string> = {
  owner: 'Dono',
  admin: 'Administrador',
  member: 'Colaborador',
  viewer: 'Somente leitura',
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
