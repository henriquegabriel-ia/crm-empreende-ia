import { DEACTIVATED_MARK, isActiveMember, NO_OWNER_LABEL, personName, type PersonLike } from '@/lib/team-members';

/** Rótulos dos valores fixos do filtro de responsável do Pipeline e dos Relatórios. */
const DEFAULT_LABELS: Readonly<Record<string, string>> = { all: 'Todos os responsáveis', unassigned: NO_OWNER_LABEL };

/**
 * Valor exibido no filtro de responsável do Pipeline e dos Relatórios (achado 6 da revisão do item 1.2): "Todos os
 * responsáveis" inteiro e, para quem foi desativado, o nome corta com reticências e a marca "(desativado)" fica sempre
 * visível. Use dentro do `SelectValue`, com o mesmo `value` do `Select`. `labels` troca os rótulos dos valores fixos,
 * como nos recortes de Hoje, Atividades e Agenda ("Minha rotina", "Toda a organização"; item 1.14).
 */
export function OwnerFilterValue({
  value,
  people,
  labels = DEFAULT_LABELS,
}: {
  value: string;
  people: readonly PersonLike[];
  labels?: Readonly<Record<string, string>>;
}) {
  if (Object.prototype.hasOwnProperty.call(labels, value)) return <>{labels[value]}</>;
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
