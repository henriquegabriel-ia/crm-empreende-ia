import { filterMembers, type PersonLike } from '@/lib/team-members';

// Filtro de responsável das telas de rotina (item 1.14; docs/arquitetura/1.14.md): Hoje, Atividades, Tarefas e Agenda.
// Além dos recortes de antes ("Minha rotina", "Toda a organização" e, fora de Hoje, "Sem responsável"), uma pessoa da
// equipe, pelo id no parâmetro `owner` da URL. A lista das pessoas segue filterMembers (item 1.2): as ativas e, depois,
// as desativadas, marcadas "(desativado)" pelo memberLabel, para ver a carteira que ficou com quem saiu.

/** Recortes fixos, na ordem em que as telas os oferecem. */
export const OWNER_SCOPES = ['mine', 'all', 'unassigned'] as const;
export type OwnerScope = (typeof OWNER_SCOPES)[number];

export interface OwnerFilter {
  /** O valor do seletor e do parâmetro `owner`: um recorte fixo ou o id da pessoa. */
  value: string;
  scope: OwnerScope | 'person';
  /** A pessoa escolhida, só no recorte de uma pessoa. */
  person: PersonLike | null;
  /** De quem são as atividades do recorte: a conta que usa o CRM em "mine" e a pessoa escolhida; nulo nos demais. */
  ownerId: string | null;
}

export interface OwnerFilterContext {
  /** Recortes fixos que a tela oferece. */
  scopes: readonly OwnerScope[];
  /** Recorte de um valor ausente ou desconhecido. */
  fallback: OwnerScope;
  userId: string | null | undefined;
  /** A equipe, com a situação de cada pessoa (o snapshot já a traz). */
  members: readonly PersonLike[];
  /** O papel deixa ver a rotina de outra pessoa (useCrmPermissions().canViewTeam). */
  canViewTeam: boolean;
}

/**
 * Lê o parâmetro `owner`. Um recorte fixo vale se a tela o oferece; o id da própria conta vira "mine"; o id de outra
 * pessoa vale só para quem vê a equipe e só se ela estiver na equipe (desativada também). Qualquer outro valor (um id
 * que não é da equipe, um papel que não vê a equipe, a equipe ainda carregando) fica no recorte padrão, sem trocar a
 * URL, como os demais filtros das telas.
 */
export function readOwnerFilter(raw: string | null | undefined, context: OwnerFilterContext): OwnerFilter {
  const { scopes, fallback, userId, members, canViewTeam } = context;
  const fixed = (scope: OwnerScope): OwnerFilter => ({
    value: scope,
    scope,
    person: null,
    ownerId: scope === 'mine' ? (userId ?? null) : null,
  });
  if (raw && (scopes as readonly string[]).includes(raw)) return fixed(raw as OwnerScope);
  if (raw && userId && raw === userId && scopes.includes('mine')) return fixed('mine');
  const person = raw && canViewTeam ? members.find((member) => member.id === raw) : undefined;
  return person ? { value: person.id, scope: 'person', person, ownerId: person.id } : fixed(fallback);
}

/** Pessoas do seletor: a equipe sem a própria conta, que tem o recorte "mine"; as ativas e, depois, as desativadas. */
export function ownerFilterPeople<T extends PersonLike>(members: readonly T[], userId: string | null | undefined): T[] {
  return filterMembers(members.filter((member) => member.id !== userId));
}

/** O responsável de um registro (`user_id` da atividade) entra no recorte. */
export function matchesOwnerFilter(assigneeId: string | null | undefined, filter: OwnerFilter) {
  if (filter.scope === 'all') return true;
  if (filter.scope === 'unassigned') return !assigneeId;
  return !!filter.ownerId && assigneeId === filter.ownerId;
}
