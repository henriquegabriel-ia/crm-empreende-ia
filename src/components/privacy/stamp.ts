import { memberLabel, type PersonLike } from '@/lib/team-members';

/** Data curta da tela ("13/10/2026"); uma data ilegível não vira texto. */
export function shortDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(date) : null;
}

/**
 * O carimbo que o banco grava (item 1.10), em texto: "Registrada por Ana Lima em 12/10/2026.", com a marca
 * "(desativado)" de quem saiu da equipe (item 1.2). Sem autor (a chave service_role e o editor SQL gravam com o autor
 * nulo), só a data; com o autor fora da equipe carregada, "por uma pessoa indisponível", como a faixa "Não contatar".
 * Sem data, nada.
 */
export function authorStamp(
  verb: string,
  at: string | null | undefined,
  by: string | null | undefined,
  members: readonly PersonLike[],
): string | null {
  const date = shortDate(at);
  if (!date) return null;
  const author = by ? members.find((member) => member.id === by) : undefined;
  const who = author ? ` por ${memberLabel(author)}` : by ? ' por uma pessoa indisponível' : '';
  return `${verb}${who} em ${date}.`;
}
