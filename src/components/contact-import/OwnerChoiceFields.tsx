import { useId } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ds/select';
import { importMemberName, type ImportMember, type OwnerMode } from '@/lib/contact-import';
import { assignableMembers, memberLabel } from '@/lib/team-members';
import { formatCount } from './text';

interface Props {
  members: readonly ImportMember[];
  mode: OwnerMode;
  otherOwnerId: string | null;
  distributeIds: readonly string[];
  distribution: readonly { id: string; count: number }[];
  disabled?: boolean;
  onModeChange: (mode: OwnerMode) => void;
  onOtherOwnerChange: (id: string) => void;
  onDistributeChange: (ids: string[]) => void;
}

/**
 * "Responsável dos contatos sem responsável na planilha" (item 1.11; docs/arquitetura/1.11.md, seção 5.5): você, outra
 * pessoa ou "Distribuir igualmente entre", só com as pessoas ativas (item 1.2), na ordem alfabética da lista. A divisão
 * mostra quantos contatos cada pessoa recebe.
 */
export function OwnerChoiceFields({
  members,
  mode,
  otherOwnerId,
  distributeIds,
  distribution,
  disabled,
  onModeChange,
  onOtherOwnerChange,
  onDistributeChange,
}: Props) {
  const id = useId();
  const people = assignableMembers(members);
  const chosen = new Set(distributeIds);
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">Responsável dos contatos sem responsável na planilha</legend>
      <RadioGroup value={mode} onValueChange={(value) => onModeChange(value as OwnerMode)} className="gap-0">
        {(
          [
            ['me', 'Você'],
            ['other', 'Outra pessoa'],
            ['distribute', 'Distribuir igualmente entre'],
          ] as const
        ).map(([value, label]) => (
          <div key={value} className="eia-touch-row flex items-center gap-2">
            <RadioGroupItem id={`${id}-${value}`} value={value} />
            <Label htmlFor={`${id}-${value}`} className="flex-1 py-2 font-normal">
              {label}
            </Label>
          </div>
        ))}
      </RadioGroup>
      {mode === 'other' && (
        <div className="space-y-1.5 pl-6">
          <Label htmlFor={`${id}-other`}>Pessoa responsável</Label>
          <Select value={otherOwnerId ?? ''} onValueChange={onOtherOwnerChange} disabled={disabled}>
            <SelectTrigger id={`${id}-other`} className="eia-touch-target">
              <SelectValue placeholder="Escolha uma pessoa" />
            </SelectTrigger>
            <SelectContent>
              {people.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {memberLabel(person)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {mode === 'distribute' && (
        <div className="space-y-1 pl-6">
          <div role="group" aria-label="Pessoas para distribuir os contatos">
            {people.map((person) => (
              <div key={person.id} className="eia-touch-row flex items-center gap-2">
                <Checkbox
                  id={`${id}-person-${person.id}`}
                  checked={chosen.has(person.id)}
                  onCheckedChange={(checked) =>
                    onDistributeChange(
                      checked === true
                        ? [...distributeIds, person.id]
                        : distributeIds.filter((current) => current !== person.id),
                    )
                  }
                />
                <Label htmlFor={`${id}-person-${person.id}`} className="flex-1 py-2 font-normal">
                  {memberLabel(person)}
                </Label>
              </div>
            ))}
          </div>
          {distribution.length > 0 && (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {distribution
                .map((item) => `${importMemberName(members, item.id)}: ${formatCount(item.count)}`)
                .join(' · ')}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}
