import { crmDb } from '@/integrations/supabase/crm-client';
import { allCrmRows } from '@/lib/crm-pagination';
import { linkSummary } from '@/lib/record-links';
import { isCrmRole, type CrmRole } from '@/lib/roles';

// Membros com a situação do papel (item 1.2; docs/arquitetura/1.2.md, seção 5.1): a fonte única das telas para saber
// quem está ativo e quem foi desativado. O nome de quem foi desativado continua no histórico, com a marca
// "(desativado)", mas sai dos seletores de responsável.

export const DEACTIVATED_MARK = '(desativado)';
export const NO_OWNER_LABEL = 'Sem responsável';
export const UNAVAILABLE_OWNER_LABEL = 'Responsável indisponível';

/** Membro da organização com o papel e a situação. Sem papel na organização, a pessoa conta como desativada. */
export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: CrmRole | null;
  active: boolean;
  deactivatedAt: string | null;
}

/**
 * Pessoa como as telas a recebem: perfis do snapshot (`name`), pessoas do Pipeline (`full_name`) e membros da Equipe.
 * Sem `active` (dados montados antes do item, ou por testes), a pessoa conta como ativa.
 */
export interface PersonLike {
  id: string;
  name?: string | null;
  full_name?: string | null;
  email?: string | null;
  active?: boolean;
}

export interface MemberRole {
  userId: string;
  role: CrmRole | null;
  deactivatedAt: string | null;
}

/**
 * Leitura de user_roles em páginas, com as colunas pedidas (cada tela usa a sua paginação); o padrão segue a da Equipe.
 * As colunas variam conforme o banco tenha ou não a migração, por isso as linhas chegam sem tipo e são lidas aqui.
 */
export type RoleReader = (columns: string) => Promise<unknown[]>;

const defaultRoleReader =
  (orgId: string): RoleReader =>
  (columns) =>
    allCrmRows((from, to) => crmDb.from('user_roles').select(columns).eq('org_id', orgId).order('id').range(from, to));

/** Coluna ausente: o banco ainda sem a migração do item 1.2 (PostgreSQL 42703; PGRST204 no cache do PostgREST). */
export function isMissingColumn(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return code === '42703' || code === 'PGRST204';
}

/**
 * Papéis da organização com a data da desativação. Num banco sem a migração, lê só o papel e trata todos como ativos:
 * ninguém fica em modo leitura por engano (AC-22).
 */
export async function readMemberRoles(
  orgId: string,
  read: RoleReader = defaultRoleReader(orgId),
): Promise<MemberRole[]> {
  let rows: unknown[];
  try {
    rows = await read('id,user_id,role,deactivated_at');
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    rows = await read('id,user_id,role');
  }
  return (rows as Record<string, unknown>[]).map((row) => ({
    userId: String(row.user_id),
    role: isCrmRole(row.role) ? row.role : null,
    deactivatedAt: typeof row.deactivated_at === 'string' ? row.deactivated_at : null,
  }));
}

/** Junta perfis e papéis por id: ativo é quem tem papel na organização e não foi desativado. */
export function withMemberStates<P extends { id: string }>(profiles: P[], roles: MemberRole[]) {
  const byUser = new Map(roles.map((role) => [role.userId, role]));
  return profiles.map((profile) => {
    const role = byUser.get(profile.id);
    return {
      ...profile,
      role: role?.role ?? null,
      active: Boolean(role) && !role?.deactivatedAt,
      deactivatedAt: role?.deactivatedAt ?? null,
    };
  });
}

/** Perfis e papéis da organização, lidos em paralelo (a Equipe). */
export async function loadTeamMembers(orgId: string): Promise<TeamMember[]> {
  const [profiles, roles] = await Promise.all([
    allCrmRows((from, to) =>
      crmDb.from('profiles').select('id,name,email').eq('org_id', orgId).order('id').range(from, to),
    ),
    readMemberRoles(orgId),
  ]);
  return withMemberStates(
    profiles.map((profile) => ({ id: profile.id, name: profile.name ?? '', email: profile.email ?? '' })),
    roles,
  );
}

export const isActiveMember = (person: Pick<PersonLike, 'active'>) => person.active !== false;

/** Nome da pessoa, ou o e-mail quando o nome está vazio. */
export function personName(person: PersonLike) {
  return (person.name ?? person.full_name ?? '').trim() || (person.email ?? '').trim();
}

/**
 * Como a pessoa aparece em cartões, listas, históricos, relatórios e no CSV: "Nome" ou "Nome (desativado)". Sem a
 * pessoa: "Responsável indisponível" quando há um id que não está na lista, e "Sem responsável" quando não há.
 */
export function memberLabel(person: PersonLike | null | undefined, id?: string | null) {
  if (!person) return id ? UNAVAILABLE_OWNER_LABEL : NO_OWNER_LABEL;
  const name = personName(person) || 'Pessoa sem nome';
  return isActiveMember(person) ? name : `${name} ${DEACTIVATED_MARK}`;
}

const byName = new Intl.Collator('pt-BR', { sensitivity: 'base' });
const compareByName = (a: PersonLike, b: PersonLike) =>
  byName.compare(personName(a), personName(b)) || a.id.localeCompare(b.id);

/**
 * Pessoas oferecidas num seletor de responsável: as ativas, em ordem alfabética, e, por último, o responsável atual se
 * ele estiver desativado (o seletor mostra o valor, marcado, e a pessoa troca por outra).
 */
export function assignableMembers<T extends PersonLike>(members: readonly T[], currentId?: string | null): T[] {
  const active = members.filter(isActiveMember).sort(compareByName);
  const current = currentId ? members.find((member) => member.id === currentId) : undefined;
  return current && !isActiveMember(current) ? [...active, current] : active;
}

/** Responsável padrão de uma ação nova: o preferido (o dono do registro) se estiver ativo; senão, quem está usando. */
export function defaultAssignee(
  preferred: string | null | undefined,
  members: readonly PersonLike[],
  me: string | null,
) {
  const person = preferred ? members.find((member) => member.id === preferred) : undefined;
  return person && isActiveMember(person) ? person.id : me;
}

/** Filtros de responsável (Pipeline, Relatórios): os ativos e, depois, os desativados, marcados pelo memberLabel. */
export function filterMembers<T extends PersonLike>(members: readonly T[]): T[] {
  return [
    ...members.filter(isActiveMember).sort(compareByName),
    ...members.filter((member) => !isActiveMember(member)).sort(compareByName),
  ];
}

export interface PortfolioCounts {
  deals: number;
  activities: number;
  contacts: number;
  companies: number;
  invitations: number;
}
const PORTFOLIO_KEYS = ['deals', 'activities', 'contacts', 'companies', 'invitations'] as const;

/**
 * Contagens da carteira: a linha devolvida por member_portfolio, deactivate_member e transfer_portfolio, ou o texto
 * JSON de `details` quando a desativação é recusada sem destinatário. Devolve null para qualquer outro formato.
 */
export function readPortfolioCounts(value: unknown): PortfolioCounts | null {
  let parsed = Array.isArray(value) ? value[0] : value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (!PORTFOLIO_KEYS.every((key) => Number.isInteger(record[key]) && Number(record[key]) >= 0)) return null;
  return {
    deals: Number(record.deals),
    activities: Number(record.activities),
    contacts: Number(record.contacts),
    companies: Number(record.companies),
    invitations: Number(record.invitations),
  };
}

/** "3 oportunidades em aberto, 5 atividades pendentes, 12 contatos e 2 empresas", sem as contagens zeradas. */
export function portfolioSummary(counts: Pick<PortfolioCounts, 'deals' | 'activities' | 'contacts' | 'companies'>) {
  return linkSummary([
    [counts.deals, 'oportunidade em aberto', 'oportunidades em aberto'],
    [counts.activities, 'atividade pendente', 'atividades pendentes'],
    [counts.contacts, 'contato', 'contatos'],
    [counts.companies, 'empresa', 'empresas'],
  ]);
}

/** Total do que passa: oportunidades e atividades sempre; contatos e empresas só com `accounts`. */
export function portfolioToPass(counts: PortfolioCounts, accounts: boolean) {
  return counts.deals + counts.activities + (accounts ? counts.contacts + counts.companies : 0);
}
