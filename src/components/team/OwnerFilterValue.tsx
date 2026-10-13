import { DEACTIVATED_MARK, isActiveMember, NO_OWNER_LABEL, personName, type PersonLike } from '@/lib/team-members';

/**
 * Valor exibido no filtro de responsável do Pipeline e dos Relatórios (achado 6 da revisão do item 1.2): "Todos os
 * responsáveis" inteiro e, para quem foi desativado, o nome corta com reticências e a marca "(desativado)" fica sempre
 * visível. Use dentro do `SelectValue`, com o mesmo `value` do `Select`.
 */
export function OwnerFilterValue({ value, people }: { value: string; people: readonly PersonLike[] }) {
  if (value === 'all') return <>Todos os responsáveis</>;
  if (value === 'unassigned') return <>{NO_OWNER_LABEL}</>;
  const person = people.find((candidate) => candidate.id === value);
  if (!person) return null;
  const name = personName(person) || 'Pessoa sem nome';
  if (isActiveMember(person)) return <>{name}</>;
  return (
    <span className="flex min-w-0 items-center">
      <span className="truncate">{name}</span>
      <span className="shrink-0">&nbsp;{DEACTIVATED_MARK}</span>
    </span>
  );
}
