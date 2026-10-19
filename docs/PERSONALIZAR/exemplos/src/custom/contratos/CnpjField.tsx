// Exemplo de docs/PERSONALIZAR/CAMPO.md: o campo "CNPJ" no formulário de empresa. A base ganha uma linha só, marcada
// com o comentário custom:, no lugar em que o campo aparece; a regra e a formatação ficam aqui, em src/custom/.
import { useId, useState } from 'react';
import { Input } from '@/components/ds/input';
import { Label } from '@/components/ui/label';
import { cnpjToSave, formatCnpj } from './cnpj';

interface CnpjFieldProps {
  /** O texto digitado (com ou sem pontuação). */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** "CNPJ", opcional: ao sair do campo, formata o número e mostra o problema, se houver. */
export function CnpjField({ value, onChange, disabled }: CnpjFieldProps) {
  const id = useId();
  // O problema aparece depois que a pessoa sai do campo, e não a cada dígito.
  const [touched, setTouched] = useState(false);
  const problem = touched ? cnpjToSave(value).problem : null;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>CNPJ</Label>
      <Input
        id={id}
        value={value}
        inputMode="numeric"
        maxLength={18}
        placeholder="00.000.000/0000-00"
        disabled={disabled}
        aria-invalid={!!problem}
        aria-describedby={problem ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          setTouched(true);
          onChange(formatCnpj(value));
        }}
      />
      {problem && (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}
