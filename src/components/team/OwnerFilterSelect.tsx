import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ds/select';
import { OwnerFilterValue } from '@/components/team/OwnerFilterValue';
import type { OwnerScope } from '@/lib/owner-filter';
import { memberLabel, type PersonLike } from '@/lib/team-members';

interface Props {
  /** O valor lido por readOwnerFilter: um recorte fixo ou o id da pessoa. */
  value: string;
  onValueChange: (value: string) => void;
  /** Os recortes fixos que a tela oferece, na ordem, com os rótulos dela ("Minha rotina", "Toda a organização"…). */
  scopes: readonly { value: OwnerScope; label: string }[];
  /** As pessoas da lista (ownerFilterPeople): vazia para quem não vê a equipe, e o grupo não aparece. */
  people: readonly PersonLike[];
  ariaLabel: string;
  className?: string;
}

/**
 * Seletor de responsável das telas de rotina (item 1.14): os recortes fixos da tela e, abaixo, o grupo "Pessoas", com
 * as ativas e as desativadas marcadas "(desativado)". O valor exibido mantém a marca fora do corte do nome
 * (OwnerFilterValue, como no Pipeline e nos Relatórios).
 */
export function OwnerFilterSelect({ value, onValueChange, scopes, people, ariaLabel, className }: Props) {
  const labels = Object.fromEntries(scopes.map((scope) => [scope.value, scope.label]));
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={className} aria-label={ariaLabel}>
        <SelectValue>
          <OwnerFilterValue value={value} people={people} labels={labels} />
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {scopes.map((scope) => (
          <SelectItem key={scope.value} value={scope.value}>
            {scope.label}
          </SelectItem>
        ))}
        {people.length > 0 && (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Pessoas</SelectLabel>
              {people.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {memberLabel(person)}
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}
      </SelectContent>
    </Select>
  );
}
