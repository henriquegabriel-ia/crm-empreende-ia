import type { CrmRow } from '@/integrations/supabase/commercial-types';
import { inReportPeriod, type ReportPeriod } from '@/lib/operation-logic';
import { isActiveMember, memberLabel, type PersonLike } from '@/lib/team-members';

// Fora de operation-logic.ts de propósito: team-members.ts lê o cliente do Supabase, e operation-logic.ts entra no
// typecheck dos tipos do banco com strictNullChecks (tsconfig.typetests.json), que não carrega as variáveis do Vite.

/** Uma linha de "Ganhos por responsável" nos Relatórios. */
export interface OwnerWins {
  /** Responsável das oportunidades; nulo nas que não têm (o banco exige responsável na ganha, então é raro). */
  ownerId: string | null;
  /** "Nome", "Nome (desativado)", "Responsável indisponível" ou "Sem responsável" (memberLabel, item 1.2). */
  label: string;
  /** Oportunidades ganhas no recorte. */
  won: number;
  /** Soma dos valores, em reais. */
  value: number;
}
const compareOwnerLabels = new Intl.Collator('pt-BR', { sensitivity: 'base' }).compare;
/**
 * "Ganhos por responsável" dos Relatórios (item 1.14): as oportunidades ganhas no período pela data de fechamento
 * (`closed_at`, como em reportDateKey, item 0.6), somadas por responsável. Recebe as oportunidades já recortadas pelo
 * funil e pelo responsável escolhidos, como o resto da tela. A ordem segue filterMembers (item 1.2): primeiro quem está
 * ativo, depois quem foi desativado (com a marca), e por último quem não está na equipe ou não tem responsável; em cada
 * grupo, o maior valor ganho primeiro, depois o maior número de ganhas e o nome.
 */
export function winsByOwner(
  deals: Pick<CrmRow<'deals'>, 'status' | 'created_at' | 'closed_at' | 'owner_id' | 'value'>[],
  people: readonly PersonLike[],
  period: ReportPeriod = {},
): OwnerWins[] {
  const groups = new Map<string | null, { won: number; cents: number }>();
  for (const deal of deals) {
    if (deal.status !== 'won' || !inReportPeriod(deal, period.from, period.to)) continue;
    const group = groups.get(deal.owner_id) ?? { won: 0, cents: 0 };
    group.won += 1;
    group.cents += Math.round(deal.value * 100);
    groups.set(deal.owner_id, group);
  }
  const byId = new Map(people.map((person) => [person.id, person]));
  return [...groups]
    .map(([ownerId, group]) => {
      const person = ownerId ? byId.get(ownerId) : undefined;
      return {
        row: { ownerId, label: memberLabel(person, ownerId), won: group.won, value: group.cents / 100 },
        rank: person ? (isActiveMember(person) ? 0 : 1) : 2,
        cents: group.cents,
      };
    })
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        b.cents - a.cents ||
        b.row.won - a.row.won ||
        compareOwnerLabels(a.row.label, b.row.label) ||
        (a.row.ownerId ?? '').localeCompare(b.row.ownerId ?? ''),
    )
    .map(({ row }) => row);
}
